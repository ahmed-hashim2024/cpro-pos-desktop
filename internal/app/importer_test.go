package app

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"cpro/internal/domain/rbac"
)

// fill opens a generated template, writes rows below the header, and
// returns the workbook bytes ready to upload.
func fill(t *testing.T, tmpl []byte, rows [][]any) *bytes.Reader {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(tmpl))
	if err != nil {
		t.Fatal(err)
	}
	sheet := f.GetSheetList()[0]
	for i, r := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+2)
		if err := f.SetSheetRow(sheet, cell, &r); err != nil {
			t.Fatal(err)
		}
	}
	var buf bytes.Buffer
	f.Write(&buf)
	return bytes.NewReader(buf.Bytes())
}

func TestImportTemplateMarksRequired(t *testing.T) {
	f := newFixture(t)
	b, name, err := f.app.ImportTemplate(f.ctx, f.owner, "items", ModeInsert, "ar")
	f.must(err)
	if !strings.HasSuffix(name, ".xlsx") {
		t.Fatalf("name %q", name)
	}
	x, _ := excelize.OpenReader(bytes.NewReader(b))
	sheets := x.GetSheetList()
	if sheets[0] != "الأصناف" || len(sheets) != 3 { // data, hidden lists, instructions
		t.Fatalf("sheets %v", sheets)
	}
	runs, _ := x.GetCellRichText(sheets[0], "B1") // name column
	if len(runs) != 2 || runs[1].Text != " *" || runs[1].Font.Color != "DC2626" {
		t.Fatalf("required marker: %+v", runs)
	}
	runs, _ = x.GetCellRichText(sheets[0], "A1") // optional code column: no star
	if len(runs) != 1 {
		t.Fatalf("optional column marked required: %+v", runs)
	}
}

func TestImportInsertValidatesThenApplies(t *testing.T) {
	f := newFixture(t)
	ctx := f.ctx
	_, err := f.app.SaveCategory(ctx, f.owner, Category{Name: "مشروبات", Active: true})
	f.must(err)
	tmpl, _, err := f.app.ImportTemplate(ctx, f.owner, "items", ModeInsert, "ar")
	f.must(err)

	// Row 3: missing price; row 4: unknown category; row 5: bad bool; row 6: duplicate code of row 2.
	bad := fill(t, tmpl, [][]any{
		{"T1", "شاي", "مشروبات", 20, "", 1, "نعم"},
		{"", "قهوة", "مشروبات", "", "", "", ""},
		{"", "عصير", "حلويات", 30, "", "", ""},
		{"", "مياه", "", 10, "", "", "ربما"},
		{"T1", "شاي أخضر", "", 25, "", "", ""},
	})
	res, err := f.app.Import(ctx, f.owner, "items", ModeInsert, bad, "ar")
	f.must(err)
	codes := map[string]int{}
	for _, i := range res.Issues {
		codes[i.Code] = i.Row
	}
	if codes["required"] != 3 || codes["unknown_reference"] != 4 || codes["invalid_bool"] != 5 || codes["duplicate_in_file"] != 6 {
		t.Fatalf("issues: %+v", res.Issues)
	}
	if items, _ := f.app.Items(ctx, f.owner); len(items) != 0 {
		t.Fatal("an invalid file must not save anything")
	}

	good := fill(t, tmpl, [][]any{
		{"T1", "شاي", "مشروبات", 20.5, "بالنعناع", 1, "نعم"},
		{"", "قهوة", "مشروبات", "35", "", "", "لا"},
	})
	res, err = f.app.Import(ctx, f.owner, "items", ModeInsert, good, "ar")
	f.must(err)
	if res.Inserted != 2 || len(res.Issues) != 0 {
		t.Fatalf("result %+v", res)
	}
	items, _ := f.app.Items(ctx, f.owner)
	byName := map[string]Item{}
	for _, i := range items {
		byName[i.Name] = i
	}
	if byName["شاي"].Price != 2050 || byName["شاي"].Code != "T1" || byName["قهوة"].Active || byName["قهوة"].Code == "" {
		t.Fatalf("items %+v", items)
	}

	// Inserting the same code again is reported, not applied.
	again := fill(t, tmpl, [][]any{{"T1", "شاي", "", 20, "", "", ""}})
	res, _ = f.app.Import(ctx, f.owner, "items", ModeInsert, again, "ar")
	if len(res.Issues) != 1 || res.Issues[0].Code != "already_exists" {
		t.Fatalf("issues %+v", res.Issues)
	}
}

func TestImportUpdateRoundTrip(t *testing.T) {
	f := newFixture(t)
	ctx := f.ctx
	_, err := f.app.SaveIngredient(ctx, f.owner, IngredientInput{Ingredient: Ingredient{Name: "لحم", Unit: "kg", Cost: 40000, Active: true}, OpeningStock: 5000})
	f.must(err)

	// Download the update template (prefilled), change the minimum, upload it back.
	tmpl, _, err := f.app.ImportTemplate(ctx, f.owner, "ingredients", ModeUpdate, "en")
	f.must(err)
	x, _ := excelize.OpenReader(bytes.NewReader(tmpl))
	sheet := x.GetSheetList()[0]
	rows, _ := x.GetRows(sheet)
	if len(rows) != 2 || rows[1][0] != "لحم" {
		t.Fatalf("prefill %v", rows)
	}
	if len(rows[0]) != 3 { // name, min_stock, active — unit/cost/opening are insert-only
		t.Fatalf("update columns %v", rows[0])
	}
	x.SetCellValue(sheet, "B2", 2.5)
	var buf bytes.Buffer
	x.Write(&buf)
	res, err := f.app.Import(ctx, f.owner, "ingredients", ModeUpdate, bytes.NewReader(buf.Bytes()), "en")
	f.must(err)
	if res.Updated != 1 {
		t.Fatalf("result %+v", res)
	}
	ings, _ := f.app.Ingredients(ctx, f.owner)
	if ings[0].MinStock != 2500 || ings[0].Stock != 5000 || ings[0].Unit != "kg" {
		t.Fatalf("after update %+v", ings[0])
	}

	// Updating an unknown name is reported.
	missing := fill(t, tmpl, [][]any{{"سمك", 1, "Yes"}})
	res, _ = f.app.Import(ctx, f.owner, "ingredients", ModeUpdate, missing, "en")
	if len(res.Issues) == 0 || res.Issues[len(res.Issues)-1].Code != "not_found" {
		t.Fatalf("issues %+v", res.Issues)
	}
}

func TestImportNeedsPermission(t *testing.T) {
	f := newFixture(t)
	cashier := f.login(rbac.Cashier, "c")
	if _, _, err := f.app.ImportTemplate(context.Background(), cashier, "items", ModeInsert, "ar"); code(err) != CodeForbidden {
		t.Fatalf("cashier got template: %v", err)
	}
	if got := f.app.ImportTargets(context.Background(), cashier, "ar"); len(got) != 0 {
		t.Fatalf("cashier targets %v", got)
	}
}

func TestExportRoundTrip(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	b, name, err := a.ExportData(ctx, owner, "items", "ar")
	f.must(err)
	if !strings.HasPrefix(name, "cpro-items-") || !strings.HasSuffix(name, ".xlsx") {
		t.Fatalf("name %q", name)
	}
	x, err := excelize.OpenReader(bytes.NewReader(b))
	f.must(err)
	sheet := x.GetSheetList()[0]
	rows, err := x.GetRows(sheet)
	f.must(err)
	if len(rows) != 3 { // header + «برجر» + the hidden item
		t.Fatalf("rows: %v", rows)
	}

	// An edited export goes straight back in on the update tab.
	col := -1
	for i, h := range rows[0] {
		if h == "السعر" {
			col = i
		}
	}
	for r, row := range rows {
		if r > 0 && strings.Contains(strings.Join(row, " "), "برجر") {
			cell, _ := excelize.CoordinatesToCellName(col+1, r+1)
			f.must(x.SetCellValue(sheet, cell, 200))
		}
	}
	var buf bytes.Buffer
	f.must(x.Write(&buf))
	res, err := a.Import(ctx, owner, "items", ModeUpdate, bytes.NewReader(buf.Bytes()), "ar")
	f.must(err)
	if len(res.Issues) != 0 || res.Updated != 2 {
		t.Fatalf("import: %+v", res)
	}
	items, _ := a.Items(ctx, owner)
	for _, it := range items {
		if it.ID == m.burger && it.Price != 20000 {
			t.Fatalf("price: %d", it.Price)
		}
	}
}

func TestExportEverythingRespectsPermissions(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	f.menu()
	b, name, err := a.ExportData(ctx, owner, exportAll, "ar")
	f.must(err)
	if !strings.HasPrefix(name, "cpro-data-") {
		t.Fatalf("name %q", name)
	}
	x, err := excelize.OpenReader(bytes.NewReader(b))
	f.must(err)
	if got := len(x.GetSheetList()); got != len(a.importEntities()) {
		t.Fatalf("sheets: %v", x.GetSheetList())
	}
	cashier := f.login(rbac.Cashier, "cashier")
	if _, _, err := a.ExportData(ctx, cashier, "customers", "ar"); code(err) != CodeForbidden {
		t.Fatalf("cashier exported customers: %v", err)
	}
	if b, _, err := a.ExportData(ctx, cashier, exportAll, "ar"); err == nil {
		c, _ := excelize.OpenReader(bytes.NewReader(b))
		for _, s := range c.GetSheetList() {
			if s == "العملاء" {
				t.Fatal("cashier got the customers sheet")
			}
		}
	}
}
