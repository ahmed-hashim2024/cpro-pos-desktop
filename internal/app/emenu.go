package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// The e-menu is served by this computer through the restaurant's domain.
// Guests are anonymous: everything here is bounded (rate limits, one
// pending order per table, server-side prices) and nothing reaches the
// kitchen until a staff member accepts it.

const (
	onlineOrderTTL  = 15 * time.Minute
	maxOnlineLines  = 30
	maxOnlineQty    = 50
	ordersPerIP     = 5 // per window
	callsPerIP      = 10
	publicRateBurst = 10 * time.Minute
)

func newPublicToken() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- rate limiting -----------------------------------------------------------

type rateLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newRateLimiter() *rateLimiter { return &rateLimiter{hits: map[string][]time.Time{}} }

// allow records a hit for key and reports whether it stays within n per window.
func (l *rateLimiter) allow(key string, n int, window time.Duration, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cut := now.Add(-window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= n {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	if len(l.hits) > 10000 { // drop stale keys now and then
		for k, v := range l.hits {
			if len(v) == 0 || v[len(v)-1].Before(cut) {
				delete(l.hits, k)
			}
		}
	}
	return true
}

var errTooMany = &Error{CodeConflict, "طلبات كثيرة، حاول بعد قليل"}

// ---- configuration -----------------------------------------------------------------

// flexBool accepts Frappe's 0/1 checks as well as JSON booleans.
type flexBool bool

func (b *flexBool) UnmarshalJSON(d []byte) error {
	switch strings.Trim(string(d), `"`) {
	case "1", "true":
		*b = true
	default:
		*b = false
	}
	return nil
}

// menuOpen reports whether guests may see the menu at all: the account has
// the e-menu and the owner hasn't switched it off (emenu_admin.go).
func (a *App) menuOpen() bool {
	return a.features().EMenu() && bool(a.emenuConfig().Enabled)
}

var errMenuClosed = &Error{CodeNotFound, "المنيو غير متاح حالياً"}

// ---- public menu -----------------------------------------------------------------

type PublicModifier struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Price money.Minor `json:"price_minor"`
}

type PublicModifierGroup struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Min       int              `json:"min"`
	Max       int              `json:"max"`
	Modifiers []PublicModifier `json:"modifiers"`
}

type PublicItem struct {
	ID          string                `json:"id"`
	CategoryID  string                `json:"category_id"`
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Price       money.Minor           `json:"price_minor"`
	Image       string                `json:"image"`
	Groups      []PublicModifierGroup `json:"groups"`
}

type PublicCategory struct {
	ID    string       `json:"id"`
	Name  string       `json:"name"`
	Image string       `json:"image"`
	Items []PublicItem `json:"items"`
}

// PublicOffer is an offer card; ordering it orders Item.
type PublicOffer struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"` // single | family
	Badge     string     `json:"badge"`
	Highlight string     `json:"highlight"`
	Item      PublicItem `json:"item"`
}

type PublicFeatured struct {
	Badge string     `json:"badge"` // '' | bestseller | hot_deal | new
	Item  PublicItem `json:"item"`
}

// PublicOrdering says how a guest may order: in the hall (from the table's
// QR code, or by typing the table number) and/or delivery to an address.
type PublicOrdering struct {
	CallWaiter  bool        `json:"call_waiter"` // table QR only
	DineIn      bool        `json:"dine_in"`
	Delivery    bool        `json:"delivery"`
	DeliveryFee money.Minor `json:"delivery_fee_minor"`
	Note        string      `json:"note"`
}

type PublicMenu struct {
	Restaurant struct {
		Name      string `json:"name"`
		Tagline   string `json:"tagline"`
		Logo      string `json:"logo"`
		Phone     string `json:"phone"`
		WhatsApp  string `json:"whatsapp"`
		Address   string `json:"address"`
		MapURL    string `json:"map_url"`
		Instagram string `json:"instagram"`
		Facebook  string `json:"facebook"`
		TikTok    string `json:"tiktok"`
		Footer    string `json:"footer"`
		Currency  string `json:"currency"`
	} `json:"restaurant"`
	Theme struct {
		Background string `json:"background"` // preset id = guest page theme
		Primary    string `json:"primary"`    // button colour (#rrggbb)
	} `json:"theme"`
	Languages       []string         `json:"languages"`
	DefaultLanguage string           `json:"default_language"`
	ShowPrices      bool             `json:"show_prices"`
	Ordering        PublicOrdering   `json:"ordering"`
	Table           *string          `json:"table"` // table name when opened from a table QR
	Categories      []PublicCategory `json:"categories"`
	Offers          []PublicOffer    `json:"offers"`
	Featured        []PublicFeatured `json:"featured"`
	Preview         bool             `json:"preview,omitempty"` // built for the designer's phone preview
	App             PublicApp        `json:"app"`
}

// PublicApp tells the guest page whether to offer installing the menu as
// an app (the manifest at /manifest.webmanifest is served only then).
type PublicApp struct {
	Installable bool   `json:"installable"`
	Name        string `json:"name"`
	Icon        string `json:"icon"`
}

func (a *App) ordering(cfg EMenuSettings, atTable bool, deliveryFee money.Minor) PublicOrdering {
	f := a.features()
	o := PublicOrdering{
		CallWaiter: atTable && bool(cfg.AllowCallWaiter),
		DineIn:     f.EMenuOrdering() && bool(cfg.AllowDineIn),
		Delivery:   f.EMenuOrdering() && bool(cfg.AllowDelivery),
		Note:       cfg.OrderNote,
	}
	if o.Delivery {
		o.DeliveryFee = deliveryFee
	}
	return o
}

func tableByToken(ctx context.Context, q sqlite.Querier, token string) (id, name string, err error) {
	if token == "" || len(token) > 64 {
		return "", "", notFound("الطاولة")
	}
	err = q.QueryRowContext(ctx, `SELECT id, name FROM dining_tables WHERE qr_token = ? AND active = 1 AND deleted_at IS NULL`, token).Scan(&id, &name)
	return id, name, noRows(err, "الطاولة")
}

// PublicMenu is what a guest's phone loads. tableToken is optional.
func (a *App) PublicMenu(ctx context.Context, tableToken string) (PublicMenu, error) {
	if !a.menuOpen() {
		return PublicMenu{}, errMenuClosed
	}
	cfg := a.emenuConfig()
	var table *string
	if tableToken != "" {
		_, name, err := tableByToken(ctx, a.db.Read, tableToken)
		if err != nil {
			return PublicMenu{}, err
		}
		table = &name
	}
	m, err := a.buildMenu(ctx, cfg, table, "/api/public/v1/images/")
	if err != nil {
		return m, err
	}
	s, err := loadSettings(ctx, a.db.Read)
	m.Ordering = a.ordering(cfg, table != nil, s.DeliveryFee)
	return m, err
}

// buildMenu assembles the guest menu from settings and the catalogue.
// img is the URL prefix pictures are served under on the calling channel.
func (a *App) buildMenu(ctx context.Context, cfg EMenuSettings, table *string, img string) (PublicMenu, error) {
	var m PublicMenu
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return m, err
	}
	m.Table = table
	r := &m.Restaurant
	r.Name, r.Tagline, r.Logo = cfg.DisplayName, cfg.Tagline, imageURL(img, cfg.Logo)
	if r.Name == "" {
		r.Name = s.RestaurantName
	}
	r.Phone, r.WhatsApp, r.Address, r.MapURL = cfg.Phone, cfg.WhatsApp, cfg.Address, cfg.MapURL
	if r.Phone == "" {
		r.Phone = s.Phone
	}
	if r.Address == "" {
		r.Address = s.Address
	}
	r.Instagram, r.Facebook, r.TikTok, r.Footer, r.Currency = cfg.Instagram, cfg.Facebook, cfg.TikTok, cfg.FooterText, s.Currency
	m.Theme.Background = cfg.Background
	m.Theme.Primary, _ = presetHex(buttonColors, cfg.ButtonColor)
	for code, on := range map[string]flexBool{"ar": cfg.LangAR, "en": cfg.LangEN, "fr": cfg.LangFR} {
		if on {
			m.Languages = append(m.Languages, code)
		}
	}
	if len(m.Languages) == 0 {
		m.Languages = []string{"ar"}
	}
	sortLangs(m.Languages)
	m.DefaultLanguage = cfg.DefaultLanguage
	m.ShowPrices = bool(cfg.ShowPrices)
	m.App = PublicApp{Installable: cfg.installable(), Name: r.Name, Icon: imageURL(img, cfg.AppIcon192)}
	m.Categories, m.Offers, m.Featured, err = publicCatalog(ctx, a.db.Read, img)
	return m, err
}

func sortLangs(l []string) {
	order := map[string]int{"ar": 0, "en": 1, "fr": 2}
	for i := 1; i < len(l); i++ {
		for j := i; j > 0 && order[l[j]] < order[l[j-1]]; j-- {
			l[j], l[j-1] = l[j-1], l[j]
		}
	}
}

// publicCatalog returns what guests may order: visible items by category,
// the offers and the featured row. Offer items appear only as offers.
func publicCatalog(ctx context.Context, q sqlite.Querier, img string) ([]PublicCategory, []PublicOffer, []PublicFeatured, error) {
	// Modifier groups per item, in one pass.
	groups := map[string][]PublicModifierGroup{}
	rows, err := q.QueryContext(ctx, `
		SELECT ig.item_id, g.id, g.name, g.min_select, g.max_select, m.id, m.name, m.price_minor
		  FROM item_modifier_groups ig
		  JOIN modifier_groups g ON g.id = ig.group_id AND g.active = 1 AND g.deleted_at IS NULL
		  JOIN modifiers m ON m.group_id = g.id AND m.active = 1
		 ORDER BY ig.item_id, ig.sort, g.name, m.sort, m.name`)
	if err != nil {
		return nil, nil, nil, err
	}
	for rows.Next() {
		var itemID string
		var g PublicModifierGroup
		var mod PublicModifier
		if err := rows.Scan(&itemID, &g.ID, &g.Name, &g.Min, &g.Max, &mod.ID, &mod.Name, &mod.Price); err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		list := groups[itemID]
		if n := len(list); n > 0 && list[n-1].ID == g.ID {
			list[n-1].Modifiers = append(list[n-1].Modifiers, mod)
		} else {
			g.Modifiers = []PublicModifier{mod}
			list = append(list, g)
		}
		groups[itemID] = list
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}

	// Every orderable item, in menu order.
	type row struct {
		cat  PublicCategory
		item PublicItem
	}
	var all []row
	byID := map[string]PublicItem{}
	rows, err = q.QueryContext(ctx, `
		SELECT c.id, c.name, coalesce(c.image_path,''), i.id, i.name, i.description, i.price_minor, coalesce(i.image_path,'')
		  FROM items i JOIN categories c ON c.id = i.category_id AND c.active = 1
		 WHERE i.active = 1 AND i.deleted_at IS NULL
		 ORDER BY c.sort, c.name, i.sort, i.name`)
	if err != nil {
		return nil, nil, nil, err
	}
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.cat.ID, &r.cat.Name, &r.cat.Image, &r.item.ID, &r.item.Name, &r.item.Description, &r.item.Price, &r.item.Image); err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		r.cat.Image, r.item.Image, r.item.CategoryID = imageURL(img, r.cat.Image), imageURL(img, r.item.Image), r.cat.ID
		r.item.Groups = groups[r.item.ID]
		if r.item.Groups == nil {
			r.item.Groups = []PublicModifierGroup{}
		}
		all = append(all, r)
		byID[r.item.ID] = r.item
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}

	offers := []PublicOffer{}
	isOffer := map[string]bool{}
	rows, err = q.QueryContext(ctx, `SELECT id, kind, item_id, badge, highlight FROM emenu_offers ORDER BY kind, sort, created_at`)
	if err != nil {
		return nil, nil, nil, err
	}
	for rows.Next() {
		var o PublicOffer
		var itemID string
		if err := rows.Scan(&o.ID, &o.Kind, &itemID, &o.Badge, &o.Highlight); err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		isOffer[itemID] = true
		if it, ok := byID[itemID]; ok {
			o.Item = it
			offers = append(offers, o)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}

	featured := []PublicFeatured{}
	rows, err = q.QueryContext(ctx, `SELECT item_id, badge FROM emenu_featured ORDER BY sort`)
	if err != nil {
		return nil, nil, nil, err
	}
	for rows.Next() {
		var f PublicFeatured
		var itemID string
		if err := rows.Scan(&itemID, &f.Badge); err != nil {
			rows.Close()
			return nil, nil, nil, err
		}
		if it, ok := byID[itemID]; ok {
			f.Item = it
			featured = append(featured, f)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}

	cats := []PublicCategory{}
	for _, r := range all {
		if isOffer[r.item.ID] {
			continue
		}
		if n := len(cats); n == 0 || cats[n-1].ID != r.cat.ID {
			cats = append(cats, r.cat)
		}
		cats[len(cats)-1].Items = append(cats[len(cats)-1].Items, r.item)
	}
	return cats, offers, featured, nil
}

// ---- call the waiter -------------------------------------------------------------

// CallWaiter records a waiter or bill request from a table. A second call of
// the same kind while one is open is a no-op.
func (a *App) CallWaiter(ctx context.Context, tableToken, kind, ip string) error {
	if !a.menuOpen() {
		return errMenuClosed
	}
	if kind != "waiter" && kind != "bill" {
		return invalid("نوع الطلب غير صحيح")
	}
	if !a.ordering(a.emenuConfig(), true, 0).CallWaiter {
		return &Error{CodeForbidden, "نداء الويتر غير متاح"}
	}
	if !a.limits.allow("call:"+ip, callsPerIP, publicRateBurst, a.now()) {
		return errTooMany
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		tableID, _, err := tableByToken(ctx, tx, tableToken)
		if err != nil {
			return err
		}
		var open int
		tx.QueryRowContext(ctx, `SELECT count(*) FROM service_requests WHERE table_id = ? AND kind = ? AND status = 'open'`, tableID, kind).Scan(&open)
		if open > 0 {
			return nil
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO service_requests(id, table_id, kind, created_at) VALUES (?,?,?,?)`,
			sqlite.NewID(), tableID, kind, a.stamp())
		return err
	})
}

// ---- online orders (guest side) ------------------------------------------------------

type OnlineLineInput struct {
	ItemID      string   `json:"item_id"`
	Qty         int      `json:"qty"`
	ModifierIDs []string `json:"modifier_ids"`
	Notes       string   `json:"notes"`
}

// OnlineOrderInput is a guest's order. In the hall the table comes from the
// QR code (TableToken) or the number the guest typed (TableNumber);
// delivery needs a name, phone and address.
type OnlineOrderInput struct {
	Type         string            `json:"type"`        // dine_in | delivery (a TableToken implies dine_in)
	TableToken   string            `json:"table_token"` // opened from the table's QR code
	TableNumber  string            `json:"table_number"`
	CustomerName string            `json:"customer_name"`
	Phone        string            `json:"phone"`
	Address      string            `json:"address"`
	Notes        string            `json:"notes"`
	Lines        []OnlineLineInput `json:"lines"`
}

type OnlineLine struct {
	ItemID      string         `json:"item_id"`
	Name        string         `json:"name"`
	Qty         int            `json:"qty"`
	UnitPrice   money.Minor    `json:"unit_price_minor"`
	Modifiers   []LineModifier `json:"modifiers"`
	ModifierIDs []string       `json:"modifier_ids"`
	Notes       string         `json:"notes"`
	Total       money.Minor    `json:"total_minor"`
}

// OnlineOrder is shown to staff (all fields) and to the guest (via
// GuestView, without staff-only details).
type OnlineOrder struct {
	ID           string       `json:"id"`
	Token        string       `json:"token,omitempty"`
	Type         string       `json:"type"`
	TableID      string       `json:"table_id"`
	TableName    string       `json:"table_name"`
	CustomerID   string       `json:"customer_id"`
	CustomerName string       `json:"customer_name"`
	Phone        string       `json:"phone"`
	Address      string       `json:"address"`
	Notes        string       `json:"notes"`
	Lines        []OnlineLine `json:"lines"`
	Total        money.Minor  `json:"total_minor"`
	Status       string       `json:"status"`
	OrderID      string       `json:"order_id"`
	OrderNumber  int          `json:"order_number"`
	RejectReason string       `json:"reject_reason"`
	CreatedAt    string       `json:"created_at"`
	DecidedAt    string       `json:"decided_at"`
}

// GuestOrder is what the guest's phone sees while waiting.
type GuestOrder struct {
	Token        string       `json:"token"`
	Type         string       `json:"type"`
	TableName    string       `json:"table_name"`
	Lines        []OnlineLine `json:"lines"`
	Total        money.Minor  `json:"total_minor"`
	Status       string       `json:"status"`
	OrderNumber  int          `json:"order_number"`
	RejectReason string       `json:"reject_reason"`
	CreatedAt    string       `json:"created_at"`
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func (a *App) expireOnlineOrders(ctx context.Context, q sqlite.Querier) error {
	_, err := q.ExecContext(ctx, `UPDATE online_orders SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < ?`,
		a.stamp(), sqlite.FormatTime(a.now().Add(-onlineOrderTTL)))
	return err
}

// SubmitOnlineOrder records a guest's order for staff to accept. Prices are
// always taken from the menu here, never from the guest.
func (a *App) SubmitOnlineOrder(ctx context.Context, in OnlineOrderInput, ip string) (GuestOrder, error) {
	if !a.menuOpen() {
		return GuestOrder{}, errMenuClosed
	}
	cfg := a.emenuConfig()
	ord := a.ordering(cfg, in.TableToken != "", 0)
	typ := in.Type
	if in.TableToken != "" {
		typ = "dine_in"
	}
	in.CustomerName, in.Phone, in.Address = clip(in.CustomerName, 60), clip(in.Phone, 20), clip(in.Address, 200)
	in.Notes, in.TableNumber = clip(in.Notes, 300), clip(in.TableNumber, 20)
	switch typ {
	case "dine_in":
		if !ord.DineIn {
			return GuestOrder{}, &Error{CodeForbidden, "الطلب من الصالة غير متاح، نادِ الويتر"}
		}
		if in.TableToken == "" && in.TableNumber == "" {
			return GuestOrder{}, invalid("اكتب رقم الترابيزة")
		}
		in.Address = ""
		if in.Phone != "" && !validPhone(in.Phone) {
			return GuestOrder{}, invalid("اكتب رقم تليفون صحيح")
		}
	case "delivery":
		if !ord.Delivery {
			return GuestOrder{}, &Error{CodeForbidden, "التوصيل غير متاح حالياً"}
		}
		if in.CustomerName == "" {
			return GuestOrder{}, invalid("اكتب الاسم")
		}
		if !validPhone(in.Phone) {
			return GuestOrder{}, invalid("اكتب رقم تليفون صحيح")
		}
		if in.Address == "" {
			return GuestOrder{}, invalid("اكتب العنوان")
		}
	default:
		return GuestOrder{}, invalid("اختار: في الصالة أو توصيل")
	}
	if len(in.Lines) == 0 {
		return GuestOrder{}, invalid("السلة فارغة")
	}
	if len(in.Lines) > maxOnlineLines {
		return GuestOrder{}, invalid(fmt.Sprintf("الحد الأقصى %d صنف في الطلب", maxOnlineLines))
	}
	if !a.limits.allow("order:"+ip, ordersPerIP, publicRateBurst, a.now()) {
		return GuestOrder{}, errTooMany
	}
	var token string
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if err := a.expireOnlineOrders(ctx, tx); err != nil {
			return err
		}
		var tableID string
		if typ == "dine_in" {
			var err error
			if in.TableToken != "" {
				tableID, _, err = tableByToken(ctx, tx, in.TableToken)
			} else {
				tableID, err = tableByNumber(ctx, tx, in.TableNumber)
			}
			if err != nil {
				return err
			}
			var pending int
			tx.QueryRowContext(ctx, `SELECT count(*) FROM online_orders WHERE table_id = ? AND status = 'pending'`, tableID).Scan(&pending)
			if pending > 0 {
				return conflict("فيه طلب لسه بيتراجع على الطاولة دي، استنى لحظة")
			}
		}
		lines := make([]OnlineLine, 0, len(in.Lines))
		var total money.Minor
		for _, l := range in.Lines {
			if l.Qty < 1 || l.Qty > maxOnlineQty {
				return invalid("الكمية غير صحيحة")
			}
			var name string
			var price money.Minor
			err := tx.QueryRowContext(ctx, `SELECT i.name, i.price_minor FROM items i JOIN categories c ON c.id = i.category_id AND c.active = 1
				WHERE i.id = ? AND i.active = 1 AND i.deleted_at IS NULL`, l.ItemID).Scan(&name, &price)
			if err != nil {
				return noRows(err, "الصنف")
			}
			mods, err := resolveModifiers(ctx, tx, l.ItemID, l.ModifierIDs)
			if err != nil {
				return err
			}
			unit := price
			ids := make([]string, 0, len(mods))
			for _, m := range mods {
				unit += m.Price
				ids = append(ids, m.ModifierID)
			}
			lt := unit.MulQty(money.Milli(l.Qty) * money.OneUnit)
			total += lt
			lines = append(lines, OnlineLine{ItemID: l.ItemID, Name: name, Qty: l.Qty, UnitPrice: price, Modifiers: mods,
				ModifierIDs: ids, Notes: clip(l.Notes, 120), Total: lt})
		}
		b, _ := json.Marshal(lines)
		token = newPublicToken() + newPublicToken()
		_, err := tx.ExecContext(ctx, `INSERT INTO online_orders(id, public_token, type, table_id, customer_name, phone, address, notes, lines_json, total_minor, ip, created_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, sqlite.NewID(), token, typ, sqlite.NullString(tableID), in.CustomerName, in.Phone, in.Address, in.Notes,
			string(b), total, clip(ip, 64), a.stamp())
		return err
	})
	if err != nil {
		return GuestOrder{}, err
	}
	return a.GuestOrderStatus(ctx, token)
}

func validPhone(p string) bool {
	digits := 0
	for _, r := range p {
		switch {
		case r >= '0' && r <= '9', r >= '٠' && r <= '٩':
			digits++
		case r == '+' || r == ' ' || r == '-':
		default:
			return false
		}
	}
	return digits >= 7 && digits <= 15
}

const onlineCols = `o.id, o.public_token, o.type, coalesce(o.table_id,''), coalesce(t.name,''), coalesce(o.customer_id,''), o.customer_name, o.phone, o.address, o.notes,
	o.lines_json, o.total_minor, o.status, coalesce(o.order_id,''), coalesce(r.number,0), o.reject_reason, o.created_at, coalesce(o.decided_at,'')`

const onlineFrom = ` FROM online_orders o LEFT JOIN dining_tables t ON t.id = o.table_id LEFT JOIN orders r ON r.id = o.order_id`

func scanOnline(row interface{ Scan(...any) error }) (OnlineOrder, error) {
	var o OnlineOrder
	var lines string
	err := row.Scan(&o.ID, &o.Token, &o.Type, &o.TableID, &o.TableName, &o.CustomerID, &o.CustomerName, &o.Phone, &o.Address, &o.Notes,
		&lines, &o.Total, &o.Status, &o.OrderID, &o.OrderNumber, &o.RejectReason, &o.CreatedAt, &o.DecidedAt)
	if err != nil {
		return o, err
	}
	err = json.Unmarshal([]byte(lines), &o.Lines)
	return o, err
}

// GuestOrderStatus is polled by the guest's phone.
func (a *App) GuestOrderStatus(ctx context.Context, token string) (GuestOrder, error) {
	if token == "" || len(token) > 64 {
		return GuestOrder{}, notFound("الطلب")
	}
	if err := a.expireOnlineOrders(ctx, a.db.Write); err != nil {
		return GuestOrder{}, err
	}
	o, err := scanOnline(a.db.Write.QueryRowContext(ctx, `SELECT `+onlineCols+onlineFrom+` WHERE o.public_token = ?`, token))
	if err != nil {
		return GuestOrder{}, noRows(err, "الطلب")
	}
	return GuestOrder{Token: o.Token, Type: o.Type, TableName: o.TableName, Lines: o.Lines, Total: o.Total, Status: o.Status,
		OrderNumber: o.OrderNumber, RejectReason: o.RejectReason, CreatedAt: o.CreatedAt}, nil
}

// ---- staff side ---------------------------------------------------------------------

type ServiceRequest struct {
	ID        string `json:"id"`
	TableID   string `json:"table_id"`
	TableName string `json:"table_name"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"created_at"`
}

// Inbox is what the POS polls: pending online orders and open calls.
type Inbox struct {
	Orders   []OnlineOrder    `json:"orders"`
	Requests []ServiceRequest `json:"requests"`
}

func (a *App) Inbox(ctx context.Context, actor Actor) (Inbox, error) {
	in := Inbox{Orders: []OnlineOrder{}, Requests: []ServiceRequest{}}
	if err := actor.require(rbac.POSSell); err != nil {
		return in, err
	}
	if err := a.expireOnlineOrders(ctx, a.db.Write); err != nil {
		return in, err
	}
	rows, err := a.db.Write.QueryContext(ctx, `SELECT `+onlineCols+onlineFrom+` WHERE o.status = 'pending' ORDER BY o.created_at`)
	if err != nil {
		return in, err
	}
	for rows.Next() {
		o, err := scanOnline(rows)
		if err != nil {
			rows.Close()
			return in, err
		}
		o.Token = ""
		in.Orders = append(in.Orders, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return in, err
	}
	rows, err = a.db.Write.QueryContext(ctx, `SELECT s.id, s.table_id, t.name, s.kind, s.created_at FROM service_requests s
		JOIN dining_tables t ON t.id = s.table_id WHERE s.status = 'open' ORDER BY s.created_at`)
	if err != nil {
		return in, err
	}
	defer rows.Close()
	for rows.Next() {
		var r ServiceRequest
		if err := rows.Scan(&r.ID, &r.TableID, &r.TableName, &r.Kind, &r.CreatedAt); err != nil {
			return in, err
		}
		in.Requests = append(in.Requests, r)
	}
	return in, rows.Err()
}

// DoneServiceRequest clears a call once someone went to the table.
func (a *App) DoneServiceRequest(ctx context.Context, actor Actor, id string) error {
	if err := actor.require(rbac.POSSell); err != nil {
		return err
	}
	_, err := a.db.Write.ExecContext(ctx, `UPDATE service_requests SET status = 'done', done_by = ?, done_at = ? WHERE id = ? AND status = 'open'`,
		actor.UserID, a.stamp(), id)
	return err
}

func pendingOnline(ctx context.Context, tx *sql.Tx, id string) (OnlineOrder, error) {
	o, err := scanOnline(tx.QueryRowContext(ctx, `SELECT `+onlineCols+onlineFrom+` WHERE o.id = ?`, id))
	if err != nil {
		return o, noRows(err, "الطلب")
	}
	if o.Status != "pending" {
		return o, conflict("الطلب ده اتعامل معاه بالفعل")
	}
	return o, nil
}

// AcceptOnlineOrder turns a guest order into a real order and sends it to
// the kitchen. Dine-in orders join the table's open order if there is one.
func (a *App) AcceptOnlineOrder(ctx context.Context, actor Actor, id string) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	var orderID string
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if err := a.expireOnlineOrders(ctx, tx); err != nil {
			return err
		}
		o, err := pendingOnline(ctx, tx, id)
		if err != nil {
			return err
		}
		note := "طلب أونلاين"
		if o.CustomerName != "" {
			note += " — " + o.CustomerName
		}
		if o.Phone != "" {
			note += " — " + o.Phone
		}
		if o.Address != "" {
			note += "\nالعنوان: " + o.Address
		}
		customerID, err := a.customerForOrder(ctx, tx, o)
		if err != nil {
			return err
		}
		if o.Notes != "" {
			note += "\n" + o.Notes
		}
		orderID, err = a.createOrderTx(ctx, tx, actor, OrderInput{Type: o.Type, TableID: o.TableID, CustomerID: customerID, Notes: note}, "online:"+o.ID)
		if err != nil {
			return err
		}
		if _, err := editable(ctx, tx, orderID); err != nil {
			return err
		}
		for _, l := range o.Lines {
			in := LineInput{ItemID: l.ItemID, Qty: money.Milli(l.Qty) * money.OneUnit, ModifierIDs: l.ModifierIDs, Notes: l.Notes, Course: 1}
			if err := addLineTx(ctx, tx, orderID, in); err != nil {
				var ae *Error
				if errors.As(err, &ae) {
					return conflict("«" + l.Name + "»: " + ae.Msg + " — ارفض الطلب أو عدّله يدوياً")
				}
				return err
			}
		}
		if err := sendPending(ctx, tx, orderID, a.stamp()); err != nil {
			return err
		}
		if err := recalc(ctx, tx, orderID, a.stamp()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE online_orders SET status = 'accepted', order_id = ?, customer_id = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
			orderID, sqlite.NullString(customerID), a.stamp(), actor.UserID, id); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "online_order.accept", "online_orders", id, map[string]string{"order_id": orderID})
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

func (a *App) RejectOnlineOrder(ctx context.Context, actor Actor, id, reason string) error {
	if err := actor.require(rbac.POSSell); err != nil {
		return err
	}
	reason = clip(reason, 200)
	if reason == "" {
		return invalid("اكتب سبب الرفض")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := pendingOnline(ctx, tx, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE online_orders SET status = 'rejected', reject_reason = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
			reason, a.stamp(), actor.UserID, id); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "online_order.reject", "online_orders", id, map[string]string{"reason": reason})
	})
}

// RegenerateTableToken invalidates a table's printed QR code.
func (a *App) RegenerateTableToken(ctx context.Context, actor Actor, tableID string) (string, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return "", err
	}
	token := newPublicToken()
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if err := mustAffect(tx.ExecContext(ctx, `UPDATE dining_tables SET qr_token = ? WHERE id = ? AND deleted_at IS NULL`, token, tableID)); err != nil {
			return noRows(err, "الطاولة")
		}
		return a.audit(ctx, tx, actor, "table.qr_regenerate", "dining_tables", tableID, nil)
	})
	return token, err
}

// ---- tables by number and customers by phone ----------------------------------------

// tableByNumber finds the table a guest typed: its exact name, or, for a
// plain number, the one table whose name has those digits («5» → «T5»).
func tableByNumber(ctx context.Context, tx *sql.Tx, typed string) (string, error) {
	want := strings.ToLower(strings.TrimSpace(typed))
	wantDigits, _ := normalizePhone(want) // digits only (Arabic digits too)
	rows, err := tx.QueryContext(ctx, `SELECT id, name FROM dining_tables WHERE active = 1 AND deleted_at IS NULL`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var byDigits []string
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return "", err
		}
		if strings.ToLower(strings.TrimSpace(name)) == want {
			return id, nil
		}
		if d := digitsOf(name); wantDigits != "" && d == strings.TrimLeft(wantDigits, "0") {
			byDigits = append(byDigits, id)
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	switch len(byDigits) {
	case 1:
		return byDigits[0], nil
	case 0:
		return "", &Error{CodeNotFound, "رقم الترابيزة ده مش موجود، اكتبه زي ما هو مكتوب على الترابيزة"}
	default:
		return "", conflict("فيه أكتر من ترابيزة بالرقم ده، اكتب اسمها زي ما هو مكتوب على الترابيزة")
	}
}

func digitsOf(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r >= '٠' && r <= '٩':
			b.WriteRune('0' + (r - '٠'))
		}
	}
	return strings.TrimLeft(b.String(), "0")
}

// normalizePhone keeps digits (Arabic and Persian digits become ASCII) and a
// leading +, dropping spaces and dashes.
func normalizePhone(p string) (string, bool) {
	var b strings.Builder
	for i, r := range strings.TrimSpace(p) {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r >= '٠' && r <= '٩':
			b.WriteRune('0' + (r - '٠'))
		case r >= '۰' && r <= '۹':
			b.WriteRune('0' + (r - '۰'))
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == ' ' || r == '-':
		default:
			return "", false
		}
	}
	n := b.String()
	digits := len(strings.TrimPrefix(n, "+"))
	return n, digits >= 7 && digits <= 15
}

// customerForOrder links an accepted online order to the customer with the
// same phone, creating one for a delivery order (staff accepting is the
// check that the details are real). An empty address on file is filled in.
func (a *App) customerForOrder(ctx context.Context, tx *sql.Tx, o OnlineOrder) (string, error) {
	phone, ok := normalizePhone(o.Phone)
	if !ok {
		return "", nil
	}
	var id, address string
	err := tx.QueryRowContext(ctx, `SELECT id, address FROM customers WHERE replace(replace(phone,' ',''),'-','') = ? ORDER BY created_at LIMIT 1`, phone).
		Scan(&id, &address)
	switch {
	case err == nil:
		if address == "" && o.Address != "" {
			_, err = tx.ExecContext(ctx, `UPDATE customers SET address = ?, updated_at = ? WHERE id = ?`, o.Address, a.stamp(), id)
		}
		return id, err
	case !errors.Is(err, sql.ErrNoRows):
		return "", err
	case o.Type != "delivery" || o.CustomerName == "":
		return "", nil
	}
	id = sqlite.NewID()
	_, err = tx.ExecContext(ctx, `INSERT INTO customers(id, name, phone, address, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
		id, o.CustomerName, phone, o.Address, "من المنيو الإلكتروني", a.stamp(), a.stamp())
	if isUnique(err) {
		return "", nil // a differently written copy of the number exists; leave the order unlinked
	}
	return id, err
}
