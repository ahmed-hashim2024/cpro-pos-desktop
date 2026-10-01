package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/order"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// ---- types -----------------------------------------------------------------

type LineModifier struct {
	ModifierID string      `json:"modifier_id"`
	Name       string      `json:"name"`
	Price      money.Minor `json:"price_minor"`
}

type OrderLine struct {
	ID            string             `json:"id"`
	ItemID        string             `json:"item_id"`
	Name          string             `json:"name"`
	UnitPrice     money.Minor        `json:"unit_price_minor"`
	Qty           money.Milli        `json:"qty_milli"`
	Modifiers     []LineModifier     `json:"modifiers"`
	DiscountKind  order.DiscountKind `json:"discount_kind"`
	DiscountRate  money.BasisPoints  `json:"discount_rate_bp"`
	DiscountAmt   money.Minor        `json:"discount_amount_minor"`
	Gross         money.Minor        `json:"gross_minor"`
	Net           money.Minor        `json:"net_minor"`
	Notes         string             `json:"notes"`
	Course        int                `json:"course"`
	KitchenStatus string             `json:"kitchen_status"`
	SentAt        string             `json:"sent_at"`
	Voided        bool               `json:"voided"`
	VoidReason    string             `json:"void_reason"`
	RefundedQty   money.Milli        `json:"refunded_qty_milli"`
}

type Payment struct {
	ID        string      `json:"id"`
	Method    string      `json:"method"`
	Amount    money.Minor `json:"amount_minor"`
	Tendered  *int64      `json:"tendered_minor"`
	Reference string      `json:"reference"`
	User      string      `json:"user_name"`
	CreatedAt string      `json:"created_at"`
}

type Order struct {
	ID             string             `json:"id"`
	Number         int                `json:"number"`
	BusinessDate   string             `json:"business_date"`
	Type           string             `json:"type"`
	Status         string             `json:"status"`
	TableID        string             `json:"table_id"`
	TableName      string             `json:"table_name"`
	CustomerID     string             `json:"customer_id"`
	CustomerName   string             `json:"customer_name"`
	CustomerPhone  string             `json:"customer_phone"`
	CustomerAddr   string             `json:"customer_address"`
	ShiftID        string             `json:"shift_id"`
	UserID         string             `json:"user_id"`
	UserName       string             `json:"user_name"`
	Guests         int                `json:"guests"`
	Notes          string             `json:"notes"`
	DiscountKind   order.DiscountKind `json:"discount_kind"`
	DiscountRate   money.BasisPoints  `json:"discount_rate_bp"`
	DiscountAmt    money.Minor        `json:"discount_amount_minor"`
	DiscountReason string             `json:"discount_reason"`
	Subtotal       money.Minor        `json:"subtotal_minor"`
	LineDiscounts  money.Minor        `json:"line_discounts_minor"`
	OrderDiscount  money.Minor        `json:"order_discount_minor"`
	Service        money.Minor        `json:"service_minor"`
	Tax            money.Minor        `json:"tax_minor"`
	DeliveryFee    money.Minor        `json:"delivery_fee_minor"`
	Total          money.Minor        `json:"total_minor"`
	Paid           money.Minor        `json:"paid_minor"`
	Refunded       money.Minor        `json:"refunded_minor"`
	VoidReason     string             `json:"void_reason"`
	InvoiceNumber  string             `json:"invoice_number"`
	InvoiceID      string             `json:"invoice_id"`
	CreatedAt      string             `json:"created_at"`
	ClosedAt       string             `json:"closed_at"`
	Lines          []OrderLine        `json:"lines"`
	Payments       []Payment          `json:"payments"`
}

// cashierShift enforces "no shift, no selling" for anyone who takes cash.
// Waiters (no ShiftCash permission) take orders without a shift; the
// cashier who settles them needs one.
func cashierShift(ctx context.Context, q sqlite.Querier, actor Actor) error {
	if !actor.Can(rbac.ShiftCash) {
		return nil
	}
	_, err := requireShift(ctx, q, actor)
	return err
}

var orderTypes = map[string]bool{"dine_in": true, "takeaway": true, "delivery": true}

// ---- loading ---------------------------------------------------------------

func (a *App) GetOrder(ctx context.Context, actor Actor, id string) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil && !actor.Can(rbac.OrderViewAll) {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Read, id)
}

func loadOrder(ctx context.Context, q sqlite.Querier, id string) (Order, error) {
	var o Order
	err := q.QueryRowContext(ctx, `
		SELECT o.id, o.number, o.business_date, o.type, o.status, coalesce(o.table_id,''), coalesce(t.name,''),
		       coalesce(o.customer_id,''), coalesce(c.name,''), coalesce(c.phone,''), coalesce(c.address,''),
		       coalesce(o.shift_id,''), o.user_id, u.full_name, o.guests, o.notes,
		       o.discount_kind, o.discount_rate_bp, o.discount_amount_minor, o.discount_reason,
		       o.subtotal_minor, o.line_discounts_minor, o.order_discount_minor, o.service_minor, o.tax_minor,
		       o.delivery_fee_minor, o.total_minor, o.void_reason, coalesce(i.number,''), coalesce(i.id,''),
		       o.created_at, coalesce(o.closed_at,''),
		       (SELECT coalesce(sum(total_minor),0) FROM refunds r WHERE r.invoice_id = i.id)
		  FROM orders o
		  JOIN users u ON u.id = o.user_id
		  LEFT JOIN dining_tables t ON t.id = o.table_id
		  LEFT JOIN customers c ON c.id = o.customer_id
		  LEFT JOIN invoices i ON i.order_id = o.id
		 WHERE o.id = ?`, id).Scan(
		&o.ID, &o.Number, &o.BusinessDate, &o.Type, &o.Status, &o.TableID, &o.TableName,
		&o.CustomerID, &o.CustomerName, &o.CustomerPhone, &o.CustomerAddr,
		&o.ShiftID, &o.UserID, &o.UserName, &o.Guests, &o.Notes,
		&o.DiscountKind, &o.DiscountRate, &o.DiscountAmt, &o.DiscountReason,
		&o.Subtotal, &o.LineDiscounts, &o.OrderDiscount, &o.Service, &o.Tax,
		&o.DeliveryFee, &o.Total, &o.VoidReason, &o.InvoiceNumber, &o.InvoiceID,
		&o.CreatedAt, &o.ClosedAt, &o.Refunded)
	if err != nil {
		return o, noRows(err, "الطلب")
	}

	rows, err := q.QueryContext(ctx, `
		SELECT l.id, l.item_id, l.name, l.unit_price_minor, l.qty_milli, l.discount_kind, l.discount_rate_bp,
		       l.discount_amount_minor, l.gross_minor, l.net_minor, l.notes, l.course, l.kitchen_status,
		       coalesce(l.sent_at,''), l.voided_at IS NOT NULL, l.void_reason,
		       (SELECT coalesce(sum(rl.qty_milli),0) FROM refund_lines rl WHERE rl.order_line_id = l.id)
		  FROM order_lines l WHERE l.order_id = ? ORDER BY l.sort, l.id`, id)
	if err != nil {
		return o, err
	}
	o.Lines = []OrderLine{}
	idx := map[string]int{}
	for rows.Next() {
		var l OrderLine
		var voided int64
		if err := rows.Scan(&l.ID, &l.ItemID, &l.Name, &l.UnitPrice, &l.Qty, &l.DiscountKind, &l.DiscountRate,
			&l.DiscountAmt, &l.Gross, &l.Net, &l.Notes, &l.Course, &l.KitchenStatus, &l.SentAt, &voided, &l.VoidReason, &l.RefundedQty); err != nil {
			rows.Close()
			return o, err
		}
		l.Voided, l.Modifiers = voided == 1, []LineModifier{}
		idx[l.ID] = len(o.Lines)
		o.Lines = append(o.Lines, l)
	}
	rows.Close()

	rows, err = q.QueryContext(ctx, `SELECT m.line_id, coalesce(m.modifier_id,''), m.name, m.price_minor
		FROM order_line_modifiers m JOIN order_lines l ON l.id = m.line_id WHERE l.order_id = ? ORDER BY m.id`, id)
	if err != nil {
		return o, err
	}
	for rows.Next() {
		var line string
		var m LineModifier
		if err := rows.Scan(&line, &m.ModifierID, &m.Name, &m.Price); err != nil {
			rows.Close()
			return o, err
		}
		if i, ok := idx[line]; ok {
			o.Lines[i].Modifiers = append(o.Lines[i].Modifiers, m)
		}
	}
	rows.Close()

	rows, err = q.QueryContext(ctx, `SELECT p.id, p.method, p.amount_minor, p.tendered_minor, p.reference, u.full_name, p.created_at
		FROM payments p JOIN users u ON u.id = p.user_id WHERE p.order_id = ? ORDER BY p.created_at`, id)
	if err != nil {
		return o, err
	}
	defer rows.Close()
	o.Payments = []Payment{}
	for rows.Next() {
		var p Payment
		var tendered sql.NullInt64
		if err := rows.Scan(&p.ID, &p.Method, &p.Amount, &tendered, &p.Reference, &p.User, &p.CreatedAt); err != nil {
			return o, err
		}
		if tendered.Valid {
			p.Tendered = &tendered.Int64
		}
		if p.Amount > 0 {
			o.Paid += p.Amount
		}
		o.Payments = append(o.Payments, p)
	}
	return o, rows.Err()
}

// editable loads an order that can still change (open or held).
func editable(ctx context.Context, q sqlite.Querier, id string) (Order, error) {
	o, err := loadOrder(ctx, q, id)
	if err != nil {
		return o, err
	}
	if o.Status != "open" && o.Status != "held" {
		return o, conflict("لا يمكن تعديل طلب مدفوع أو ملغي")
	}
	return o, nil
}

// recalc reprices the order from its stored lines and writes the totals.
func recalc(ctx context.Context, q sqlite.Querier, id string, stamp string) error {
	o, err := loadOrder(ctx, q, id)
	if err != nil {
		return err
	}
	s, err := loadSettings(ctx, q)
	if err != nil {
		return err
	}
	var lines []order.Line
	var live []OrderLine
	for _, l := range o.Lines {
		if l.Voided {
			continue
		}
		pl := order.Line{ItemID: l.ItemID, UnitPrice: l.UnitPrice, Qty: l.Qty,
			Discount: order.Discount{Kind: l.DiscountKind, Rate: l.DiscountRate, Amount: l.DiscountAmt}}
		for _, m := range l.Modifiers {
			pl.Modifiers = append(pl.Modifiers, order.Modifier{Name: m.Name, Price: m.Price})
		}
		lines = append(lines, pl)
		live = append(live, l)
	}
	var t order.Totals
	if len(lines) > 0 {
		t, err = order.Price(lines, order.Discount{Kind: o.DiscountKind, Rate: o.DiscountRate, Amount: o.DiscountAmt}, s.pricing(o.Type))
		if errors.Is(err, order.ErrInvalidDiscount) {
			// A fixed discount bigger than what's left after removing items: drop it.
			o.DiscountKind, o.DiscountAmt, o.DiscountRate = "", 0, 0
			if _, err := q.ExecContext(ctx, `UPDATE orders SET discount_kind='', discount_rate_bp=0, discount_amount_minor=0, discount_reason='' WHERE id=?`, id); err != nil {
				return err
			}
			t, err = order.Price(lines, order.Discount{}, s.pricing(o.Type))
		}
		if err != nil {
			return invalid("بيانات الطلب غير صحيحة")
		}
		for i, l := range live {
			if _, err := q.ExecContext(ctx, `UPDATE order_lines SET gross_minor=?, net_minor=? WHERE id=?`, t.Lines[i].Gross, t.Lines[i].Net, l.ID); err != nil {
				return err
			}
		}
	}
	_, err = q.ExecContext(ctx, `UPDATE orders SET subtotal_minor=?, line_discounts_minor=?, order_discount_minor=?, service_minor=?,
		tax_minor=?, delivery_fee_minor=?, total_minor=?, updated_at=? WHERE id=?`,
		t.Subtotal, t.LineDiscounts, t.OrderDiscount, t.Service, t.Tax, t.DeliveryFee, t.Total, stamp, id)
	return err
}

// ---- create / update -------------------------------------------------------

type OrderInput struct {
	Type       string `json:"type"`
	TableID    string `json:"table_id"`
	CustomerID string `json:"customer_id"`
	Guests     int    `json:"guests"`
	Notes      string `json:"notes"`
}

func (a *App) CreateOrder(ctx context.Context, actor Actor, in OrderInput, idemKey string) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	if !orderTypes[in.Type] {
		return Order{}, invalid("نوع الطلب غير صحيح")
	}
	if in.Type != "dine_in" {
		in.TableID = ""
	}
	var id string
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		id, err = a.createOrderTx(ctx, tx, actor, in, idemKey)
		return err
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, id)
}

// createOrderTx opens an order (or returns the one already on the table).
func (a *App) createOrderTx(ctx context.Context, tx *sql.Tx, actor Actor, in OrderInput, idemKey string) (string, error) {
	if err := a.requireLicensed(); err != nil {
		return "", err
	}
	var id string
	if err := cashierShift(ctx, tx, actor); err != nil {
		return "", err
	}
	if idemKey != "" {
		if err := tx.QueryRowContext(ctx, `SELECT id FROM orders WHERE idempotency_key = ?`, idemKey).Scan(&id); err == nil {
			return id, nil
		}
	}
	if in.TableID != "" {
		// Opening an occupied table returns the order already on it.
		err := tx.QueryRowContext(ctx, `SELECT id FROM orders WHERE table_id = ? AND status IN ('open','held')`, in.TableID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		var ok int
		if tx.QueryRowContext(ctx, `SELECT count(*) FROM dining_tables WHERE id = ? AND active = 1`, in.TableID).Scan(&ok); ok == 0 {
			return "", notFound("الطاولة")
		}
	}
	s, err := loadSettings(ctx, tx)
	if err != nil {
		return "", err
	}
	bd := businessDate(a.now(), s.DayStartHour)
	var number int
	if err := tx.QueryRowContext(ctx, `SELECT coalesce(max(number),0) + 1 FROM orders WHERE business_date = ?`, bd).Scan(&number); err != nil {
		return "", err
	}
	shift, err := openShift(ctx, tx, actor)
	if err != nil {
		return "", err
	}
	id = sqlite.NewID()
	_, err = tx.ExecContext(ctx, `INSERT INTO orders(id, number, business_date, type, status, table_id, customer_id, shift_id, user_id,
		guests, notes, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,'open',?,?,?,?,?,?,?,?,?)`,
		id, number, bd, in.Type, sqlite.NullString(in.TableID), sqlite.NullString(in.CustomerID), sqlite.NullString(shift), actor.UserID,
		in.Guests, strings.TrimSpace(in.Notes), sqlite.NullString(idemKey), a.stamp(), a.stamp())
	if err != nil {
		return "", err
	}
	return id, recalc(ctx, tx, id, a.stamp())
}

// UpdateOrder changes type, table (transfer), customer, guests or notes.
func (a *App) UpdateOrder(ctx context.Context, actor Actor, id string, in OrderInput) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	if !orderTypes[in.Type] {
		return Order{}, invalid("نوع الطلب غير صحيح")
	}
	if in.Type != "dine_in" {
		in.TableID = ""
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		o, err := editable(ctx, tx, id)
		if err != nil {
			return err
		}
		if in.TableID != "" && in.TableID != o.TableID {
			var other string
			err := tx.QueryRowContext(ctx, `SELECT id FROM orders WHERE table_id = ? AND status IN ('open','held') AND id <> ?`, in.TableID, id).Scan(&other)
			if err == nil {
				return conflict("الطاولة مشغولة بطلب آخر، استخدم دمج الطلبات")
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE orders SET type=?, table_id=?, customer_id=?, guests=?, notes=? WHERE id=?`,
			in.Type, sqlite.NullString(in.TableID), sqlite.NullString(in.CustomerID), in.Guests, strings.TrimSpace(in.Notes), id); err != nil {
			return err
		}
		if o.TableID != in.TableID && o.TableID != "" {
			if err := a.audit(ctx, tx, actor, "order.transfer_table", "orders", id, map[string]string{"from": o.TableName, "to": in.TableID}); err != nil {
				return err
			}
		}
		return recalc(ctx, tx, id, a.stamp())
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, id)
}

type LineInput struct {
	ItemID      string             `json:"item_id"`
	Qty         money.Milli        `json:"qty_milli"`
	ModifierIDs []string           `json:"modifier_ids"`
	Notes       string             `json:"notes"`
	Course      int                `json:"course"`
	DiscKind    order.DiscountKind `json:"discount_kind"`
	DiscRate    money.BasisPoints  `json:"discount_rate_bp"`
	DiscAmount  money.Minor        `json:"discount_amount_minor"`
	ApproverPIN string             `json:"approver_pin"`
}

func (a *App) AddLine(ctx context.Context, actor Actor, orderID string, in LineInput) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	if in.Qty <= 0 {
		in.Qty = money.OneUnit
	}
	if in.Course <= 0 {
		in.Course = 1
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if err := a.requireLicensed(); err != nil {
			return err
		}
		if err := cashierShift(ctx, tx, actor); err != nil {
			return err
		}
		if _, err := editable(ctx, tx, orderID); err != nil {
			return err
		}
		if err := addLineTx(ctx, tx, orderID, in); err != nil {
			return err
		}
		return recalc(ctx, tx, orderID, a.stamp())
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

// addLineTx adds an item at its current menu price; the caller recalculates.
func addLineTx(ctx context.Context, tx *sql.Tx, orderID string, in LineInput) error {
	var name string
	var price money.Minor
	err := tx.QueryRowContext(ctx, `SELECT name, price_minor FROM items WHERE id = ? AND active = 1`, in.ItemID).Scan(&name, &price)
	if err != nil {
		return noRows(err, "الصنف")
	}
	mods, err := resolveModifiers(ctx, tx, in.ItemID, in.ModifierIDs)
	if err != nil {
		return err
	}
	var sort int
	tx.QueryRowContext(ctx, `SELECT coalesce(max(sort),0) + 1 FROM order_lines WHERE order_id = ?`, orderID).Scan(&sort)
	lineID := sqlite.NewID()
	if _, err := tx.ExecContext(ctx, `INSERT INTO order_lines(id, order_id, item_id, name, unit_price_minor, qty_milli, gross_minor, net_minor, notes, course, sort)
		VALUES (?,?,?,?,?,?,0,0,?,?,?)`, lineID, orderID, in.ItemID, name, price, in.Qty, strings.TrimSpace(in.Notes), in.Course, sort); err != nil {
		return err
	}
	for _, m := range mods {
		if _, err := tx.ExecContext(ctx, `INSERT INTO order_line_modifiers(id, line_id, modifier_id, name, price_minor) VALUES (?,?,?,?,?)`,
			sqlite.NewID(), lineID, m.ModifierID, m.Name, m.Price); err != nil {
			return err
		}
	}
	return nil
}

// resolveModifiers checks that the chosen modifiers belong to the item's
// groups, are active, and satisfy each group's min/max selection.
func resolveModifiers(ctx context.Context, q sqlite.Querier, itemID string, ids []string) ([]LineModifier, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT g.id, g.name, g.min_select, g.max_select, m.id, m.name, m.price_minor
		  FROM item_modifier_groups ig
		  JOIN modifier_groups g ON g.id = ig.group_id AND g.active = 1
		  JOIN modifiers m ON m.group_id = g.id AND m.active = 1
		 WHERE ig.item_id = ?`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type group struct {
		name     string
		min, max int
		picked   int
	}
	groups := map[string]*group{}
	byMod := map[string]LineModifier{}
	modGroup := map[string]string{}
	for rows.Next() {
		var gid, gname, mid, mname string
		var min, max int
		var price money.Minor
		if err := rows.Scan(&gid, &gname, &min, &max, &mid, &mname, &price); err != nil {
			return nil, err
		}
		if groups[gid] == nil {
			groups[gid] = &group{name: gname, min: min, max: max}
		}
		byMod[mid] = LineModifier{ModifierID: mid, Name: mname, Price: price}
		modGroup[mid] = gid
	}
	out := []LineModifier{}
	for _, id := range ids {
		m, ok := byMod[id]
		if !ok {
			return nil, invalid("إضافة غير متاحة لهذا الصنف")
		}
		groups[modGroup[id]].picked++
		out = append(out, m)
	}
	for _, g := range groups {
		if g.picked < g.min {
			return nil, invalid(fmt.Sprintf("اختر على الأقل %d من «%s»", g.min, g.name))
		}
		if g.max > 0 && g.picked > g.max {
			return nil, invalid(fmt.Sprintf("الحد الأقصى %d من «%s»", g.max, g.name))
		}
	}
	return out, nil
}

// UpdateLine changes quantity, notes or the line discount. Lines already
// sent to the kitchen can't change quantity; void them instead.
func (a *App) UpdateLine(ctx context.Context, actor Actor, orderID, lineID string, in LineInput) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		o, err := editable(ctx, tx, orderID)
		if err != nil {
			return err
		}
		l, ok := findLine(o, lineID)
		if !ok {
			return notFound("الصنف")
		}
		if in.Qty <= 0 {
			return invalid("الكمية يجب أن تكون أكبر من صفر")
		}
		if l.SentAt != "" && in.Qty != l.Qty {
			return conflict("الصنف أُرسل للمطبخ، لا يمكن تغيير الكمية. أضف صنفاً جديداً أو ألغِ هذا الصنف")
		}
		if in.DiscKind != l.DiscountKind || in.DiscRate != l.DiscountRate || in.DiscAmount != l.DiscountAmt {
			approver, err := a.approver(ctx, actor, rbac.OrderDiscount, in.ApproverPIN)
			if err != nil {
				return err
			}
			if err := a.audit(ctx, tx, approver, "order.line_discount", "orders", orderID,
				map[string]any{"line": l.Name, "kind": in.DiscKind, "rate": in.DiscRate, "amount": in.DiscAmount, "requested_by": actor.Name}); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE order_lines SET qty_milli=?, notes=?, discount_kind=?, discount_rate_bp=?, discount_amount_minor=? WHERE id=?`,
			in.Qty, strings.TrimSpace(in.Notes), string(in.DiscKind), in.DiscRate, in.DiscAmount, lineID); err != nil {
			return err
		}
		if err := recalc(ctx, tx, orderID, a.stamp()); err != nil {
			var e *Error
			if errors.As(err, &e) {
				return invalid("الخصم غير صحيح")
			}
			return err
		}
		return nil
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

func findLine(o Order, id string) (OrderLine, bool) {
	for _, l := range o.Lines {
		if l.ID == id && !l.Voided {
			return l, true
		}
	}
	return OrderLine{}, false
}

type VoidInput struct {
	Reason      string `json:"reason"`
	Waste       bool   `json:"waste"` // the kitchen already made it: book its ingredients as waste
	ApproverPIN string `json:"approver_pin"`
}

// RemoveLine deletes an unsent line, or voids a sent one (needs OrderVoid or
// a manager PIN, and a reason).
func (a *App) RemoveLine(ctx context.Context, actor Actor, orderID, lineID string, in VoidInput) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		o, err := editable(ctx, tx, orderID)
		if err != nil {
			return err
		}
		l, ok := findLine(o, lineID)
		if !ok {
			return notFound("الصنف")
		}
		if l.SentAt == "" {
			if _, err := tx.ExecContext(ctx, `DELETE FROM order_lines WHERE id = ?`, lineID); err != nil {
				return err
			}
			return recalc(ctx, tx, orderID, a.stamp())
		}
		if strings.TrimSpace(in.Reason) == "" {
			return invalid("سبب الإلغاء مطلوب")
		}
		approver, err := a.approver(ctx, actor, rbac.OrderVoid, in.ApproverPIN)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE order_lines SET voided_at=?, void_reason=?, voided_by=? WHERE id=?`,
			a.stamp(), strings.TrimSpace(in.Reason), approver.UserID, lineID); err != nil {
			return err
		}
		if in.Waste {
			if err := a.wasteLine(ctx, tx, approver, l, "إلغاء بعد التحضير: "+in.Reason); err != nil {
				return err
			}
		}
		if err := a.audit(ctx, tx, approver, "order.void_line", "orders", orderID,
			map[string]any{"line": l.Name, "qty": l.Qty, "amount": l.Net, "reason": in.Reason, "waste": in.Waste, "requested_by": actor.Name}); err != nil {
			return err
		}
		return recalc(ctx, tx, orderID, a.stamp())
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

type DiscountInput struct {
	Kind        order.DiscountKind `json:"kind"`
	Rate        money.BasisPoints  `json:"rate_bp"`
	Amount      money.Minor        `json:"amount_minor"`
	Reason      string             `json:"reason"`
	ApproverPIN string             `json:"approver_pin"`
}

func (a *App) SetOrderDiscount(ctx context.Context, actor Actor, orderID string, in DiscountInput) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	if in.Kind != order.DiscountNone && strings.TrimSpace(in.Reason) == "" {
		return Order{}, invalid("سبب الخصم مطلوب")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := editable(ctx, tx, orderID); err != nil {
			return err
		}
		approver, err := a.approver(ctx, actor, rbac.OrderDiscount, in.ApproverPIN)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE orders SET discount_kind=?, discount_rate_bp=?, discount_amount_minor=?, discount_reason=? WHERE id=?`,
			string(in.Kind), in.Rate, in.Amount, strings.TrimSpace(in.Reason), orderID); err != nil {
			return err
		}
		o, err := loadOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		var lines []order.Line
		for _, l := range o.Lines {
			if !l.Voided {
				lines = append(lines, order.Line{UnitPrice: l.Net, Qty: money.OneUnit})
			}
		}
		if len(lines) > 0 {
			if _, err := order.Price(lines, order.Discount{Kind: in.Kind, Rate: in.Rate, Amount: in.Amount}, order.PricingConfig{}); err != nil {
				return invalid("قيمة الخصم غير صحيحة")
			}
		}
		if err := a.audit(ctx, tx, approver, "order.discount", "orders", orderID,
			map[string]any{"kind": in.Kind, "rate": in.Rate, "amount": in.Amount, "reason": in.Reason, "requested_by": actor.Name}); err != nil {
			return err
		}
		return recalc(ctx, tx, orderID, a.stamp())
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

// ---- kitchen, hold, merge, void ----------------------------------------------

// SendToKitchen marks every unsent line as sent and returns the order.
func (a *App) SendToKitchen(ctx context.Context, actor Actor, orderID string) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := editable(ctx, tx, orderID); err != nil {
			return err
		}
		return sendPending(ctx, tx, orderID, a.stamp())
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

func sendPending(ctx context.Context, q sqlite.Querier, orderID, stamp string) error {
	_, err := q.ExecContext(ctx, `UPDATE order_lines SET kitchen_status='sent', sent_at=? WHERE order_id=? AND sent_at IS NULL AND voided_at IS NULL`, stamp, orderID)
	return err
}

func (a *App) SetHeld(ctx context.Context, actor Actor, orderID string, held bool) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	status := "open"
	if held {
		status = "held"
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := editable(ctx, tx, orderID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE orders SET status=?, updated_at=? WHERE id=?`, status, a.stamp(), orderID)
		return err
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

// MergeOrders moves every live line of source into target and voids source.
func (a *App) MergeOrders(ctx context.Context, actor Actor, targetID, sourceID string) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	if targetID == sourceID {
		return Order{}, invalid("لا يمكن دمج الطلب مع نفسه")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := editable(ctx, tx, targetID); err != nil {
			return err
		}
		src, err := editable(ctx, tx, sourceID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE order_lines SET order_id = ?, sort = sort + 1000 WHERE order_id = ? AND voided_at IS NULL`, targetID, sourceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE orders SET status='void', void_reason=?, closed_at=?, table_id=NULL WHERE id=?`,
			"دُمج في طلب آخر", a.stamp(), sourceID); err != nil {
			return err
		}
		if err := recalc(ctx, tx, sourceID, a.stamp()); err != nil {
			return err
		}
		if err := a.audit(ctx, tx, actor, "order.merge", "orders", targetID, map[string]any{"source": src.Number}); err != nil {
			return err
		}
		return recalc(ctx, tx, targetID, a.stamp())
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, targetID)
}

// VoidOrder cancels an unpaid order. An order with nothing sent to the
// kitchen can be cancelled by anyone who can sell; otherwise it needs
// OrderVoid or a manager PIN.
func (a *App) VoidOrder(ctx context.Context, actor Actor, orderID string, in VoidInput) error {
	if err := actor.require(rbac.POSSell); err != nil {
		return err
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		o, err := editable(ctx, tx, orderID)
		if err != nil {
			return err
		}
		sent := false
		for _, l := range o.Lines {
			sent = sent || (l.SentAt != "" && !l.Voided)
		}
		approver := actor
		if sent {
			if strings.TrimSpace(in.Reason) == "" {
				return invalid("سبب الإلغاء مطلوب")
			}
			if approver, err = a.approver(ctx, actor, rbac.OrderVoid, in.ApproverPIN); err != nil {
				return err
			}
			if in.Waste {
				for _, l := range o.Lines {
					if l.SentAt != "" && !l.Voided {
						if err := a.wasteLine(ctx, tx, approver, l, "إلغاء طلب: "+in.Reason); err != nil {
							return err
						}
					}
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE orders SET status='void', void_reason=?, closed_at=?, updated_at=? WHERE id=?`,
			strings.TrimSpace(in.Reason), a.stamp(), a.stamp(), orderID); err != nil {
			return err
		}
		return a.audit(ctx, tx, approver, "order.void", "orders", orderID,
			map[string]any{"number": o.Number, "total": o.Total, "reason": in.Reason, "sent": sent, "requested_by": actor.Name})
	})
}

// ---- payment ---------------------------------------------------------------

type Tender struct {
	Method    string      `json:"method"`
	Amount    money.Minor `json:"amount_minor"`   // applied to the bill
	Tendered  money.Minor `json:"tendered_minor"` // cash handed over (≥ amount)
	Reference string      `json:"reference"`
}

type PayResult struct {
	Order  Order       `json:"order"`
	Change money.Minor `json:"change_minor"`
}

// Pay settles an order with one or more tenders (split payment). It issues a
// gapless invoice number, sends anything unsent to the kitchen and deducts
// recipe ingredients from stock, all in one transaction.
func (a *App) Pay(ctx context.Context, actor Actor, orderID string, tenders []Tender, idemKey string) (PayResult, error) {
	if err := actor.require(rbac.POSPay); err != nil {
		return PayResult{}, err
	}
	var change money.Minor
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if idemKey != "" {
			var done string
			if tx.QueryRowContext(ctx, `SELECT order_id FROM payments WHERE idempotency_key = ?`, idemKey).Scan(&done); done == orderID {
				return nil // retry of a payment that already went through
			}
		}
		if err := a.requireLicensed(); err != nil {
			return err
		}
		shift, err := requireShift(ctx, tx, actor)
		if err != nil {
			return err
		}
		o, err := editable(ctx, tx, orderID)
		if err != nil {
			return err
		}
		live := 0
		for _, l := range o.Lines {
			if !l.Voided {
				live++
			}
		}
		if live == 0 {
			return invalid("الطلب فارغ")
		}
		s, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		var sum money.Minor
		for _, t := range tenders {
			m, ok := s.method(t.Method)
			if !ok {
				return invalid("طريقة دفع غير متاحة: " + t.Method)
			}
			if t.Amount <= 0 {
				return invalid("مبلغ الدفع يجب أن يكون أكبر من صفر")
			}
			if m.IsCash && t.Tendered > 0 {
				if t.Tendered < t.Amount {
					return invalid("المبلغ المستلم أقل من المطلوب")
				}
				change += t.Tendered - t.Amount
			}
			sum += t.Amount
		}
		if sum != o.Total {
			return invalid(fmt.Sprintf("مجموع الدفع (%s) لا يساوي إجمالي الطلب (%s)", sum, o.Total))
		}
		for i, t := range tenders {
			var tendered sql.NullInt64
			if t.Tendered > 0 {
				tendered = sql.NullInt64{Int64: int64(t.Tendered), Valid: true}
			}
			key := sql.NullString{}
			if idemKey != "" && i == 0 {
				key = sql.NullString{String: idemKey, Valid: true}
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO payments(id, order_id, shift_id, method, amount_minor, tendered_minor, reference, user_id, idempotency_key, created_at)
				VALUES (?,?,?,?,?,?,?,?,?,?)`, sqlite.NewID(), orderID, shift, t.Method, t.Amount, tendered, strings.TrimSpace(t.Reference), actor.UserID, key, a.stamp()); err != nil {
				return err
			}
		}
		number, err := nextInvoiceNumber(ctx, tx, actor.DeviceID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO invoices(id, order_id, number, device_id, issued_at) VALUES (?,?,?,?,?)`,
			sqlite.NewID(), orderID, number, actor.DeviceID, a.stamp()); err != nil {
			return err
		}
		if err := sendPending(ctx, tx, orderID, a.stamp()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE orders SET status='paid', shift_id=?, closed_at=?, updated_at=? WHERE id=?`,
			shift, a.stamp(), a.stamp(), orderID); err != nil {
			return err
		}
		if err := a.consumeOrder(ctx, tx, actor, o); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "order.pay", "orders", orderID, map[string]any{"number": o.Number, "invoice": number, "total": o.Total, "tenders": tenders})
	})
	if err != nil {
		return PayResult{}, err
	}
	o, err := loadOrder(ctx, a.db.Write, orderID)
	return PayResult{Order: o, Change: change}, err
}

func nextInvoiceNumber(ctx context.Context, tx *sql.Tx, deviceID string) (string, error) {
	var prefix string
	var n int
	err := tx.QueryRowContext(ctx, `UPDATE invoice_counters SET last_number = last_number + 1 WHERE device_id = ? RETURNING prefix, last_number`, deviceID).Scan(&prefix, &n)
	if err != nil {
		return "", noRows(err, "عداد الفواتير للجهاز")
	}
	return fmt.Sprintf("%s-%06d", prefix, n), nil
}

// ---- refunds ---------------------------------------------------------------

type RefundLineInput struct {
	LineID string      `json:"line_id"`
	Qty    money.Milli `json:"qty_milli"`
}

type RefundInput struct {
	Lines       []RefundLineInput `json:"lines"`
	Reason      string            `json:"reason"`
	Method      string            `json:"method"`
	Restock     bool              `json:"restock"` // put ingredients back (sealed items only)
	ApproverPIN string            `json:"approver_pin"`
}

// Refund returns part or all of a paid order. Each line's refund is its
// share of the order total (so discounts, service and tax are refunded
// proportionally) times the returned fraction of its quantity.
func (a *App) Refund(ctx context.Context, actor Actor, orderID string, in RefundInput, idemKey string) (Order, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return Order{}, err
	}
	if strings.TrimSpace(in.Reason) == "" || len(in.Lines) == 0 {
		return Order{}, invalid("اختر الأصناف المرتجعة واكتب السبب")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if idemKey != "" {
			var n int
			if tx.QueryRowContext(ctx, `SELECT count(*) FROM refunds WHERE idempotency_key = ?`, idemKey).Scan(&n); n > 0 {
				return nil
			}
		}
		approver, err := a.approver(ctx, actor, rbac.OrderRefund, in.ApproverPIN)
		if err != nil {
			return err
		}
		shift, err := requireShift(ctx, tx, actor)
		if err != nil {
			return err
		}
		o, err := loadOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		if o.Status != "paid" {
			return conflict("الإرجاع متاح للطلبات المدفوعة فقط")
		}
		s, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		if in.Method == "" {
			in.Method = "cash"
		}
		if _, ok := s.method(in.Method); !ok {
			return invalid("طريقة الرد غير متاحة")
		}
		var netSum money.Minor
		for _, l := range o.Lines {
			if !l.Voided {
				netSum += l.Net
			}
		}
		refundID := sqlite.NewID()
		var total money.Minor
		type returned struct {
			line   OrderLine
			qty    money.Milli
			amount money.Minor
		}
		var back []returned
		seen := map[string]bool{}
		for _, rl := range in.Lines {
			l, ok := findLine(o, rl.LineID)
			if !ok || seen[rl.LineID] {
				return notFound("الصنف")
			}
			seen[rl.LineID] = true
			if rl.Qty <= 0 || rl.Qty > l.Qty-l.RefundedQty {
				return invalid("كمية الإرجاع أكبر من المتاح لـ " + l.Name)
			}
			share := o.Total.Scale(int64(l.Net), int64(netSum))
			amount := share.Scale(int64(rl.Qty), int64(l.Qty))
			total += amount
			back = append(back, returned{l, rl.Qty, amount})
		}
		if total > o.Total-o.Refunded {
			total = o.Total - o.Refunded
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO refunds(id, invoice_id, shift_id, reason, total_minor, user_id, idempotency_key, created_at, restock, method)
			VALUES (?,?,?,?,?,?,?,?,?,?)`, refundID, o.InvoiceID, shift, strings.TrimSpace(in.Reason), total, approver.UserID,
			sqlite.NullString(idemKey), a.stamp(), sqlite.Int(in.Restock), in.Method); err != nil {
			return err
		}
		for _, r := range back {
			if _, err := tx.ExecContext(ctx, `INSERT INTO refund_lines(id, refund_id, order_line_id, qty_milli, amount_minor) VALUES (?,?,?,?,?)`,
				sqlite.NewID(), refundID, r.line.ID, r.qty, r.amount); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO payments(id, order_id, shift_id, method, amount_minor, reference, user_id, created_at)
			VALUES (?,?,?,?,?,?,?,?)`, sqlite.NewID(), orderID, shift, in.Method, -total, "مرتجع", actor.UserID, a.stamp()); err != nil {
			return err
		}
		if in.Restock {
			for _, r := range back {
				if err := a.restockLine(ctx, tx, approver, r.line, r.qty, refundID); err != nil {
					return err
				}
			}
		}
		return a.audit(ctx, tx, approver, "order.refund", "orders", orderID,
			map[string]any{"invoice": o.InvoiceNumber, "total": total, "reason": in.Reason, "restock": in.Restock, "requested_by": actor.Name})
	})
	if err != nil {
		return Order{}, err
	}
	return loadOrder(ctx, a.db.Write, orderID)
}

// ---- lists -----------------------------------------------------------------

type OrderSummary struct {
	ID            string      `json:"id"`
	Number        int         `json:"number"`
	BusinessDate  string      `json:"business_date"`
	Type          string      `json:"type"`
	Status        string      `json:"status"`
	TableID       string      `json:"table_id"`
	TableName     string      `json:"table_name"`
	CustomerName  string      `json:"customer_name"`
	UserName      string      `json:"user_name"`
	Guests        int         `json:"guests"`
	Items         int         `json:"items"`
	Total         money.Minor `json:"total_minor"`
	Refunded      money.Minor `json:"refunded_minor"`
	InvoiceNumber string      `json:"invoice_number"`
	Pending       int         `json:"pending_lines"` // not yet sent to kitchen
	CreatedAt     string      `json:"created_at"`
	ClosedAt      string      `json:"closed_at"`
}

const summaryCols = `o.id, o.number, o.business_date, o.type, o.status, coalesce(o.table_id,''), coalesce(t.name,''),
	coalesce(c.name,''), u.full_name, o.guests,
	(SELECT count(*) FROM order_lines l WHERE l.order_id = o.id AND l.voided_at IS NULL),
	o.total_minor,
	(SELECT coalesce(sum(r.total_minor),0) FROM refunds r WHERE r.invoice_id = i.id),
	coalesce(i.number,''),
	(SELECT count(*) FROM order_lines l WHERE l.order_id = o.id AND l.voided_at IS NULL AND l.sent_at IS NULL),
	o.created_at, coalesce(o.closed_at,'')`

const summaryFrom = ` FROM orders o JOIN users u ON u.id = o.user_id
	LEFT JOIN dining_tables t ON t.id = o.table_id
	LEFT JOIN customers c ON c.id = o.customer_id
	LEFT JOIN invoices i ON i.order_id = o.id`

func scanSummaries(rows *sql.Rows) ([]OrderSummary, error) {
	defer rows.Close()
	out := []OrderSummary{}
	for rows.Next() {
		var s OrderSummary
		if err := rows.Scan(&s.ID, &s.Number, &s.BusinessDate, &s.Type, &s.Status, &s.TableID, &s.TableName, &s.CustomerName,
			&s.UserName, &s.Guests, &s.Items, &s.Total, &s.Refunded, &s.InvoiceNumber, &s.Pending, &s.CreatedAt, &s.ClosedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// OpenOrders lists every unpaid order (needed by all staff for tables).
func (a *App) OpenOrders(ctx context.Context, actor Actor) ([]OrderSummary, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT `+summaryCols+summaryFrom+` WHERE o.status IN ('open','held') ORDER BY o.created_at`)
	if err != nil {
		return nil, err
	}
	return scanSummaries(rows)
}

type OrderFilter struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Status string `json:"status"`
	Type   string `json:"type"`
	Search string `json:"search"` // order number, invoice number, customer
}

func (a *App) OrderHistory(ctx context.Context, actor Actor, f OrderFilter) ([]OrderSummary, error) {
	if !actor.Can(rbac.OrderViewAll) && !actor.Can(rbac.POSPay) {
		return nil, errForbidden
	}
	q := `SELECT ` + summaryCols + summaryFrom + ` WHERE o.business_date BETWEEN ? AND ? AND o.status IN ('paid','void')`
	args := []any{f.From, f.To}
	if !actor.Can(rbac.OrderViewAll) {
		q += ` AND o.user_id = ?`
		args = append(args, actor.UserID)
	}
	if f.Status != "" {
		q += ` AND o.status = ?`
		args = append(args, f.Status)
	}
	if f.Type != "" {
		q += ` AND o.type = ?`
		args = append(args, f.Type)
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		q += ` AND (cast(o.number AS TEXT) = ? OR i.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`
		args = append(args, s, "%"+s, "%"+s+"%", "%"+s+"%")
	}
	rows, err := a.db.Read.QueryContext(ctx, q+` ORDER BY o.created_at DESC LIMIT 1000`, args...)
	if err != nil {
		return nil, err
	}
	return scanSummaries(rows)
}
