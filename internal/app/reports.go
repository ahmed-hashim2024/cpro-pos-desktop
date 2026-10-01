package app

import (
	"context"
	"database/sql"
	"time"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

type SalesSummary struct {
	Orders       int         `json:"orders"`
	Guests       int         `json:"guests"`
	Gross        money.Minor `json:"gross_minor"` // before discounts
	Discounts    money.Minor `json:"discounts_minor"`
	Service      money.Minor `json:"service_minor"`
	Tax          money.Minor `json:"tax_minor"`
	DeliveryFees money.Minor `json:"delivery_fees_minor"`
	Sales        money.Minor `json:"sales_minor"` // what customers paid
	Refunds      money.Minor `json:"refunds_minor"`
	NetSales     money.Minor `json:"net_sales_minor"` // sales - refunds
	AvgTicket    money.Minor `json:"avg_ticket_minor"`
	Cost         money.Minor `json:"cost_minor"` // cost of goods sold from recipes
	GrossProfit  money.Minor `json:"gross_profit_minor"`
	MarginBP     int64       `json:"margin_bp"`
	VoidOrders   int         `json:"void_orders"`
	VoidValue    money.Minor `json:"void_value_minor"`
	VoidLines    int         `json:"void_lines"`
	WasteCost    money.Minor `json:"waste_cost_minor"`
}

type Bucket struct {
	Key    string      `json:"key"`
	Label  string      `json:"label"`
	Orders int         `json:"orders"`
	Qty    money.Milli `json:"qty_milli,omitempty"`
	Amount money.Minor `json:"amount_minor"`
}

type ItemSales struct {
	ItemID   string      `json:"item_id"`
	Name     string      `json:"name"`
	Category string      `json:"category"`
	Qty      money.Milli `json:"qty_milli"`
	Net      money.Minor `json:"net_minor"`
	Cost     money.Minor `json:"cost_minor"`
	Profit   money.Minor `json:"profit_minor"`
	MarginBP int64       `json:"margin_bp"`
}

type VoidRow struct {
	Number int         `json:"number"`
	What   string      `json:"what"`
	Amount money.Minor `json:"amount_minor"`
	Reason string      `json:"reason"`
	User   string      `json:"user_name"`
	At     string      `json:"at"`
}

type SalesReport struct {
	From       string       `json:"from"`
	To         string       `json:"to"`
	Summary    SalesSummary `json:"summary"`
	ByDay      []Bucket     `json:"by_day"`
	ByHour     []Bucket     `json:"by_hour"`
	ByType     []Bucket     `json:"by_type"`
	ByMethod   []Bucket     `json:"by_method"`
	ByCashier  []Bucket     `json:"by_cashier"`
	ByCategory []Bucket     `json:"by_category"`
	Items      []ItemSales  `json:"items"`
	Voids      []VoidRow    `json:"voids"`
}

func margin(profit, sales money.Minor) int64 {
	if sales <= 0 {
		return 0
	}
	return int64(profit) * 10000 / int64(sales)
}

func (a *App) SalesReport(ctx context.Context, actor Actor, from, to string) (SalesReport, error) {
	if err := actor.require(rbac.ReportsView); err != nil {
		return SalesReport{}, err
	}
	q := a.db.Read
	s, err := loadSettings(ctx, q)
	if err != nil {
		return SalesReport{}, err
	}
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return SalesReport{}, err
	}
	r := SalesReport{From: from, To: to}
	sum := &r.Summary
	paid := `o.status = 'paid' AND o.business_date BETWEEN ? AND ?`

	err = q.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(guests),0), coalesce(sum(subtotal_minor),0),
		coalesce(sum(line_discounts_minor + order_discount_minor),0), coalesce(sum(service_minor),0), coalesce(sum(tax_minor),0),
		coalesce(sum(delivery_fee_minor),0), coalesce(sum(total_minor),0) FROM orders o WHERE `+paid, from, to).
		Scan(&sum.Orders, &sum.Guests, &sum.Gross, &sum.Discounts, &sum.Service, &sum.Tax, &sum.DeliveryFees, &sum.Sales)
	if err != nil {
		return r, err
	}
	q.QueryRowContext(ctx, `SELECT coalesce(sum(total_minor),0) FROM refunds WHERE created_at >= ? AND created_at < ?`, start, end).Scan(&sum.Refunds)
	q.QueryRowContext(ctx, `SELECT coalesce(sum(l.cost_minor),0) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.voided_at IS NULL AND `+paid, from, to).Scan(&sum.Cost)
	q.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(total_minor),0) FROM orders o WHERE o.status = 'void' AND o.business_date BETWEEN ? AND ?`, from, to).Scan(&sum.VoidOrders, &sum.VoidValue)
	q.QueryRowContext(ctx, `SELECT count(*) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.voided_at IS NOT NULL AND o.business_date BETWEEN ? AND ?`, from, to).Scan(&sum.VoidLines)
	q.QueryRowContext(ctx, `SELECT coalesce(sum(cost_minor),0) FROM waste_entries WHERE created_at >= ? AND created_at < ?`, start, end).Scan(&sum.WasteCost)
	sum.NetSales = sum.Sales - sum.Refunds
	if sum.Orders > 0 {
		sum.AvgTicket = sum.Sales.Scale(1, int64(sum.Orders))
	}
	// Profit is on food revenue: net sales minus tax and delivery fees, minus cost.
	revenue := sum.NetSales - sum.Tax - sum.DeliveryFees
	sum.GrossProfit = revenue - sum.Cost
	sum.MarginBP = margin(sum.GrossProfit, revenue)

	bucket := func(query string, args ...any) ([]Bucket, error) {
		rows, err := q.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := []Bucket{}
		for rows.Next() {
			var b Bucket
			if err := rows.Scan(&b.Key, &b.Label, &b.Orders, &b.Amount); err != nil {
				return nil, err
			}
			out = append(out, b)
		}
		return out, rows.Err()
	}
	if r.ByDay, err = bucket(`SELECT business_date, business_date, count(*), sum(total_minor) FROM orders o WHERE `+paid+` GROUP BY business_date ORDER BY business_date`, from, to); err != nil {
		return r, err
	}
	if r.ByType, err = bucket(`SELECT type, type, count(*), sum(total_minor) FROM orders o WHERE `+paid+` GROUP BY type ORDER BY 4 DESC`, from, to); err != nil {
		return r, err
	}
	if r.ByCashier, err = bucket(`SELECT u.id, u.full_name, count(*), sum(o.total_minor) FROM orders o JOIN payments p ON p.order_id = o.id AND p.amount_minor > 0
		JOIN users u ON u.id = p.user_id WHERE `+paid+` GROUP BY u.id ORDER BY 4 DESC`, from, to); err != nil {
		return r, err
	}
	if r.ByMethod, err = bucket(`SELECT p.method, p.method, count(*), sum(p.amount_minor) FROM payments p JOIN orders o ON o.id = p.order_id
		WHERE p.created_at >= ? AND p.created_at < ? GROUP BY p.method ORDER BY 4 DESC`, start, end); err != nil {
		return r, err
	}
	for i, b := range r.ByMethod {
		if m, ok := s.method(b.Key); ok {
			r.ByMethod[i].Label = m.Name
		}
	}

	// Category and item breakdown from line net amounts.
	rows, err := q.QueryContext(ctx, `SELECT l.item_id, l.name, coalesce(c.name,'بدون قسم'), sum(l.qty_milli), sum(l.net_minor), sum(l.cost_minor)
		FROM order_lines l JOIN orders o ON o.id = l.order_id LEFT JOIN items i ON i.id = l.item_id LEFT JOIN categories c ON c.id = i.category_id
		WHERE l.voided_at IS NULL AND `+paid+` GROUP BY l.item_id ORDER BY 5 DESC`, from, to)
	if err != nil {
		return r, err
	}
	cats := map[string]*Bucket{}
	var catOrder []string
	r.Items = []ItemSales{}
	for rows.Next() {
		var it ItemSales
		if err := rows.Scan(&it.ItemID, &it.Name, &it.Category, &it.Qty, &it.Net, &it.Cost); err != nil {
			rows.Close()
			return r, err
		}
		it.Profit = it.Net - it.Cost
		it.MarginBP = margin(it.Profit, it.Net)
		r.Items = append(r.Items, it)
		if cats[it.Category] == nil {
			cats[it.Category] = &Bucket{Key: it.Category, Label: it.Category}
			catOrder = append(catOrder, it.Category)
		}
		cats[it.Category].Qty += it.Qty
		cats[it.Category].Amount += it.Net
	}
	rows.Close()
	r.ByCategory = []Bucket{}
	for _, c := range catOrder {
		r.ByCategory = append(r.ByCategory, *cats[c])
	}

	// Hour of day in local time.
	rows, err = q.QueryContext(ctx, `SELECT closed_at, total_minor FROM orders o WHERE `+paid, from, to)
	if err != nil {
		return r, err
	}
	hours := make([]Bucket, 24)
	for h := range hours {
		hours[h] = Bucket{Key: itoa2(h), Label: itoa2(h) + ":00"}
	}
	for rows.Next() {
		var at string
		var total money.Minor
		if err := rows.Scan(&at, &total); err != nil {
			rows.Close()
			return r, err
		}
		h := sqlite.ParseTime(at).In(time.Local).Hour()
		hours[h].Orders++
		hours[h].Amount += total
	}
	rows.Close()
	r.ByHour = []Bucket{}
	for _, b := range hours {
		if b.Orders > 0 {
			r.ByHour = append(r.ByHour, b)
		}
	}

	// Voided orders and lines, for loss review.
	rows, err = q.QueryContext(ctx, `
		SELECT o.number, 'طلب كامل', o.total_minor, o.void_reason, u.full_name, coalesce(o.closed_at, o.updated_at)
		  FROM orders o JOIN users u ON u.id = o.user_id
		 WHERE o.status = 'void' AND o.void_reason <> 'دُمج في طلب آخر' AND o.business_date BETWEEN ? AND ?
		UNION ALL
		SELECT o.number, l.name, l.net_minor, l.void_reason, coalesce(v.full_name,''), l.voided_at
		  FROM order_lines l JOIN orders o ON o.id = l.order_id LEFT JOIN users v ON v.id = l.voided_by
		 WHERE l.voided_at IS NOT NULL AND o.business_date BETWEEN ? AND ?
		ORDER BY 6 DESC LIMIT 500`, from, to, from, to)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	r.Voids = []VoidRow{}
	for rows.Next() {
		var v VoidRow
		if err := rows.Scan(&v.Number, &v.What, &v.Amount, &v.Reason, &v.User, &v.At); err != nil {
			return r, err
		}
		r.Voids = append(r.Voids, v)
	}
	return r, rows.Err()
}

func itoa2(n int) string {
	return string([]byte{byte('0' + n/10), byte('0' + n%10)})
}

// ---- consumption -------------------------------------------------------------

// ConsumptionRow traces one ingredient through a period:
// opening + purchases − sales use − waste ± refunds ± corrections = closing.
// SalesUse is the theoretical (recipe) usage; CountVariance is what the
// stock counts found on top of it (negative = missing stock).
type ConsumptionRow struct {
	IngredientID  string      `json:"ingredient_id"`
	Name          string      `json:"name"`
	Unit          string      `json:"unit"`
	Opening       money.Milli `json:"opening_milli"`
	Purchased     money.Milli `json:"purchased_milli"`
	SalesUse      money.Milli `json:"sales_use_milli"`
	Waste         money.Milli `json:"waste_milli"`
	Returned      money.Milli `json:"returned_milli"`
	Adjustments   money.Milli `json:"adjustments_milli"`
	CountVariance money.Milli `json:"count_variance_milli"`
	Closing       money.Milli `json:"closing_milli"`
	ActualUse     money.Milli `json:"actual_use_milli"` // opening + purchased − closing
	Cost          money.Minor `json:"cost_minor"`
	SalesUseValue money.Minor `json:"sales_use_value_minor"`
	WasteValue    money.Minor `json:"waste_value_minor"`
	VarianceValue money.Minor `json:"variance_value_minor"`
	PurchaseValue money.Minor `json:"purchase_value_minor"`
}

type ConsumptionReport struct {
	From  string           `json:"from"`
	To    string           `json:"to"`
	Rows  []ConsumptionRow `json:"rows"`
	Total ConsumptionRow   `json:"total"` // value columns only
}

func (a *App) ConsumptionReport(ctx context.Context, actor Actor, from, to string) (ConsumptionReport, error) {
	if !actor.Can(rbac.ReportsView) && !actor.Can(rbac.InventoryView) {
		return ConsumptionReport{}, errForbidden
	}
	q := a.db.Read
	s, err := loadSettings(ctx, q)
	if err != nil {
		return ConsumptionReport{}, err
	}
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return ConsumptionReport{}, err
	}
	rows, err := q.QueryContext(ctx, `
		SELECT g.id, g.name, g.unit, g.stock_milli, g.cost_minor,
		       coalesce(sum(CASE WHEN m.created_at >= ? THEN m.qty_milli END),0)                                      AS since_start,
		       coalesce(sum(CASE WHEN m.created_at >= ? THEN m.qty_milli END),0)                                      AS since_end,
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind IN ('purchase','opening') THEN m.qty_milli END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'purchase' THEN m.qty_milli * m.cost_minor / 1000 END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'sale' THEN -m.qty_milli END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'sale' THEN -m.qty_milli * m.cost_minor / 1000 END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'waste' THEN -m.qty_milli END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'waste' THEN -m.qty_milli * m.cost_minor / 1000 END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'refund' THEN m.qty_milli END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'adjustment' THEN m.qty_milli END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind = 'count' THEN m.qty_milli END),0),
		       coalesce(sum(CASE WHEN m.created_at >= ? AND m.created_at < ? AND m.kind IN ('count','adjustment') THEN m.qty_milli * m.cost_minor / 1000 END),0)
		  FROM ingredients g LEFT JOIN stock_movements m ON m.ingredient_id = g.id
		 GROUP BY g.id ORDER BY g.name`,
		start, end, start, end, start, end, start, end, start, end, start, end, start, end, start, end, start, end, start, end, start, end)
	if err != nil {
		return ConsumptionReport{}, err
	}
	defer rows.Close()
	rep := ConsumptionReport{From: from, To: to, Rows: []ConsumptionRow{}}
	for rows.Next() {
		var c ConsumptionRow
		var stock, sinceStart, sinceEnd money.Milli
		if err := rows.Scan(&c.IngredientID, &c.Name, &c.Unit, &stock, &c.Cost, &sinceStart, &sinceEnd,
			&c.Purchased, &c.PurchaseValue, &c.SalesUse, &c.SalesUseValue, &c.Waste, &c.WasteValue,
			&c.Returned, &c.Adjustments, &c.CountVariance, &c.VarianceValue); err != nil {
			return rep, err
		}
		c.Opening = stock - sinceStart
		c.Closing = stock - sinceEnd
		c.ActualUse = c.Opening + c.Purchased - c.Closing
		if c.Opening == 0 && c.Purchased == 0 && c.SalesUse == 0 && c.Waste == 0 && c.Closing == 0 && c.CountVariance == 0 && c.Adjustments == 0 {
			continue
		}
		rep.Rows = append(rep.Rows, c)
		rep.Total.PurchaseValue += c.PurchaseValue
		rep.Total.SalesUseValue += c.SalesUseValue
		rep.Total.WasteValue += c.WasteValue
		rep.Total.VarianceValue += c.VarianceValue
	}
	return rep, rows.Err()
}

// ---- dashboard -------------------------------------------------------------

type Dashboard struct {
	BusinessDate string       `json:"business_date"`
	Today        SalesSummary `json:"today"`
	OpenOrders   int          `json:"open_orders"`
	OpenValue    money.Minor  `json:"open_value_minor"`
	OpenTables   int          `json:"open_tables"`
	Tables       int          `json:"tables"`
	OpenShifts   int          `json:"open_shifts"`
	LowStock     []Ingredient `json:"low_stock"`
	TopItems     []ItemSales  `json:"top_items"`
	ByHour       []Bucket     `json:"by_hour"`
	Last7Days    []Bucket     `json:"last_7_days"`
}

func (a *App) Dashboard(ctx context.Context, actor Actor) (Dashboard, error) {
	if err := actor.require(rbac.ReportsView); err != nil {
		return Dashboard{}, err
	}
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return Dashboard{}, err
	}
	today := businessDate(a.now(), s.DayStartHour)
	weekAgo := businessDate(a.now().AddDate(0, 0, -6), s.DayStartHour)
	rep, err := a.SalesReport(ctx, actor, today, today)
	if err != nil {
		return Dashboard{}, err
	}
	d := Dashboard{BusinessDate: today, Today: rep.Summary, ByHour: rep.ByHour, TopItems: rep.Items}
	if len(d.TopItems) > 8 {
		d.TopItems = d.TopItems[:8]
	}
	q := a.db.Read
	q.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(total_minor),0), count(DISTINCT table_id) FROM orders WHERE status IN ('open','held')`).Scan(&d.OpenOrders, &d.OpenValue, &d.OpenTables)
	q.QueryRowContext(ctx, `SELECT count(*) FROM dining_tables WHERE active = 1`).Scan(&d.Tables)
	q.QueryRowContext(ctx, `SELECT count(*) FROM shifts WHERE status = 'open'`).Scan(&d.OpenShifts)
	week, err := a.SalesReport(ctx, actor, weekAgo, today)
	if err != nil {
		return d, err
	}
	d.Last7Days = week.ByDay
	all, err := a.Ingredients(ctx, Actor{Role: rbac.Owner})
	if err != nil && err != sql.ErrNoRows {
		return d, err
	}
	d.LowStock = []Ingredient{}
	for _, g := range all {
		if g.Low {
			d.LowStock = append(d.LowStock, g)
		}
	}
	return d, nil
}
