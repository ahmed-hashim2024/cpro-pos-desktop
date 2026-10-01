package app

import (
	"context"
	"database/sql"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

type Customer struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Phone      string      `json:"phone"`
	Address    string      `json:"address"`
	Notes      string      `json:"notes"`
	Orders     int         `json:"orders"`
	TotalSpent money.Minor `json:"total_spent_minor"`
	LastOrder  string      `json:"last_order_at"`
}

func (a *App) Customers(ctx context.Context, actor Actor, search string) ([]Customer, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return nil, err
	}
	like := "%" + strings.TrimSpace(search) + "%"
	rows, err := a.db.Read.QueryContext(ctx,
		`SELECT c.id, c.name, coalesce(c.phone,''), c.address, c.notes,
		        count(o.id), coalesce(sum(o.total_minor),0), coalesce(max(o.created_at),'')
		   FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
		  WHERE c.name LIKE ? OR coalesce(c.phone,'') LIKE ?
		  GROUP BY c.id ORDER BY max(o.created_at) DESC NULLS LAST, c.name LIMIT 200`, like, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Customer{}
	for rows.Next() {
		var c Customer
		if err := rows.Scan(&c.ID, &c.Name, &c.Phone, &c.Address, &c.Notes, &c.Orders, &c.TotalSpent, &c.LastOrder); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (a *App) SaveCustomer(ctx context.Context, actor Actor, c Customer) (Customer, error) {
	if err := actor.require(rbac.POSSell); err != nil {
		return c, err
	}
	c.Name, c.Phone = strings.TrimSpace(c.Name), strings.TrimSpace(c.Phone)
	if c.Name == "" {
		return c, invalid("اسم العميل مطلوب")
	}
	if c.ID != "" && !actor.Can(rbac.CustomersEdit) {
		return c, errForbidden
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if c.ID == "" {
			c.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO customers(id, name, phone, address, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
				c.ID, c.Name, sqlite.NullString(c.Phone), c.Address, c.Notes, a.stamp(), a.stamp())
		} else {
			err = mustAffect(tx.ExecContext(ctx, `UPDATE customers SET name=?, phone=?, address=?, notes=?, updated_at=? WHERE id=?`,
				c.Name, sqlite.NullString(c.Phone), c.Address, c.Notes, a.stamp(), c.ID))
		}
		if isUnique(err) {
			return conflict("رقم الهاتف مسجل لعميل آخر")
		}
		if err != nil {
			return noRows(err, "العميل")
		}
		return a.audit(ctx, tx, actor, "customer.save", "customers", c.ID, map[string]string{"name": c.Name})
	})
	return c, err
}
