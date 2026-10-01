package app

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// Bulk import from Excel. Every entity declares its columns once; the same
// spec drives the downloadable template (headers, red * on required
// columns, dropdowns, instructions sheet) and the validation of an uploaded
// file. A file is applied only if every row is valid, in one transaction.

type ImportMode string

const (
	ModeInsert ImportMode = "insert"
	ModeUpdate ImportMode = "update"
)

type fieldKind int

const (
	kText fieldKind = iota
	kMoney
	kQty
	kInt
	kBool
	kEnum
	kRef // a name looked up in another table
)

type tr struct{ ar, en, fr string }

func (t tr) in(lang string) string {
	switch lang {
	case "en":
		return t.en
	case "fr":
		return t.fr
	}
	return t.ar
}

type importField struct {
	key        string
	label      tr
	help       tr
	kind       fieldKind
	required   bool     // on insert
	insertOnly bool     // ignored on update (e.g. a unit that recipes depend on)
	enum       []string // allowed codes for kEnum
	refTable   string   // for kRef: table whose "name" column is matched
	example    string
}

type importEntity struct {
	key   string
	label tr
	perm  rbac.Permission
	match string // field identifying an existing row on update
	// how to read existing rows: SELECT id, <columns in field order>
	query  string
	fields []importField
	insert func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error
	update func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error
}

type rowValues map[string]any

func (v rowValues) has(k string) bool { _, ok := v[k]; return ok }
func (v rowValues) str(k string) string {
	s, _ := v[k].(string)
	return s
}

var yesNo = map[string]bool{
	"نعم": true, "لا": false, "yes": true, "no": false, "oui": true, "non": false,
	"1": true, "0": false, "true": true, "false": false, "مفعل": true, "موقوف": false, "active": true, "inactive": false,
}

var unitAliases = map[string]string{
	"kg": "kg", "كجم": "kg", "كيلو": "kg", "g": "g", "جم": "g", "جرام": "g", "l": "l", "لتر": "l", "ml": "ml", "مل": "ml",
	"pcs": "pcs", "قطعة": "pcs", "pc": "pcs", "piece": "pcs", "pièce": "pcs",
}

func boolWord(b bool, lang string) string {
	words := map[string][2]string{"ar": {"لا", "نعم"}, "en": {"No", "Yes"}, "fr": {"Non", "Oui"}}
	w := words[lang]
	if w[0] == "" {
		w = words["ar"]
	}
	if b {
		return w[1]
	}
	return w[0]
}

var activeField = importField{key: "active", label: tr{"مفعّل", "Active", "Actif"}, kind: kBool,
	help: tr{"نعم أو لا — الافتراضي نعم", "Yes or No — default Yes", "Oui ou Non — par défaut Oui"}, example: "نعم"}
var sortField = importField{key: "sort", label: tr{"الترتيب", "Sort order", "Ordre"}, kind: kInt,
	help: tr{"رقم صحيح، الأصغر يظهر أولاً", "Whole number, lower shows first", "Nombre entier, le plus petit d'abord"}, example: "1"}

func (a *App) importEntities() []importEntity {
	return []importEntity{
		{
			key: "items", label: tr{"الأصناف", "Menu items", "Articles"}, perm: rbac.CatalogManage, match: "code",
			query: `SELECT i.id, i.code, i.name, coalesce(c.name,''), i.price_minor, i.description, i.sort, i.active FROM items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.deleted_at IS NULL ORDER BY i.sort, i.name`,
			fields: []importField{
				{key: "code", label: tr{"الكود", "Code", "Code"}, kind: kText, help: tr{"فريد. يُولَّد تلقائياً عند الإضافة إن تُرك فارغاً، ومطلوب للتعديل", "Unique. Auto-generated on insert if empty; required for update", "Unique. Généré à l'ajout si vide ; requis pour la mise à jour"}, example: "BRG-01"},
				{key: "name", label: tr{"اسم الصنف", "Item name", "Nom de l'article"}, kind: kText, required: true, example: "برجر كلاسيك"},
				{key: "category", label: tr{"القسم", "Category", "Catégorie"}, kind: kRef, refTable: "categories", help: tr{"اسم قسم موجود", "Name of an existing category", "Nom d'une catégorie existante"}, example: "ساندوتشات"},
				{key: "price", label: tr{"السعر", "Price", "Prix"}, kind: kMoney, required: true, example: "150"},
				{key: "description", label: tr{"الوصف", "Description", "Description"}, kind: kText},
				sortField, activeField,
			},
			insert: func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error {
				code := v.str("code")
				if code == "" {
					var n int
					tx.QueryRowContext(ctx, `SELECT count(*) + 1 FROM items`).Scan(&n)
					code = fmt.Sprintf("I%04d", n)
					for {
						var exists int
						tx.QueryRowContext(ctx, `SELECT count(*) FROM items WHERE code = ?`, code).Scan(&exists)
						if exists == 0 {
							break
						}
						n++
						code = fmt.Sprintf("I%04d", n)
					}
				}
				_, err := tx.ExecContext(ctx, `INSERT INTO items(id, code, name, category_id, price_minor, description, sort, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
					sqlite.NewID(), code, v.str("name"), sqlite.NullString(v.str("category")), v["price"], v.str("description"), orInt(v, "sort", 0), sqlite.Int(orBool(v, "active", true)), a.stamp(), a.stamp())
				return err
			},
			update: func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error {
				return updateCols(ctx, tx, "items", id, v, map[string]string{"name": "name", "category": "category_id", "price": "price_minor", "description": "description", "sort": "sort", "active": "active"}, a.stamp())
			},
		},
		{
			key: "categories", label: tr{"الأقسام", "Categories", "Catégories"}, perm: rbac.CatalogManage, match: "name",
			query: `SELECT c.id, c.name, coalesce(s.name,''), c.sort, c.active FROM categories c LEFT JOIN kitchen_stations s ON s.id = c.kitchen_station_id ORDER BY c.sort, c.name`,
			fields: []importField{
				{key: "name", label: tr{"اسم القسم", "Category name", "Nom de la catégorie"}, kind: kText, required: true, example: "مشروبات"},
				{key: "station", label: tr{"محطة المطبخ", "Kitchen station", "Poste de cuisine"}, kind: kRef, refTable: "kitchen_stations", help: tr{"اسم محطة موجودة (اختياري)", "Name of an existing station (optional)", "Nom d'un poste existant (facultatif)"}},
				sortField, activeField,
			},
			insert: func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error {
				_, err := tx.ExecContext(ctx, `INSERT INTO categories(id, name, kitchen_station_id, sort, active) VALUES (?,?,?,?,?)`,
					sqlite.NewID(), v.str("name"), sqlite.NullString(v.str("station")), orInt(v, "sort", 0), sqlite.Int(orBool(v, "active", true)))
				return err
			},
			update: func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error {
				return updateCols(ctx, tx, "categories", id, v, map[string]string{"station": "kitchen_station_id", "sort": "sort", "active": "active"}, "")
			},
		},
		{
			key: "ingredients", label: tr{"المواد الخام", "Raw materials", "Matières premières"}, perm: rbac.InventoryEdit, match: "name",
			query: `SELECT id, name, unit, cost_minor, min_stock_milli, 0, active FROM ingredients ORDER BY name`,
			fields: []importField{
				{key: "name", label: tr{"اسم الخامة", "Material name", "Nom de la matière"}, kind: kText, required: true, example: "لحم بقري"},
				{key: "unit", label: tr{"الوحدة", "Unit", "Unité"}, kind: kEnum, required: true, insertOnly: true, enum: []string{"kg", "g", "l", "ml", "pcs"},
					help: tr{"kg أو g أو l أو ml أو pcs — لا تتغير بعد الإضافة", "kg, g, l, ml or pcs — fixed after insert", "kg, g, l, ml ou pcs — fixe après l'ajout"}, example: "kg"},
				{key: "cost", label: tr{"التكلفة للوحدة", "Cost per unit", "Coût unitaire"}, kind: kMoney, insertOnly: true, help: tr{"عند الإضافة فقط؛ بعدها تتحدث من المشتريات", "Insert only; afterwards it follows purchases", "À l'ajout seulement ; ensuite selon les achats"}, example: "400"},
				{key: "min_stock", label: tr{"الحد الأدنى", "Minimum stock", "Stock minimum"}, kind: kQty, example: "2"},
				{key: "opening_stock", label: tr{"الرصيد الافتتاحي", "Opening stock", "Stock initial"}, kind: kQty, insertOnly: true, example: "10"},
				activeField,
			},
			insert: func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error {
				id := sqlite.NewID()
				cost, _ := v["cost"].(money.Minor)
				if _, err := tx.ExecContext(ctx, `INSERT INTO ingredients(id, name, unit, min_stock_milli, cost_minor, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
					id, v.str("name"), v.str("unit"), orQty(v, "min_stock"), cost, sqlite.Int(orBool(v, "active", true)), a.stamp(), a.stamp()); err != nil {
					return err
				}
				return a.move(ctx, tx, "", id, "opening", orQty(v, "opening_stock"), cost, "import", "", "رصيد افتتاحي")
			},
			update: func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error {
				return updateCols(ctx, tx, "ingredients", id, v, map[string]string{"min_stock": "min_stock_milli", "active": "active"}, a.stamp())
			},
		},
		{
			key: "customers", label: tr{"العملاء", "Customers", "Clients"}, perm: rbac.CatalogManage, // bulk import is a manager task match: "phone",
			query: `SELECT id, coalesce(phone,''), name, address, notes FROM customers ORDER BY name`,
			fields: []importField{
				{key: "phone", label: tr{"الهاتف", "Phone", "Téléphone"}, kind: kText, help: tr{"فريد، ومطلوب للتعديل", "Unique; required for update", "Unique ; requis pour la mise à jour"}, example: "01001234567"},
				{key: "name", label: tr{"اسم العميل", "Customer name", "Nom du client"}, kind: kText, required: true, example: "محمد علي"},
				{key: "address", label: tr{"العنوان", "Address", "Adresse"}, kind: kText},
				{key: "notes", label: tr{"ملاحظات", "Notes", "Remarques"}, kind: kText},
			},
			insert: func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error {
				_, err := tx.ExecContext(ctx, `INSERT INTO customers(id, name, phone, address, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
					sqlite.NewID(), v.str("name"), sqlite.NullString(v.str("phone")), v.str("address"), v.str("notes"), a.stamp(), a.stamp())
				return err
			},
			update: func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error {
				return updateCols(ctx, tx, "customers", id, v, map[string]string{"name": "name", "address": "address", "notes": "notes"}, a.stamp())
			},
		},
		{
			key: "suppliers", label: tr{"الموردون", "Suppliers", "Fournisseurs"}, perm: rbac.InventoryEdit, match: "name",
			query: `SELECT id, name, phone, notes FROM suppliers ORDER BY name`,
			fields: []importField{
				{key: "name", label: tr{"اسم المورد", "Supplier name", "Nom du fournisseur"}, kind: kText, required: true, example: "مزارع النيل"},
				{key: "phone", label: tr{"الهاتف", "Phone", "Téléphone"}, kind: kText},
				{key: "notes", label: tr{"ملاحظات", "Notes", "Remarques"}, kind: kText},
			},
			insert: func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error {
				_, err := tx.ExecContext(ctx, `INSERT INTO suppliers(id, name, phone, notes, created_at) VALUES (?,?,?,?,?)`, sqlite.NewID(), v.str("name"), v.str("phone"), v.str("notes"), a.stamp())
				return err
			},
			update: func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error {
				return updateCols(ctx, tx, "suppliers", id, v, map[string]string{"phone": "phone", "notes": "notes"}, "")
			},
		},
		{
			key: "tables", label: tr{"الطاولات", "Tables", "Tables"}, perm: rbac.CatalogManage, match: "name",
			query: `SELECT id, name, area, seats, sort, active FROM dining_tables WHERE deleted_at IS NULL ORDER BY area, sort, name`,
			fields: []importField{
				{key: "name", label: tr{"اسم الطاولة", "Table name", "Nom de la table"}, kind: kText, required: true, example: "T1"},
				{key: "area", label: tr{"المنطقة", "Area", "Zone"}, kind: kText, example: "الصالة"},
				{key: "seats", label: tr{"عدد المقاعد", "Seats", "Places"}, kind: kInt, example: "4"},
				sortField, activeField,
			},
			insert: func(ctx context.Context, tx *sql.Tx, a *App, v rowValues) error {
				_, err := tx.ExecContext(ctx, `INSERT INTO dining_tables(id, name, area, seats, sort, active, qr_token) VALUES (?,?,?,?,?,?,?)`,
					sqlite.NewID(), v.str("name"), v.str("area"), orInt(v, "seats", 4), orInt(v, "sort", 0), sqlite.Int(orBool(v, "active", true)), newPublicToken())
				return err
			},
			update: func(ctx context.Context, tx *sql.Tx, a *App, id string, v rowValues) error {
				return updateCols(ctx, tx, "dining_tables", id, v, map[string]string{"area": "area", "seats": "seats", "sort": "sort", "active": "active"}, "")
			},
		},
	}
}

func orInt(v rowValues, k string, d int) int {
	if n, ok := v[k].(int); ok {
		return n
	}
	return d
}
func orBool(v rowValues, k string, d bool) bool {
	if b, ok := v[k].(bool); ok {
		return b
	}
	return d
}
func orQty(v rowValues, k string) money.Milli {
	q, _ := v[k].(money.Milli)
	return q
}

// updateCols sets only the columns present in v: an empty cell on update
// means "leave as is".
func updateCols(ctx context.Context, tx *sql.Tx, table, id string, v rowValues, cols map[string]string, stamp string) error {
	var sets []string
	var args []any
	for field, col := range cols {
		val, ok := v[field]
		if !ok {
			continue
		}
		if b, isBool := val.(bool); isBool {
			val = sqlite.Int(b)
		}
		if col == "category_id" || col == "kitchen_station_id" {
			val = sqlite.NullString(val.(string))
		}
		sets = append(sets, col+" = ?")
		args = append(args, val)
	}
	if len(sets) == 0 {
		return nil
	}
	if stamp != "" {
		sets = append(sets, "updated_at = ?")
		args = append(args, stamp)
	}
	_, err := tx.ExecContext(ctx, `UPDATE `+table+` SET `+strings.Join(sets, ", ")+` WHERE id = ?`, append(args, id)...)
	return err
}

func (a *App) importEntity(actor Actor, key string) (importEntity, error) {
	for _, e := range a.importEntities() {
		if e.key == key {
			if err := actor.require(e.perm); err != nil {
				return e, err
			}
			return e, nil
		}
	}
	return importEntity{}, notFound("نوع البيانات")
}

// ImportTarget describes what can be imported, for the UI.
type ImportTarget struct {
	Key    string            `json:"key"`
	Label  string            `json:"label"`
	Match  string            `json:"match"`
	Fields []ImportFieldInfo `json:"fields"`
}

type ImportFieldInfo struct {
	Key        string `json:"key"`
	Label      string `json:"label"`
	Required   bool   `json:"required"`
	InsertOnly bool   `json:"insert_only"`
	Help       string `json:"help"`
}

func (a *App) ImportTargets(_ context.Context, actor Actor, lang string) []ImportTarget {
	out := []ImportTarget{}
	for _, e := range a.importEntities() {
		if !actor.Can(e.perm) {
			continue
		}
		t := ImportTarget{Key: e.key, Label: e.label.in(lang), Match: e.match}
		for _, f := range e.fields {
			t.Fields = append(t.Fields, ImportFieldInfo{Key: f.key, Label: f.label.in(lang), Required: f.required, InsertOnly: f.insertOnly, Help: f.help.in(lang)})
		}
		out = append(out, t)
	}
	return out
}

// ---- template ----------------------------------------------------------------

func (e importEntity) columns(mode ImportMode) []importField {
	var out []importField
	for _, f := range e.fields {
		if mode == ModeUpdate && f.insertOnly {
			continue
		}
		if mode == ModeUpdate && f.key == e.match {
			f.required = true
		}
		out = append(out, f)
	}
	return out
}

// ImportTemplate builds the .xlsx to fill in. For updates it is prefilled
// with the current records so they can be edited and uploaded back.
func (a *App) ImportTemplate(ctx context.Context, actor Actor, key string, mode ImportMode, lang string) ([]byte, string, error) {
	e, err := a.importEntity(actor, key)
	if err != nil {
		return nil, "", err
	}
	cols := e.columns(mode)
	f := excelize.NewFile()
	defer f.Close()
	sheet := e.label.in(lang)
	f.SetSheetName("Sheet1", sheet)
	rtl := lang == "" || lang == "ar"
	f.SetSheetView(sheet, 0, &excelize.ViewOptions{RightToLeft: &rtl})

	head, _ := f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "1E1B4B", Size: 11},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"EEF0FF"}},
		Alignment: &excelize.Alignment{Horizontal: "center", Vertical: "center", WrapText: true},
		Border:    []excelize.Border{{Type: "bottom", Color: "4F46E5", Style: 2}},
	})
	for i, col := range cols {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		runs := []excelize.RichTextRun{{Text: col.label.in(lang), Font: &excelize.Font{Bold: true, Color: "1E1B4B"}}}
		if col.required {
			runs = append(runs, excelize.RichTextRun{Text: " *", Font: &excelize.Font{Bold: true, Color: "DC2626"}})
		}
		f.SetCellRichText(sheet, cell, runs)
		f.SetCellStyle(sheet, cell, cell, head)
		colName, _ := excelize.ColumnNumberToName(i + 1)
		f.SetColWidth(sheet, colName, colName, 22)
		if h := col.help.in(lang); h != "" {
			f.AddComment(sheet, excelize.Comment{Cell: cell, Author: "CPro", Paragraph: []excelize.RichTextRun{{Text: h}}})
		}
	}
	f.SetRowHeight(sheet, 1, 28)
	f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})

	// Dropdowns: yes/no, units, and names of referenced records (kept on a
	// hidden sheet so long lists work).
	f.NewSheet("_lists")
	f.SetSheetVisible("_lists", false)
	listCol := 0
	for i, col := range cols {
		var values []string
		switch col.kind {
		case kBool:
			values = []string{boolWord(true, lang), boolWord(false, lang)}
		case kEnum:
			values = col.enum
		case kRef:
			rows, err := a.db.Read.QueryContext(ctx, `SELECT name FROM `+col.refTable+` WHERE active = 1 ORDER BY name`)
			if err != nil {
				return nil, "", err
			}
			for rows.Next() {
				var n string
				rows.Scan(&n)
				values = append(values, n)
			}
			rows.Close()
		}
		if len(values) == 0 {
			continue
		}
		listCol++
		lc, _ := excelize.ColumnNumberToName(listCol)
		for r, v := range values {
			c, _ := excelize.CoordinatesToCellName(listCol, r+1)
			f.SetCellStr("_lists", c, v)
		}
		target, _ := excelize.ColumnNumberToName(i + 1)
		dv := excelize.NewDataValidation(col.kind != kRef)
		dv.Sqref = fmt.Sprintf("%s2:%s5000", target, target)
		dv.SetSqrefDropList(fmt.Sprintf("'_lists'!$%s$1:$%s$%d", lc, lc, len(values)))
		f.AddDataValidation(sheet, dv)
	}

	if mode == ModeUpdate {
		if err := a.prefill(ctx, f, sheet, e, cols, lang); err != nil {
			return nil, "", err
		}
	}
	a.instructions(f, e, cols, mode, lang)
	f.SetActiveSheet(0)

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), fmt.Sprintf("cpro-%s-%s.xlsx", e.key, mode), nil
}

func (a *App) prefill(ctx context.Context, f *excelize.File, sheet string, e importEntity, cols []importField, lang string) error {
	rows, err := a.db.Read.QueryContext(ctx, e.query)
	if err != nil {
		return err
	}
	defer rows.Close()
	all := e.fields
	r := 2
	for rows.Next() {
		vals := make([]any, len(all)+1)
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		byKey := map[string]any{}
		for i, fld := range all {
			byKey[fld.key] = vals[i+1]
		}
		for c, col := range cols {
			cell, _ := excelize.CoordinatesToCellName(c+1, r)
			v := byKey[col.key]
			switch col.kind {
			case kMoney:
				f.SetCellValue(sheet, cell, float64(toInt64(v))/100)
			case kQty:
				f.SetCellValue(sheet, cell, float64(toInt64(v))/1000)
			case kInt:
				f.SetCellValue(sheet, cell, toInt64(v))
			case kBool:
				f.SetCellStr(sheet, cell, boolWord(toInt64(v) == 1, lang))
			default:
				f.SetCellStr(sheet, cell, fmt.Sprint(v))
			}
		}
		r++
	}
	return rows.Err()
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

func (a *App) instructions(f *excelize.File, e importEntity, cols []importField, mode ImportMode, lang string) {
	name := tr{"تعليمات", "Instructions", "Instructions"}.in(lang)
	f.NewSheet(name)
	rtl := lang == "" || lang == "ar"
	f.SetSheetView(name, 0, &excelize.ViewOptions{RightToLeft: &rtl})
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 12}})
	red, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Color: "DC2626"}})
	lines := map[string][]string{
		"ar": {"املأ ورقة «" + e.label.ar + "» بداية من الصف الثاني.", "الأعمدة المعلّمة بـ * إلزامية ولا يمكن تركها فارغة.",
			"عند التعديل: يُحدَّد السجل بعمود «" + labelOf(e, e.match, "ar") + "»، والخلية الفارغة تعني عدم تغيير القيمة.",
			"لن يُحفظ أي شيء إذا وُجد خطأ في أي صف؛ صحح الأخطاء الظاهرة في البرنامج ثم ارفع الملف مرة أخرى."},
		"en": {"Fill the «" + e.label.en + "» sheet starting from row 2.", "Columns marked * are required and cannot be empty.",
			"On update, rows are matched by «" + labelOf(e, e.match, "en") + "»; an empty cell leaves the value unchanged.",
			"Nothing is saved if any row has an error; fix the errors shown in the app and upload again."},
		"fr": {"Remplissez la feuille «" + e.label.fr + "» à partir de la ligne 2.", "Les colonnes marquées * sont obligatoires.",
			"En mise à jour, les lignes sont reconnues par «" + labelOf(e, e.match, "fr") + "» ; une cellule vide ne modifie rien.",
			"Rien n'est enregistré si une ligne contient une erreur ; corrigez puis téléversez à nouveau."},
	}
	ls := lines[lang]
	if ls == nil {
		ls = lines["ar"]
	}
	for i, l := range ls {
		f.SetCellStr(name, fmt.Sprintf("A%d", i+1), l)
	}
	hdr := []tr{{"العمود", "Column", "Colonne"}, {"إلزامي", "Required", "Obligatoire"}, {"الوصف", "Description", "Description"}, {"مثال", "Example", "Exemple"}}
	start := len(ls) + 2
	for i, h := range hdr {
		c, _ := excelize.CoordinatesToCellName(i+1, start)
		f.SetCellStr(name, c, h.in(lang))
		f.SetCellStyle(name, c, c, bold)
	}
	for i, col := range cols {
		r := start + 1 + i
		f.SetCellStr(name, fmt.Sprintf("A%d", r), col.label.in(lang))
		if col.required {
			f.SetCellStr(name, fmt.Sprintf("B%d", r), "*")
			f.SetCellStyle(name, fmt.Sprintf("B%d", r), fmt.Sprintf("B%d", r), red)
		}
		f.SetCellStr(name, fmt.Sprintf("C%d", r), col.help.in(lang))
		f.SetCellStr(name, fmt.Sprintf("D%d", r), col.example)
	}
	f.SetColWidth(name, "A", "A", 28)
	f.SetColWidth(name, "C", "C", 60)
	f.SetColWidth(name, "D", "D", 20)
}

func labelOf(e importEntity, key, lang string) string {
	for _, f := range e.fields {
		if f.key == key {
			return f.label.in(lang)
		}
	}
	return key
}

// ---- upload ------------------------------------------------------------------

// ImportIssue is one problem in the uploaded file. Code is stable so the UI
// can translate it; Value echoes the offending cell.
type ImportIssue struct {
	Row    int    `json:"row"`
	Column string `json:"column"`
	Code   string `json:"code"`
	Value  string `json:"value"`
}

type ImportResult struct {
	Rows     int           `json:"rows"`
	Inserted int           `json:"inserted"`
	Updated  int           `json:"updated"`
	Issues   []ImportIssue `json:"issues"`
}

const maxImportRows = 10000

// Import validates every row of the uploaded workbook and, only if all rows
// are valid, applies them in a single transaction.
func (a *App) Import(ctx context.Context, actor Actor, key string, mode ImportMode, file io.Reader, lang string) (ImportResult, error) {
	e, err := a.importEntity(actor, key)
	if err != nil {
		return ImportResult{}, err
	}
	if mode != ModeInsert && mode != ModeUpdate {
		return ImportResult{}, invalid("نوع العملية غير صحيح")
	}
	f, err := excelize.OpenReader(io.LimitReader(file, 20<<20))
	if err != nil {
		return ImportResult{}, invalid("الملف ليس ملف Excel صالحاً (.xlsx)")
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return ImportResult{}, invalid("الملف فارغ")
	}
	rows, err := f.GetRows(sheets[0], excelize.Options{RawCellValue: true})
	if err != nil || len(rows) == 0 {
		return ImportResult{}, invalid("الورقة الأولى في الملف فارغة")
	}

	cols := e.columns(mode)
	res := ImportResult{Issues: []ImportIssue{}}
	issue := func(row int, col importField, code, val string) {
		res.Issues = append(res.Issues, ImportIssue{Row: row, Column: col.label.in(lang), Code: code, Value: val})
	}

	// Map header cells to fields by label in any language or by key.
	index := map[string]int{}
	for i, h := range rows[0] {
		h = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(h), "*"))
		for _, c := range cols {
			if h == c.key || h == c.label.ar || h == c.label.en || h == c.label.fr {
				index[c.key] = i
			}
		}
	}
	for _, c := range cols {
		if _, ok := index[c.key]; !ok && c.required {
			issue(1, c, "missing_column", "")
		}
	}
	if len(res.Issues) > 0 {
		return res, nil
	}

	// Lookups: existing keys and referenced names.
	existing := map[string]string{}
	rowsQ, err := a.db.Read.QueryContext(ctx, e.query)
	if err != nil {
		return res, err
	}
	matchPos := 0
	for i, fld := range e.fields {
		if fld.key == e.match {
			matchPos = i + 1
		}
	}
	for rowsQ.Next() {
		vals := make([]any, len(e.fields)+1)
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rowsQ.Scan(ptrs...); err != nil {
			rowsQ.Close()
			return res, err
		}
		if k := strings.ToLower(strings.TrimSpace(fmt.Sprint(vals[matchPos]))); k != "" {
			existing[k] = fmt.Sprint(vals[0])
		}
	}
	rowsQ.Close()
	refs := map[string]map[string]string{}
	for _, c := range cols {
		if c.kind != kRef || refs[c.refTable] != nil {
			continue
		}
		refs[c.refTable] = map[string]string{}
		rq, err := a.db.Read.QueryContext(ctx, `SELECT id, name FROM `+c.refTable)
		if err != nil {
			return res, err
		}
		for rq.Next() {
			var id, name string
			rq.Scan(&id, &name)
			refs[c.refTable][strings.ToLower(strings.TrimSpace(name))] = id
		}
		rq.Close()
	}

	type parsed struct {
		row int
		id  string
		v   rowValues
	}
	var good []parsed
	seen := map[string]int{}
	for r := 1; r < len(rows); r++ {
		excelRow := r + 1
		cells := rows[r]
		cell := func(k string) string {
			i, ok := index[k]
			if !ok || i >= len(cells) {
				return ""
			}
			return strings.TrimSpace(cells[i])
		}
		empty := true
		for _, c := range cols {
			if cell(c.key) != "" {
				empty = false
			}
		}
		if empty {
			continue
		}
		res.Rows++
		if res.Rows > maxImportRows {
			return res, invalid(fmt.Sprintf("الحد الأقصى %d صف في الملف الواحد", maxImportRows))
		}
		v := rowValues{}
		before := len(res.Issues)
		for _, c := range cols {
			raw := cell(c.key)
			if raw == "" {
				if c.required {
					issue(excelRow, c, "required", "")
				}
				continue
			}
			val, code := parseCell(c, raw, refs)
			if code != "" {
				issue(excelRow, c, code, raw)
				continue
			}
			v[c.key] = val
		}
		matchCol := cols[0]
		for _, c := range cols {
			if c.key == e.match {
				matchCol = c
			}
		}
		k := strings.ToLower(v.str(e.match))
		if k != "" {
			if first, dup := seen[k]; dup {
				issue(excelRow, matchCol, "duplicate_in_file", fmt.Sprintf("%s (%d)", v.str(e.match), first))
			}
			seen[k] = excelRow
		}
		id := existing[k]
		if mode == ModeInsert && k != "" && id != "" {
			issue(excelRow, matchCol, "already_exists", v.str(e.match))
		}
		if mode == ModeUpdate && k != "" && id == "" {
			issue(excelRow, matchCol, "not_found", v.str(e.match))
		}
		if len(res.Issues) == before {
			good = append(good, parsed{excelRow, id, v})
		}
	}
	if res.Rows == 0 {
		return res, invalid("لا توجد صفوف بيانات في الملف")
	}
	if len(res.Issues) > 0 {
		return res, nil
	}

	err = a.tx(ctx, func(tx *sql.Tx) error {
		for _, p := range good {
			var err error
			if mode == ModeInsert {
				err = e.insert(ctx, tx, a, p.v)
				res.Inserted++
			} else {
				err = e.update(ctx, tx, a, p.id, p.v)
				res.Updated++
			}
			if err != nil {
				if isUnique(err) {
					return &Error{CodeConflict, fmt.Sprintf("الصف %d: قيمة مكررة لحقل فريد", p.row)}
				}
				return fmt.Errorf("row %d: %w", p.row, err)
			}
		}
		return a.audit(ctx, tx, actor, "import."+string(mode), e.key, "", map[string]any{"rows": res.Rows})
	})
	if err != nil {
		res.Inserted, res.Updated = 0, 0
	}
	return res, err
}

func parseCell(c importField, raw string, refs map[string]map[string]string) (any, string) {
	norm := strings.NewReplacer("٠", "0", "١", "1", "٢", "2", "٣", "3", "٤", "4", "٥", "5", "٦", "6", "٧", "7", "٨", "8", "٩", "9", "٫", ".", ",", "").Replace(raw)
	switch c.kind {
	case kText:
		if len([]rune(raw)) > 500 {
			return nil, "too_long"
		}
		return raw, ""
	case kMoney:
		f, err := strconv.ParseFloat(norm, 64)
		if err != nil || f < 0 {
			return nil, "invalid_number"
		}
		m, err := money.Parse(strconv.FormatFloat(f, 'f', 2, 64))
		if err != nil {
			return nil, "invalid_number"
		}
		return m, ""
	case kQty:
		f, err := strconv.ParseFloat(norm, 64)
		if err != nil || f < 0 {
			return nil, "invalid_number"
		}
		return money.Milli(f*1000 + 0.5), ""
	case kInt:
		f, err := strconv.ParseFloat(norm, 64)
		if err != nil || f < 0 || f != float64(int(f)) {
			return nil, "invalid_integer"
		}
		return int(f), ""
	case kBool:
		b, ok := yesNo[strings.ToLower(raw)]
		if !ok {
			return nil, "invalid_bool"
		}
		return b, ""
	case kEnum:
		if u, ok := unitAliases[strings.ToLower(raw)]; ok {
			return u, ""
		}
		return nil, "invalid_choice"
	case kRef:
		id, ok := refs[c.refTable][strings.ToLower(raw)]
		if !ok {
			return nil, "unknown_reference"
		}
		return id, ""
	}
	return raw, ""
}
