package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"cpro/internal/domain/money"
	"cpro/internal/domain/order"
	"cpro/internal/domain/rbac"
	"cpro/internal/platform/paths"
	"cpro/internal/store/sqlite"
)

type fixture struct {
	t     *testing.T
	ctx   context.Context
	app   *App
	owner Actor
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	t.Setenv("CPRO_DATA_DIR", t.TempDir())
	p, err := paths.Resolve()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	db, err := sqlite.Open(ctx, p.DB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	a := New(db, p, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Fixed clock at 14:00 local so business dates are deterministic.
	a.now = func() time.Time { return time.Date(2026, 10, 1, 14, 0, 0, 0, time.Local) }
	s, err := a.Setup(ctx, SetupInput{RestaurantName: "مطعم", OwnerName: "المالك", Username: "owner", Password: "owner1234", PIN: "1111"}, ChannelApp)
	if err != nil {
		t.Fatal(err)
	}
	actor, _, err := a.Authenticate(ctx, s.Token, ChannelApp)
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{t: t, ctx: ctx, app: a, owner: actor}
}

func (f *fixture) must(err error) {
	f.t.Helper()
	if err != nil {
		f.t.Fatal(err)
	}
}

func code(err error) Code {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// login creates a user with the given role and returns them as an actor.
func (f *fixture) login(role rbac.Role, username string) Actor {
	f.t.Helper()
	_, err := f.app.CreateUser(f.ctx, f.owner, UserInput{FullName: username, Username: username, Role: role, Password: "pass1234x", PIN: "2222", Active: true})
	f.must(err)
	s, err := f.app.Login(f.ctx, LoginInput{Username: username, Password: "pass1234x"}, ChannelApp, "test")
	f.must(err)
	a, _, err := f.app.Authenticate(f.ctx, s.Token, ChannelApp)
	f.must(err)
	return a
}

func TestFullRestaurantDay(t *testing.T) {
	f := newFixture(t)
	ctx, a, owner := f.ctx, f.app, f.owner

	// Settings: 14% tax on top, 12% service on dine-in.
	s, _ := a.Settings(ctx, owner)
	s.TaxRate, s.ServiceRate = 1400, 1200
	_, err := a.UpdateSettings(ctx, owner, s)
	f.must(err)

	// Inventory: beef in kg, bun per piece, cheese in kg.
	beef, err := a.SaveIngredient(ctx, owner, IngredientInput{Ingredient: Ingredient{Name: "لحم", Unit: "kg", Cost: 40000, Active: true}, OpeningStock: 10 * money.OneUnit})
	f.must(err)
	bun, err := a.SaveIngredient(ctx, owner, IngredientInput{Ingredient: Ingredient{Name: "عيش", Unit: "pcs", Cost: 300, MinStock: 50 * money.OneUnit, Active: true}, OpeningStock: 100 * money.OneUnit})
	f.must(err)
	cheese, err := a.SaveIngredient(ctx, owner, IngredientInput{Ingredient: Ingredient{Name: "جبنة", Unit: "kg", Cost: 30000, Active: true}, OpeningStock: 2 * money.OneUnit})
	f.must(err)

	// Menu: burger 150 EGP = 150 g beef + 1 bun; "extra cheese" +15 EGP = 30 g cheese.
	cat, err := a.SaveCategory(ctx, owner, Category{Name: "ساندوتشات", Active: true})
	f.must(err)
	groupID, err := a.SaveModifierGroup(ctx, owner, ModifierGroup{Name: "إضافات", MaxSelect: 2, Active: true, Modifiers: []Modifier{
		{Name: "جبنة زيادة", Price: 1500, Active: true, Recipe: []RecipeLine{{IngredientID: cheese, Qty: 30}}},
	}})
	f.must(err)
	groups, _ := a.ModifierGroups(ctx, owner)
	cheeseMod := groups[0].Modifiers[0].ID
	burger, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "برجر", CategoryID: cat.ID, Price: 15000, Active: true,
		ModifierGroupIDs: []string{groupID},
		Recipe:           []RecipeLine{{IngredientID: beef, Qty: 150}, {IngredientID: bun, Qty: 1000}}}})
	f.must(err)
	items, _ := a.Items(ctx, owner)
	if items[0].Cost != 6000+300 {
		t.Fatalf("recipe cost = %d, want 6300", items[0].Cost)
	}
	table, err := a.SaveTable(ctx, owner, Table{Name: "T1", Seats: 4, Active: true})
	f.must(err)

	cashier := f.login(rbac.Cashier, "cashier")
	waiter := f.login(rbac.Waiter, "waiter")

	// A waiter opens table T1 and orders 2 burgers, one with extra cheese.
	o, err := a.CreateOrder(ctx, waiter, OrderInput{Type: "dine_in", TableID: table.ID, Guests: 2}, "")
	f.must(err)
	again, err := a.CreateOrder(ctx, waiter, OrderInput{Type: "dine_in", TableID: table.ID}, "")
	f.must(err)
	if again.ID != o.ID {
		t.Fatal("opening an occupied table must return its open order")
	}
	_, err = a.AddLine(ctx, waiter, o.ID, LineInput{ItemID: burger, Qty: money.OneUnit, ModifierIDs: []string{cheeseMod}})
	f.must(err)
	o, err = a.AddLine(ctx, waiter, o.ID, LineInput{ItemID: burger, Qty: money.OneUnit})
	f.must(err)
	// subtotal 165 + 150 = 315; service 12% = 37.80; tax 14% of 315 = 44.10 (service untaxed by default)
	if o.Subtotal != 31500 || o.Service != 3780 || o.Tax != 4410 || o.Total != 39690 {
		t.Fatalf("totals: %+v", o)
	}
	if _, err := a.AddLine(ctx, waiter, o.ID, LineInput{ItemID: burger, ModifierIDs: []string{"bogus"}}); code(err) != CodeInvalid {
		t.Fatalf("foreign modifier accepted: %v", err)
	}
	o, err = a.SendToKitchen(ctx, waiter, o.ID)
	f.must(err)
	board, err := a.KitchenBoard(ctx, waiter, "")
	f.must(err)
	if len(board) != 1 || len(board[0].Lines) != 2 || len(board[0].Lines[0].Modifiers) != 1 {
		t.Fatalf("kitchen board: %+v", board)
	}

	// Waiter can't take payment; a sent line can't change quantity.
	if _, err := a.Pay(ctx, waiter, o.ID, nil, ""); code(err) != CodeForbidden {
		t.Fatalf("waiter paid: %v", err)
	}
	if _, err := a.UpdateLine(ctx, waiter, o.ID, o.Lines[1].ID, LineInput{Qty: 2000}); code(err) != CodeConflict {
		t.Fatalf("changed qty of a sent line: %v", err)
	}
	// Voiding a sent line needs a manager PIN; with the owner's PIN it works.
	if _, err := a.RemoveLine(ctx, waiter, o.ID, o.Lines[1].ID, VoidInput{Reason: "غلط"}); code(err) != CodeForbidden {
		t.Fatalf("waiter voided without approval: %v", err)
	}
	o, err = a.RemoveLine(ctx, waiter, o.ID, o.Lines[1].ID, VoidInput{Reason: "العميل غير رأيه", Waste: true, ApproverPIN: "1111"})
	f.must(err)
	if o.Total != 16500+1980+2310 { // 165 + 19.80 service + 23.10 tax
		t.Fatalf("total after void = %d", o.Total)
	}

	// Cashier needs an open shift to take payment.
	if _, err := a.Pay(ctx, cashier, o.ID, []Tender{{Method: "cash", Amount: o.Total}}, ""); code(err) != CodeConflict {
		t.Fatalf("paid without shift: %v", err)
	}
	shiftID, err := a.OpenShift(ctx, cashier, 50000)
	f.must(err)
	if _, err := a.OpenShift(ctx, cashier, 0); code(err) != CodeConflict {
		t.Fatalf("second open shift: %v", err)
	}
	// Split payment: 100 on card, the rest cash with 500 handed over.
	cash := o.Total - 10000
	if _, err := a.Pay(ctx, cashier, o.ID, []Tender{{Method: "card", Amount: 10000}, {Method: "cash", Amount: cash - 1}}, ""); code(err) != CodeInvalid {
		t.Fatalf("short payment accepted: %v", err)
	}
	res, err := a.Pay(ctx, cashier, o.ID, []Tender{{Method: "card", Amount: 10000}, {Method: "cash", Amount: cash, Tendered: 50000}}, "pay-1")
	f.must(err)
	if res.Change != 50000-cash || res.Order.Status != "paid" || res.Order.InvoiceNumber != "A-000001" {
		t.Fatalf("pay result: change=%d status=%s invoice=%s", res.Change, res.Order.Status, res.Order.InvoiceNumber)
	}
	// Retrying with the same idempotency key is a no-op.
	if _, err := a.Pay(ctx, cashier, o.ID, []Tender{{Method: "cash", Amount: o.Total}}, "pay-1"); err != nil {
		t.Fatalf("idempotent retry failed: %v", err)
	}

	// Stock: 1 sold burger (150 g beef, 1 bun, 30 g cheese) + 1 wasted burger (150 g, 1 bun).
	ings, _ := a.Ingredients(ctx, owner)
	stock := map[string]money.Milli{}
	for _, g := range ings {
		stock[g.ID] = g.Stock
	}
	if stock[beef] != 10000-300 || stock[bun] != 100000-2000 || stock[cheese] != 2000-30 {
		t.Fatalf("stock after sale: beef=%d bun=%d cheese=%d", stock[beef], stock[bun], stock[cheese])
	}

	// Shift X report: expected cash = float + cash part.
	rep, err := a.ShiftReport(ctx, cashier, shiftID)
	f.must(err)
	if rep.ExpectedCash != 50000+cash || rep.Orders != 1 {
		t.Fatalf("shift report: expected=%d orders=%d", rep.ExpectedCash, rep.Orders)
	}

	// Refund the burger: needs approval, returns the whole total.
	if _, err := a.Refund(ctx, cashier, o.ID, RefundInput{Lines: []RefundLineInput{{LineID: o.Lines[0].ID, Qty: 1000}}, Reason: "بارد"}, ""); code(err) != CodeForbidden {
		t.Fatalf("cashier refunded without approval: %v", err)
	}
	ref, err := a.Refund(ctx, cashier, o.ID, RefundInput{Lines: []RefundLineInput{{LineID: o.Lines[0].ID, Qty: 1000}}, Reason: "بارد", Method: "cash", ApproverPIN: "1111"}, "")
	f.must(err)
	if ref.Refunded != ref.Total {
		t.Fatalf("refunded %d of %d", ref.Refunded, ref.Total)
	}
	if _, err := a.Refund(ctx, cashier, o.ID, RefundInput{Lines: []RefundLineInput{{LineID: o.Lines[0].ID, Qty: 1000}}, Reason: "x", ApproverPIN: "1111"}, ""); code(err) != CodeInvalid {
		t.Fatalf("double refund accepted: %v", err)
	}

	// Close the shift counting exactly the expected cash after the refund.
	rep, err = a.ShiftReport(ctx, cashier, shiftID)
	f.must(err)
	closed, err := a.CloseShift(ctx, cashier, shiftID, rep.ExpectedCash)
	f.must(err)
	if closed.Difference == nil || *closed.Difference != 0 || closed.Shift.Status != "closed" {
		t.Fatalf("Z report: %+v", closed)
	}

	// Miscount fixed afterwards: only a manager, with a reason; history kept.
	if _, err := a.RecountShift(ctx, cashier, shiftID, 0, "x"); code(err) != CodeForbidden {
		t.Fatalf("cashier recounted: %v", err)
	}
	if _, err := a.RecountShift(ctx, owner, shiftID, rep.ExpectedCash-5000, ""); code(err) != CodeInvalid {
		t.Fatalf("recount without reason: %v", err)
	}
	fixed, err := a.RecountShift(ctx, owner, shiftID, rep.ExpectedCash-5000, "خطأ في العد")
	f.must(err)
	if *fixed.Difference != -5000 || len(fixed.Recounts) != 1 || fixed.Recounts[0].Previous != rep.ExpectedCash {
		t.Fatalf("recount: diff=%d recounts=%+v", *fixed.Difference, fixed.Recounts)
	}

	// Stock count: 9.6 kg beef found vs 9.7 expected → 100 g missing.
	countID, err := a.StartCount(ctx, owner, "جرد شهري")
	f.must(err)
	if _, err := a.StartCount(ctx, owner, ""); code(err) != CodeConflict {
		t.Fatalf("second draft count: %v", err)
	}
	counted := int64(9600)
	f.must(a.SetCountLines(ctx, owner, countID, map[string]*int64{beef: &counted}))
	f.must(a.PostCount(ctx, owner, countID))
	cnt, _ := a.GetCount(ctx, owner, countID)
	for _, l := range cnt.Lines {
		if l.IngredientID == beef && (l.Variance != -100 || l.VarianceCost != -4000) {
			t.Fatalf("count line: %+v", l)
		}
	}

	// Purchase 5 kg beef at 500/kg: average cost (9.6×400 + 5×500) / 14.6 = 434.25
	_, err = a.ReceivePurchase(ctx, owner, Purchase{Reference: "F-1", Lines: []PurchaseLine{{IngredientID: beef, Qty: 5000, UnitCost: 50000}}})
	f.must(err)
	ings, _ = a.Ingredients(ctx, owner)
	for _, g := range ings {
		if g.ID == beef && (g.Stock != 14600 || g.Cost != 43425) {
			t.Fatalf("after purchase: stock=%d cost=%d", g.Stock, g.Cost)
		}
	}

	// Consumption report reconciles: opening + purchased − closing = actual use.
	day := businessDate(a.now(), 6)
	cons, err := a.ConsumptionReport(ctx, owner, day, day)
	f.must(err)
	for _, r := range cons.Rows {
		if r.IngredientID == beef {
			// The opening balance was entered today, so it is an inflow of this period.
			if r.Opening != 0 || r.Purchased != 15000 || r.SalesUse != 150 || r.Waste != 150 || r.CountVariance != -100 ||
				r.Closing != 14600 || r.ActualUse != r.SalesUse+r.Waste-r.CountVariance {
				t.Fatalf("beef consumption: %+v", r)
			}
		}
	}

	sales, err := a.SalesReport(ctx, owner, day, day)
	f.must(err)
	if sales.Summary.Orders != 1 || sales.Summary.Refunds != sales.Summary.Sales || sales.Summary.VoidLines != 1 || len(sales.Items) != 1 {
		t.Fatalf("sales report: %+v", sales.Summary)
	}

	// Cashier can't see reports; audit log can't be edited and recorded the void.
	if _, err := a.SalesReport(ctx, cashier, day, day); code(err) != CodeForbidden {
		t.Fatalf("cashier saw reports: %v", err)
	}
	log, err := a.AuditLog(ctx, owner, day, day, "order.void_line", "")
	f.must(err)
	if len(log) != 1 {
		t.Fatalf("audit void_line entries = %d", len(log))
	}
}

func TestDiscountsNeedApproval(t *testing.T) {
	f := newFixture(t)
	ctx, a := f.ctx, f.app
	item, err := a.SaveItem(ctx, f.owner, ItemInput{Item: Item{Name: "شاي", Price: 2000, Active: true}})
	f.must(err)
	cashier := f.login(rbac.Cashier, "c")
	if _, err := a.CreateOrder(ctx, cashier, OrderInput{Type: "takeaway"}, ""); code(err) != CodeConflict {
		t.Fatalf("cashier sold without a shift: %v", err)
	}
	_, err = a.OpenShift(ctx, cashier, 0)
	f.must(err)
	o, err := a.CreateOrder(ctx, cashier, OrderInput{Type: "takeaway"}, "k1")
	f.must(err)
	if dup, _ := a.CreateOrder(ctx, cashier, OrderInput{Type: "takeaway"}, "k1"); dup.ID != o.ID {
		t.Fatal("idempotent create returned a new order")
	}
	_, err = a.AddLine(ctx, cashier, o.ID, LineInput{ItemID: item, Qty: 3000})
	f.must(err)
	d := DiscountInput{Kind: order.DiscountPercent, Rate: 5000, Reason: "صديق"}
	if _, err := a.SetOrderDiscount(ctx, cashier, o.ID, d); code(err) != CodeForbidden {
		t.Fatalf("cashier discounted without approval: %v", err)
	}
	d.ApproverPIN = "1111"
	o, err = a.SetOrderDiscount(ctx, cashier, o.ID, d)
	f.must(err)
	if o.Total != 3000 {
		t.Fatalf("discounted total = %d", o.Total)
	}
	bad := DiscountInput{Kind: order.DiscountFixed, Amount: 999999, Reason: "x", ApproverPIN: "1111"}
	if _, err := a.SetOrderDiscount(ctx, cashier, o.ID, bad); code(err) != CodeInvalid {
		t.Fatalf("discount above total accepted: %v", err)
	}
}

func TestSessionsAndUsers(t *testing.T) {
	f := newFixture(t)
	ctx, a := f.ctx, f.app
	s, err := a.Login(ctx, LoginInput{Username: "owner", Password: "owner1234"}, ChannelLAN, "1.2.3.4")
	f.must(err)
	if _, _, err := a.Authenticate(ctx, s.Token, ChannelTunnel); code(err) != CodeUnauthorized {
		t.Fatal("LAN token accepted over the tunnel")
	}
	for i := 0; i < 5; i++ {
		a.Login(ctx, LoginInput{Username: "owner", Password: "wrong"}, ChannelLAN, "9.9.9.9")
	}
	if _, err := a.Login(ctx, LoginInput{Username: "owner", Password: "owner1234"}, ChannelLAN, "9.9.9.9"); code(err) != CodeForbidden {
		t.Fatalf("login not throttled after 5 failures: %v", err)
	}
	// The only owner can't be disabled.
	users, _ := a.Users(ctx, f.owner)
	if err := a.UpdateUser(ctx, f.owner, users[0].ID, UserInput{FullName: "x", Role: rbac.Owner, Active: false}); code(err) != CodeConflict {
		t.Fatalf("disabled the last owner: %v", err)
	}
	// Disabling a user kills their sessions.
	c := f.login(rbac.Cashier, "cc")
	f.must(a.UpdateUser(ctx, f.owner, c.UserID, UserInput{FullName: "cc", Role: rbac.Cashier, Active: false}))
	if _, err := a.Login(ctx, LoginInput{Username: "cc", Password: "pass1234x"}, ChannelApp, "x"); code(err) != CodeUnauthorized {
		t.Fatalf("disabled user logged in: %v", err)
	}
	if _, err := a.Setup(ctx, SetupInput{RestaurantName: "x", OwnerName: "x", Username: "x", Password: "xxxx1234"}, ChannelApp); code(err) != CodeConflict {
		t.Fatalf("setup ran twice: %v", err)
	}
}

func TestBackup(t *testing.T) {
	f := newFixture(t)
	b, err := f.app.BackupNow(f.ctx, f.owner, "manual")
	f.must(err)
	if _, err := os.Stat(f.app.paths.Backups + "/" + b.Name); err != nil {
		t.Fatal(err)
	}
	list, _ := f.app.Backups(f.ctx, f.owner)
	if len(list) != 1 {
		t.Fatalf("backups = %d", len(list))
	}
}

func TestDeleteAndToggleCatalog(t *testing.T) {
	f := newFixture(t)
	ctx, a := f.ctx, f.app
	cat, err := a.SaveCategory(ctx, f.owner, Category{Name: "مشروبات", Active: true})
	f.must(err)
	unsold, err := a.SaveItem(ctx, f.owner, ItemInput{Item: Item{Name: "شاي", Code: "TEA", CategoryID: cat.ID, Price: 2000, Active: true}})
	f.must(err)
	sold, err := a.SaveItem(ctx, f.owner, ItemInput{Item: Item{Name: "قهوة", Code: "COF", CategoryID: cat.ID, Price: 3000, Active: true}})
	f.must(err)

	_, err = a.OpenShift(ctx, f.owner, 0)
	f.must(err)
	// Disabling hides the item from sale.
	f.must(a.SetActive(ctx, f.owner, "items", sold, false))
	o, err := a.CreateOrder(ctx, f.owner, OrderInput{Type: "takeaway"}, "")
	f.must(err)
	if _, err := a.AddLine(ctx, f.owner, o.ID, LineInput{ItemID: sold}); code(err) != CodeNotFound {
		t.Fatalf("sold a disabled item: %v", err)
	}
	f.must(a.SetActive(ctx, f.owner, "items", sold, true))
	_, err = a.AddLine(ctx, f.owner, o.ID, LineInput{ItemID: sold})
	f.must(err)

	// A never-sold item is removed; a used one is archived and its code freed.
	res, err := a.DeleteItem(ctx, f.owner, unsold)
	f.must(err)
	if res.Archived {
		t.Fatal("unused item should be deleted, not archived")
	}
	res, err = a.DeleteItem(ctx, f.owner, sold)
	f.must(err)
	if !res.Archived {
		t.Fatal("item on an order must be archived")
	}
	items, _ := a.Items(ctx, f.owner)
	if len(items) != 0 {
		t.Fatalf("deleted items still listed: %d", len(items))
	}
	order, _ := a.GetOrder(ctx, f.owner, o.ID)
	if order.Lines[0].Name != "قهوة" {
		t.Fatal("past order lost its item")
	}
	if _, err := a.SaveItem(ctx, f.owner, ItemInput{Item: Item{Name: "قهوة جديدة", Code: "COF", Price: 3500, Active: true}}); err != nil {
		t.Fatalf("code of archived item not reusable: %v", err)
	}

	// A category with live items can't be deleted.
	if err := a.DeleteCategory(ctx, f.owner, cat.ID); err != nil {
		t.Fatalf("empty category not deleted: %v", err)
	}
	cashier := f.login(rbac.Cashier, "c")
	if _, err := a.DeleteItem(ctx, cashier, "x"); code(err) != CodeForbidden {
		t.Fatalf("cashier deleted: %v", err)
	}
}
