package app

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"cpro/internal/domain/money"
)

func sortsOf(t *testing.T, a *App, query string, args ...any) map[string]int {
	t.Helper()
	rows, err := a.db.Read.Query(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var name string
		var sort int
		if err := rows.Scan(&name, &sort); err != nil {
			t.Fatal(err)
		}
		out[name] = sort
	}
	return out
}

func TestPositionsAreUnique(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	cat, err := a.SaveCategory(ctx, owner, Category{Name: "بيتزا", Active: true})
	f.must(err)
	add := func(name string, pos int) string {
		id, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: name, CategoryID: cat.ID, Price: 100, Sort: pos, Active: true}})
		f.must(err)
		return id
	}
	first := add("أ", 0)
	add("ب", 0)
	add("ج", 1) // takes first place; the others move down
	items := func() map[string]int {
		return sortsOf(t, a, `SELECT name, sort FROM items WHERE category_id = ?`, cat.ID)
	}
	if got := items(); got["ج"] != 1 || got["أ"] != 2 || got["ب"] != 3 {
		t.Fatalf("after insert: %v", got)
	}
	// Moving an item keeps every position taken exactly once; a save with no
	// position leaves it where it is.
	_, err = a.SaveItem(ctx, owner, ItemInput{Item: Item{ID: first, Name: "أ", CategoryID: cat.ID, Price: 100, Sort: 3, Active: true}})
	f.must(err)
	if got := items(); got["ج"] != 1 || got["ب"] != 2 || got["أ"] != 3 {
		t.Fatalf("after move: %v", got)
	}
	_, err = a.SaveItem(ctx, owner, ItemInput{Item: Item{ID: first, Name: "أ", CategoryID: cat.ID, Price: 100, Active: true}})
	f.must(err)
	if got := items(); got["أ"] != 3 {
		t.Fatalf("no position moved it: %v", got)
	}

	// Rows saved before this rule (all zero) get fixed on the next save.
	if _, err := a.db.Write.ExecContext(ctx, `UPDATE items SET sort = 0 WHERE category_id = ?`, cat.ID); err != nil {
		t.Fatal(err)
	}
	_, err = a.SaveItem(ctx, owner, ItemInput{Item: Item{ID: first, Name: "أ", CategoryID: cat.ID, Price: 100, Sort: 1, Active: true}})
	f.must(err)
	got := items()
	if got["أ"] != 1 || got["ب"] == got["ج"] || got["ب"] == 0 || got["ج"] == 0 {
		t.Fatalf("old rows: %v", got)
	}

	// Offers: per kind, so a family offer doesn't compete with the slider.
	offer := func(name, kind string, pos int) EMenuOffer {
		o, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: EMenuOffer{Name: name, Kind: kind, Price: 100, Sort: pos, Active: true}, ImageData: pngData(t)})
		f.must(err)
		return o
	}
	offer("س1", "single", 1)
	s2 := offer("س2", "single", 1)
	offer("ع1", "family", 1)
	offers, err := a.EMenuAdmin(ctx, owner)
	f.must(err)
	sorts := map[string]int{}
	for _, o := range offers.Offers {
		sorts[o.Name] = o.Sort
	}
	if sorts["س2"] != 1 || sorts["س1"] != 2 || sorts["ع1"] != 1 || s2.Sort != 1 {
		t.Fatalf("offers: %v", sorts)
	}

	// Categories.
	_, err = a.SaveCategory(ctx, owner, Category{Name: "مشروبات", Sort: 1, Active: true})
	f.must(err)
	cats, _ := a.Categories(ctx, owner)
	seen := map[int]bool{}
	for _, c := range cats {
		if seen[c.Sort] {
			t.Fatalf("categories share a position: %+v", cats)
		}
		seen[c.Sort] = true
	}
	if cats[0].Name != "مشروبات" {
		t.Fatalf("categories: %+v", cats)
	}
}

func TestEstimatedTime(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	cats, _ := a.Categories(ctx, owner)
	fries, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "بطاطس", CategoryID: cats[0].ID, Price: 3000, PrepMinutes: 10, Active: true}})
	f.must(err)
	pizza, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "بيتزا", CategoryID: cats[0].ID, Price: 3000, PrepMinutes: 25, Active: true}})
	f.must(err)
	if _, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "غلط", Price: 1, PrepMinutes: maxPrepMinutes + 1, Active: true}}); code(err) != CodeInvalid {
		t.Fatalf("bad minutes: %v", err)
	}

	// The longest item, not the sum: the kitchen works on them together.
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: fries, Qty: 2}, {ItemID: pizza, Qty: 1}}}, "1.0.0.1")
	f.must(err)
	if g.ETAMinutes != 25 {
		t.Fatalf("hall eta: %d", g.ETAMinutes)
	}

	// Delivery adds the trip.
	s := f.emenuSettings()
	s.DeliveryMinutes = 30
	_, err = a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s})
	f.must(err)
	g, err = a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "delivery", CustomerName: "كريم", Phone: "01012345678", Address: "شارع", Lines: []OnlineLineInput{{ItemID: fries, Qty: 1}}}, "1.0.0.2")
	f.must(err)
	if g.ETAMinutes != 40 {
		t.Fatalf("delivery eta: %d", g.ETAMinutes)
	}
}

func TestHotDealPrice(t *testing.T) {
	f := newFixture(t)
	shift(f)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu() // burger: 15000

	if _, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "hot_deal", Deal: 15000}}); code(err) != CodeInvalid {
		t.Fatalf("deal not below the price: %v", err)
	}
	if _, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "hot_deal", Deal: -1}}); code(err) != CodeInvalid {
		t.Fatalf("negative deal: %v", err)
	}
	list, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "hot_deal", Note: "لفترة محدودة", Deal: 12000}})
	f.must(err)
	if list[0].Deal != 12000 || list[0].Note != "لفترة محدودة" {
		t.Fatalf("featured: %+v", list)
	}

	// Guests see the deal everywhere, with the old price to strike out.
	pub, err := a.PublicMenu(ctx, "")
	f.must(err)
	it := pub.Featured[0].Item
	cat := pub.Categories[0].Items[0]
	if it.Price != 12000 || it.WasPrice != 15000 || it.Note != "لفترة محدودة" || cat.Price != 12000 || cat.WasPrice != 15000 {
		t.Fatalf("public item: %+v / %+v", it, cat)
	}

	// The guest's order is priced by the server, and stays at the deal when
	// the cashier accepts it, even if the deal ended in between.
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 2, ModifierIDs: []string{m.cheese}}}}, "1.0.0.1")
	f.must(err)
	if g.Total != 2*(12000+1500) {
		t.Fatalf("guest total: %d", g.Total)
	}
	_, err = a.SetFeatured(ctx, owner, nil)
	f.must(err)
	inbox, err := a.Inbox(ctx, owner)
	f.must(err)
	o, err := a.AcceptOnlineOrder(ctx, owner, inbox.Orders[0].ID)
	f.must(err)
	if o.Lines[0].UnitPrice != 12000 {
		t.Fatalf("accepted at %d", o.Lines[0].UnitPrice)
	}

	// The POS keeps the normal price.
	_, err = a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "hot_deal", Deal: 12000}})
	f.must(err)
	pos, err := a.CreateOrder(ctx, owner, OrderInput{Type: "takeaway"}, "")
	f.must(err)
	pos, err = a.AddLine(ctx, owner, pos.ID, LineInput{ItemID: m.burger, ModifierIDs: []string{m.cheese}})
	f.must(err)
	if pos.Lines[0].UnitPrice != 15000 {
		t.Fatalf("POS price: %d", pos.Lines[0].UnitPrice)
	}

	// A deal stops applying if the item later gets cheaper than it.
	f.must(func() error {
		_, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{ID: m.burger, Name: "برجر", Code: "B1", CategoryID: pub.Categories[0].ID, Price: 10000, Active: true}})
		return err
	}())
	pub, _ = a.PublicMenu(ctx, "")
	if it := pub.Categories[0].Items[0]; it.Price != 10000 || it.WasPrice != 0 {
		t.Fatalf("stale deal: %+v", it)
	}

	// Another badge drops the deal price.
	list, err = a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "new", Deal: 9000}})
	f.must(err)
	if list[0].Deal != 0 {
		t.Fatalf("deal kept on another badge: %+v", list[0])
	}
}

func shift(f *fixture) {
	f.t.Helper()
	_, err := f.app.OpenShift(f.ctx, f.owner, 0)
	f.must(err)
}

func TestOfferContents(t *testing.T) {
	f := newFixture(t)
	shift(f)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu() // burger: 15000
	cats, _ := a.Categories(ctx, owner)
	dough, err := a.SaveIngredient(ctx, owner, IngredientInput{Ingredient: Ingredient{Name: "عجين", Unit: "pcs", Cost: 100, Active: true}, OpeningStock: 100 * money.OneUnit})
	f.must(err)
	pizza, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "مارجريتا", CategoryID: cats[0].ID, Price: 18000, PrepMinutes: 20, Active: true,
		Recipe: []RecipeLine{{IngredientID: dough, Qty: 1 * money.OneUnit}}}})
	f.must(err)

	offer := EMenuOffer{Name: "2 مارجريتا + 2 برجر", Kind: "family", Price: 50000, Active: true,
		Contents: []EMenuOfferContent{{ItemID: pizza, Qty: 2}, {ItemID: m.burger, Qty: 2}}}
	o, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: offer, ImageData: pngData(t)})
	f.must(err)
	if len(o.Contents) != 2 || o.Contents[0].Name != "مارجريتا" || o.Contents[0].Qty != 2 {
		t.Fatalf("contents: %+v", o.Contents)
	}

	// Rejected: an offer inside an offer, a repeat, a bad quantity, an unknown item.
	bad := []EMenuOfferContent{{ItemID: o.ItemID, Qty: 1}}
	if _, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: EMenuOffer{ID: o.ID, Name: "x", Kind: "family", Price: 1, Contents: bad}}); code(err) != CodeInvalid {
		t.Fatalf("offer in offer: %v", err)
	}
	for _, list := range [][]EMenuOfferContent{{{ItemID: pizza, Qty: 1}, {ItemID: pizza, Qty: 1}}, {{ItemID: pizza, Qty: 0}}, {{ItemID: "nope", Qty: 1}}} {
		if _, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: EMenuOffer{ID: o.ID, Name: "x", Kind: "family", Price: 1, Contents: list}}); err == nil {
			t.Fatalf("accepted %+v", list)
		}
	}

	// An item inside an offer can't be deleted from under it.
	if _, err := a.DeleteItem(ctx, owner, pizza); code(err) != CodeConflict {
		t.Fatalf("delete a content item: %v", err)
	}

	// Guests see what's inside, the saving, and the longest prep time.
	pub, err := a.PublicMenu(ctx, "")
	f.must(err)
	it := pub.Offers[0].Item
	if len(it.Includes) != 2 || it.Includes[1].Name != "برجر" || it.WasPrice != 2*18000+2*15000 || it.PrepMinutes != 20 {
		t.Fatalf("public offer: %+v", it)
	}
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: o.ItemID, Qty: 1}}}, "1.0.0.1")
	f.must(err)
	if g.ETAMinutes != 20 {
		t.Fatalf("offer eta: %d", g.ETAMinutes)
	}

	// The kitchen sees what to make; the price stays the offer's.
	inbox, _ := a.Inbox(ctx, owner)
	order, err := a.AcceptOnlineOrder(ctx, owner, inbox.Orders[0].ID)
	f.must(err)
	if order.Subtotal != 50000 {
		t.Fatalf("subtotal: %d", order.Subtotal)
	}
	board, err := a.KitchenBoard(ctx, owner, "")
	f.must(err)
	var labels []string
	for _, l := range board[0].Lines[0].Modifiers {
		labels = append(labels, l.Name)
	}
	if got := strings.Join(labels, "|"); !strings.Contains(got, "2× مارجريتا") || !strings.Contains(got, "2× برجر") {
		t.Fatalf("kitchen modifiers: %q", got)
	}

	// Paying deducts the recipes of what's inside.
	_, err = a.Pay(ctx, owner, order.ID, []Tender{{Method: "cash", Amount: order.Total}}, "")
	f.must(err)
	ings, err := a.Ingredients(ctx, owner)
	f.must(err)
	if ings[0].Stock != 98*money.OneUnit {
		t.Fatalf("stock: %d", ings[0].Stock)
	}

	// Removing the offer frees the item.
	f.must(a.DeleteOffer(ctx, owner, o.ID))
	if _, err := a.DeleteItem(ctx, owner, pizza); err != nil {
		t.Fatalf("delete after the offer is gone: %v", err)
	}
}

func TestKitchenStationSeesSharedCategories(t *testing.T) {
	f := newFixture(t)
	shift(f)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu() // its category has no station
	st, err := a.SaveStation(ctx, owner, Station{Name: "مشويات", Active: true})
	f.must(err)
	_, err = a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "1.0.0.1")
	f.must(err)
	inbox, _ := a.Inbox(ctx, owner)
	_, err = a.AcceptOnlineOrder(ctx, owner, inbox.Orders[0].ID)
	f.must(err)
	board, err := a.KitchenBoard(ctx, owner, st.ID)
	f.must(err)
	if len(board) != 1 {
		t.Fatalf("station board: %+v", board)
	}
}

func TestOrderStage(t *testing.T) {
	f := newFixture(t)
	shift(f)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	cats, _ := a.Categories(ctx, owner)
	fries, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "بطاطس", CategoryID: cats[0].ID, Price: 3000, Active: true}})
	f.must(err)
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}, {ItemID: fries, Qty: 1}}}, "1.0.0.1")
	f.must(err)
	if g.Status != "pending" || g.Stage != "" {
		t.Fatalf("pending: %+v", g)
	}
	stage := func() string {
		t.Helper()
		g, err := a.GuestOrderStatus(ctx, g.Token)
		f.must(err)
		return g.Stage
	}
	inbox, _ := a.Inbox(ctx, owner)
	order, err := a.AcceptOnlineOrder(ctx, owner, inbox.Orders[0].ID)
	f.must(err)
	if s := stage(); s != "preparing" {
		t.Fatalf("after accept: %q", s)
	}
	f.must(a.SetKitchenStatus(ctx, owner, []string{order.Lines[0].ID}, "ready"))
	if s := stage(); s != "preparing" {
		t.Fatalf("one line ready: %q", s)
	}
	f.must(a.SetKitchenStatus(ctx, owner, []string{order.Lines[1].ID}, "ready"))
	if s := stage(); s != "ready" {
		t.Fatalf("all ready: %q", s)
	}
	// The kitchen screen's «done» bumps the whole ticket to served.
	f.must(a.SetKitchenStatus(ctx, owner, []string{order.Lines[0].ID, order.Lines[1].ID}, "served"))
	if s := stage(); s != "ready" {
		t.Fatalf("bumped: %q", s)
	}

	// Paid long ago: stop following it.
	_, err = a.Pay(ctx, owner, order.ID, []Tender{{Method: "cash", Amount: order.Total}}, "")
	f.must(err)
	if s := stage(); s != "ready" {
		t.Fatalf("just paid: %q", s)
	}
	start := a.now()
	a.now = func() time.Time { return start.Add(orderFollowFor + time.Minute) }
	if s := stage(); s != "closed" {
		t.Fatalf("paid long ago: %q", s)
	}
}

func TestMenuByLink(t *testing.T) {
	f := newFixture(t)
	a, ctx := f.app, f.ctx
	m := f.menu()

	// Online link: delivery only, nothing about tables.
	online, err := a.PublicMenu(ctx, "")
	f.must(err)
	if online.Ordering.DineIn || online.Ordering.CallWaiter || !online.Ordering.Delivery || len(online.Tables) != 0 {
		t.Fatalf("online: %+v tables %v", online.Ordering, online.Tables)
	}
	// Hall QR: the list of tables and the help button, no delivery.
	hall, err := a.PublicHallMenu(ctx)
	f.must(err)
	if !hall.Ordering.DineIn || !hall.Ordering.CallWaiter || hall.Ordering.Delivery || len(hall.Tables) != 1 || hall.Tables[0] != "T1" || hall.Table != nil {
		t.Fatalf("hall: %+v tables %v", hall.Ordering, hall.Tables)
	}
	// A table's QR: the table is known.
	table, err := a.PublicMenu(ctx, m.token)
	f.must(err)
	if table.Table == nil || !table.Ordering.CallWaiter || len(table.Tables) != 0 {
		t.Fatalf("table: %+v", table.Ordering)
	}

	// The hall order goes to the picked table.
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "dine_in", TableNumber: "T1", Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "1.0.0.1")
	f.must(err)
	if g.TableName != "T1" {
		t.Fatalf("hall order table: %q", g.TableName)
	}
}

func TestServiceCalls(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()

	if err := a.CallWaiter(ctx, ServiceCall{Kind: "waiter"}, "1.1.1.1"); code(err) != CodeInvalid {
		t.Fatalf("no table: %v", err)
	}
	if err := a.CallWaiter(ctx, ServiceCall{Table: m.token, Kind: "nope"}, "1.1.1.1"); code(err) != CodeInvalid {
		t.Fatalf("bad kind: %v", err)
	}
	f.must(a.CallWaiter(ctx, ServiceCall{TableNumber: "T1", Kind: "waiter", Note: "ignored"}, "1.1.1.1"))
	f.must(a.CallWaiter(ctx, ServiceCall{Table: m.token, Kind: "issue", Note: "الأكل بارد"}, "1.1.1.1"))
	f.must(a.CallWaiter(ctx, ServiceCall{TableNumber: "T1", Kind: "issue", Note: "الطلب ناقص"}, "1.1.1.1"))
	in, err := a.Inbox(ctx, owner)
	f.must(err)
	if len(in.Requests) != 2 {
		t.Fatalf("requests: %+v", in.Requests)
	}
	for _, r := range in.Requests {
		if r.Kind == "waiter" && r.Note != "" {
			t.Fatalf("waiter note: %+v", r)
		}
		if r.Kind == "issue" && r.Note != "الطلب ناقص" {
			t.Fatalf("issue note: %+v", r)
		}
	}
}

// Every reason a table can call for, with the picks and notes each keeps.
func TestServiceCallReasons(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	call := func(c ServiceCall) error { c.Table = m.token; return a.CallWaiter(ctx, c, "1.1.1.1") }

	if err := call(ServiceCall{Kind: "other"}); code(err) != CodeInvalid {
		t.Fatalf("other without a note: %v", err)
	}
	if err := call(ServiceCall{Kind: "extras", Details: []string{"caviar"}}); code(err) != CodeInvalid {
		t.Fatalf("extras with nothing known: %v", err)
	}
	f.must(call(ServiceCall{Kind: "order", Note: "dropped"}))
	f.must(call(ServiceCall{Kind: "late"}))
	f.must(call(ServiceCall{Kind: "bill", Details: []string{"card", "cash", "bogus"}}))
	f.must(call(ServiceCall{Kind: "extras", Details: []string{"water", "water", "napkins", "caviar"}, Note: "2 مياه"}))
	f.must(call(ServiceCall{Kind: "other", Note: "عايزين نغير الترابيزة"}))
	// A newer pick replaces the open one instead of adding a call.
	f.must(call(ServiceCall{Kind: "bill", Details: []string{"cash"}}))
	if err := call(ServiceCall{Kind: "extras"}); code(err) != CodeInvalid {
		t.Fatalf("empty extras: %v", err)
	}

	in, err := a.Inbox(ctx, owner)
	f.must(err)
	got := map[string]ServiceRequest{}
	for _, r := range in.Requests {
		got[r.Kind] = r
	}
	if len(in.Requests) != 5 {
		t.Fatalf("requests: %+v", in.Requests)
	}
	if r := got["order"]; r.Note != "" || len(r.Details) != 0 {
		t.Fatalf("order kept extras: %+v", r)
	}
	if r := got["bill"]; strings.Join(r.Details, ",") != "cash" {
		t.Fatalf("bill: %+v", r)
	}
	if r := got["extras"]; strings.Join(r.Details, ",") != "water,napkins" || r.Note != "2 مياه" {
		t.Fatalf("extras: %+v", r)
	}
	if r := got["other"]; r.Note != "عايزين نغير الترابيزة" {
		t.Fatalf("other: %+v", r)
	}
}

// The schema takes every kind of call and keeps its index.
func TestServiceRequestsRebuilt(t *testing.T) {
	f := newFixture(t)
	var sqlText string
	err := f.app.db.Read.QueryRowContext(f.ctx, `SELECT sql FROM sqlite_master WHERE name = 'service_requests'`).Scan(&sqlText)
	f.must(err)
	if !strings.Contains(sqlText, "'issue'") || !strings.Contains(sqlText, "'extras'") || !strings.Contains(sqlText, "details") {
		t.Fatalf("table not rebuilt: %s", sqlText)
	}
	var idx string
	err = f.app.db.Read.QueryRowContext(f.ctx, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'service_requests_open'`).Scan(&idx)
	if errors.Is(err, sql.ErrNoRows) {
		t.Fatal("index lost")
	}
	f.must(err)
}

func TestOfferOverlay(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	o := EMenuOffer{Name: "عرض", Kind: "single", Price: 100, Active: true, OverlayOpacity: 40, OverlayColor: "navy"}
	saved, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: o, ImageData: pngData(t)})
	f.must(err)
	if saved.OverlayOpacity != 40 || saved.OverlayColor != "navy" {
		t.Fatalf("saved: %+v", saved)
	}
	pub, err := a.PublicMenu(ctx, "")
	f.must(err)
	if got := pub.Offers[0]; got.OverlayOpacity != 40 || got.OverlayColor != "#0F1F3D" {
		t.Fatalf("public: %+v", got)
	}

	// Showing or hiding an offer sends the row back: its shade survives.
	saved.Active = false
	again, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: saved})
	f.must(err)
	if again.OverlayOpacity != 40 || again.OverlayColor != "navy" {
		t.Fatalf("after toggle: %+v", again)
	}

	// No shade at all is a valid choice; a free-form value isn't.
	saved.OverlayOpacity = 0
	if got, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: saved}); err != nil || got.OverlayOpacity != 0 {
		t.Fatalf("zero: %+v %v", got, err)
	}
	for _, bad := range []EMenuOffer{{OverlayOpacity: 101, OverlayColor: "black"}, {OverlayOpacity: -1, OverlayColor: "black"}, {OverlayOpacity: 50, OverlayColor: "url(evil)"}} {
		x := saved
		x.OverlayOpacity, x.OverlayColor = bad.OverlayOpacity, bad.OverlayColor
		if _, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: x}); code(err) != CodeInvalid {
			t.Fatalf("accepted %+v: %v", bad, err)
		}
	}
}

// The table's own QR shows what it owes; voided lines don't count.
func TestPublicBill(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()

	b, err := a.PublicBill(ctx, m.token)
	f.must(err)
	if b.Table != "T1" || len(b.Lines) != 0 || b.Total != 0 {
		t.Fatalf("empty bill: %+v", b)
	}
	if _, err := a.PublicBill(ctx, ""); code(err) != CodeNotFound {
		t.Fatalf("no token: %v", err)
	}

	_, err = a.OpenShift(ctx, owner, 0)
	f.must(err)
	o, err := a.CreateOrder(ctx, owner, OrderInput{Type: "dine_in", TableID: m.table}, "")
	f.must(err)
	_, err = a.AddLine(ctx, owner, o.ID, LineInput{ItemID: m.burger, ModifierIDs: []string{m.cheese}})
	f.must(err)
	o, err = a.AddLine(ctx, owner, o.ID, LineInput{ItemID: m.burger, Qty: 2 * money.OneUnit})
	f.must(err)

	b, err = a.PublicBill(ctx, m.token)
	f.must(err)
	if len(b.Lines) != 2 || b.Total != o.Total || b.Due != o.Total || b.Total == 0 {
		t.Fatalf("bill %+v vs order total %d", b, o.Total)
	}
	if len(b.Lines[0].Modifiers) != 1 || b.Lines[0].Modifiers[0] != "جبنة" {
		t.Fatalf("modifiers: %+v", b.Lines[0])
	}
}

// Calls per reason, how long they waited and who answered them.
func TestServiceReport(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	call := func(kind string) {
		f.must(a.CallWaiter(ctx, ServiceCall{Table: m.token, Kind: kind, Details: []string{"cash"}}, "1.1.1.1"))
	}
	call("waiter")
	call("bill")
	in, err := a.Inbox(ctx, owner)
	f.must(err)
	for _, r := range in.Requests {
		if r.Kind == "waiter" {
			f.must(a.DoneServiceRequest(ctx, owner, r.ID))
		}
	}
	today := businessDate(a.now(), 6)
	r, err := a.ServiceReport(ctx, owner, today, today)
	f.must(err)
	if r.Calls != 2 || r.Answered != 1 || len(r.ByKind) != 2 || len(r.ByStaff) != 1 || r.ByStaff[0].Answered != 1 {
		t.Fatalf("report: %+v", r)
	}
	hours := 0
	for _, h := range r.ByHour {
		hours += h.Orders
	}
	if hours != 2 {
		t.Fatalf("by hour: %+v", r.ByHour)
	}
	if _, err := a.ServiceReport(ctx, Actor{Role: "waiter"}, today, today); code(err) != CodeForbidden {
		t.Fatalf("waiter sees reports: %v", err)
	}
}

// The savings sticker keeps its place, size and motion, stays on the picture,
// and starts where it always was for clients that don't send them.
func TestOfferSticker(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	o := EMenuOffer{Name: "عرض العيلة", Kind: "family", Price: 100, Active: true, Highlight: "وفّر 20%", OverlayColor: "black"}
	saved, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: o, ImageData: pngData(t)})
	f.must(err)
	if saved.HighlightX != 14 || saved.HighlightY != 20 || saved.HighlightSize != 100 || saved.HighlightMotion != "pulse" {
		t.Fatalf("defaults: %+v", saved)
	}

	saved.HighlightX, saved.HighlightY, saved.HighlightSize, saved.HighlightMotion = 80, 70, 150, "bounce"
	saved, err = a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: saved})
	f.must(err)
	pub, err := a.PublicMenu(ctx, "")
	f.must(err)
	if g := pub.Offers[0]; g.HighlightX != 80 || g.HighlightY != 70 || g.HighlightSize != 150 || g.HighlightMotion != "bounce" {
		t.Fatalf("public: %+v", g)
	}

	// Out of range is pulled back onto the picture; an unknown motion is refused.
	saved.HighlightX, saved.HighlightY, saved.HighlightSize = 140, -5, 900
	got, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: saved})
	f.must(err)
	if got.HighlightX != 100 || got.HighlightY != 0 || got.HighlightSize != 200 {
		t.Fatalf("clamped: %+v", got)
	}
	got.HighlightMotion = "explode"
	if _, err := a.SaveOffer(ctx, owner, EMenuOfferInput{EMenuOffer: got}); code(err) != CodeInvalid {
		t.Fatalf("bad motion: %v", err)
	}
}
