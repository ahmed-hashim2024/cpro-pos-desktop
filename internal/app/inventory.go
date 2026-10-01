package app

import (
	"context"
	"database/sql"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// Units an ingredient can be tracked in. Recipes use the same unit, e.g. a
// burger uses 0.150 kg of beef.
var ingredientUnits = map[string]string{"kg": "كجم", "g": "جم", "l": "لتر", "ml": "مل", "pcs": "قطعة"}

type Ingredient struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	Unit     string      `json:"unit"`
	Stock    money.Milli `json:"stock_milli"`
	MinStock money.Milli `json:"min_stock_milli"`
	Cost     money.Minor `json:"cost_minor"`  // average cost per unit
	Value    money.Minor `json:"value_minor"` // stock × cost
	Low      bool        `json:"low"`
	Active   bool        `json:"active"`
	UsedIn   int         `json:"used_in"` // number of items whose recipe uses it
}

// ---- ledger primitives -------------------------------------------------------

// move books one stock movement and updates the cached stock in the same tx.
func (a *App) move(ctx context.Context, tx *sql.Tx, userID, ingredientID, kind string, qty money.Milli, cost money.Minor, refType, refID, reason string) error {
	if qty == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO stock_movements(id, ingredient_id, kind, qty_milli, cost_minor, ref_type, ref_id, reason, user_id, created_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`, sqlite.NewID(), ingredientID, kind, qty, cost, refType, refID, reason, sqlite.NullString(userID), a.stamp()); err != nil {
		return err
	}
	return mustAffect(tx.ExecContext(ctx, `UPDATE ingredients SET stock_milli = stock_milli + ?, updated_at = ? WHERE id = ?`, qty, a.stamp(), ingredientID))
}

type usage struct {
	qty  money.Milli
	cost money.Minor // unit cost
}

// consumption returns what qty units of an order line use, from the item's
// recipe plus the recipes of its selected modifiers.
func consumption(ctx context.Context, q sqlite.Querier, l OrderLine, qty money.Milli) (map[string]usage, error) {
	out := map[string]usage{}
	add := func(rows *sql.Rows, err error) error {
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var per money.Milli
			var cost money.Minor
			if err := rows.Scan(&id, &per, &cost); err != nil {
				return err
			}
			u := out[id]
			u.qty += per.Mul(qty)
			u.cost = cost
			out[id] = u
		}
		return rows.Err()
	}
	if err := add(q.QueryContext(ctx, `SELECT r.ingredient_id, r.qty_milli, g.cost_minor FROM recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.item_id = ?`, l.ItemID)); err != nil {
		return nil, err
	}
	for _, m := range l.Modifiers {
		if m.ModifierID == "" {
			continue
		}
		if err := add(q.QueryContext(ctx, `SELECT r.ingredient_id, r.qty_milli, g.cost_minor FROM modifier_recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.modifier_id = ?`, m.ModifierID)); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// consumeOrder deducts every paid line's ingredients and records the line's
// cost of goods sold. Stock may go negative: the sale already happened.
func (a *App) consumeOrder(ctx context.Context, tx *sql.Tx, actor Actor, o Order) error {
	for _, l := range o.Lines {
		if l.Voided {
			continue
		}
		use, err := consumption(ctx, tx, l, l.Qty)
		if err != nil {
			return err
		}
		var cost money.Minor
		for id, u := range use {
			if err := a.move(ctx, tx, actor.UserID, id, "sale", -u.qty, u.cost, "order", o.ID, ""); err != nil {
				return err
			}
			cost += u.cost.MulQty(u.qty)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE order_lines SET cost_minor = ? WHERE id = ?`, cost, l.ID); err != nil {
			return err
		}
	}
	return nil
}

// wasteLine books a prepared-but-voided line's ingredients as waste.
func (a *App) wasteLine(ctx context.Context, tx *sql.Tx, actor Actor, l OrderLine, reason string) error {
	use, err := consumption(ctx, tx, l, l.Qty)
	if err != nil {
		return err
	}
	var cost money.Minor
	id := sqlite.NewID()
	for ing, u := range use {
		if err := a.move(ctx, tx, actor.UserID, ing, "waste", -u.qty, u.cost, "waste", id, reason); err != nil {
			return err
		}
		cost += u.cost.MulQty(u.qty)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO waste_entries(id, item_id, qty_milli, reason, cost_minor, user_id, created_at) VALUES (?,?,?,?,?,?,?)`,
		id, l.ItemID, l.Qty, reason, cost, actor.UserID, a.stamp())
	return err
}

func (a *App) restockLine(ctx context.Context, tx *sql.Tx, actor Actor, l OrderLine, qty money.Milli, refundID string) error {
	use, err := consumption(ctx, tx, l, qty)
	if err != nil {
		return err
	}
	for ing, u := range use {
		if err := a.move(ctx, tx, actor.UserID, ing, "refund", u.qty, u.cost, "refund", refundID, ""); err != nil {
			return err
		}
	}
	return nil
}

// ---- ingredients -----------------------------------------------------------

func (a *App) Ingredients(ctx context.Context, actor Actor) ([]Ingredient, error) {
	if !actor.Can(rbac.InventoryView) && !actor.Can(rbac.CatalogManage) {
		return nil, errForbidden
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT g.id, g.name, g.unit, g.stock_milli, g.min_stock_milli, g.cost_minor, g.active,
		(SELECT count(*) FROM recipe_lines r WHERE r.ingredient_id = g.id) FROM ingredients g ORDER BY g.active DESC, g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Ingredient{}
	for rows.Next() {
		var g Ingredient
		var active int64
		if err := rows.Scan(&g.ID, &g.Name, &g.Unit, &g.Stock, &g.MinStock, &g.Cost, &active, &g.UsedIn); err != nil {
			return nil, err
		}
		g.Active = active == 1
		g.Value = g.Cost.MulQty(max(g.Stock, 0))
		g.Low = g.Active && g.Stock <= g.MinStock
		out = append(out, g)
	}
	return out, rows.Err()
}

type IngredientInput struct {
	Ingredient
	OpeningStock money.Milli `json:"opening_stock_milli"` // only on create
}

func (a *App) SaveIngredient(ctx context.Context, actor Actor, in IngredientInput) (string, error) {
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return "", err
	}
	g := in.Ingredient
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" {
		return "", invalid("اسم الخامة مطلوب")
	}
	if _, ok := ingredientUnits[g.Unit]; !ok {
		return "", invalid("وحدة القياس غير صحيحة")
	}
	if g.Cost < 0 || g.MinStock < 0 || in.OpeningStock < 0 {
		return "", invalid("القيم يجب ألا تكون سالبة")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if g.ID == "" {
			g.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO ingredients(id, name, unit, min_stock_milli, cost_minor, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
				g.ID, g.Name, g.Unit, g.MinStock, g.Cost, sqlite.Int(g.Active), a.stamp(), a.stamp())
			if err == nil {
				err = a.move(ctx, tx, actor.UserID, g.ID, "opening", in.OpeningStock, g.Cost, "", "", "رصيد افتتاحي")
			}
		} else {
			// Unit is fixed once recipes and movements depend on it; cost
			// changes only through purchases.
			err = mustAffect(tx.ExecContext(ctx, `UPDATE ingredients SET name=?, min_stock_milli=?, active=?, updated_at=? WHERE id=?`,
				g.Name, g.MinStock, sqlite.Int(g.Active), a.stamp(), g.ID))
		}
		if isUnique(err) {
			return conflict("يوجد خامة بنفس الاسم")
		}
		if err != nil {
			return noRows(err, "الخامة")
		}
		return a.audit(ctx, tx, actor, "ingredient.save", "ingredients", g.ID, map[string]any{"name": g.Name, "unit": g.Unit})
	})
	return g.ID, err
}

// AdjustStock sets an ingredient's stock to a new quantity with a reason
// (quick correction outside a full count).
func (a *App) AdjustStock(ctx context.Context, actor Actor, ingredientID string, newQty money.Milli, reason string) error {
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return err
	}
	if strings.TrimSpace(reason) == "" {
		return invalid("سبب التسوية مطلوب")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		var cur money.Milli
		var cost money.Minor
		if err := tx.QueryRowContext(ctx, `SELECT stock_milli, cost_minor FROM ingredients WHERE id = ?`, ingredientID).Scan(&cur, &cost); err != nil {
			return noRows(err, "الخامة")
		}
		if err := a.move(ctx, tx, actor.UserID, ingredientID, "adjustment", newQty-cur, cost, "", "", strings.TrimSpace(reason)); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "stock.adjust", "ingredients", ingredientID, map[string]any{"from": cur, "to": newQty, "reason": reason})
	})
}

// ---- suppliers & purchases ---------------------------------------------------

type Supplier struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Phone     string      `json:"phone"`
	Notes     string      `json:"notes"`
	Purchases money.Minor `json:"purchases_minor"`
}

func (a *App) Suppliers(ctx context.Context, actor Actor) ([]Supplier, error) {
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT s.id, s.name, s.phone, s.notes, coalesce(sum(p.total_minor),0)
		FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id GROUP BY s.id ORDER BY s.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Supplier{}
	for rows.Next() {
		var s Supplier
		if err := rows.Scan(&s.ID, &s.Name, &s.Phone, &s.Notes, &s.Purchases); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *App) SaveSupplier(ctx context.Context, actor Actor, s Supplier) (Supplier, error) {
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return s, err
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		return s, invalid("اسم المورد مطلوب")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if s.ID == "" {
			s.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO suppliers(id, name, phone, notes, created_at) VALUES (?,?,?,?,?)`, s.ID, s.Name, s.Phone, s.Notes, a.stamp())
		} else {
			err = mustAffect(tx.ExecContext(ctx, `UPDATE suppliers SET name=?, phone=?, notes=? WHERE id=?`, s.Name, s.Phone, s.Notes, s.ID))
		}
		if isUnique(err) {
			return conflict("يوجد مورد بنفس الاسم")
		}
		return noRows(err, "المورد")
	})
	return s, err
}

type PurchaseLine struct {
	IngredientID string      `json:"ingredient_id"`
	Name         string      `json:"name,omitempty"`
	Unit         string      `json:"unit,omitempty"`
	Qty          money.Milli `json:"qty_milli"`
	UnitCost     money.Minor `json:"unit_cost_minor"`
	Total        money.Minor `json:"total_minor"`
}

type Purchase struct {
	ID         string         `json:"id"`
	SupplierID string         `json:"supplier_id"`
	Supplier   string         `json:"supplier_name"`
	Reference  string         `json:"reference"`
	Notes      string         `json:"notes"`
	Total      money.Minor    `json:"total_minor"`
	User       string         `json:"user_name"`
	ReceivedAt string         `json:"received_at"`
	Lines      []PurchaseLine `json:"lines"`
}

// ReceivePurchase adds stock and updates each ingredient's weighted average cost.
func (a *App) ReceivePurchase(ctx context.Context, actor Actor, p Purchase) (string, error) {
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return "", err
	}
	if len(p.Lines) == 0 {
		return "", invalid("أضف خامة واحدة على الأقل")
	}
	p.ID = sqlite.NewID()
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var total money.Minor
		for i, l := range p.Lines {
			if l.Qty <= 0 || l.UnitCost < 0 {
				return invalid("الكمية والسعر غير صحيحين")
			}
			l.Total = l.UnitCost.MulQty(l.Qty)
			p.Lines[i] = l
			total += l.Total
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO purchases(id, supplier_id, reference, total_minor, notes, user_id, received_at) VALUES (?,?,?,?,?,?,?)`,
			p.ID, sqlite.NullString(p.SupplierID), strings.TrimSpace(p.Reference), total, strings.TrimSpace(p.Notes), actor.UserID, a.stamp()); err != nil {
			return err
		}
		for _, l := range p.Lines {
			var stock money.Milli
			var cost money.Minor
			if err := tx.QueryRowContext(ctx, `SELECT stock_milli, cost_minor FROM ingredients WHERE id = ?`, l.IngredientID).Scan(&stock, &cost); err != nil {
				return noRows(err, "الخامة")
			}
			newCost := l.UnitCost
			if stock > 0 {
				// (old value + new value) / new quantity
				newCost = (cost.MulQty(stock) + l.Total).Scale(int64(money.OneUnit), int64(stock+l.Qty))
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO purchase_lines(id, purchase_id, ingredient_id, qty_milli, unit_cost_minor, total_minor) VALUES (?,?,?,?,?,?)`,
				sqlite.NewID(), p.ID, l.IngredientID, l.Qty, l.UnitCost, l.Total); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE ingredients SET cost_minor = ? WHERE id = ?`, newCost, l.IngredientID); err != nil {
				return err
			}
			if err := a.move(ctx, tx, actor.UserID, l.IngredientID, "purchase", l.Qty, l.UnitCost, "purchase", p.ID, p.Reference); err != nil {
				return err
			}
		}
		return a.audit(ctx, tx, actor, "purchase.receive", "purchases", p.ID, map[string]any{"total": total, "lines": len(p.Lines), "reference": p.Reference})
	})
	return p.ID, err
}

func (a *App) Purchases(ctx context.Context, actor Actor, from, to string) ([]Purchase, error) {
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return nil, err
	}
	s, _ := loadSettings(ctx, a.db.Read)
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT p.id, coalesce(p.supplier_id,''), coalesce(s.name,''), p.reference, p.notes, p.total_minor, u.full_name, p.received_at
		FROM purchases p JOIN users u ON u.id = p.user_id LEFT JOIN suppliers s ON s.id = p.supplier_id
		WHERE p.received_at >= ? AND p.received_at < ? ORDER BY p.received_at DESC`, start, end)
	if err != nil {
		return nil, err
	}
	out := []Purchase{}
	idx := map[string]int{}
	for rows.Next() {
		var p Purchase
		if err := rows.Scan(&p.ID, &p.SupplierID, &p.Supplier, &p.Reference, &p.Notes, &p.Total, &p.User, &p.ReceivedAt); err != nil {
			rows.Close()
			return nil, err
		}
		p.Lines = []PurchaseLine{}
		idx[p.ID] = len(out)
		out = append(out, p)
	}
	rows.Close()
	rows, err = a.db.Read.QueryContext(ctx, `SELECT l.purchase_id, l.ingredient_id, g.name, g.unit, l.qty_milli, l.unit_cost_minor, l.total_minor
		FROM purchase_lines l JOIN ingredients g ON g.id = l.ingredient_id JOIN purchases p ON p.id = l.purchase_id
		WHERE p.received_at >= ? AND p.received_at < ?`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var pid string
		var l PurchaseLine
		if err := rows.Scan(&pid, &l.IngredientID, &l.Name, &l.Unit, &l.Qty, &l.UnitCost, &l.Total); err != nil {
			return nil, err
		}
		if i, ok := idx[pid]; ok {
			out[i].Lines = append(out[i].Lines, l)
		}
	}
	return out, rows.Err()
}

// ---- waste -----------------------------------------------------------------

type WasteInput struct {
	ItemID       string      `json:"item_id"`       // a prepared dish, or
	IngredientID string      `json:"ingredient_id"` // a raw material
	Qty          money.Milli `json:"qty_milli"`
	Reason       string      `json:"reason"`
}

type WasteEntry struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Kind   string      `json:"kind"` // item | ingredient
	Unit   string      `json:"unit"`
	Qty    money.Milli `json:"qty_milli"`
	Reason string      `json:"reason"`
	Cost   money.Minor `json:"cost_minor"`
	User   string      `json:"user_name"`
	At     string      `json:"created_at"`
}

func (a *App) RecordWaste(ctx context.Context, actor Actor, in WasteInput) error {
	if !actor.Can(rbac.InventoryEdit) && !actor.Can(rbac.KitchenView) {
		return errForbidden
	}
	if in.Qty <= 0 || strings.TrimSpace(in.Reason) == "" || (in.ItemID == "") == (in.IngredientID == "") {
		return invalid("اختر صنفاً أو خامة، وأدخل الكمية والسبب")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if in.ItemID != "" {
			var l OrderLine
			if err := tx.QueryRowContext(ctx, `SELECT id, name FROM items WHERE id = ?`, in.ItemID).Scan(&l.ItemID, &l.Name); err != nil {
				return noRows(err, "الصنف")
			}
			l.Qty = in.Qty
			if err := a.wasteLine(ctx, tx, actor, l, strings.TrimSpace(in.Reason)); err != nil {
				return err
			}
		} else {
			var cost money.Minor
			if err := tx.QueryRowContext(ctx, `SELECT cost_minor FROM ingredients WHERE id = ?`, in.IngredientID).Scan(&cost); err != nil {
				return noRows(err, "الخامة")
			}
			id := sqlite.NewID()
			if err := a.move(ctx, tx, actor.UserID, in.IngredientID, "waste", -in.Qty, cost, "waste", id, in.Reason); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO waste_entries(id, ingredient_id, qty_milli, reason, cost_minor, user_id, created_at) VALUES (?,?,?,?,?,?,?)`,
				id, in.IngredientID, in.Qty, strings.TrimSpace(in.Reason), cost.MulQty(in.Qty), actor.UserID, a.stamp()); err != nil {
				return err
			}
		}
		return a.audit(ctx, tx, actor, "waste.record", "waste_entries", "", in)
	})
}

func (a *App) Waste(ctx context.Context, actor Actor, from, to string) ([]WasteEntry, error) {
	if !actor.Can(rbac.InventoryView) && !actor.Can(rbac.ReportsView) {
		return nil, errForbidden
	}
	s, _ := loadSettings(ctx, a.db.Read)
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT w.id, coalesce(i.name, g.name), CASE WHEN w.item_id IS NULL THEN 'ingredient' ELSE 'item' END,
		coalesce(g.unit,'pcs'), w.qty_milli, w.reason, w.cost_minor, u.full_name, w.created_at
		FROM waste_entries w JOIN users u ON u.id = w.user_id
		LEFT JOIN items i ON i.id = w.item_id LEFT JOIN ingredients g ON g.id = w.ingredient_id
		WHERE w.created_at >= ? AND w.created_at < ? ORDER BY w.created_at DESC`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WasteEntry{}
	for rows.Next() {
		var w WasteEntry
		if err := rows.Scan(&w.ID, &w.Name, &w.Kind, &w.Unit, &w.Qty, &w.Reason, &w.Cost, &w.User, &w.At); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// ---- stock counts (جرد) ------------------------------------------------------

type CountLine struct {
	IngredientID string      `json:"ingredient_id"`
	Name         string      `json:"name"`
	Unit         string      `json:"unit"`
	Expected     money.Milli `json:"expected_milli"` // live while draft, frozen once posted
	Counted      *int64      `json:"counted_milli"`  // nil = not counted yet
	Variance     money.Milli `json:"variance_milli"`
	Cost         money.Minor `json:"cost_minor"`
	VarianceCost money.Minor `json:"variance_cost_minor"`
}

type StockCount struct {
	ID           string      `json:"id"`
	Status       string      `json:"status"`
	Notes        string      `json:"notes"`
	CreatedBy    string      `json:"created_by"`
	CreatedAt    string      `json:"created_at"`
	PostedBy     string      `json:"posted_by"`
	PostedAt     string      `json:"posted_at"`
	Lines        []CountLine `json:"lines"`
	Counted      int         `json:"counted"`
	VarianceCost money.Minor `json:"variance_cost_minor"`
}

func (a *App) StockCounts(ctx context.Context, actor Actor) ([]StockCount, error) {
	if err := actor.require(rbac.InventoryCount); err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT c.id, c.status, c.notes, u.full_name, c.created_at, coalesce(p.full_name,''), coalesce(c.posted_at,''),
		(SELECT count(*) FROM stock_count_lines l WHERE l.count_id = c.id),
		(SELECT coalesce(sum((l.counted_milli - l.expected_milli) * l.cost_minor / 1000),0) FROM stock_count_lines l WHERE l.count_id = c.id AND l.expected_milli IS NOT NULL)
		FROM stock_counts c JOIN users u ON u.id = c.created_by LEFT JOIN users p ON p.id = c.posted_by
		ORDER BY c.created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StockCount{}
	for rows.Next() {
		var c StockCount
		if err := rows.Scan(&c.ID, &c.Status, &c.Notes, &c.CreatedBy, &c.CreatedAt, &c.PostedBy, &c.PostedAt, &c.Counted, &c.VarianceCost); err != nil {
			return nil, err
		}
		c.Lines = []CountLine{}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (a *App) StartCount(ctx context.Context, actor Actor, notes string) (string, error) {
	if err := actor.require(rbac.InventoryCount); err != nil {
		return "", err
	}
	id := sqlite.NewID()
	err := a.tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO stock_counts(id, status, notes, created_by, created_at) VALUES (?, 'draft', ?, ?, ?)`, id, strings.TrimSpace(notes), actor.UserID, a.stamp())
		if isUnique(err) {
			return conflict("يوجد جرد مفتوح بالفعل، أكمله أو ألغه أولاً")
		}
		if err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "count.start", "stock_counts", id, nil)
	})
	return id, err
}

func (a *App) GetCount(ctx context.Context, actor Actor, id string) (StockCount, error) {
	if err := actor.require(rbac.InventoryCount); err != nil {
		return StockCount{}, err
	}
	var c StockCount
	err := a.db.Read.QueryRowContext(ctx, `SELECT c.id, c.status, c.notes, u.full_name, c.created_at, coalesce(p.full_name,''), coalesce(c.posted_at,'')
		FROM stock_counts c JOIN users u ON u.id = c.created_by LEFT JOIN users p ON p.id = c.posted_by WHERE c.id = ?`, id).
		Scan(&c.ID, &c.Status, &c.Notes, &c.CreatedBy, &c.CreatedAt, &c.PostedBy, &c.PostedAt)
	if err != nil {
		return c, noRows(err, "الجرد")
	}
	// Every active ingredient appears; drafts compare to live stock.
	rows, err := a.db.Read.QueryContext(ctx, `SELECT g.id, g.name, g.unit,
		coalesce(l.expected_milli, g.stock_milli), l.counted_milli, coalesce(l.cost_minor, g.cost_minor)
		FROM ingredients g LEFT JOIN stock_count_lines l ON l.ingredient_id = g.id AND l.count_id = ?
		WHERE g.active = 1 OR l.count_id IS NOT NULL ORDER BY g.name`, id)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	c.Lines = []CountLine{}
	for rows.Next() {
		var l CountLine
		var counted sql.NullInt64
		if err := rows.Scan(&l.IngredientID, &l.Name, &l.Unit, &l.Expected, &counted, &l.Cost); err != nil {
			return c, err
		}
		if counted.Valid {
			l.Counted = &counted.Int64
			l.Variance = money.Milli(counted.Int64) - l.Expected
			l.VarianceCost = l.Cost.MulQty(l.Variance)
			c.Counted++
			c.VarianceCost += l.VarianceCost
		}
		c.Lines = append(c.Lines, l)
	}
	return c, rows.Err()
}

// SetCountLines saves counted quantities on a draft; nil clears a line.
func (a *App) SetCountLines(ctx context.Context, actor Actor, id string, lines map[string]*int64) error {
	if err := actor.require(rbac.InventoryCount); err != nil {
		return err
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if err := draftCount(ctx, tx, id); err != nil {
			return err
		}
		for ing, qty := range lines {
			if qty == nil {
				if _, err := tx.ExecContext(ctx, `DELETE FROM stock_count_lines WHERE count_id = ? AND ingredient_id = ?`, id, ing); err != nil {
					return err
				}
				continue
			}
			if *qty < 0 {
				return invalid("الكمية المعدودة لا يمكن أن تكون سالبة")
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO stock_count_lines(count_id, ingredient_id, counted_milli) VALUES (?,?,?)
				ON CONFLICT(count_id, ingredient_id) DO UPDATE SET counted_milli = excluded.counted_milli`, id, ing, *qty); err != nil {
				return err
			}
		}
		return nil
	})
}

func draftCount(ctx context.Context, q sqlite.Querier, id string) error {
	var status string
	if err := q.QueryRowContext(ctx, `SELECT status FROM stock_counts WHERE id = ?`, id).Scan(&status); err != nil {
		return noRows(err, "الجرد")
	}
	if status != "draft" {
		return conflict("الجرد مُرحّل أو ملغي ولا يمكن تعديله")
	}
	return nil
}

// PostCount freezes expected quantities and books each variance as a
// "count" movement, so stock becomes exactly what was counted.
func (a *App) PostCount(ctx context.Context, actor Actor, id string) error {
	if err := actor.require(rbac.InventoryCount); err != nil {
		return err
	}
	if err := actor.require(rbac.InventoryEdit); err != nil {
		return &Error{CodeForbidden, "ترحيل الجرد يتطلب صلاحية إدارة المخزون"}
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if err := draftCount(ctx, tx, id); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `SELECT l.ingredient_id, l.counted_milli, g.stock_milli, g.cost_minor
			FROM stock_count_lines l JOIN ingredients g ON g.id = l.ingredient_id WHERE l.count_id = ?`, id)
		if err != nil {
			return err
		}
		type line struct {
			ing            string
			counted, stock money.Milli
			cost           money.Minor
		}
		var lines []line
		for rows.Next() {
			var l line
			if err := rows.Scan(&l.ing, &l.counted, &l.stock, &l.cost); err != nil {
				rows.Close()
				return err
			}
			lines = append(lines, l)
		}
		rows.Close()
		if len(lines) == 0 {
			return invalid("لم يتم إدخال أي كميات معدودة")
		}
		var variance money.Minor
		for _, l := range lines {
			if _, err := tx.ExecContext(ctx, `UPDATE stock_count_lines SET expected_milli = ?, cost_minor = ? WHERE count_id = ? AND ingredient_id = ?`,
				l.stock, l.cost, id, l.ing); err != nil {
				return err
			}
			if err := a.move(ctx, tx, actor.UserID, l.ing, "count", l.counted-l.stock, l.cost, "count", id, "جرد"); err != nil {
				return err
			}
			variance += l.cost.MulQty(l.counted - l.stock)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE stock_counts SET status='posted', posted_by=?, posted_at=? WHERE id=?`, actor.UserID, a.stamp(), id); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "count.post", "stock_counts", id, map[string]any{"lines": len(lines), "variance_cost": variance})
	})
}

func (a *App) CancelCount(ctx context.Context, actor Actor, id string) error {
	if err := actor.require(rbac.InventoryCount); err != nil {
		return err
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if err := draftCount(ctx, tx, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE stock_counts SET status='cancelled' WHERE id=?`, id); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "count.cancel", "stock_counts", id, nil)
	})
}

// ---- movements ledger --------------------------------------------------------

type Movement struct {
	ID         string      `json:"id"`
	Ingredient string      `json:"ingredient"`
	Unit       string      `json:"unit"`
	Kind       string      `json:"kind"`
	Qty        money.Milli `json:"qty_milli"`
	Cost       money.Minor `json:"cost_minor"`
	Value      money.Minor `json:"value_minor"`
	RefType    string      `json:"ref_type"`
	RefID      string      `json:"ref_id"`
	Reason     string      `json:"reason"`
	User       string      `json:"user_name"`
	At         string      `json:"created_at"`
}

func (a *App) Movements(ctx context.Context, actor Actor, ingredientID, kind, from, to string) ([]Movement, error) {
	if err := actor.require(rbac.InventoryView); err != nil {
		return nil, err
	}
	s, _ := loadSettings(ctx, a.db.Read)
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return nil, err
	}
	q := `SELECT m.id, g.name, g.unit, m.kind, m.qty_milli, m.cost_minor, m.ref_type, m.ref_id, m.reason, coalesce(u.full_name,''), m.created_at
		FROM stock_movements m JOIN ingredients g ON g.id = m.ingredient_id LEFT JOIN users u ON u.id = m.user_id
		WHERE m.created_at >= ? AND m.created_at < ?`
	args := []any{start, end}
	if ingredientID != "" {
		q += ` AND m.ingredient_id = ?`
		args = append(args, ingredientID)
	}
	if kind != "" {
		q += ` AND m.kind = ?`
		args = append(args, kind)
	}
	rows, err := a.db.Read.QueryContext(ctx, q+` ORDER BY m.created_at DESC LIMIT 2000`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Movement{}
	for rows.Next() {
		var m Movement
		if err := rows.Scan(&m.ID, &m.Ingredient, &m.Unit, &m.Kind, &m.Qty, &m.Cost, &m.RefType, &m.RefID, &m.Reason, &m.User, &m.At); err != nil {
			return nil, err
		}
		m.Value = m.Cost.MulQty(m.Qty)
		out = append(out, m)
	}
	return out, rows.Err()
}
