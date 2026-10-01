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

// ---- configuration from the Platform --------------------------------------------

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

// EMenuConfig mirrors SCP E-Menu Settings on the Platform.
type EMenuConfig struct {
	Enabled         flexBool `json:"enabled"`
	DisplayName     string   `json:"display_name"`
	Tagline         string   `json:"tagline"`
	WelcomeMessage  string   `json:"welcome_message"`
	DefaultLanguage string   `json:"default_language"`
	LangAR          flexBool `json:"lang_ar"`
	LangEN          flexBool `json:"lang_en"`
	LangFR          flexBool `json:"lang_fr"`
	Theme           string   `json:"theme"`
	PrimaryColor    string   `json:"primary_color"`
	AccentColor     string   `json:"accent_color"`
	CardStyle       string   `json:"card_style"`
	Logo            string   `json:"logo"`
	CoverImage      string   `json:"cover_image"`
	ShowPrices      flexBool `json:"show_prices"`
	ShowItemCodes   flexBool `json:"show_item_codes"`
	AllowCallWaiter flexBool `json:"allow_call_waiter"`
	AllowDineIn     flexBool `json:"allow_dine_in_orders"`
	AllowTakeaway   flexBool `json:"allow_takeaway_orders"`
	RequirePhone    flexBool `json:"require_phone"`
	OrderNote       string   `json:"order_note"`
	Phone           string   `json:"phone"`
	WhatsApp        string   `json:"whatsapp"`
	Address         string   `json:"address"`
	MapURL          string   `json:"map_url"`
	Instagram       string   `json:"instagram"`
	Facebook        string   `json:"facebook"`
	TikTok          string   `json:"tiktok"`
	CustomHTML      string   `json:"custom_html"`
	FooterText      string   `json:"footer_text"`
}

func defaultEMenuConfig() EMenuConfig {
	return EMenuConfig{
		Enabled: true, DefaultLanguage: "ar", LangAR: true, LangEN: true, Theme: "Midnight",
		PrimaryColor: "#D4A24C", AccentColor: "#E8604C", CardStyle: "Photo Cards", ShowPrices: true,
		AllowCallWaiter: true, RequirePhone: true,
	}
}

func (a *App) emenuConfig() EMenuConfig {
	c := defaultEMenuConfig()
	p := a.platform
	if p == nil {
		c.AllowDineIn, c.AllowTakeaway = true, true // licensing off: tests and tools
		return c
	}
	p.mu.RLock()
	raw := p.st.EMenu
	p.mu.RUnlock()
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &c); err != nil {
			a.log.Warn("e-menu settings unreadable", "err", err)
		}
	}
	return c
}

// menuOpen reports whether guests may see the menu at all.
func (a *App) menuOpen() bool {
	return a.features().EMenu && bool(a.emenuConfig().Enabled)
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
	Code        string                `json:"code,omitempty"`
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Price       money.Minor           `json:"price_minor"`
	Image       string                `json:"image"`
	Groups      []PublicModifierGroup `json:"groups"`
}

type PublicCategory struct {
	ID    string       `json:"id"`
	Name  string       `json:"name"`
	Items []PublicItem `json:"items"`
}

type PublicOrdering struct {
	CallWaiter   bool   `json:"call_waiter"`
	DineIn       bool   `json:"dine_in"`
	Takeaway     bool   `json:"takeaway"`
	RequirePhone bool   `json:"require_phone"`
	Note         string `json:"note"`
}

type PublicMenu struct {
	Restaurant struct {
		Name       string `json:"name"`
		Tagline    string `json:"tagline"`
		Welcome    string `json:"welcome"`
		Logo       string `json:"logo"`
		Cover      string `json:"cover"`
		Phone      string `json:"phone"`
		WhatsApp   string `json:"whatsapp"`
		Address    string `json:"address"`
		MapURL     string `json:"map_url"`
		Instagram  string `json:"instagram"`
		Facebook   string `json:"facebook"`
		TikTok     string `json:"tiktok"`
		CustomHTML string `json:"custom_html"`
		Footer     string `json:"footer"`
		Currency   string `json:"currency"`
	} `json:"restaurant"`
	Theme struct {
		Name      string `json:"name"`
		Primary   string `json:"primary"`
		Accent    string `json:"accent"`
		CardStyle string `json:"card_style"`
	} `json:"theme"`
	Languages       []string         `json:"languages"`
	DefaultLanguage string           `json:"default_language"`
	ShowPrices      bool             `json:"show_prices"`
	ShowCodes       bool             `json:"show_codes"`
	Ordering        PublicOrdering   `json:"ordering"`
	Table           *string          `json:"table"` // table name when opened from a table QR
	Categories      []PublicCategory `json:"categories"`
	Offers          []any            `json:"offers"` // next phase
}

func (a *App) ordering(cfg EMenuConfig, atTable bool) PublicOrdering {
	f := a.features()
	return PublicOrdering{
		CallWaiter:   atTable && bool(cfg.AllowCallWaiter),
		DineIn:       atTable && f.EMenuOrdering && bool(cfg.AllowDineIn),
		Takeaway:     f.EMenuOrdering && bool(cfg.AllowTakeaway),
		RequirePhone: bool(cfg.RequirePhone),
		Note:         cfg.OrderNote,
	}
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
	var m PublicMenu
	if !a.menuOpen() {
		return m, errMenuClosed
	}
	cfg := a.emenuConfig()
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return m, err
	}
	if tableToken != "" {
		_, name, err := tableByToken(ctx, a.db.Read, tableToken)
		if err != nil {
			return m, err
		}
		m.Table = &name
	}
	r := &m.Restaurant
	r.Name = cfg.DisplayName
	if r.Name == "" {
		r.Name = s.RestaurantName
	}
	r.Tagline, r.Welcome, r.Logo, r.Cover = cfg.Tagline, cfg.WelcomeMessage, cfg.Logo, cfg.CoverImage
	r.Phone, r.WhatsApp, r.Address, r.MapURL = cfg.Phone, cfg.WhatsApp, cfg.Address, cfg.MapURL
	if r.Phone == "" {
		r.Phone = s.Phone
	}
	if r.Address == "" {
		r.Address = s.Address
	}
	r.Instagram, r.Facebook, r.TikTok = cfg.Instagram, cfg.Facebook, cfg.TikTok
	r.CustomHTML, r.Footer, r.Currency = cfg.CustomHTML, cfg.FooterText, s.Currency
	m.Theme.Name, m.Theme.Primary, m.Theme.Accent, m.Theme.CardStyle = cfg.Theme, cfg.PrimaryColor, cfg.AccentColor, cfg.CardStyle
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
	m.ShowPrices, m.ShowCodes = bool(cfg.ShowPrices), bool(cfg.ShowItemCodes)
	m.Ordering = a.ordering(cfg, m.Table != nil)
	m.Offers = []any{}
	m.Categories, err = publicCatalog(ctx, a.db.Read, m.ShowCodes)
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

func publicCatalog(ctx context.Context, q sqlite.Querier, codes bool) ([]PublicCategory, error) {
	// Modifier groups per item, in one pass.
	groups := map[string][]PublicModifierGroup{}
	rows, err := q.QueryContext(ctx, `
		SELECT ig.item_id, g.id, g.name, g.min_select, g.max_select, m.id, m.name, m.price_minor
		  FROM item_modifier_groups ig
		  JOIN modifier_groups g ON g.id = ig.group_id AND g.active = 1 AND g.deleted_at IS NULL
		  JOIN modifiers m ON m.group_id = g.id AND m.active = 1
		 ORDER BY ig.item_id, ig.sort, g.name, m.sort, m.name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var itemID string
		var g PublicModifierGroup
		var mod PublicModifier
		if err := rows.Scan(&itemID, &g.ID, &g.Name, &g.Min, &g.Max, &mod.ID, &mod.Name, &mod.Price); err != nil {
			rows.Close()
			return nil, err
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
		return nil, err
	}

	rows, err = q.QueryContext(ctx, `
		SELECT c.id, c.name, i.id, i.code, i.name, i.description, i.price_minor, coalesce(i.image_path,'')
		  FROM items i JOIN categories c ON c.id = i.category_id AND c.active = 1
		 WHERE i.active = 1 AND i.deleted_at IS NULL
		 ORDER BY c.sort, c.name, i.sort, i.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicCategory{}
	for rows.Next() {
		var cid, cname string
		var it PublicItem
		if err := rows.Scan(&cid, &cname, &it.ID, &it.Code, &it.Name, &it.Description, &it.Price, &it.Image); err != nil {
			return nil, err
		}
		if !codes {
			it.Code = ""
		}
		if it.Image != "" {
			it.Image = "/api/public/v1/images/" + it.Image
		}
		it.Groups = groups[it.ID]
		if it.Groups == nil {
			it.Groups = []PublicModifierGroup{}
		}
		if n := len(out); n == 0 || out[n-1].ID != cid {
			out = append(out, PublicCategory{ID: cid, Name: cname})
		}
		out[len(out)-1].Items = append(out[len(out)-1].Items, it)
	}
	return out, rows.Err()
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
	if !a.ordering(a.emenuConfig(), true).CallWaiter {
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

type OnlineOrderInput struct {
	TableToken   string            `json:"table_token"` // set: dine-in at that table
	CustomerName string            `json:"customer_name"`
	Phone        string            `json:"phone"`
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
	CustomerName string       `json:"customer_name"`
	Phone        string       `json:"phone"`
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
	atTable := in.TableToken != ""
	ord := a.ordering(cfg, atTable)
	typ := "takeaway"
	if atTable {
		typ = "dine_in"
		if !ord.DineIn {
			return GuestOrder{}, &Error{CodeForbidden, "الطلب من الطاولة غير متاح، نادِ الويتر"}
		}
	} else if !ord.Takeaway {
		return GuestOrder{}, &Error{CodeForbidden, "الطلب أونلاين غير متاح حالياً"}
	}
	in.CustomerName, in.Phone, in.Notes = clip(in.CustomerName, 60), clip(in.Phone, 20), clip(in.Notes, 300)
	if !atTable {
		if in.CustomerName == "" {
			return GuestOrder{}, invalid("اكتب الاسم")
		}
		if ord.RequirePhone && !validPhone(in.Phone) {
			return GuestOrder{}, invalid("اكتب رقم تليفون صحيح")
		}
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
		if atTable {
			var err error
			if tableID, _, err = tableByToken(ctx, tx, in.TableToken); err != nil {
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
		_, err := tx.ExecContext(ctx, `INSERT INTO online_orders(id, public_token, type, table_id, customer_name, phone, notes, lines_json, total_minor, ip, created_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?)`, sqlite.NewID(), token, typ, sqlite.NullString(tableID), in.CustomerName, in.Phone, in.Notes,
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

const onlineCols = `o.id, o.public_token, o.type, coalesce(o.table_id,''), coalesce(t.name,''), o.customer_name, o.phone, o.notes,
	o.lines_json, o.total_minor, o.status, coalesce(o.order_id,''), coalesce(r.number,0), o.reject_reason, o.created_at, coalesce(o.decided_at,'')`

const onlineFrom = ` FROM online_orders o LEFT JOIN dining_tables t ON t.id = o.table_id LEFT JOIN orders r ON r.id = o.order_id`

func scanOnline(row interface{ Scan(...any) error }) (OnlineOrder, error) {
	var o OnlineOrder
	var lines string
	err := row.Scan(&o.ID, &o.Token, &o.Type, &o.TableID, &o.TableName, &o.CustomerName, &o.Phone, &o.Notes,
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
		if o.Notes != "" {
			note += "\n" + o.Notes
		}
		orderID, err = a.createOrderTx(ctx, tx, actor, OrderInput{Type: o.Type, TableID: o.TableID, Notes: note}, "online:"+o.ID)
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
		if _, err := tx.ExecContext(ctx, `UPDATE online_orders SET status = 'accepted', order_id = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
			orderID, a.stamp(), actor.UserID, id); err != nil {
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
