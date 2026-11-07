package app

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// Moving a restaurant to another computer. The file carries what the business
// owns: the menu with its pictures, stock, customers, sales history and the
// restaurant's settings. What belongs to one computer or one person stays
// behind: users, devices, the license, sessions and the audit log.
//
// Records keep their ids, so uploading the same file twice adds nothing.
// Sales point at a user and a device that don't exist on the new computer, so
// those links aren't carried: on arrival they go to the owner doing the import
// and to this computer.
//
// A file is applied in one transaction, after an automatic backup: every row
// goes in, or nothing does.

const (
	transferExcel  = "data.xlsx"
	transferImages = "images/"
	maxTransferRow = 500000
	maxIssues      = 500
	excelCellLimit = 32767
	maxImageFile   = 8 << 20
)

// transferGroup is a part of the business, as the owner sees it.
type transferGroup struct {
	label  tr
	tables []string
}

var transferGroups = []transferGroup{
	{tr{"قائمة الطعام", "Menu", "Menu"}, []string{"categories", "kitchen_stations", "items", "modifier_groups", "modifiers", "item_modifier_groups",
		"recipe_lines", "modifier_recipe_lines", "dining_tables", "emenu_offers", "emenu_offer_items", "emenu_featured"}},
	{tr{"المخزون والموردون", "Stock and suppliers", "Stock et fournisseurs"}, []string{"ingredients", "suppliers", "purchases", "purchase_lines",
		"stock_movements", "stock_counts", "stock_count_lines", "waste_entries"}},
	{tr{"العملاء", "Customers", "Clients"}, []string{"customers"}},
	{tr{"المبيعات والورديات", "Sales and shifts", "Ventes et services"}, []string{"shifts", "cash_movements", "shift_recounts", "orders", "order_lines",
		"order_line_modifiers", "payments", "invoices", "refunds", "refund_lines"}},
	{tr{"إعدادات المطعم", "Restaurant settings", "Paramètres du restaurant"}, []string{"settings"}},
}

func transferTables() map[string]bool {
	out := map[string]bool{}
	for _, g := range transferGroups {
		for _, t := range g.tables {
			out[t] = true
		}
	}
	return out
}

// Only the restaurant's own settings travel. The rest of that table is this
// computer's: its device id and the Platform license.
const transferSettings = `key IN ('` + settingsKey + `','` + emenuKey + `')`

func requireOwner(actor Actor) error {
	if actor.Role != rbac.Owner {
		return errForbidden
	}
	return nil
}

type transferColumn struct {
	name     string
	integer  bool
	required bool // NOT NULL with no default
	pk       bool
	fill     string // "user" or "device": a link that doesn't travel
}

// quote is only ever applied to names from transferGroups or the schema.
func quote(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }

func transferColumns(ctx context.Context, q sqlite.Querier, table string) ([]transferColumn, error) {
	links := map[string]string{}
	rows, err := q.QueryContext(ctx, `SELECT "from", "table" FROM pragma_foreign_key_list(?)`, table)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var from, parent string
		if err := rows.Scan(&from, &parent); err != nil {
			rows.Close()
			return nil, err
		}
		switch parent {
		case "users":
			links[from] = "user"
		case "devices":
			links[from] = "device"
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = q.QueryContext(ctx, `SELECT name, type, "notnull", dflt_value IS NOT NULL, pk FROM pragma_table_info(?) ORDER BY cid`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []transferColumn{}
	for rows.Next() {
		var name, typ string
		var notNull, hasDefault, pk int
		if err := rows.Scan(&name, &typ, &notNull, &hasDefault, &pk); err != nil {
			return nil, err
		}
		out = append(out, transferColumn{name: name, integer: strings.EqualFold(typ, "INTEGER"), required: notNull == 1 && hasDefault == 0, pk: pk > 0, fill: links[name]})
	}
	return out, rows.Err()
}

func tableFilter(table string) string {
	if table == "settings" {
		return ` WHERE ` + transferSettings
	}
	return ""
}

// TransferGroup is one line of what the file will hold.
type TransferGroup struct {
	Label string `json:"label"`
	Rows  int64  `json:"rows"`
}

type TransferSummary struct {
	Groups     []TransferGroup `json:"groups"`
	Images     int             `json:"images"`
	OpenShifts int             `json:"open_shifts"`
}

// TransferSummary says what a transfer file would hold, for the owner.
func (a *App) TransferSummary(ctx context.Context, actor Actor, lang string) (TransferSummary, error) {
	var s TransferSummary
	if err := requireOwner(actor); err != nil {
		return s, err
	}
	for _, g := range transferGroups {
		line := TransferGroup{Label: g.label.in(lang)}
		for _, t := range g.tables {
			var n int64
			if err := a.db.Read.QueryRowContext(ctx, `SELECT count(*) FROM `+quote(t)+tableFilter(t)).Scan(&n); err != nil {
				return s, err
			}
			line.Rows += n
		}
		s.Groups = append(s.Groups, line)
	}
	names, err := a.imageFiles()
	if err != nil {
		return s, err
	}
	s.Images = len(names)
	err = a.db.Read.QueryRowContext(ctx, `SELECT count(*) FROM shifts WHERE status = 'open'`).Scan(&s.OpenShifts)
	return s, err
}

func (a *App) imageFiles() ([]string, error) {
	entries, err := os.ReadDir(a.paths.Images)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, e := range entries {
		if !e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

// ExportTransfer builds the file to carry to the new computer: a zip with
// the data as Excel (one sheet per table) and the pictures.
func (a *App) ExportTransfer(ctx context.Context, actor Actor) ([]byte, string, error) {
	if err := requireOwner(actor); err != nil {
		return nil, "", err
	}
	f := excelize.NewFile()
	defer f.Close()
	first := true
	for _, g := range transferGroups {
		for _, t := range g.tables {
			if first {
				f.SetSheetName("Sheet1", t)
				first = false
			} else if _, err := f.NewSheet(t); err != nil {
				return nil, "", err
			}
			if err := a.writeTable(ctx, f, t); err != nil {
				return nil, "", err
			}
		}
	}
	var out bytes.Buffer
	z := zip.NewWriter(&out)
	w, err := z.Create(transferExcel)
	if err != nil {
		return nil, "", err
	}
	if err := f.Write(w); err != nil {
		return nil, "", err
	}
	images, err := a.imageFiles()
	if err != nil {
		return nil, "", err
	}
	for _, name := range images {
		b, err := os.ReadFile(filepath.Join(a.paths.Images, name))
		if err != nil {
			return nil, "", err
		}
		w, err := z.CreateHeader(&zip.FileHeader{Name: transferImages + name, Method: zip.Store}) // already compressed
		if err != nil {
			return nil, "", err
		}
		if _, err := w.Write(b); err != nil {
			return nil, "", err
		}
	}
	if err := z.Close(); err != nil {
		return nil, "", err
	}
	if err := a.audit(ctx, a.db.Write, actor, "data.transfer_export", "transfer", "", nil); err != nil {
		return nil, "", err
	}
	return out.Bytes(), fmt.Sprintf("cpro-transfer-%s.zip", a.now().Format("2006-01-02")), nil
}

func (a *App) writeTable(ctx context.Context, f *excelize.File, table string) error {
	all, err := transferColumns(ctx, a.db.Read, table)
	if err != nil {
		return err
	}
	cols := []transferColumn{}
	names, head := []string{}, []any{}
	for _, c := range all {
		if c.fill == "" {
			cols = append(cols, c)
			names, head = append(names, quote(c.name)), append(head, c.name)
		}
	}
	sw, err := f.NewStreamWriter(table)
	if err != nil {
		return err
	}
	if err := sw.SetRow("A1", head); err != nil {
		return err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT `+strings.Join(names, ",")+` FROM `+quote(table)+tableFilter(table))
	if err != nil {
		return err
	}
	defer rows.Close()
	line := 1
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		for i, v := range vals {
			if b, ok := v.([]byte); ok {
				v, vals[i] = string(b), string(b)
			}
			// Excel would cut it, and a file that loses data silently is worse than none.
			if s, ok := v.(string); ok && len(s) > excelCellLimit {
				return invalid(fmt.Sprintf("قيمة في جدول %s أطول من حد خلية Excel", table))
			}
		}
		line++
		cell, _ := excelize.CoordinatesToCellName(1, line)
		if err := sw.SetRow(cell, vals); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return sw.Flush()
}

// TransferResult is what happened to an uploaded file.
type TransferResult struct {
	Inserted int           `json:"inserted"`
	Updated  int           `json:"updated"`
	Images   int           `json:"images"`
	Issues   []ImportIssue `json:"issues"`
	Backup   string        `json:"backup"`
}

var errTransferIssues = errors.New("transfer has issues")

type transferRun struct {
	ctx    context.Context
	tx     *sql.Tx
	res    *TransferResult
	rows   map[string]map[string]int // table -> primary key -> Excel row
	now    string
	user   string
	device string
}

func (r *transferRun) issue(table string, row int, col, code, val string) {
	if len(r.res.Issues) < maxIssues {
		r.res.Issues = append(r.res.Issues, ImportIssue{Row: row, Column: table + " · " + col, Code: code, Value: val})
	}
}

// openTransfer takes the zip from ExportTransfer, or a bare workbook (the zip's
// data.xlsx after editing it).
func openTransfer(data []byte) (*excelize.File, []*zip.File, error) {
	bad := invalid("هذا الملف ليس ملف نقل بيانات. استخدم الملف الذي نزّلته من «نقل البيانات»")
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, bad
	}
	var excel *zip.File
	var images []*zip.File
	for _, e := range z.File {
		switch {
		case e.Name == transferExcel:
			excel = e
		case strings.HasPrefix(e.Name, transferImages) && !e.FileInfo().IsDir():
			images = append(images, e)
		}
	}
	if excel == nil {
		f, err := excelize.OpenReader(bytes.NewReader(data))
		if err != nil {
			return nil, nil, bad
		}
		return f, nil, nil
	}
	rc, err := excel.Open()
	if err != nil {
		return nil, nil, bad
	}
	defer rc.Close()
	f, err := excelize.OpenReader(rc)
	if err != nil {
		return nil, nil, bad
	}
	return f, images, nil
}

// ImportTransfer applies a transfer file on this computer. A row whose id
// exists is updated (an empty cell keeps the current value); any other is added.
func (a *App) ImportTransfer(ctx context.Context, actor Actor, data []byte) (TransferResult, error) {
	res := TransferResult{Issues: []ImportIssue{}}
	if err := requireOwner(actor); err != nil {
		return res, err
	}
	f, images, err := openTransfer(data)
	if err != nil {
		return res, err
	}
	defer f.Close()
	sheets := map[string]bool{}
	for _, s := range f.GetSheetList() {
		sheets[s] = true
	}
	known := false
	for t := range transferTables() {
		known = known || sheets[t]
	}
	if !known {
		return res, invalid("هذا الملف ليس ملف نقل بيانات. استخدم الملف الذي نزّلته من «نقل البيانات»")
	}
	device, err := a.EnsureTerminal(ctx)
	if err != nil {
		return res, err
	}
	cur, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return res, err
	}

	// The way back if a good-looking file turns out to be the wrong one.
	backup, err := a.BackupNow(ctx, Actor{}, "pre-import")
	if err != nil {
		return res, err
	}
	res.Backup = backup.Name

	err = a.tx(ctx, func(tx *sql.Tx) error {
		// Sheets may come in any order: links are checked once all are in.
		if _, err := tx.ExecContext(ctx, `PRAGMA defer_foreign_keys = ON`); err != nil {
			return err
		}
		r := &transferRun{ctx: ctx, tx: tx, res: &res, rows: map[string]map[string]int{}, now: a.stamp(), user: actor.UserID, device: device}
		total := 0
		for _, g := range transferGroups {
			for _, t := range g.tables {
				if !sheets[t] {
					continue
				}
				rows, err := f.GetRows(t, excelize.Options{RawCellValue: true})
				if err != nil {
					return err
				}
				if total += len(rows); total > maxTransferRow {
					return invalid(fmt.Sprintf("الحد الأقصى %d صف في الملف الواحد", maxTransferRow))
				}
				if err := r.table(t, rows, cur); err != nil {
					return err
				}
			}
		}
		if err := r.checkReferences(); err != nil {
			return err
		}
		if err := r.syncInvoiceCounters(); err != nil {
			return err
		}
		if len(res.Issues) > 0 {
			return errTransferIssues
		}
		return a.audit(ctx, tx, actor, "data.transfer_import", "transfer", "",
			map[string]any{"inserted": res.Inserted, "updated": res.Updated, "backup": res.Backup})
	})
	if err != nil {
		res.Inserted, res.Updated = 0, 0
		if errors.Is(err, errTransferIssues) {
			return res, nil
		}
		return res, err
	}
	// Settings are cached in memory.
	a.emenuMu.Lock()
	a.emenuLoaded, a.emenuLocal = false, nil
	a.emenuMu.Unlock()
	res.Images = a.restoreImages(images)
	return res, nil
}

// restoreImages copies the pictures in. They're served to guests, so each must
// really be a picture, whatever its name says. Existing files stay.
func (a *App) restoreImages(files []*zip.File) int {
	n := 0
	for _, e := range files {
		name := strings.TrimPrefix(e.Name, transferImages)
		p, ok := a.ImagePath(name)
		if !ok || e.UncompressedSize64 > maxImageFile {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxImageFile))
		rc.Close()
		if err == nil && a.saveImage(name, p, b) {
			n++
		}
	}
	return n
}

// saveImage writes a picture that came from a file, if it really is a picture.
func (a *App) saveImage(name, path string, b []byte) bool {
	if imageExt[http.DetectContentType(b)] != strings.ToLower(filepath.Ext(name)) {
		return false
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		a.log.Error("restore image", "name", name, "err", err)
		return false
	}
	return true
}

func (r *transferRun) table(table string, rows [][]string, cur Settings) error {
	cols, err := transferColumns(r.ctx, r.tx, table)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	index := map[string]int{}
	for i, h := range rows[0] {
		index[strings.TrimSpace(h)] = i
	}
	var pks []transferColumn
	for _, c := range cols {
		if c.pk {
			pks = append(pks, c)
		}
	}
	if r.rows[table] == nil {
		r.rows[table] = map[string]int{}
	}
	for n := 1; n < len(rows); n++ {
		if err := r.row(table, cols, pks, index, rows[n], n+1, cur); err != nil {
			return err
		}
	}
	return nil
}

func (r *transferRun) row(table string, cols, pks []transferColumn, index map[string]int, cells []string, excelRow int, cur Settings) error {
	vals := map[string]any{}
	bad := false
	for _, c := range cols {
		i, ok := index[c.name]
		if !ok || i >= len(cells) || c.fill != "" { // user and device links never come from a file
			continue
		}
		raw := strings.TrimSpace(cells[i])
		if raw == "" {
			continue
		}
		if !c.integer {
			vals[c.name] = raw
			continue
		}
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			fl, ferr := strconv.ParseFloat(raw, 64)
			if ferr != nil || fl != float64(int64(fl)) {
				r.issue(table, excelRow, c.name, "invalid_integer", raw)
				bad = true
				continue
			}
			n = int64(fl)
		}
		vals[c.name] = n
	}
	if len(vals) == 0 {
		return nil // an empty row
	}
	if table == "settings" && !r.settingsRow(vals, excelRow, cur) {
		return nil
	}
	if bad {
		return nil
	}

	// A row with no id is a new one.
	if len(pks) == 1 && pks[0].name == "id" && vals["id"] == nil {
		vals["id"] = sqlite.NewID()
	}
	keys := make([]any, 0, len(pks))
	where := make([]string, 0, len(pks))
	for _, p := range pks {
		if vals[p.name] == nil {
			r.issue(table, excelRow, p.name, "required", "")
			return nil
		}
		keys = append(keys, vals[p.name])
		where = append(where, quote(p.name)+" = ?")
	}
	var found int
	q := `SELECT count(*) FROM ` + quote(table) + ` WHERE ` + strings.Join(where, " AND ")
	if err := r.tx.QueryRowContext(r.ctx, q, keys...).Scan(&found); err != nil {
		return err
	}
	r.rows[table][pkKey(keys)] = excelRow
	if found > 0 {
		return r.update(table, cols, where, keys, vals, excelRow)
	}
	return r.insert(table, cols, vals, excelRow)
}

// settingsRow keeps what the app reads at start-up valid: broken settings
// would stop it opening. The backup folder is a path on the old computer, so
// this one's is kept.
func (r *transferRun) settingsRow(vals map[string]any, excelRow int, cur Settings) bool {
	key, _ := vals["key"].(string)
	value, _ := vals["value"].(string)
	switch key {
	case settingsKey:
		s := defaultSettings()
		if err := json.Unmarshal([]byte(value), &s); err != nil {
			r.issue("settings", excelRow, "value", "invalid_json", key)
			return false
		}
		if err := validateSettings(&s); err != nil {
			r.issue("settings", excelRow, "value", "invalid_choice", err.Error())
			return false
		}
		s.BackupDir = cur.BackupDir
		b, err := json.Marshal(s)
		if err != nil {
			r.issue("settings", excelRow, "value", "invalid_json", key)
			return false
		}
		vals["value"] = string(b)
		return true
	case emenuKey:
		if !json.Valid([]byte(value)) {
			r.issue("settings", excelRow, "value", "invalid_json", key)
			return false
		}
		return true
	}
	r.issue("settings", excelRow, "key", "invalid_choice", key)
	return false
}

func pkKey(keys []any) string {
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = fmt.Sprint(k)
	}
	return strings.Join(parts, " ")
}

func (r *transferRun) update(table string, cols []transferColumn, where []string, keys []any, vals map[string]any, excelRow int) error {
	set := []string{}
	args := []any{}
	for _, c := range cols {
		if v, ok := vals[c.name]; ok && !c.pk {
			set = append(set, quote(c.name)+" = ?")
			args = append(args, v)
		}
	}
	if len(set) == 0 {
		return nil
	}
	q := `UPDATE ` + quote(table) + ` SET ` + strings.Join(set, ",") + ` WHERE ` + strings.Join(where, " AND ")
	if _, err := r.tx.ExecContext(r.ctx, q, append(args, keys...)...); err != nil {
		return r.rowError(table, excelRow, err)
	}
	r.res.Updated++
	return nil
}

var autoTimes = map[string]bool{"created_at": true, "updated_at": true}

func (r *transferRun) insert(table string, cols []transferColumn, vals map[string]any, excelRow int) error {
	names, marks, args := []string{}, []string{}, []any{}
	for _, c := range cols {
		v := vals[c.name]
		switch {
		case v == nil && autoTimes[c.name]:
			v = r.now
		case c.fill == "user" && c.required:
			v = r.user
		case c.fill == "device" && c.required:
			v = r.device
		}
		if v == nil {
			if c.required {
				r.issue(table, excelRow, c.name, "required", "")
				return nil
			}
			continue
		}
		names, marks, args = append(names, quote(c.name)), append(marks, "?"), append(args, v)
	}
	q := `INSERT INTO ` + quote(table) + `(` + strings.Join(names, ",") + `) VALUES (` + strings.Join(marks, ",") + `)`
	if _, err := r.tx.ExecContext(r.ctx, q, args...); err != nil {
		return r.rowError(table, excelRow, err)
	}
	r.res.Inserted++
	return nil
}

// rowError reports what the database refused about a row (a CHECK or UNIQUE
// rule) and carries on, so the owner sees every problem at once.
func (r *transferRun) rowError(table string, excelRow int, err error) error {
	msg := err.Error()
	if r.ctx.Err() != nil || !strings.Contains(msg, "constraint") {
		return err
	}
	if i := strings.Index(msg, "constraint failed"); i >= 0 {
		msg = strings.TrimSpace(msg[i:])
	}
	r.issue(table, excelRow, "-", "db_rule", msg)
	return nil
}

// checkReferences finds rows pointing at something that doesn't exist and
// names the row, instead of failing at commit with no detail.
func (r *transferRun) checkReferences() error {
	for table, imported := range r.rows {
		pk, err := primaryKeySQL(r.ctx, r.tx, table)
		if err != nil {
			return err
		}
		refs, err := foreignKeys(r.ctx, r.tx, table)
		if err != nil {
			return err
		}
		type bad struct {
			rowid, fk int64
			parent    string
		}
		var found []bad
		rows, err := r.tx.QueryContext(r.ctx, `SELECT rowid, parent, fkid FROM pragma_foreign_key_check(?)`, table)
		if err != nil {
			return err
		}
		for rows.Next() {
			var b bad
			if err := rows.Scan(&b.rowid, &b.parent, &b.fk); err != nil {
				rows.Close()
				return err
			}
			found = append(found, b)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, b := range found {
			key := ""
			q := `SELECT ` + pk + ` FROM ` + quote(table) + ` WHERE rowid = ?`
			if err := r.tx.QueryRowContext(r.ctx, q, b.rowid).Scan(&key); err != nil {
				return err
			}
			if row, ok := imported[key]; ok {
				r.issue(table, row, refs[b.fk], "unknown_reference", b.parent)
			}
		}
	}
	return nil
}

// primaryKeySQL is an expression giving the same text as pkKey.
func primaryKeySQL(ctx context.Context, q sqlite.Querier, table string) (string, error) {
	rows, err := q.QueryContext(ctx, `SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`, table)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	parts := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return "", err
		}
		parts = append(parts, quote(n))
	}
	return strings.Join(parts, " || ' ' || "), rows.Err()
}

func foreignKeys(ctx context.Context, q sqlite.Querier, table string) (map[int64]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, "from" FROM pragma_foreign_key_list(?)`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var id int64
		var from string
		if err := rows.Scan(&id, &from); err != nil {
			return nil, err
		}
		out[id] = from
	}
	return out, rows.Err()
}

var trailingNumber = regexp.MustCompile(`(\d+)$`)

// syncInvoiceCounters moves the counters past the invoices now in the table.
// Numbers are unique across devices and every device starts with the same
// prefix, so otherwise the next sale here would reuse an imported number and
// the cashier couldn't take payment.
func (r *transferRun) syncInvoiceCounters() error {
	if _, touched := r.rows["invoices"]; !touched {
		return nil
	}
	highest := map[string]int64{}
	rows, err := r.tx.QueryContext(r.ctx, `SELECT number FROM invoices`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var number string
		if err := rows.Scan(&number); err != nil {
			rows.Close()
			return err
		}
		if m := trailingNumber.FindString(number); m != "" {
			prefix := strings.TrimSuffix(strings.TrimSuffix(number, m), "-")
			if n, err := strconv.ParseInt(m, 10, 64); err == nil && n > highest[prefix] {
				highest[prefix] = n
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for prefix, n := range highest {
		if _, err := r.tx.ExecContext(r.ctx, `UPDATE invoice_counters SET last_number = max(last_number, ?) WHERE prefix = ?`, n, prefix); err != nil {
			return err
		}
	}
	return nil
}
