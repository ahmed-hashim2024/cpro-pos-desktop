package app

import (
	"context"
	"database/sql"
	"sort"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
)

type KitchenLine struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Qty       money.Milli    `json:"qty_milli"`
	Modifiers []LineModifier `json:"modifiers"`
	Notes     string         `json:"notes"`
	Course    int            `json:"course"`
	Status    string         `json:"status"`
	StationID string         `json:"station_id"`
	Voided    bool           `json:"voided"` // cancelled after it was sent: stop making it
	SentAt    string         `json:"sent_at"`
}

type KitchenTicket struct {
	OrderID   string        `json:"order_id"`
	Number    int           `json:"number"`
	Type      string        `json:"type"`
	TableName string        `json:"table_name"`
	Customer  string        `json:"customer_name"`
	Waiter    string        `json:"user_name"`
	Notes     string        `json:"notes"`
	SentAt    string        `json:"sent_at"` // oldest line, drives the timer
	Lines     []KitchenLine `json:"lines"`
}

var kitchenStatuses = map[string]bool{"sent": true, "preparing": true, "ready": true, "served": true}

// KitchenBoard returns the tickets still being worked on, oldest first,
// optionally limited to one station (by the item's category).
func (a *App) KitchenBoard(ctx context.Context, actor Actor, stationID string) ([]KitchenTicket, error) {
	if err := actor.require(rbac.KitchenView); err != nil {
		return nil, err
	}
	q := `SELECT o.id, o.number, o.type, coalesce(t.name,''), coalesce(c.name,''), u.full_name, o.notes,
	             l.id, l.name, l.qty_milli, l.notes, l.course, l.kitchen_status, coalesce(cat.kitchen_station_id,''),
	             l.voided_at IS NOT NULL, l.sent_at
	        FROM order_lines l
	        JOIN orders o ON o.id = l.order_id
	        JOIN users u ON u.id = o.user_id
	        JOIN items i ON i.id = l.item_id
	        LEFT JOIN categories cat ON cat.id = i.category_id
	        LEFT JOIN dining_tables t ON t.id = o.table_id
	        LEFT JOIN customers c ON c.id = o.customer_id
	       WHERE l.sent_at IS NOT NULL AND l.kitchen_status IN ('sent','preparing','ready') AND o.status <> 'void'`
	args := []any{}
	if stationID != "" {
		q += ` AND cat.kitchen_station_id = ?`
		args = append(args, stationID)
	}
	rows, err := a.db.Read.QueryContext(ctx, q+` ORDER BY l.sent_at, l.sort`, args...)
	if err != nil {
		return nil, err
	}
	tickets := map[string]*KitchenTicket{}
	lineIdx := map[string]*KitchenLine{}
	var order []string
	for rows.Next() {
		var t KitchenTicket
		var l KitchenLine
		var voided int64
		if err := rows.Scan(&t.OrderID, &t.Number, &t.Type, &t.TableName, &t.Customer, &t.Waiter, &t.Notes,
			&l.ID, &l.Name, &l.Qty, &l.Notes, &l.Course, &l.Status, &l.StationID, &voided, &l.SentAt); err != nil {
			rows.Close()
			return nil, err
		}
		l.Voided, l.Modifiers = voided == 1, []LineModifier{}
		cur := tickets[t.OrderID]
		if cur == nil {
			t.SentAt = l.SentAt
			cur = &t
			tickets[t.OrderID] = cur
			order = append(order, t.OrderID)
		}
		cur.Lines = append(cur.Lines, l)
	}
	rows.Close()
	for _, t := range tickets {
		for i := range t.Lines {
			lineIdx[t.Lines[i].ID] = &t.Lines[i]
		}
	}
	if len(lineIdx) > 0 {
		rows, err = a.db.Read.QueryContext(ctx, `SELECT m.line_id, m.name FROM order_line_modifiers m JOIN order_lines l ON l.id = m.line_id
			WHERE l.sent_at IS NOT NULL AND l.kitchen_status IN ('sent','preparing','ready')`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var line, name string
			if err := rows.Scan(&line, &name); err != nil {
				return nil, err
			}
			if l := lineIdx[line]; l != nil {
				l.Modifiers = append(l.Modifiers, LineModifier{Name: name})
			}
		}
	}
	out := make([]KitchenTicket, 0, len(order))
	for _, id := range order {
		out = append(out, *tickets[id])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SentAt < out[j].SentAt })
	return out, nil
}

// SetKitchenStatus moves lines along sent → preparing → ready → served.
func (a *App) SetKitchenStatus(ctx context.Context, actor Actor, lineIDs []string, status string) error {
	if err := actor.require(rbac.KitchenView); err != nil {
		return err
	}
	if !kitchenStatuses[status] || len(lineIDs) == 0 {
		return invalid("حالة غير صحيحة")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		ph := strings.TrimSuffix(strings.Repeat("?,", len(lineIDs)), ",")
		args := []any{status}
		for _, id := range lineIDs {
			args = append(args, id)
		}
		_, err := tx.ExecContext(ctx, `UPDATE order_lines SET kitchen_status = ? WHERE sent_at IS NOT NULL AND id IN (`+ph+`)`, args...)
		return err
	})
}
