package app

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/license"
	"cpro/internal/platform/paths"
	"cpro/internal/saas"
	"cpro/internal/saas/saastest"
	"cpro/internal/store/sqlite"
)

// linkedFixture is a fixture with licensing on, talking to a fake Platform.
func linkedFixture(t *testing.T) (*fixture, *saastest.Fake) {
	t.Helper()
	f := newFixture(t)
	fake := saastest.New("ACT-TEST")
	t.Cleanup(fake.Close)
	old := license.PublicKey
	license.PublicKey = fake.Public
	t.Cleanup(func() { license.PublicKey = old })
	// The fake signs with the real clock; keep the app on it too.
	f.app.now = time.Now
	id, err := saas.LoadIdentity(filepath.Join(t.TempDir(), "device.json"))
	f.must(err)
	f.must(f.app.EnablePlatform(f.ctx, saas.NewClient(id)))
	f.must(f.app.SetPlatformURL(f.ctx, f.owner, fake.URL))
	return f, fake
}

type menuFixture struct {
	burger, cheese, table, token string
}

func (f *fixture) menu() menuFixture {
	a, ctx, owner := f.app, f.ctx, f.owner
	cat, err := a.SaveCategory(ctx, owner, Category{Name: "ساندوتشات", Active: true})
	f.must(err)
	gid, err := a.SaveModifierGroup(ctx, owner, ModifierGroup{Name: "إضافات", MaxSelect: 2, Active: true, Modifiers: []Modifier{{Name: "جبنة", Price: 1500, Active: true}}})
	f.must(err)
	groups, _ := a.ModifierGroups(ctx, owner)
	burger, err := a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "برجر", CategoryID: cat.ID, Price: 15000, Active: true, ModifierGroupIDs: []string{gid}}})
	f.must(err)
	_, err = a.SaveItem(ctx, owner, ItemInput{Item: Item{Name: "مخفي", CategoryID: cat.ID, Price: 100, Active: false}})
	f.must(err)
	tbl, err := a.SaveTable(ctx, owner, Table{Name: "T1", Active: true})
	f.must(err)
	return menuFixture{burger: burger, cheese: groups[0].Modifiers[0].ID, table: tbl.ID, token: tbl.QRToken}
}

func TestActivationGatesSelling(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()

	if _, err := a.CreateOrder(ctx, owner, OrderInput{Type: "takeaway"}, ""); code(err) != CodeForbidden {
		t.Fatalf("sold while unlicensed: %v", err)
	}
	info, _ := a.PlatformInfo(ctx, owner)
	if info.State != license.Unlicensed || info.Linked {
		t.Fatalf("info before activation: %+v", info)
	}
	cashier := f.login(rbac.Cashier, "cashier")
	if _, err := a.ActivateDevice(ctx, cashier, "ACT-TEST", ""); code(err) != CodeForbidden {
		t.Fatalf("cashier activated: %v", err)
	}
	if _, err := a.ActivateDevice(ctx, owner, "ACT-WRONG", ""); code(err) != CodeConflict {
		t.Fatalf("wrong code: %v", err)
	}
	info, err := a.ActivateDevice(ctx, owner, "act-test", "الكاشير")
	f.must(err)
	if info.State != license.Active || info.TenantName != "مطعم التجربة" || !info.Features.EMenu() {
		t.Fatalf("info after activation: %+v", info)
	}
	if _, err := a.OpenShift(ctx, owner, 0); err != nil {
		t.Fatal(err)
	}
	o, err := a.CreateOrder(ctx, owner, OrderInput{Type: "takeaway"}, "")
	f.must(err)
	_, err = a.AddLine(ctx, owner, o.ID, LineInput{ItemID: m.burger})
	f.must(err)

	// A license survives a restart (state is persisted).
	id := a.platform.client.ID
	a2 := New(a.db, a.paths, a.log)
	f.must(a2.EnablePlatform(ctx, saas.NewClient(id)))
	if !a2.licenseStatus().CanSell() {
		t.Fatal("license lost after restart")
	}
	// ...but not on another installation restoring the same database.
	other, _ := saas.LoadIdentity(filepath.Join(t.TempDir(), "other.json"))
	a3 := New(a.db, a.paths, a.log)
	f.must(a3.EnablePlatform(ctx, saas.NewClient(other)))
	if a3.licenseStatus().State != license.Unlicensed {
		t.Fatal("license accepted on another device")
	}

	// The owner sets a domain on the Platform; the next sync picks it up.
	fake.Update("ACT-TEST", func(t *saastest.Tenant) {
		t.Tunnel = &saas.Tunnel{Domain: "karama.cpro.app", ConnectorToken: "tok-1"}
	})
	a.syncOnce(ctx, false)
	if tok, dom := a.TunnelConfig(); tok != "tok-1" || dom != "karama.cpro.app" {
		t.Fatalf("tunnel after sync: %q %q", tok, dom)
	}

	// Suspension on the Platform blocks selling at the next refresh.
	fake.Update("ACT-TEST", func(t *saastest.Tenant) { t.Status = "suspended" })
	a.syncOnce(ctx, false)
	if _, err := a.AddLine(ctx, owner, o.ID, LineInput{ItemID: m.burger}); code(err) != CodeForbidden {
		t.Fatalf("sold while suspended: %v", err)
	}
	if tok, _ := a.TunnelConfig(); tok != "" {
		t.Fatal("tunnel kept running while suspended")
	}

	// Revoking the device from the Platform restricts it too.
	fake.Update("ACT-TEST", func(t *saastest.Tenant) { t.Status = "active" })
	a.syncOnce(ctx, false)
	if !a.licenseStatus().CanSell() {
		t.Fatal("not restored after reactivation")
	}
	fake.Revoke(id.DeviceID)
	a.syncOnce(ctx, false)
	if st := a.licenseStatus(); st.State != license.Restricted || st.Reason != license.ReasonRevoked {
		t.Fatalf("after revoke: %+v", st)
	}

	// Unlinking clears the local license.
	f.must(a.UnlinkDevice(ctx, owner, true))
	if a.licenseStatus().State != license.Unlicensed {
		t.Fatal("still licensed after unlink")
	}
}

func TestPlatformURLValidation(t *testing.T) {
	f, _ := linkedFixture(t)
	if err := f.app.SetPlatformURL(f.ctx, f.owner, "http://evil.example.com"); code(err) != CodeInvalid {
		t.Fatalf("plain http accepted: %v", err)
	}
}

func TestEMenuOrderingFlow(t *testing.T) {
	f := newFixture(t) // licensing off: every feature on
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()

	menu, err := a.PublicMenu(ctx, m.token)
	f.must(err)
	if menu.Table == nil || *menu.Table != "T1" || !menu.Ordering.DineIn || !menu.Ordering.CallWaiter {
		t.Fatalf("menu: %+v", menu)
	}
	if len(menu.Categories) != 1 || len(menu.Categories[0].Items) != 1 || len(menu.Categories[0].Items[0].Groups) != 1 {
		t.Fatalf("inactive item leaked or groups missing: %+v", menu.Categories)
	}
	if _, err := a.PublicMenu(ctx, "nope"); code(err) != CodeNotFound {
		t.Fatalf("bad table token: %v", err)
	}

	// Waiter call is de-duplicated per table and kind.
	f.must(a.CallWaiter(ctx, m.token, "waiter", "1.1.1.1"))
	f.must(a.CallWaiter(ctx, m.token, "waiter", "1.1.1.1"))
	f.must(a.CallWaiter(ctx, m.token, "bill", "1.1.1.1"))
	inbox, err := a.Inbox(ctx, owner)
	f.must(err)
	if len(inbox.Requests) != 2 {
		t.Fatalf("requests: %+v", inbox.Requests)
	}
	f.must(a.DoneServiceRequest(ctx, owner, inbox.Requests[0].ID))

	// The guest can't set prices: totals come from the menu.
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{
		{ItemID: m.burger, Qty: 2, ModifierIDs: []string{m.cheese}, Notes: "بدون بصل"},
	}}, "2.2.2.2")
	f.must(err)
	if g.Status != "pending" || g.Total != 2*(15000+1500) || g.TableName != "T1" {
		t.Fatalf("guest order: %+v", g)
	}
	if _, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "2.2.2.2"); code(err) != CodeConflict {
		t.Fatalf("second pending order on table: %v", err)
	}
	if _, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{CustomerName: "سارة", Phone: "x", Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "3.3.3.3"); code(err) != CodeInvalid {
		t.Fatalf("bad phone accepted: %v", err)
	}
	if _, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{CustomerName: "سارة", Phone: "01001234567", Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 999}}}, "3.3.3.3"); code(err) != CodeInvalid {
		t.Fatalf("huge qty accepted: %v", err)
	}

	// Staff accept: becomes a real order at the table, sent to the kitchen.
	inbox, _ = a.Inbox(ctx, owner)
	if len(inbox.Orders) != 1 || inbox.Orders[0].Token != "" {
		t.Fatalf("inbox orders: %+v", inbox.Orders)
	}
	_, err = a.OpenShift(ctx, owner, 0)
	f.must(err)
	o, err := a.AcceptOnlineOrder(ctx, owner, inbox.Orders[0].ID)
	f.must(err)
	if o.TableID != m.table || len(o.Lines) != 1 || o.Lines[0].Qty != 2*money.OneUnit || o.Lines[0].SentAt == "" || o.Subtotal != 33000 {
		t.Fatalf("accepted order: %+v", o)
	}
	if _, err := a.AcceptOnlineOrder(ctx, owner, inbox.Orders[0].ID); code(err) != CodeConflict {
		t.Fatalf("accepted twice: %v", err)
	}
	g, err = a.GuestOrderStatus(ctx, g.Token)
	f.must(err)
	if g.Status != "accepted" || g.OrderNumber != o.Number {
		t.Fatalf("guest status: %+v", g)
	}

	// Takeaway, rejected with a reason.
	g2, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{CustomerName: "سارة", Phone: "01001234567", Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "3.3.3.3")
	f.must(err)
	inbox, _ = a.Inbox(ctx, owner)
	if err := a.RejectOnlineOrder(ctx, owner, inbox.Orders[0].ID, ""); code(err) != CodeInvalid {
		t.Fatalf("reject without reason: %v", err)
	}
	f.must(a.RejectOnlineOrder(ctx, owner, inbox.Orders[0].ID, "المطبخ مقفول"))
	g2, _ = a.GuestOrderStatus(ctx, g2.Token)
	if g2.Status != "rejected" || g2.RejectReason != "المطبخ مقفول" {
		t.Fatalf("rejected: %+v", g2)
	}

	// Unanswered orders expire.
	g3, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{CustomerName: "علي", Phone: "01001234567", Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "4.4.4.4")
	f.must(err)
	base := a.now()
	a.now = func() time.Time { return base.Add(onlineOrderTTL + time.Minute) }
	g3, _ = a.GuestOrderStatus(ctx, g3.Token)
	if g3.Status != "expired" {
		t.Fatalf("not expired: %+v", g3)
	}

	// Per-IP rate limit.
	var last error
	for i := 0; i < ordersPerIP+1; i++ {
		_, last = a.SubmitOnlineOrder(ctx, OnlineOrderInput{CustomerName: "x", Phone: "01001234567", Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "9.9.9.9")
	}
	if last != errTooMany {
		t.Fatalf("rate limit: %v", last)
	}

	// Regenerating the QR invalidates the old link.
	_, err = a.RegenerateTableToken(ctx, owner, m.table)
	f.must(err)
	if _, err := a.PublicMenu(ctx, m.token); code(err) != CodeNotFound {
		t.Fatalf("old QR still works: %v", err)
	}
}

func TestEMenuRespectsLicense(t *testing.T) {
	f, fake := linkedFixture(t)
	m := f.menu()
	if _, err := f.app.PublicMenu(f.ctx, ""); code(err) != CodeNotFound {
		t.Fatalf("menu open while unlicensed: %v", err)
	}
	_, err := f.app.ActivateDevice(f.ctx, f.owner, "ACT-TEST", "")
	f.must(err)
	if _, err := f.app.PublicMenu(f.ctx, m.token); err != nil {
		t.Fatal(err)
	}
	// Ordering switched off on the Platform: the menu stays, ordering goes.
	fake.Update("ACT-TEST", func(t *saastest.Tenant) { t.Ordering = false })
	f.app.syncOnce(f.ctx, false)
	menu, err := f.app.PublicMenu(f.ctx, m.token)
	f.must(err)
	if menu.Ordering.DineIn || menu.Ordering.Takeaway || !menu.Ordering.CallWaiter {
		t.Fatalf("ordering flags: %+v", menu.Ordering)
	}
	if _, err := f.app.SubmitOnlineOrder(f.ctx, OnlineOrderInput{TableToken: m.token, Lines: []OnlineLineInput{{ItemID: m.burger, Qty: 1}}}, "1.1.1.1"); code(err) != CodeForbidden {
		t.Fatalf("ordered with ordering off: %v", err)
	}
	// E-menu disabled in the owner's settings closes it.
	fake.Update("ACT-TEST", func(t *saastest.Tenant) { t.EMenuSettings["enabled"] = 0 })
	f.app.syncOnce(f.ctx, false)
	if _, err := f.app.PublicMenu(f.ctx, ""); code(err) != CodeNotFound {
		t.Fatalf("menu open while disabled: %v", err)
	}
}

func TestBrowserLinking(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner

	cashier := f.login(rbac.Cashier, "cashier")
	if _, err := a.StartLink(ctx, cashier, ""); code(err) != CodeForbidden {
		t.Fatalf("cashier started a link: %v", err)
	}
	// The first-run endpoints close once the app is set up.
	if _, err := a.StartSetupLink(ctx, ChannelApp, ""); code(err) != CodeForbidden {
		t.Fatalf("setup link after setup: %v", err)
	}

	st, err := a.StartLink(ctx, owner, "الكاشير")
	f.must(err)
	if st.State != "pending" || st.Code == "" || st.URL != fake.URL+"/link?code="+st.Code {
		t.Fatalf("start: %+v", st)
	}
	if st, err = a.PollLink(ctx, owner); err != nil || st.State != "pending" {
		t.Fatalf("poll before approval: %+v %v", st, err)
	}
	if a.licenseStatus().CanSell() {
		t.Fatal("licensed before approval")
	}
	if !fake.ApproveLink(st.Code, "ACT-TEST") {
		t.Fatal("approve failed")
	}
	// Polls are throttled to the Platform's interval.
	base := time.Now()
	a.now = func() time.Time { return base.Add(2 * time.Second) }
	st, err = a.PollLink(ctx, owner)
	f.must(err)
	if st.State != "approved" || !a.licenseStatus().CanSell() {
		t.Fatalf("after approval: %+v %+v", st, a.licenseStatus())
	}
	if st, _ = a.PollLink(ctx, owner); st.State != "idle" {
		t.Fatalf("link not cleared: %+v", st)
	}
}

func TestFirstRunLinkBeforeSetup(t *testing.T) {
	t.Setenv("CPRO_DATA_DIR", t.TempDir())
	p, _ := paths.Resolve()
	ctx := context.Background()
	db, err := sqlite.Open(ctx, p.DB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	a := New(db, p, slog.New(slog.NewTextHandler(io.Discard, nil)))
	fake := saastest.New("ACT-TEST")
	t.Cleanup(fake.Close)
	old := license.PublicKey
	license.PublicKey = fake.Public
	t.Cleanup(func() { license.PublicKey = old })
	id, _ := saas.LoadIdentity(filepath.Join(t.TempDir(), "d.json"))
	if err := a.EnablePlatform(ctx, saas.NewClient(id)); err != nil {
		t.Fatal(err)
	}
	a.platform.st.URL = fake.URL

	if _, err := a.StartSetupLink(ctx, ChannelLAN, ""); code(err) != CodeForbidden {
		t.Fatalf("setup link from the LAN: %v", err)
	}
	st, err := a.StartSetupLink(ctx, ChannelApp, "")
	if err != nil {
		t.Fatal(err)
	}
	fake.ApproveLink(st.Code, "ACT-TEST")
	if st, err = a.PollSetupLink(ctx, ChannelApp); err != nil || st.State != "approved" {
		t.Fatalf("poll: %+v %v", st, err)
	}
	if info := a.SetupPlatformInfo(); !info.Linked || info.TenantName != "مطعم التجربة" {
		t.Fatalf("setup info: %+v", info)
	}
}

func TestAddOnsFromPlatform(t *testing.T) {
	f, fake := linkedFixture(t)
	_, err := f.app.ActivateDevice(f.ctx, f.owner, "ACT-TEST", "")
	f.must(err)
	if _, ok := f.app.IntegrationConfig("whatsapp_ai"); ok {
		t.Fatal("add-on on before it was enabled")
	}
	fake.Update("ACT-TEST", func(t *saastest.Tenant) {
		t.Extra = map[string]bool{"whatsapp_ai": true}
		t.Integrations = map[string]map[string]any{"whatsapp_ai": {"model": "fast"}}
	})
	f.app.syncOnce(f.ctx, false)
	cfg, ok := f.app.IntegrationConfig("whatsapp_ai")
	if !ok || string(cfg) != `{"model":"fast"}` {
		t.Fatalf("add-on config: %s %v", cfg, ok)
	}
}
