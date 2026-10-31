package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"strings"
	"testing"

	"cpro/internal/domain/rbac"
)

// pngData is a real 2×2 PNG as a data URL.
func pngData(t *testing.T) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func (f *fixture) emenuSettings() EMenuSettings {
	adm, err := f.app.EMenuAdmin(f.ctx, f.owner)
	f.must(err)
	return adm.Settings
}

func TestEMenuSettings(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	cashier := f.login(rbac.Cashier, "cashier")
	if _, err := a.EMenuAdmin(ctx, cashier); code(err) != CodeForbidden {
		t.Fatalf("cashier opened the designer: %v", err)
	}
	if _, err := a.PreviewEMenu(ctx, cashier, defaultEMenuSettings()); code(err) != CodeForbidden {
		t.Fatalf("cashier previewed: %v", err)
	}

	s := f.emenuSettings()
	if s.ButtonColor != "ember" || s.Background != "cream" || !bool(s.Enabled) {
		t.Fatalf("defaults: %+v", s)
	}
	bad := []func(*EMenuSettings){
		func(s *EMenuSettings) { s.ButtonColor = "#ff0000" },
		func(s *EMenuSettings) { s.Background = "url(x)" },
		func(s *EMenuSettings) { s.LangAR, s.LangEN, s.LangFR = false, false, false },
		func(s *EMenuSettings) { s.MapURL = "javascript:alert(1)" },
		func(s *EMenuSettings) { s.Instagram = "javascript:alert(1)" },
		func(s *EMenuSettings) { s.WhatsApp = "call me" },
	}
	for i, mut := range bad {
		in := f.emenuSettings()
		mut(&in)
		if _, err := a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: in}); code(err) != CodeInvalid {
			t.Fatalf("bad settings %d accepted: %v", i, err)
		}
	}

	s.DisplayName, s.Tagline, s.ButtonColor, s.Background = "إمبر جريل", "برجر هاوس", "blue", "midnight"
	s.LangAR, s.LangEN, s.DefaultLanguage = false, true, "ar" // default falls back to an enabled language
	s.Instagram, s.MapURL = "@ember", "https://maps.app.goo.gl/x"
	s.Logo = "../../device.json" // never taken from the client
	adm, err := a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s, LogoData: pngData(t)})
	f.must(err)
	if adm.Settings.DefaultLanguage != "en" || !strings.HasSuffix(adm.Settings.Logo, ".png") || strings.Contains(adm.Settings.Logo, "/") {
		t.Fatalf("saved: %+v", adm.Settings)
	}
	m, err := a.PublicMenu(ctx, "")
	f.must(err)
	if m.Restaurant.Name != "إمبر جريل" || m.Restaurant.Tagline != "برجر هاوس" || m.Theme.Primary != "#2E6BD9" || m.Theme.Background != "midnight" ||
		m.Restaurant.Logo != "/api/public/v1/images/"+adm.Settings.Logo || len(m.Languages) != 1 || m.Languages[0] != "en" {
		t.Fatalf("public menu: %+v", m)
	}

	// A logo that isn't really a picture is refused.
	fake := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<svg onload=alert(1)>"))
	if _, err := a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s, LogoData: fake}); code(err) != CodeInvalid {
		t.Fatalf("fake image accepted: %v", err)
	}

	// Switched off: guests get nothing, the owner can still preview.
	s.Enabled = false
	_, err = a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s})
	f.must(err)
	if _, err := a.PublicMenu(ctx, ""); code(err) != CodeNotFound {
		t.Fatalf("closed menu served: %v", err)
	}
	p, err := a.PreviewEMenu(ctx, owner, s)
	f.must(err)
	if !p.Preview || p.Restaurant.Name != "إمبر جريل" || !strings.HasPrefix(p.Restaurant.Logo, "/api/v1/images/") {
		t.Fatalf("preview: %+v", p)
	}
}

func TestEMenuOffersAndFeatured(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu()
	img := pngData(t)

	in := EMenuOfferInput{EMenuOffer: EMenuOffer{Kind: "family", Name: "برجر + بطاطس + مشروب", Description: "برجر لحم، بطاطس كبيرة، كولا", Price: 25000, Highlight: "وفّر 20%", Active: true}}
	if _, err := a.SaveOffer(ctx, owner, in); code(err) != CodeInvalid {
		t.Fatalf("offer without picture: %v", err)
	}
	bad := in
	bad.Kind, bad.ImageData = "weird", img
	if _, err := a.SaveOffer(ctx, owner, bad); code(err) != CodeInvalid {
		t.Fatalf("bad kind: %v", err)
	}
	bad = in
	bad.Price, bad.ImageData = 0, img
	if _, err := a.SaveOffer(ctx, owner, bad); code(err) != CodeInvalid {
		t.Fatalf("free offer: %v", err)
	}
	in.ImageData = img
	o, err := a.SaveOffer(ctx, owner, in)
	f.must(err)
	if o.ItemID == "" || o.Price != 25000 || o.Image == "" || o.Highlight != "وفّر 20%" {
		t.Fatalf("offer: %+v", o)
	}
	// The offer is a real item in «العروض», so the POS sells it too.
	items, _ := a.Items(ctx, owner)
	cats, _ := a.Categories(ctx, owner)
	var offerItem Item
	for _, it := range items {
		if it.ID == o.ItemID {
			offerItem = it
		}
	}
	var offerCat string
	for _, c := range cats {
		if c.Name == offersCategory {
			offerCat = c.ID
		}
	}
	if offerItem.Price != 25000 || offerItem.CategoryID != offerCat || offerCat == "" {
		t.Fatalf("offer item %+v in %q", offerItem, offerCat)
	}

	pub, err := a.PublicMenu(ctx, "")
	f.must(err)
	if len(pub.Offers) != 1 || pub.Offers[0].Item.Price != 25000 || pub.Offers[0].Kind != "family" {
		t.Fatalf("public offers: %+v", pub.Offers)
	}
	for _, c := range pub.Categories {
		if c.ID == offerCat {
			t.Fatalf("offer item listed as a category: %+v", c)
		}
	}

	// Ordering the offer charges the price set here, whatever the guest sends.
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "delivery", CustomerName: "منى", Phone: "01001234567", Address: "شارع 9",
		Lines: []OnlineLineInput{{ItemID: o.ItemID, Qty: 2}}}, "5.5.5.5")
	f.must(err)
	if g.Total != 50000 {
		t.Fatalf("offer order total: %d", g.Total)
	}

	// Edit the price; switch it off.
	in.ID, in.ImageData, in.Price = o.ID, "", 22000
	o, err = a.SaveOffer(ctx, owner, in)
	f.must(err)
	pub, _ = a.PublicMenu(ctx, "")
	if o.Price != 22000 || pub.Offers[0].Item.Price != 22000 || pub.Offers[0].Item.Image == "" {
		t.Fatalf("edited: %+v / %+v", o, pub.Offers)
	}
	in.Active = false
	_, err = a.SaveOffer(ctx, owner, in)
	f.must(err)
	if pub, _ = a.PublicMenu(ctx, ""); len(pub.Offers) != 0 {
		t.Fatalf("hidden offer shown: %+v", pub.Offers)
	}

	// Featured row with badges.
	if _, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "<b>"}}); code(err) != CodeInvalid {
		t.Fatalf("bad badge: %v", err)
	}
	if _, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger}, {ItemID: m.burger}}); code(err) != CodeInvalid {
		t.Fatalf("duplicate featured: %v", err)
	}
	if _, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: "nope"}}); code(err) != CodeNotFound {
		t.Fatalf("unknown featured item: %v", err)
	}
	feat, err := a.SetFeatured(ctx, owner, []EMenuFeatured{{ItemID: m.burger, Badge: "bestseller"}})
	f.must(err)
	pub, _ = a.PublicMenu(ctx, "")
	if len(feat) != 1 || feat[0].Name != "برجر" || len(pub.Featured) != 1 || pub.Featured[0].Badge != "bestseller" || pub.Featured[0].Item.Price != 15000 {
		t.Fatalf("featured: %+v / %+v", feat, pub.Featured)
	}

	// Deleting the offer removes its item; deleting an item removes its offer.
	f.must(a.DeleteOffer(ctx, owner, o.ID))
	items, _ = a.Items(ctx, owner)
	for _, it := range items {
		if it.ID == o.ItemID {
			t.Fatalf("offer item left behind: %+v", it)
		}
	}
	in = EMenuOfferInput{EMenuOffer: EMenuOffer{Kind: "single", Name: "سموكي", Price: 9000, Active: true}, ImageData: img}
	o, err = a.SaveOffer(ctx, owner, in)
	f.must(err)
	_, err = a.DeleteItem(ctx, owner, o.ItemID)
	f.must(err)
	_, err = a.DeleteItem(ctx, owner, m.burger)
	f.must(err)
	adm, err := a.EMenuAdmin(ctx, owner)
	f.must(err)
	if len(adm.Offers) != 0 || len(adm.Featured) != 0 {
		t.Fatalf("left after item delete: %+v %+v", adm.Offers, adm.Featured)
	}
	if err := a.DeleteOffer(ctx, owner, o.ID); code(err) != CodeNotFound {
		t.Fatalf("delete twice: %v", err)
	}
}

func TestCategoryImage(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	f.menu()
	cats, _ := a.Categories(ctx, owner)
	id := cats[0].ID
	if _, err := a.SetCategoryImage(ctx, f.login(rbac.Cashier, "cashier"), id, pngData(t)); code(err) != CodeForbidden {
		t.Fatalf("cashier set a picture: %v", err)
	}
	c, err := a.SetCategoryImage(ctx, owner, id, pngData(t))
	f.must(err)
	if !strings.HasPrefix(c.Image, "/api/v1/images/") {
		t.Fatalf("category: %+v", c)
	}
	pub, _ := a.PublicMenu(ctx, "")
	if !strings.HasPrefix(pub.Categories[0].Image, "/api/public/v1/images/") {
		t.Fatalf("public category: %+v", pub.Categories[0])
	}
	// Renaming the category keeps its picture.
	cats[0].Name = "سندوتشات"
	_, err = a.SaveCategory(ctx, owner, cats[0])
	f.must(err)
	cats, _ = a.Categories(ctx, owner)
	if cats[0].Image != c.Image {
		t.Fatalf("picture lost on save: %+v", cats[0])
	}
	if c, err = a.SetCategoryImage(ctx, owner, id, "-"); err != nil || c.Image != "" {
		t.Fatalf("clear: %+v %v", c, err)
	}
}

func TestHallAndDeliveryOrders(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	m := f.menu() // has table «T1»
	_, err := a.SaveTable(ctx, owner, Table{Name: "صالة 12", Active: true})
	f.must(err)
	line := []OnlineLineInput{{ItemID: m.burger, Qty: 1}}

	// In the hall by typed number: «1» finds «T1», Arabic digits work, unknown fails.
	if _, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "dine_in", Lines: line}, "1.0.0.1"); code(err) != CodeInvalid {
		t.Fatalf("hall order without a table: %v", err)
	}
	if _, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "dine_in", TableNumber: "99", Lines: line}, "1.0.0.1"); code(err) != CodeNotFound {
		t.Fatalf("unknown table: %v", err)
	}
	g, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "dine_in", TableNumber: "١", Lines: line}, "1.0.0.2")
	f.must(err)
	if g.Type != "dine_in" || g.TableName != "T1" {
		t.Fatalf("hall order: %+v", g)
	}
	g2, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "dine_in", TableNumber: "صالة 12", CustomerName: "كريم", Lines: line}, "1.0.0.3")
	f.must(err)
	if g2.TableName != "صالة 12" {
		t.Fatalf("hall order by name: %+v", g2)
	}

	// Delivery needs name, phone and address.
	for i, in := range []OnlineOrderInput{
		{Type: "delivery", Phone: "01001234567", Address: "x", Lines: line},
		{Type: "delivery", CustomerName: "منى", Address: "x", Lines: line},
		{Type: "delivery", CustomerName: "منى", Phone: "01001234567", Lines: line},
		{Type: "takeaway", CustomerName: "منى", Phone: "01001234567", Lines: line},
	} {
		if _, err := a.SubmitOnlineOrder(ctx, in, "1.0.1.1"); code(err) != CodeInvalid {
			t.Fatalf("bad delivery %d accepted: %v", i, err)
		}
	}
	_, err = a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "delivery", CustomerName: "منى", Phone: "0100 123 4567", Address: "شارع 9، المعادي", Lines: line}, "1.0.1.2")
	f.must(err)

	// Accepting a delivery order creates the customer (with the address) and
	// links the order; a second order from the same phone reuses them.
	_, err = a.OpenShift(ctx, owner, 0)
	f.must(err)
	inbox, _ := a.Inbox(ctx, owner)
	var del OnlineOrder
	for _, o := range inbox.Orders {
		if o.Type == "delivery" {
			del = o
		}
	}
	if del.Address != "شارع 9، المعادي" {
		t.Fatalf("delivery in inbox: %+v", del)
	}
	o, err := a.AcceptOnlineOrder(ctx, owner, del.ID)
	f.must(err)
	if o.Type != "delivery" || o.CustomerID == "" || !strings.Contains(o.Notes, "شارع 9") {
		t.Fatalf("accepted delivery: %+v", o)
	}
	custs, err := a.Customers(ctx, owner, "")
	f.must(err)
	if len(custs) != 1 || custs[0].Address != "شارع 9، المعادي" || custs[0].Phone != "01001234567" {
		t.Fatalf("customers: %+v", custs)
	}
	_, err = a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "delivery", CustomerName: "منى", Phone: "01001234567", Address: "عنوان تاني", Lines: line}, "1.0.1.3")
	f.must(err)
	inbox, _ = a.Inbox(ctx, owner)
	for _, x := range inbox.Orders {
		if x.Type == "delivery" {
			o2, err := a.AcceptOnlineOrder(ctx, owner, x.ID)
			f.must(err)
			if o2.CustomerID != o.CustomerID {
				t.Fatalf("second order linked to %q, want %q", o2.CustomerID, o.CustomerID)
			}
		}
	}

	// Delivery switched off: refused, hall still fine.
	s := f.emenuSettings()
	s.AllowDelivery = false
	_, err = a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s})
	f.must(err)
	if _, err := a.SubmitOnlineOrder(ctx, OnlineOrderInput{Type: "delivery", CustomerName: "منى", Phone: "01001234567", Address: "x", Lines: line}, "1.0.2.1"); code(err) != CodeForbidden {
		t.Fatalf("delivery while off: %v", err)
	}
}

func pngSized(t *testing.T, w, h int) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestInstallableApp(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	s := f.emenuSettings()
	if !bool(s.InstallPrompt) {
		t.Fatal("install offer should default to on")
	}
	// No icon yet: nothing to install.
	if _, err := a.AppManifest(ctx); code(err) != CodeNotFound {
		t.Fatalf("manifest without icon: %v", err)
	}
	if m, _ := a.PublicMenu(ctx, ""); m.App.Installable {
		t.Fatal("installable without icon")
	}

	for i, in := range []EMenuSettingsInput{
		{AppIcon512Data: pngSized(t, 512, 512)},                                                // one size only
		{AppIcon512Data: pngSized(t, 500, 500), AppIcon192Data: pngSized(t, 192, 192)},         // wrong size
		{AppIcon512Data: pngData(t), AppIcon192Data: pngSized(t, 192, 192)},                    // tiny
		{AppIcon512Data: "data:image/jpeg;base64,/9j/", AppIcon192Data: pngSized(t, 192, 192)}, // not PNG
	} {
		in.EMenuSettings = s
		if _, err := a.SaveEMenuSettings(ctx, owner, in); code(err) != CodeInvalid {
			t.Fatalf("bad icon %d accepted: %v", i, err)
		}
	}
	s.AppIcon512, s.AppIcon192 = "../../device.json", "x" // never taken from the client
	adm, err := a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s,
		AppIcon512Data: pngSized(t, 512, 512), AppIcon192Data: pngSized(t, 192, 192)})
	f.must(err)
	if strings.Contains(adm.Settings.AppIcon512, "/") || adm.AppIconURL == "" {
		t.Fatalf("icon saved: %+v", adm.Settings)
	}
	m, err := a.PublicMenu(ctx, "")
	f.must(err)
	if !m.App.Installable || !strings.HasPrefix(m.App.Icon, "/api/public/v1/images/") {
		t.Fatalf("public app: %+v", m.App)
	}
	raw, err := a.AppManifest(ctx)
	f.must(err)
	var man struct {
		Name    string `json:"name"`
		Display string `json:"display"`
		Start   string `json:"start_url"`
		Icons   []struct{ Src, Sizes string }
	}
	f.must(json.Unmarshal(raw, &man))
	if man.Name != "مطعم" || man.Display != "standalone" || man.Start != "/" || len(man.Icons) != 2 || man.Icons[1].Sizes != "512x512" {
		t.Fatalf("manifest: %s", raw)
	}
	if _, ok := a.AppleTouchIcon(); !ok {
		t.Fatal("no apple touch icon")
	}

	// Saving other settings keeps the icon; turning the offer off hides the app.
	s = adm.Settings
	s.InstallPrompt = false
	_, err = a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s})
	f.must(err)
	if _, err := a.AppManifest(ctx); code(err) != CodeNotFound {
		t.Fatalf("manifest while off: %v", err)
	}
	s.InstallPrompt = true
	adm, err = a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s})
	f.must(err)
	if adm.Settings.AppIcon512 == "" {
		t.Fatal("icon lost on save")
	}
	adm, err = a.SaveEMenuSettings(ctx, owner, EMenuSettingsInput{EMenuSettings: s, AppIcon512Data: "-"})
	f.must(err)
	if adm.Settings.AppIcon512 != "" || adm.Settings.AppIcon192 != "" {
		t.Fatalf("icon not removed: %+v", adm.Settings)
	}
}
