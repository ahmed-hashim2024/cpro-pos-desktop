package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

type Shift struct {
	ID           string      `json:"id"`
	UserID       string      `json:"user_id"`
	UserName     string      `json:"user_name"`
	DeviceID     string      `json:"device_id"`
	DeviceName   string      `json:"device_name"`
	Status       string      `json:"status"`
	OpeningFloat money.Minor `json:"opening_float_minor"`
	ExpectedCash *int64      `json:"expected_cash_minor"`
	CountedCash  *int64      `json:"counted_cash_minor"`
	OpenedAt     string      `json:"opened_at"`
	ClosedAt     string      `json:"closed_at"`
}

// ShiftReport is the X report (while open) or Z report (once closed).
type ShiftReport struct {
	Shift         Shift          `json:"shift"`
	Orders        int            `json:"orders"`
	Sales         money.Minor    `json:"sales_minor"` // paid order totals
	Discounts     money.Minor    `json:"discounts_minor"`
	Service       money.Minor    `json:"service_minor"`
	Tax           money.Minor    `json:"tax_minor"`
	Refunds       money.Minor    `json:"refunds_minor"`
	Voids         int            `json:"voided_orders"`
	ByMethod      []MethodTotal  `json:"by_method"`
	CashIn        money.Minor    `json:"cash_in_minor"`
	CashOut       money.Minor    `json:"cash_out_minor"`
	CashSales     money.Minor    `json:"cash_sales_minor"` // cash payments net of change and cash refunds
	ExpectedCash  money.Minor    `json:"expected_cash_minor"`
	Difference    *int64         `json:"difference_minor"` // counted - expected, once closed
	CashMovements []CashMovement `json:"cash_movements"`
}

type MethodTotal struct {
	Method string      `json:"method"`
	Name   string      `json:"name"`
	Count  int         `json:"count"`
	Amount money.Minor `json:"amount_minor"`
}

type CashMovement struct {
	ID     string      `json:"id"`
	Kind   string      `json:"kind"`
	Amount money.Minor `json:"amount_minor"`
	Reason string      `json:"reason"`
	User   string      `json:"user_name"`
	At     string      `json:"created_at"`
}

const shiftCols = `s.id, s.user_id, u.full_name, s.device_id, d.name, s.status, s.opening_float_minor,
	s.expected_cash_minor, s.counted_cash_minor, s.opened_at, coalesce(s.closed_at,'')`

func scanShift(r interface{ Scan(...any) error }) (Shift, error) {
	var s Shift
	var exp, cnt sql.NullInt64
	err := r.Scan(&s.ID, &s.UserID, &s.UserName, &s.DeviceID, &s.DeviceName, &s.Status, &s.OpeningFloat, &exp, &cnt, &s.OpenedAt, &s.ClosedAt)
	if exp.Valid {
		s.ExpectedCash = &exp.Int64
	}
	if cnt.Valid {
		s.CountedCash = &cnt.Int64
	}
	return s, err
}

// openShift returns the actor's open shift on their device, if any.
func openShift(ctx context.Context, q sqlite.Querier, actor Actor) (string, error) {
	var id string
	err := q.QueryRowContext(ctx, `SELECT id FROM shifts WHERE user_id = ? AND device_id = ? AND status = 'open'`, actor.UserID, actor.DeviceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func requireShift(ctx context.Context, q sqlite.Querier, actor Actor) (string, error) {
	id, err := openShift(ctx, q, actor)
	if err == nil && id == "" {
		return "", &Error{CodeConflict, "يجب فتح وردية أولاً"}
	}
	return id, err
}

// CurrentShift returns the actor's open shift or nil.
func (a *App) CurrentShift(ctx context.Context, actor Actor) (*Shift, error) {
	s, err := scanShift(a.db.Read.QueryRowContext(ctx,
		`SELECT `+shiftCols+` FROM shifts s JOIN users u ON u.id = s.user_id JOIN devices d ON d.id = s.device_id
		  WHERE s.user_id = ? AND s.device_id = ? AND s.status = 'open'`, actor.UserID, actor.DeviceID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

func (a *App) OpenShift(ctx context.Context, actor Actor, float money.Minor) (string, error) {
	if err := actor.require(rbac.ShiftCash); err != nil {
		return "", err
	}
	if float < 0 {
		return "", invalid("رصيد الافتتاح غير صحيح")
	}
	id := sqlite.NewID()
	err := a.tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO shifts(id, user_id, device_id, status, opening_float_minor, opened_at) VALUES (?,?,?,'open',?,?)`,
			id, actor.UserID, actor.DeviceID, float, a.stamp())
		if isUnique(err) {
			return conflict("لديك وردية مفتوحة بالفعل على هذا الجهاز")
		}
		if err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "shift.open", "shifts", id, map[string]any{"float": float})
	})
	return id, err
}

func (a *App) CashMove(ctx context.Context, actor Actor, kind string, amount money.Minor, reason string) error {
	if err := actor.require(rbac.ShiftCash); err != nil {
		return err
	}
	if kind != "in" && kind != "out" {
		return invalid("نوع الحركة غير صحيح")
	}
	if amount <= 0 || strings.TrimSpace(reason) == "" {
		return invalid("المبلغ والسبب مطلوبان")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		shift, err := requireShift(ctx, tx, actor)
		if err != nil {
			return err
		}
		id := sqlite.NewID()
		if _, err := tx.ExecContext(ctx, `INSERT INTO cash_movements(id, shift_id, kind, amount_minor, reason, user_id, created_at) VALUES (?,?,?,?,?,?,?)`,
			id, shift, kind, amount, strings.TrimSpace(reason), actor.UserID, a.stamp()); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "shift.cash_"+kind, "shifts", shift, map[string]any{"amount": amount, "reason": reason})
	})
}

// CloseShift records the counted cash and freezes the expected amount.
func (a *App) CloseShift(ctx context.Context, actor Actor, shiftID string, counted money.Minor) (ShiftReport, error) {
	if err := actor.require(rbac.ShiftCash); err != nil {
		return ShiftReport{}, err
	}
	if counted < 0 {
		return ShiftReport{}, invalid("المبلغ المعدود غير صحيح")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var owner, status string
		if err := tx.QueryRowContext(ctx, `SELECT user_id, status FROM shifts WHERE id = ?`, shiftID).Scan(&owner, &status); err != nil {
			return noRows(err, "الوردية")
		}
		if owner != actor.UserID && !actor.Can(rbac.ShiftManage) {
			return errForbidden
		}
		if status != "open" {
			return conflict("الوردية مغلقة بالفعل")
		}
		var held int
		tx.QueryRowContext(ctx, `SELECT count(*) FROM orders WHERE shift_id = ? AND status IN ('open','held') AND total_minor > 0`, shiftID).Scan(&held)
		if held > 0 {
			return conflict("يوجد طلبات مفتوحة في هذه الوردية، أغلقها أو انقلها قبل إغلاق الوردية")
		}
		rep, err := a.shiftReport(ctx, tx, shiftID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE shifts SET status='closed', expected_cash_minor=?, counted_cash_minor=?, closed_at=? WHERE id=?`,
			rep.ExpectedCash, counted, a.stamp(), shiftID); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "shift.close", "shifts", shiftID, map[string]any{"expected": rep.ExpectedCash, "counted": counted})
	})
	if err != nil {
		return ShiftReport{}, err
	}
	return a.ShiftReport(ctx, actor, shiftID)
}

func (a *App) ShiftReport(ctx context.Context, actor Actor, shiftID string) (ShiftReport, error) {
	var owner string
	if err := a.db.Read.QueryRowContext(ctx, `SELECT user_id FROM shifts WHERE id = ?`, shiftID).Scan(&owner); err != nil {
		return ShiftReport{}, noRows(err, "الوردية")
	}
	if owner != actor.UserID && !actor.Can(rbac.ShiftManage) && !actor.Can(rbac.ReportsView) {
		return ShiftReport{}, errForbidden
	}
	return a.shiftReport(ctx, a.db.Read, shiftID)
}

func (a *App) shiftReport(ctx context.Context, q sqlite.Querier, shiftID string) (ShiftReport, error) {
	var r ShiftReport
	var err error
	r.Shift, err = scanShift(q.QueryRowContext(ctx,
		`SELECT `+shiftCols+` FROM shifts s JOIN users u ON u.id = s.user_id JOIN devices d ON d.id = s.device_id WHERE s.id = ?`, shiftID))
	if err != nil {
		return r, noRows(err, "الوردية")
	}
	settings, err := loadSettings(ctx, q)
	if err != nil {
		return r, err
	}
	err = q.QueryRowContext(ctx,
		`SELECT count(*), coalesce(sum(total_minor),0), coalesce(sum(line_discounts_minor + order_discount_minor),0),
		        coalesce(sum(service_minor),0), coalesce(sum(tax_minor),0)
		   FROM orders WHERE shift_id = ? AND status = 'paid'`, shiftID).
		Scan(&r.Orders, &r.Sales, &r.Discounts, &r.Service, &r.Tax)
	if err != nil {
		return r, err
	}
	q.QueryRowContext(ctx, `SELECT count(*) FROM orders WHERE shift_id = ? AND status = 'void'`, shiftID).Scan(&r.Voids)
	q.QueryRowContext(ctx, `SELECT coalesce(sum(total_minor),0) FROM refunds WHERE shift_id = ?`, shiftID).Scan(&r.Refunds)

	rows, err := q.QueryContext(ctx, `SELECT method, count(*), sum(amount_minor) FROM payments WHERE shift_id = ? GROUP BY method ORDER BY 3 DESC`, shiftID)
	if err != nil {
		return r, err
	}
	r.ByMethod = []MethodTotal{}
	for rows.Next() {
		var m MethodTotal
		if err := rows.Scan(&m.Method, &m.Count, &m.Amount); err != nil {
			rows.Close()
			return r, err
		}
		m.Name = m.Method
		if pm, ok := settings.method(m.Method); ok {
			m.Name = pm.Name
			if pm.IsCash {
				r.CashSales += m.Amount
			}
		}
		r.ByMethod = append(r.ByMethod, m)
	}
	rows.Close()

	rows, err = q.QueryContext(ctx, `SELECT c.id, c.kind, c.amount_minor, c.reason, u.full_name, c.created_at
		FROM cash_movements c JOIN users u ON u.id = c.user_id WHERE c.shift_id = ? ORDER BY c.created_at`, shiftID)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	r.CashMovements = []CashMovement{}
	for rows.Next() {
		var m CashMovement
		if err := rows.Scan(&m.ID, &m.Kind, &m.Amount, &m.Reason, &m.User, &m.At); err != nil {
			return r, err
		}
		if m.Kind == "in" {
			r.CashIn += m.Amount
		} else {
			r.CashOut += m.Amount
		}
		r.CashMovements = append(r.CashMovements, m)
	}
	r.ExpectedCash = r.Shift.OpeningFloat + r.CashSales + r.CashIn - r.CashOut
	if r.Shift.CountedCash != nil && r.Shift.ExpectedCash != nil {
		d := *r.Shift.CountedCash - *r.Shift.ExpectedCash
		r.Difference = &d
		r.ExpectedCash = money.Minor(*r.Shift.ExpectedCash)
	}
	return r, rows.Err()
}

// Shifts lists recent shifts: all of them for managers, own otherwise.
func (a *App) Shifts(ctx context.Context, actor Actor, from, to string) ([]Shift, error) {
	if err := actor.require(rbac.ShiftCash); err != nil && !actor.Can(rbac.ReportsView) {
		return nil, err
	}
	settings, _ := loadSettings(ctx, a.db.Read)
	start, end, err := dayRange(from, to, settings.DayStartHour)
	if err != nil {
		return nil, err
	}
	q := `SELECT ` + shiftCols + ` FROM shifts s JOIN users u ON u.id = s.user_id JOIN devices d ON d.id = s.device_id
	       WHERE s.opened_at >= ? AND s.opened_at < ?`
	args := []any{start, end}
	if !actor.Can(rbac.ShiftManage) && !actor.Can(rbac.ReportsView) {
		q += ` AND s.user_id = ?`
		args = append(args, actor.UserID)
	}
	rows, err := a.db.Read.QueryContext(ctx, q+` ORDER BY s.opened_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Shift{}
	for rows.Next() {
		s, err := scanShift(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
