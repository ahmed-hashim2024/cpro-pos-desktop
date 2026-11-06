package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// The e-menu designer: the owner sets up the guest menu (name, colours,
// offers, featured items, category pictures, ordering rules) from the
// desktop app. The Platform still decides whether the account has the
// e-menu at all (license features); everything about how it looks and
// behaves lives here.

const emenuKey = "emenu"

// ---- presets ---------------------------------------------------------------------

// Colour choices are fixed presets, never free-form CSS, so the guest page
// can't be broken (or injected into) through settings.
type ColorPreset struct {
	ID  string `json:"id"`
	Hex string `json:"hex"`
}

var buttonColors = []ColorPreset{
	{"ember", "#E8590C"}, {"red", "#D9342B"}, {"gold", "#C9952B"}, {"green", "#2F9E5B"}, {"teal", "#0E9384"},
	{"blue", "#2E6BD9"}, {"purple", "#7A4FE0"}, {"pink", "#D6336C"}, {"black", "#1E1E1E"},
}

// Backgrounds map to the guest page's themes (frontend/src/emenu/emenu.css);
// Hex is only the swatch shown to the owner.
var backgrounds = []ColorPreset{
	{"cream", "#F7EFE4"}, {"white", "#F4F4F6"}, {"fresh", "#F3F8F4"}, {"midnight", "#121110"}, {"espresso", "#1A120D"},
}

func presetHex(list []ColorPreset, id string) (string, bool) {
	for _, p := range list {
		if p.ID == id {
			return p.Hex, true
		}
	}
	return "", false
}

// ---- settings ----------------------------------------------------------------------

// EMenuSettings is the owner's e-menu configuration. JSON names match the
// Platform's SCP E-Menu Settings where they overlap, so values set there
// before this screen existed carry over until the owner saves here.
type EMenuSettings struct {
	Enabled         flexBool `json:"enabled"`
	DisplayName     string   `json:"display_name"`
	Tagline         string   `json:"tagline"`
	ButtonColor     string   `json:"button_color"`
	Background      string   `json:"background"`
	DefaultLanguage string   `json:"default_language"`
	LangAR          flexBool `json:"lang_ar"`
	LangEN          flexBool `json:"lang_en"`
	LangFR          flexBool `json:"lang_fr"`
	ShowPrices      flexBool `json:"show_prices"`
	AllowCallWaiter flexBool `json:"allow_call_waiter"`
	AllowDineIn     flexBool `json:"allow_dine_in_orders"`  // in the hall: table QR or table number
	AllowDelivery   flexBool `json:"allow_takeaway_orders"` // from outside, to an address (key kept from the Platform)
	DeliveryMinutes int      `json:"delivery_minutes"`      // added to the estimated time of delivery orders
	OrderNote       string   `json:"order_note"`
	Phone           string   `json:"phone"`
	WhatsApp        string   `json:"whatsapp"`
	Address         string   `json:"address"`
	MapURL          string   `json:"map_url"`
	Instagram       string   `json:"instagram"`
	Facebook        string   `json:"facebook"`
	TikTok          string   `json:"tiktok"`
	FooterText      string   `json:"footer_text"`
	// Logo is an image file name under the data dir (set through LogoData).
	Logo string `json:"logo_image"`
	// The installable app (PWA): offer it to guests once a day, with this
	// icon (512 and 192 px PNG files under the data dir; see emenu_app.go).
	InstallPrompt flexBool `json:"install_prompt"`
	AppIcon512    string   `json:"app_icon_512"`
	AppIcon192    string   `json:"app_icon_192"`
}

func defaultEMenuSettings() EMenuSettings {
	return EMenuSettings{
		Enabled: true, ButtonColor: "ember", Background: "cream", DefaultLanguage: "ar", LangAR: true, LangEN: true,
		ShowPrices: true, AllowCallWaiter: true, InstallPrompt: true,
	}
}

// loadLocalEMenu returns the settings saved on this computer (nil if never saved).
func (a *App) loadLocalEMenu(ctx context.Context) (json.RawMessage, error) {
	a.emenuMu.Lock()
	defer a.emenuMu.Unlock()
	if a.emenuLoaded {
		return a.emenuLocal, nil
	}
	var raw string
	err := a.db.Read.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, emenuKey).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if raw != "" {
		a.emenuLocal = json.RawMessage(raw)
	}
	a.emenuLoaded = true
	return a.emenuLocal, nil
}

// emenuConfig is the effective configuration: defaults, then what the
// Platform sent (older setups), then what the owner saved here.
func (a *App) emenuConfig() EMenuSettings {
	c := defaultEMenuSettings()
	if p := a.platform; p == nil {
		c.AllowDineIn, c.AllowDelivery = true, true // licensing off: tests and tools
	} else {
		p.mu.RLock()
		raw := p.st.EMenu
		p.mu.RUnlock()
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &c); err != nil {
				a.log.Warn("platform e-menu settings unreadable", "err", err)
			}
		}
	}
	local, err := a.loadLocalEMenu(context.Background())
	if err != nil {
		a.log.Error("load e-menu settings", "err", err)
	}
	if len(local) > 0 {
		if err := json.Unmarshal(local, &c); err != nil {
			a.log.Warn("e-menu settings unreadable", "err", err)
		}
	}
	// Anything invalid (old Platform values, hand-edited rows) falls back.
	if _, ok := presetHex(buttonColors, c.ButtonColor); !ok {
		c.ButtonColor = "ember"
	}
	if _, ok := presetHex(backgrounds, c.Background); !ok {
		c.Background = "cream"
	}
	return c
}

var (
	handleRe  = regexp.MustCompile(`^@?[A-Za-z0-9._-]{1,60}$`)
	langCodes = []string{"ar", "en", "fr"}
)

// safeURL accepts only absolute http(s) links (never javascript: or data:).
func safeURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}

// socialOK accepts a profile link or a bare handle.
func socialOK(v string) bool { return v == "" || handleRe.MatchString(v) || safeURL(v) }

func (s *EMenuSettings) normalize() error {
	s.DisplayName, s.Tagline = clip(s.DisplayName, 40), clip(s.Tagline, 60)
	s.OrderNote, s.FooterText, s.Address = clip(s.OrderNote, 200), clip(s.FooterText, 120), clip(s.Address, 160)
	s.Phone, s.WhatsApp, s.MapURL = clip(s.Phone, 20), clip(s.WhatsApp, 20), clip(s.MapURL, 500)
	s.Instagram, s.Facebook, s.TikTok = clip(s.Instagram, 200), clip(s.Facebook, 200), clip(s.TikTok, 200)
	if s.DeliveryMinutes < 0 || s.DeliveryMinutes > maxPrepMinutes {
		return invalid("وقت التوصيل غير صحيح")
	}
	if _, ok := presetHex(buttonColors, s.ButtonColor); !ok {
		return invalid("اختر لون الأزرار من الألوان المتاحة")
	}
	if _, ok := presetHex(backgrounds, s.Background); !ok {
		return invalid("اختر لون الخلفية من الألوان المتاحة")
	}
	on := map[string]bool{"ar": bool(s.LangAR), "en": bool(s.LangEN), "fr": bool(s.LangFR)}
	if !on["ar"] && !on["en"] && !on["fr"] {
		return invalid("فعّل لغة واحدة على الأقل")
	}
	if !on[s.DefaultLanguage] {
		for _, l := range langCodes {
			if on[l] {
				s.DefaultLanguage = l
				break
			}
		}
	}
	if s.Phone != "" && !validPhone(s.Phone) {
		return invalid("رقم التليفون غير صحيح")
	}
	if s.WhatsApp != "" && !validPhone(s.WhatsApp) {
		return invalid("رقم الواتساب غير صحيح")
	}
	if s.MapURL != "" && !safeURL(s.MapURL) {
		return invalid("رابط الخريطة يجب أن يبدأ بـ https://")
	}
	if !socialOK(s.Instagram) || !socialOK(s.Facebook) || !socialOK(s.TikTok) {
		return invalid("روابط السوشيال: اكتب الرابط كاملاً أو اسم الحساب فقط")
	}
	return nil
}

// EMenuSettingsInput is a save from the designer; LogoData is a data URL
// for a new logo, "-" removes it, "" keeps the current one.
type EMenuSettingsInput struct {
	EMenuSettings
	LogoData string `json:"logo_data"`
	// AppIcon512Data / AppIcon192Data: the app icon at both sizes (PNG data
	// URLs, both or neither); "-" in AppIcon512Data removes it.
	AppIcon512Data string `json:"app_icon_512_data"`
	AppIcon192Data string `json:"app_icon_192_data"`
}

func (a *App) SaveEMenuSettings(ctx context.Context, actor Actor, in EMenuSettingsInput) (EMenuAdmin, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return EMenuAdmin{}, err
	}
	s := in.EMenuSettings
	if err := s.normalize(); err != nil {
		return EMenuAdmin{}, err
	}
	// The logo can't be pointed at an arbitrary file: it is kept as is,
	// replaced by an upload, or cleared.
	cur := a.emenuConfig()
	s.Logo, s.AppIcon512, s.AppIcon192 = cur.Logo, cur.AppIcon512, cur.AppIcon192
	if err := a.applyAppIcon(&s, in.AppIcon512Data, in.AppIcon192Data); err != nil {
		return EMenuAdmin{}, err
	}
	switch in.LogoData {
	case "":
	case "-":
		s.Logo = ""
	default:
		name, err := a.storeImage(in.LogoData)
		if err != nil {
			return EMenuAdmin{}, err
		}
		s.Logo = name
	}
	b, err := json.Marshal(s)
	if err != nil {
		return EMenuAdmin{}, err
	}
	a.emenuMu.Lock()
	err = a.tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, emenuKey, string(b), a.stamp())
		if err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "emenu.settings", "settings", emenuKey, s)
	})
	if err == nil {
		a.emenuLocal, a.emenuLoaded = b, true
	}
	a.emenuMu.Unlock()
	if err != nil {
		return EMenuAdmin{}, err
	}
	return a.EMenuAdmin(ctx, actor)
}

// ---- designer overview -----------------------------------------------------------------

// EMenuOfferContent is a menu item inside an offer («2 مارجريتا»).
type EMenuOfferContent struct {
	ItemID string      `json:"item_id"`
	Qty    int         `json:"qty"`
	Name   string      `json:"name,omitempty"`
	Price  money.Minor `json:"price_minor,omitempty"`
}

type EMenuOffer struct {
	ID          string              `json:"id"`
	Kind        string              `json:"kind"` // single | family
	ItemID      string              `json:"item_id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Price       money.Minor         `json:"price_minor"`
	Image       string              `json:"image"`
	Badge       string              `json:"badge"`
	Highlight   string              `json:"highlight"`
	Sort        int                 `json:"sort"`
	PrepMinutes int                 `json:"prep_minutes"`
	Active      bool                `json:"active"`
	Contents    []EMenuOfferContent `json:"contents"`
}

type EMenuFeatured struct {
	ItemID string      `json:"item_id"`
	Badge  string      `json:"badge"`            // '' | bestseller | hot_deal | new
	Note   string      `json:"note"`             // short line under the name
	Deal   money.Minor `json:"deal_price_minor"` // hot deal: the e-menu price; 0 = none
	Name   string      `json:"name,omitempty"`
	Price  money.Minor `json:"price_minor,omitempty"`
	Image  string      `json:"image,omitempty"`
}

type EMenuStatus struct {
	Licensed bool   `json:"licensed"` // the account has the e-menu
	Ordering bool   `json:"ordering"` // the account has e-menu ordering
	Open     bool   `json:"open"`     // guests can see it now
	MenuURL  string `json:"menu_url"` // empty until the Platform gives a domain
}

type EMenuAdmin struct {
	Settings    EMenuSettings   `json:"settings"`
	LogoURL     string          `json:"logo_url"`
	AppIconURL  string          `json:"app_icon_url"` // 512 px icon, empty if none
	Offers      []EMenuOffer    `json:"offers"`
	Featured    []EMenuFeatured `json:"featured"`
	Buttons     []ColorPreset   `json:"button_colors"`
	Backgrounds []ColorPreset   `json:"backgrounds"`
	Status      EMenuStatus     `json:"status"`
}

func (a *App) EMenuAdmin(ctx context.Context, actor Actor) (EMenuAdmin, error) {
	out := EMenuAdmin{Buttons: buttonColors, Backgrounds: backgrounds}
	if err := actor.require(rbac.CatalogManage); err != nil {
		return out, err
	}
	out.Settings = a.emenuConfig()
	out.LogoURL = imageURL("/api/v1/images/", out.Settings.Logo)
	out.AppIconURL = imageURL("/api/v1/images/", out.Settings.AppIcon512)
	var err error
	if out.Offers, err = loadOffers(ctx, a.db.Read, "/api/v1/images/", false); err != nil {
		return out, err
	}
	if out.Featured, err = loadFeatured(ctx, a.db.Read, "/api/v1/images/"); err != nil {
		return out, err
	}
	f := a.features()
	out.Status = EMenuStatus{Licensed: f.EMenu(), Ordering: f.EMenuOrdering(), Open: a.menuOpen()}
	if p := a.platform; p != nil {
		p.mu.RLock()
		if p.st.Tunnel != nil && p.st.Tunnel.Domain != "" {
			out.Status.MenuURL = "https://" + p.st.Tunnel.Domain
		}
		p.mu.RUnlock()
	}
	return out, nil
}

func imageURL(prefix, name string) string {
	if name == "" {
		return ""
	}
	return prefix + name
}

// loadOffers lists offers with their item's details. publicOnly drops
// offers whose item is hidden, archived or in a hidden category.
func loadOffers(ctx context.Context, q sqlite.Querier, imgPrefix string, publicOnly bool) ([]EMenuOffer, error) {
	where := `i.deleted_at IS NULL`
	if publicOnly {
		where += ` AND i.active = 1 AND EXISTS (SELECT 1 FROM categories c WHERE c.id = i.category_id AND c.active = 1)`
	}
	rows, err := q.QueryContext(ctx, `SELECT o.id, o.kind, o.item_id, i.name, i.description, i.price_minor, coalesce(i.image_path,''),
		o.badge, o.highlight, o.sort, i.prep_minutes, i.active FROM emenu_offers o JOIN items i ON i.id = o.item_id
		WHERE `+where+` ORDER BY o.kind, o.sort, o.created_at`)
	if err != nil {
		return nil, err
	}
	out := []EMenuOffer{}
	idx := map[string]int{}
	for rows.Next() {
		var o EMenuOffer
		var active int64
		if err := rows.Scan(&o.ID, &o.Kind, &o.ItemID, &o.Name, &o.Description, &o.Price, &o.Image, &o.Badge, &o.Highlight, &o.Sort, &o.PrepMinutes, &active); err != nil {
			rows.Close()
			return nil, err
		}
		o.Image, o.Active = imageURL(imgPrefix, o.Image), active == 1
		o.Contents = []EMenuOfferContent{}
		idx[o.ID] = len(out)
		out = append(out, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = q.QueryContext(ctx, `SELECT b.offer_id, b.item_id, b.qty, i.name, i.price_minor
		FROM emenu_offer_items b JOIN items i ON i.id = b.item_id ORDER BY b.sort`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var offerID string
		var c EMenuOfferContent
		if err := rows.Scan(&offerID, &c.ItemID, &c.Qty, &c.Name, &c.Price); err != nil {
			return nil, err
		}
		if i, ok := idx[offerID]; ok {
			out[i].Contents = append(out[i].Contents, c)
		}
	}
	return out, rows.Err()
}

func loadFeatured(ctx context.Context, q sqlite.Querier, imgPrefix string) ([]EMenuFeatured, error) {
	rows, err := q.QueryContext(ctx, `SELECT f.item_id, f.badge, f.note, f.deal_price_minor, i.name, i.price_minor, coalesce(i.image_path,'')
		FROM emenu_featured f JOIN items i ON i.id = f.item_id WHERE i.deleted_at IS NULL ORDER BY f.sort`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EMenuFeatured{}
	for rows.Next() {
		var f EMenuFeatured
		if err := rows.Scan(&f.ItemID, &f.Badge, &f.Note, &f.Deal, &f.Name, &f.Price, &f.Image); err != nil {
			return nil, err
		}
		f.Image = imageURL(imgPrefix, f.Image)
		out = append(out, f)
	}
	return out, rows.Err()
}

// ---- offers ----------------------------------------------------------------------------

const (
	offersCategory   = "العروض"
	maxOfferContents = 12
)

type EMenuOfferInput struct {
	EMenuOffer
	ImageData string `json:"image_data"` // data URL for a new picture; "" keeps it
}

// SaveOffer creates or updates an offer and the catalog item behind it.
// The price the owner types here is the item's price, so the guest pays
// exactly that and the POS sells the same offer at the same price.
func (a *App) SaveOffer(ctx context.Context, actor Actor, in EMenuOfferInput) (EMenuOffer, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return EMenuOffer{}, err
	}
	o := in.EMenuOffer
	o.Name, o.Description = clip(o.Name, 80), clip(o.Description, 300)
	o.Badge, o.Highlight = clip(o.Badge, 20), clip(o.Highlight, 16)
	if o.Kind != "single" && o.Kind != "family" {
		return o, invalid("نوع العرض غير صحيح")
	}
	if o.Name == "" {
		return o, invalid("اسم العرض مطلوب")
	}
	if o.Price <= 0 {
		return o, invalid("سعر العرض يجب أن يكون أكبر من صفر")
	}
	if o.PrepMinutes < 0 || o.PrepMinutes > maxPrepMinutes {
		return o, invalid("وقت التحضير غير صحيح")
	}
	if len(o.Contents) > maxOfferContents {
		return o, invalid(fmt.Sprintf("الحد الأقصى %d أصناف في العرض", maxOfferContents))
	}
	if in.ImageData == "-" {
		return o, invalid("صورة العرض مطلوبة")
	}
	image, err := a.storeImage(in.ImageData)
	if err != nil {
		return o, err
	}
	err = a.tx(ctx, func(tx *sql.Tx) error {
		now := a.stamp()
		isNew := o.ID == ""
		o.Sort = keptSort(ctx, tx, "emenu_offers", o.ID, o.Sort)
		if isNew {
			if image == "" {
				return invalid("اختر صورة للعرض")
			}
			catID, err := ensureCategory(ctx, tx, offersCategory)
			if err != nil {
				return err
			}
			o.ID, o.ItemID = sqlite.NewID(), sqlite.NewID()
			if _, err := tx.ExecContext(ctx, `INSERT INTO items(id, code, name, category_id, price_minor, image_path, description, sort, prep_minutes, active, created_at, updated_at)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, o.ItemID, "OF-"+o.ItemID[len(o.ItemID)-8:], o.Name, catID, o.Price, image, o.Description, o.Sort,
				o.PrepMinutes, sqlite.Int(o.Active), now, now); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO emenu_offers(id, kind, item_id, badge, highlight, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
				o.ID, o.Kind, o.ItemID, o.Badge, o.Highlight, o.Sort, now, now); err != nil {
				return err
			}
		} else {
			if err := tx.QueryRowContext(ctx, `SELECT o.item_id FROM emenu_offers o JOIN items i ON i.id = o.item_id
				WHERE o.id = ? AND i.deleted_at IS NULL`, o.ID).Scan(&o.ItemID); err != nil {
				return noRows(err, "العرض")
			}
			if _, err := tx.ExecContext(ctx, `UPDATE items SET name=?, price_minor=?, description=?, sort=?, prep_minutes=?, active=?, updated_at=? WHERE id=?`,
				o.Name, o.Price, o.Description, o.Sort, o.PrepMinutes, sqlite.Int(o.Active), now, o.ItemID); err != nil {
				return err
			}
			if image != "" {
				if _, err := tx.ExecContext(ctx, `UPDATE items SET image_path=? WHERE id=?`, image, o.ItemID); err != nil {
					return err
				}
			}
			if _, err := tx.ExecContext(ctx, `UPDATE emenu_offers SET kind=?, badge=?, highlight=?, sort=?, updated_at=? WHERE id=?`,
				o.Kind, o.Badge, o.Highlight, o.Sort, now, o.ID); err != nil {
				return err
			}
		}
		if err := placeInOrder(ctx, tx, offerScope(o.Kind), o.ID, o.Sort, isNew); err != nil {
			return err
		}
		// The POS lists offers as items: same order as the guest sees.
		if _, err := tx.ExecContext(ctx, `UPDATE items SET sort = (SELECT e.sort FROM emenu_offers e WHERE e.item_id = items.id)
			WHERE id IN (SELECT item_id FROM emenu_offers WHERE kind = ?)`, o.Kind); err != nil {
			return err
		}
		if err := saveOfferContents(ctx, tx, o.ID, o.Contents); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "emenu.offer.save", "emenu_offers", o.ID,
			map[string]any{"name": o.Name, "kind": o.Kind, "price": o.Price, "active": o.Active, "item_id": o.ItemID})
	})
	if err != nil {
		return o, err
	}
	offers, err := loadOffers(ctx, a.db.Write, "/api/v1/images/", false)
	if err != nil {
		return o, err
	}
	for _, x := range offers {
		if x.ID == o.ID {
			return x, nil
		}
	}
	return o, notFound("العرض")
}

// saveOfferContents replaces what an offer is made of. Contents are real menu
// items; an offer can't contain another offer.
func saveOfferContents(ctx context.Context, tx *sql.Tx, offerID string, list []EMenuOfferContent) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM emenu_offer_items WHERE offer_id = ?`, offerID); err != nil {
		return err
	}
	seen := map[string]bool{}
	for i, c := range list {
		if c.Qty < 1 || c.Qty > maxOnlineQty {
			return invalid("كمية الصنف في العرض غير صحيحة")
		}
		if c.ItemID == "" || seen[c.ItemID] {
			return invalid("صنف مكرر أو غير محدد في العرض")
		}
		seen[c.ItemID] = true
		var found, isOffer int
		err := tx.QueryRowContext(ctx, `SELECT count(*), (SELECT count(*) FROM emenu_offers WHERE item_id = ?) FROM items WHERE id = ? AND deleted_at IS NULL`,
			c.ItemID, c.ItemID).Scan(&found, &isOffer)
		if err != nil {
			return err
		}
		if found == 0 {
			return notFound("الصنف")
		}
		if isOffer > 0 {
			return invalid("مينفعش تحط عرض جوه عرض")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO emenu_offer_items(offer_id, item_id, qty, sort) VALUES (?,?,?,?)`, offerID, c.ItemID, c.Qty, i); err != nil {
			return err
		}
	}
	return nil
}

// offerContentLabels returns «2× مارجريتا» for each item in an offer (none
// for a normal item), for the kitchen and printed tickets.
func offerContentLabels(ctx context.Context, q sqlite.Querier, itemID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT b.qty, i.name FROM emenu_offers o JOIN emenu_offer_items b ON b.offer_id = o.id
		JOIN items i ON i.id = b.item_id WHERE o.item_id = ? ORDER BY b.sort`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var qty int
		var name string
		if err := rows.Scan(&qty, &name); err != nil {
			return nil, err
		}
		out = append(out, fmt.Sprintf("%d× %s", qty, name))
	}
	return out, rows.Err()
}

// DeleteOffer removes the offer and its item (archived instead when past
// orders point to it, exactly like deleting an item).
func (a *App) DeleteOffer(ctx context.Context, actor Actor, id string) error {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return err
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		var itemID string
		if err := tx.QueryRowContext(ctx, `SELECT item_id FROM emenu_offers WHERE id = ?`, id).Scan(&itemID); err != nil {
			return noRows(err, "العرض")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM emenu_offers WHERE id = ?`, id); err != nil {
			return err
		}
		if _, err := a.deleteItemTx(ctx, tx, actor, itemID); err != nil && errCode(err) != CodeNotFound {
			return err
		}
		return a.audit(ctx, tx, actor, "emenu.offer.delete", "emenu_offers", id, map[string]string{"item_id": itemID})
	})
}

// errCode returns an app error's code ("" for other errors).
func errCode(err error) Code {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// ensureCategory returns the id of the category with this name, creating it
// (active, all kitchen screens) if needed.
func ensureCategory(ctx context.Context, tx *sql.Tx, name string) (string, error) {
	var id string
	err := tx.QueryRowContext(ctx, `SELECT id FROM categories WHERE name = ?`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	id = sqlite.NewID()
	_, err = tx.ExecContext(ctx, `INSERT INTO categories(id, name, sort, active) VALUES (?,?,(SELECT coalesce(max(sort),0) + 1 FROM categories),1)`, id, name)
	return id, err
}

// ---- featured items ------------------------------------------------------------------------

const maxFeatured = 24

var featuredBadges = map[string]bool{"": true, "bestseller": true, "hot_deal": true, "new": true}

// SetFeatured replaces the "popular" row, in the given order.
func (a *App) SetFeatured(ctx context.Context, actor Actor, list []EMenuFeatured) ([]EMenuFeatured, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return nil, err
	}
	if len(list) > maxFeatured {
		return nil, invalid("الحد الأقصى 24 صنف مميز")
	}
	seen := map[string]bool{}
	for i := range list {
		f := &list[i]
		if !featuredBadges[f.Badge] {
			return nil, invalid("الشارة غير صحيحة")
		}
		f.Note = clip(f.Note, 40)
		if f.Badge != "hot_deal" {
			f.Deal = 0
		}
		if f.Deal < 0 {
			return nil, invalid("سعر العرض غير صحيح")
		}
		if f.ItemID == "" || seen[f.ItemID] {
			return nil, invalid("صنف مكرر أو غير محدد")
		}
		seen[f.ItemID] = true
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM emenu_featured`); err != nil {
			return err
		}
		for i, f := range list {
			var price money.Minor
			if err := tx.QueryRowContext(ctx, `SELECT price_minor FROM items WHERE id = ? AND deleted_at IS NULL`, f.ItemID).Scan(&price); err != nil {
				return noRows(err, "الصنف")
			}
			if f.Deal >= price && f.Deal > 0 {
				return invalid("سعر العرض لازم يكون أقل من سعر الصنف")
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO emenu_featured(item_id, badge, note, deal_price_minor, sort) VALUES (?,?,?,?,?)`,
				f.ItemID, f.Badge, f.Note, f.Deal, i); err != nil {
				return err
			}
		}
		return a.audit(ctx, tx, actor, "emenu.featured", "emenu_featured", "", list)
	})
	if err != nil {
		return nil, err
	}
	return loadFeatured(ctx, a.db.Write, "/api/v1/images/")
}

// ---- category pictures ---------------------------------------------------------------------

// SetCategoryImage sets ("data:…") or clears ("-") a category's picture.
func (a *App) SetCategoryImage(ctx context.Context, actor Actor, id, imageData string) (Category, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return Category{}, err
	}
	if imageData == "" {
		return Category{}, invalid("اختر صورة")
	}
	image, err := a.storeImage(imageData)
	if err != nil {
		return Category{}, err
	}
	err = a.tx(ctx, func(tx *sql.Tx) error {
		if err := mustAffect(tx.ExecContext(ctx, `UPDATE categories SET image_path = ? WHERE id = ?`, sqlite.NullString(image), id)); err != nil {
			return noRows(err, "القسم")
		}
		return a.audit(ctx, tx, actor, "category.image", "categories", id, map[string]bool{"cleared": image == ""})
	})
	if err != nil {
		return Category{}, err
	}
	cats, err := a.Categories(ctx, actor)
	for _, c := range cats {
		if c.ID == id {
			return c, err
		}
	}
	return Category{}, notFound("القسم")
}

// ---- preview ---------------------------------------------------------------------------------

// PreviewEMenu builds the guest menu exactly as guests would get it, with
// draft (unsaved) settings, for the phone preview in the designer. It works
// before the e-menu is licensed or opened, so the owner can prepare it.
func (a *App) PreviewEMenu(ctx context.Context, actor Actor, draft EMenuSettings) (PublicMenu, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return PublicMenu{}, err
	}
	if err := draft.normalize(); err != nil {
		return PublicMenu{}, err
	}
	cur := a.emenuConfig()
	draft.Logo, draft.AppIcon512, draft.AppIcon192 = cur.Logo, cur.AppIcon512, cur.AppIcon192
	m, err := a.buildMenu(ctx, draft, nil, "/api/v1/images/")
	if err != nil {
		return m, err
	}
	// Show the ordering screens the owner enabled, whatever the license says.
	m.Ordering = PublicOrdering{DineIn: bool(draft.AllowDineIn), Delivery: bool(draft.AllowDelivery), CallWaiter: bool(draft.AllowCallWaiter), Note: draft.OrderNote}
	if m.Tables, err = tableNames(ctx, a.db.Read); err != nil {
		return m, err
	}
	if bool(draft.AllowDelivery) {
		if s, err := loadSettings(ctx, a.db.Read); err == nil {
			m.Ordering.DeliveryFee = s.DeliveryFee
		}
	}
	m.Preview = true
	return m, nil
}
