package app

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
)

func count(t *testing.T, a *App, q string, args ...any) int {
	t.Helper()
	var n int
	if err := a.db.Write.QueryRowContext(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func sell(f *fixture, itemID string) Order {
	a, ctx, owner := f.app, f.ctx, f.owner
	o, err := a.CreateOrder(ctx, owner, OrderInput{Type: "takeaway"}, "")
	f.must(err)
	o, err = a.AddLine(ctx, owner, o.ID, LineInput{ItemID: itemID})
	f.must(err)
	r, err := a.Pay(ctx, owner, o.ID, []Tender{{Method: "cash", Amount: o.Total}}, "")
	f.must(err)
	return r.Order
}

// workbook is an edited transfer file: one sheet per table.
func workbook(t *testing.T, sheets map[string][][]any) []byte {
	t.Helper()
	x := excelize.NewFile()
	defer x.Close()
	first := true
	for name, rows := range sheets {
		if first {
			x.SetSheetName("Sheet1", name)
			first = false
		} else {
			x.NewSheet(name)
		}
		for i, r := range rows {
			cell, _ := excelize.CoordinatesToCellName(1, i+1)
			if err := x.SetSheetRow(name, cell, &r); err != nil {
				t.Fatal(err)
			}
		}
	}
	var buf bytes.Buffer
	if err := x.Write(&buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// A restaurant with a menu, a picture, stock and a closed day of sales.
func shop(t *testing.T) (*fixture, menuFixture, Order) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	cats, _ := a.Categories(ctx, owner)
	_, err := a.SetCategoryImage(ctx, owner, cats[0].ID, pngData(t))
	f.must(err)
	flour, err := a.SaveIngredient(ctx, owner, IngredientInput{Ingredient: Ingredient{Name: "دقيق", Unit: "kg", Cost: 100, Active: true}, OpeningStock: 10 * money.OneUnit})
	f.must(err)
	_, err = a.SaveItem(ctx, owner, ItemInput{Item: Item{ID: m.burger, Code: "B1", Name: "برجر", CategoryID: cats[0].ID, Price: 15000, Active: true,
		Recipe: []RecipeLine{{IngredientID: flour, Qty: money.OneUnit}}}})
	f.must(err)
	_, err = a.OpenShift(ctx, owner, 0)
	f.must(err)
	groups, _ := a.ModifierGroups(ctx, owner)
	_ = groups
	s, _ := a.Settings(ctx, owner)
	s.RestaurantName = "بيتزا هاوس"
	_, err = a.UpdateSettings(ctx, owner, s)
	f.must(err)
	o := sell(f, m.burger)
	return f, m, o
}

func TestMoveToANewComputer(t *testing.T) {
	src, m, o := shop(t)
	b, name, err := src.app.ExportTransfer(src.ctx, src.owner)
	src.must(err)
	if !strings.HasSuffix(name, ".zip") {
		t.Fatalf("name %q", name)
	}

	dst := newFixture(t)
	a, ctx, owner := dst.app, dst.ctx, dst.owner
	res, err := a.ImportTransfer(ctx, owner, b)
	dst.must(err)
	if len(res.Issues) != 0 {
		t.Fatalf("issues: %+v", res.Issues)
	}
	if res.Inserted == 0 || res.Backup == "" || res.Images != 1 {
		t.Fatalf("result: %+v", res)
	}

	// Sales arrive whole, under this owner and this computer.
	got, err := a.GetOrder(ctx, owner, o.ID)
	dst.must(err)
	if got.Total != o.Total || got.InvoiceNumber != o.InvoiceNumber || len(got.Lines) != 1 || len(got.Payments) != 1 {
		t.Fatalf("order: %+v", got)
	}
	device, _ := a.EnsureTerminal(ctx)
	if n := count(t, a, `SELECT count(*) FROM orders WHERE user_id = ?`, owner.UserID); n != 1 {
		t.Fatal("order not under the new owner")
	}
	if n := count(t, a, `SELECT count(*) FROM shifts WHERE device_id = ?`, device); n != 1 {
		t.Fatal("shift not on this computer")
	}
	// Stock came with its balance: one sold out of ten.
	if n := count(t, a, `SELECT stock_milli FROM ingredients WHERE name = 'دقيق'`); money.Milli(n) != 9*money.OneUnit {
		t.Fatalf("stock: %d", n)
	}
	// The menu shows its picture, and the restaurant its name.
	cats, _ := a.Categories(ctx, owner)
	if len(cats) == 0 || cats[0].Image == "" {
		t.Fatalf("categories: %+v", cats)
	}
	p, ok := a.ImagePath(strings.TrimPrefix(cats[0].Image, "/api/v1/images/"))
	if _, err := os.Stat(p); !ok || err != nil {
		t.Fatalf("picture missing: %v", err)
	}
	s, _ := a.Settings(ctx, owner)
	if s.RestaurantName != "بيتزا هاوس" {
		t.Fatalf("settings: %+v", s)
	}
	items, _ := a.Items(ctx, owner)
	if len(items) == 0 || items[0].ID == "" {
		t.Fatal("no items")
	}

	// This computer's own identity didn't change, and neither did its people.
	again, _ := a.EnsureTerminal(ctx)
	if again != device || count(t, a, `SELECT count(*) FROM users`) != 1 {
		t.Fatal("device or users touched")
	}

	// The next sale here works, right after the imported invoice number.
	_, err = a.OpenShift(ctx, owner, 0)
	if err != nil && code(err) != CodeConflict {
		t.Fatal(err)
	}
	if next := sell(dst, m.burger); next.InvoiceNumber == "" || next.InvoiceNumber == o.InvoiceNumber {
		t.Fatalf("next invoice: %q after %q", next.InvoiceNumber, o.InvoiceNumber)
	}

	// The same file again adds nothing.
	before := count(t, a, `SELECT count(*) FROM orders`)
	res, err = a.ImportTransfer(ctx, owner, b)
	dst.must(err)
	if res.Inserted != 0 || len(res.Issues) != 0 || count(t, a, `SELECT count(*) FROM orders`) != before {
		t.Fatalf("second time: %+v", res)
	}
}

func TestTransferLeavesPersonalThingsBehind(t *testing.T) {
	f, _, _ := shop(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	a.db.Write.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES ('platform', '{"license":"secret-token"}', 'x')`)
	b, _, err := a.ExportTransfer(ctx, owner)
	f.must(err)
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	f.must(err)
	rc, err := z.Open(transferExcel)
	f.must(err)
	x, err := excelize.OpenReader(rc)
	f.must(err)
	rc.Close()
	for _, s := range x.GetSheetList() {
		for _, leak := range []string{"users", "devices", "sessions", "audit_log", "invoice_counters"} {
			if s == leak {
				t.Fatalf("%s exported", s)
			}
		}
		rows, _ := x.GetRows(s)
		for _, r := range rows {
			line := strings.Join(r, "|")
			for _, leak := range []string{"secret-token", "password_hash", "user_id", "device_id", "backup_dir\":\"/"} {
				if strings.Contains(line, leak) {
					t.Fatalf("%s holds %q: %s", s, leak, line)
				}
			}
		}
	}
	if _, _, err := a.ExportTransfer(ctx, f.login(rbac.Manager, "boss")); code(err) != CodeForbidden {
		t.Fatalf("manager exported: %v", err)
	}
	if _, err := a.ImportTransfer(ctx, f.login(rbac.Manager, "boss2"), b); code(err) != CodeForbidden {
		t.Fatalf("manager imported: %v", err)
	}
}

func TestEditedFileAndBadRows(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()

	// The bare workbook works too, with a new row and an edited one.
	res, err := a.ImportTransfer(ctx, owner, workbook(t, map[string][][]any{
		"suppliers": {{"name", "phone"}, {"مورد جديد", "0100"}},
		"items":     {{"id", "price_minor", "name"}, {m.burger, 9900, ""}},
	}))
	f.must(err)
	if res.Inserted != 1 || res.Updated != 1 || len(res.Issues) != 0 {
		t.Fatalf("edit: %+v", res)
	}
	if count(t, a, `SELECT count(*) FROM items WHERE id = ? AND price_minor = 9900 AND name = 'برجر'`, m.burger) != 1 {
		t.Fatal("not edited")
	}

	// A sheet that isn't part of the transfer is ignored: users can't come in.
	res, err = a.ImportTransfer(ctx, owner, workbook(t, map[string][][]any{
		"suppliers": {{"name"}, {"س"}},
		"users":     {{"username", "full_name", "role", "password_hash"}, {"hacker", "x", "owner", "x"}},
		"settings":  {{"key", "value"}},
	}))
	f.must(err)
	if count(t, a, `SELECT count(*) FROM users WHERE username = 'hacker'`) != 0 || len(res.Issues) != 0 {
		t.Fatalf("users came in: %+v", res)
	}

	// One bad row means nothing is kept.
	before := count(t, a, `SELECT count(*) FROM suppliers`)
	res, err = a.ImportTransfer(ctx, owner, workbook(t, map[string][][]any{
		"suppliers":      {{"name"}, {"يتحفظ؟"}},
		"emenu_featured": {{"item_id", "badge"}, {"no-such-item", "new"}},
	}))
	f.must(err)
	if len(res.Issues) != 1 || res.Issues[0].Code != "unknown_reference" || res.Issues[0].Row != 2 || res.Inserted != 0 {
		t.Fatalf("reference: %+v", res)
	}
	if count(t, a, `SELECT count(*) FROM suppliers`) != before {
		t.Fatal("kept part of the file")
	}

	// Rules, numbers and settings that would stop the app.
	for name, sheet := range map[string]map[string][][]any{
		"db_rule":         {"ingredients": {{"name", "unit"}, {"خامة", "ton"}}},
		"required":        {"suppliers": {{"phone"}, {"0100"}}},
		"invalid_integer": {"items": {{"name", "code", "price_minor"}, {"س", "S1", "غالي"}}},
		"invalid_json":    {"settings": {{"key", "value"}, {settingsKey, "{broken"}}},
		"invalid_choice":  {"settings": {{"key", "value"}, {"platform", `{"license":"forged"}`}}},
	} {
		res, err := a.ImportTransfer(ctx, owner, workbook(t, sheet))
		f.must(err)
		if len(res.Issues) != 1 || res.Issues[0].Code != name {
			t.Fatalf("%s: %+v", name, res.Issues)
		}
	}
	if _, err := a.Settings(ctx, owner); err != nil {
		t.Fatalf("settings broken: %v", err)
	}

	// Something else entirely is refused before anything happens.
	if _, err := a.ImportTransfer(ctx, owner, []byte("not a file")); code(err) != CodeInvalid {
		t.Fatalf("junk: %v", err)
	}
	if _, err := a.ImportTransfer(ctx, owner, workbook(t, map[string][][]any{"Sheet1": {{"x"}}})); code(err) != CodeInvalid {
		t.Fatalf("unrelated workbook: %v", err)
	}
}

func TestPicturesInAFileAreChecked(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	w, _ := z.Create(transferExcel)
	w.Write(workbook(t, map[string][][]any{"suppliers": {{"name"}, {"س"}}}))
	for name, body := range map[string]string{
		"images/page.png":       "<html><script>alert(1)</script>",
		"images/../../evil.png": "\x89PNG\r\n\x1a\n",
	} {
		w, _ := z.Create(name)
		w.Write([]byte(body))
	}
	w, _ = z.Create("images/good.png")
	w.Write([]byte("\x89PNG\r\n\x1a\n0000"))
	f.must(z.Close())
	res, err := a.ImportTransfer(ctx, owner, buf.Bytes())
	f.must(err)
	if res.Images != 1 {
		t.Fatalf("images: %+v", res)
	}
	entries, _ := os.ReadDir(a.paths.Images)
	if len(entries) != 1 || entries[0].Name() != "good.png" {
		t.Fatalf("files: %v", entries)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(a.paths.Images), "evil.png")); err == nil {
		t.Fatal("wrote outside the images folder")
	}
}

func TestBackupFolderStaysOnThisComputer(t *testing.T) {
	src, _, _ := shop(t)
	dir := t.TempDir()
	_, err := src.app.SetBackupDir(src.ctx, src.owner, dir)
	src.must(err)
	b, _, err := src.app.ExportTransfer(src.ctx, src.owner)
	src.must(err)
	dst := newFixture(t)
	mine := t.TempDir()
	_, err = dst.app.SetBackupDir(dst.ctx, dst.owner, mine)
	dst.must(err)
	res, err := dst.app.ImportTransfer(dst.ctx, dst.owner, b)
	dst.must(err)
	if len(res.Issues) != 0 {
		t.Fatalf("issues: %+v", res.Issues)
	}
	s, _ := dst.app.Settings(dst.ctx, dst.owner)
	if s.BackupDir != mine {
		t.Fatalf("backup folder: %q", s.BackupDir)
	}
}
