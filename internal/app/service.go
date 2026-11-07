package app

import (
	"context"
	"math"
	"time"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// ---- the bill on the guest's phone --------------------------------------------------

// GuestBillLine is one dish on the table's bill as the guest sees it.
type GuestBillLine struct {
	Name      string      `json:"name"`
	Qty       money.Milli `json:"qty_milli"`
	Modifiers []string    `json:"modifiers"`
	Total     money.Minor `json:"total_minor"`
}

// GuestBill is what the table owes right now: every open order on it
// (usually one) with the restaurant's own totals, so the number matches the
// receipt the waiter brings.
type GuestBill struct {
	Table     string          `json:"table"`
	Lines     []GuestBillLine `json:"lines"`
	Subtotal  money.Minor     `json:"subtotal_minor"`
	Discounts money.Minor     `json:"discounts_minor"`
	Service   money.Minor     `json:"service_minor"`
	Tax       money.Minor     `json:"tax_minor"`
	Total     money.Minor     `json:"total_minor"`
	Paid      money.Minor     `json:"paid_minor"`
	Due       money.Minor     `json:"due_minor"`
}

// PublicBill is the bill behind a table's QR code. Only the table's own
// code shows it: the hall QR lets anyone pick any table, so it never does.
func (a *App) PublicBill(ctx context.Context, tableToken string) (GuestBill, error) {
	b := GuestBill{Lines: []GuestBillLine{}}
	if !a.menuOpen() {
		return b, errMenuClosed
	}
	tableID, name, err := tableByToken(ctx, a.db.Read, tableToken)
	if err != nil {
		return b, err
	}
	b.Table = name
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id FROM orders WHERE table_id = ? AND status IN ('open','held') ORDER BY created_at`, tableID)
	if err != nil {
		return b, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return b, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return b, err
	}
	for _, id := range ids {
		o, err := loadOrder(ctx, a.db.Read, id)
		if err != nil {
			return b, err
		}
		for _, l := range o.Lines {
			if l.Voided {
				continue
			}
			gl := GuestBillLine{Name: l.Name, Qty: l.Qty, Total: l.Net, Modifiers: []string{}}
			for _, m := range l.Modifiers {
				gl.Modifiers = append(gl.Modifiers, m.Name)
			}
			b.Lines = append(b.Lines, gl)
		}
		b.Subtotal += o.Subtotal
		b.Discounts += o.LineDiscounts + o.OrderDiscount
		b.Service += o.Service
		b.Tax += o.Tax
		b.Total += o.Total
		b.Paid += o.Paid
	}
	b.Due = max(b.Total-b.Paid, 0)
	return b, nil
}

// ---- how fast the hall answers calls --------------------------------------------------

type ServiceKindStats struct {
	Kind       string  `json:"kind"`
	Calls      int     `json:"calls"`
	Answered   int     `json:"answered"`
	AvgMinutes float64 `json:"avg_minutes"` // from the call to «done», answered calls only
	MaxMinutes float64 `json:"max_minutes"`
}

type ServiceStaffStats struct {
	UserName   string  `json:"user_name"`
	Answered   int     `json:"answered"`
	AvgMinutes float64 `json:"avg_minutes"`
}

type ServiceReport struct {
	From       string              `json:"from"`
	To         string              `json:"to"`
	Calls      int                 `json:"calls"`
	Answered   int                 `json:"answered"`
	AvgMinutes float64             `json:"avg_minutes"`
	ByKind     []ServiceKindStats  `json:"by_kind"`
	ByStaff    []ServiceStaffStats `json:"by_staff"`
	ByHour     []Bucket            `json:"by_hour"` // Orders = calls in that hour
}

// minutes between created_at and done_at, in SQL.
const callMinutes = `(julianday(s.done_at) - julianday(s.created_at)) * 1440`

func round1(f float64) float64 { return math.Round(f*10) / 10 }

// ServiceReport shows the calls from the tables in a period: how many of each
// reason, how long they waited, and who answered them.
func (a *App) ServiceReport(ctx context.Context, actor Actor, from, to string) (ServiceReport, error) {
	r := ServiceReport{From: from, To: to, ByKind: []ServiceKindStats{}, ByStaff: []ServiceStaffStats{}, ByHour: []Bucket{}}
	if err := actor.require(rbac.ReportsView); err != nil {
		return r, err
	}
	q := a.db.Read
	s, err := loadSettings(ctx, q)
	if err != nil {
		return r, err
	}
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return r, err
	}
	in := ` FROM service_requests s WHERE s.created_at >= ? AND s.created_at < ?`

	rows, err := q.QueryContext(ctx, `SELECT s.kind, count(*), count(s.done_at), coalesce(avg(`+callMinutes+`),0), coalesce(max(`+callMinutes+`),0)`+in+
		` GROUP BY s.kind ORDER BY count(*) DESC`, start, end)
	if err != nil {
		return r, err
	}
	var waited float64
	for rows.Next() {
		var k ServiceKindStats
		if err := rows.Scan(&k.Kind, &k.Calls, &k.Answered, &k.AvgMinutes, &k.MaxMinutes); err != nil {
			rows.Close()
			return r, err
		}
		r.Calls += k.Calls
		r.Answered += k.Answered
		waited += k.AvgMinutes * float64(k.Answered)
		k.AvgMinutes, k.MaxMinutes = round1(k.AvgMinutes), round1(k.MaxMinutes)
		r.ByKind = append(r.ByKind, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return r, err
	}
	if r.Answered > 0 {
		r.AvgMinutes = round1(waited / float64(r.Answered))
	}

	rows, err = q.QueryContext(ctx, `SELECT coalesce(u.full_name,''), count(*), avg(`+callMinutes+`)
		FROM service_requests s JOIN users u ON u.id = s.done_by
		WHERE s.done_at IS NOT NULL AND s.created_at >= ? AND s.created_at < ? GROUP BY s.done_by ORDER BY 3`, start, end)
	if err != nil {
		return r, err
	}
	for rows.Next() {
		var st ServiceStaffStats
		if err := rows.Scan(&st.UserName, &st.Answered, &st.AvgMinutes); err != nil {
			rows.Close()
			return r, err
		}
		st.AvgMinutes = round1(st.AvgMinutes)
		r.ByStaff = append(r.ByStaff, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return r, err
	}

	// Local hour of each call, to see when the hall gets busy.
	rows, err = q.QueryContext(ctx, `SELECT s.created_at`+in, start, end)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	hours := make([]Bucket, 24)
	for h := range hours {
		hours[h] = Bucket{Key: itoa2(h), Label: itoa2(h) + ":00"}
	}
	for rows.Next() {
		var at string
		if err := rows.Scan(&at); err != nil {
			return r, err
		}
		hours[sqlite.ParseTime(at).In(time.Local).Hour()].Orders++
	}
	for _, b := range hours {
		if b.Orders > 0 {
			r.ByHour = append(r.ByHour, b)
		}
	}
	return r, rows.Err()
}
