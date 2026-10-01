package app

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// ---- types -----------------------------------------------------------------

type Category struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	KitchenStationID string `json:"kitchen_station_id"`
	Sort             int    `json:"sort"`
	Active           bool   `json:"active"`
}

type Station struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Printer string `json:"printer"`
	Active  bool   `json:"active"`
}

type RecipeLine struct {
	IngredientID string      `json:"ingredient_id"`
	Name         string      `json:"name,omitempty"`
	Unit         string      `json:"unit,omitempty"`
	Qty          money.Milli `json:"qty_milli"`
	Cost         money.Minor `json:"cost_minor,omitempty"` // cost of Qty at current average cost
}

type Item struct {
	ID               string       `json:"id"`
	Code             string       `json:"code"`
	Name             string       `json:"name"`
	CategoryID       string       `json:"category_id"`
	Price            money.Minor  `json:"price_minor"`
	Image            string       `json:"image"` // URL path, empty if none
	Description      string       `json:"description"`
	Sort             int          `json:"sort"`
	Active           bool         `json:"active"`
	ModifierGroupIDs []string     `json:"modifier_group_ids"`
	Recipe           []RecipeLine `json:"recipe"`
	Cost             money.Minor  `json:"cost_minor"` // recipe cost
}

type Modifier struct {
	ID     string       `json:"id"`
	Name   string       `json:"name"`
	Price  money.Minor  `json:"price_minor"`
	Sort   int          `json:"sort"`
	Active bool         `json:"active"`
	Recipe []RecipeLine `json:"recipe"`
}

type ModifierGroup struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	MinSelect int        `json:"min_select"`
	MaxSelect int        `json:"max_select"` // 0 = unlimited
	Active    bool       `json:"active"`
	Modifiers []Modifier `json:"modifiers"`
}

type Table struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Area   string `json:"area"`
	Seats  int    `json:"seats"`
	Sort   int    `json:"sort"`
	Active bool   `json:"active"`
}

func isUnique(err error) bool { return err != nil && strings.Contains(err.Error(), "UNIQUE") }

// ---- categories ------------------------------------------------------------

func (a *App) Categories(ctx context.Context, _ Actor) ([]Category, error) {
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id, name, coalesce(kitchen_station_id,''), sort, active FROM categories ORDER BY sort, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		var c Category
		var active int64
		if err := rows.Scan(&c.ID, &c.Name, &c.KitchenStationID, &c.Sort, &active); err != nil {
			return nil, err
		}
		c.Active = active == 1
		out = append(out, c)
	}
	return out, rows.Err()
}

func (a *App) SaveCategory(ctx context.Context, actor Actor, c Category) (Category, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return c, err
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return c, invalid("اسم القسم مطلوب")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if c.ID == "" {
			c.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO categories(id, name, kitchen_station_id, sort, active) VALUES (?,?,?,?,?)`,
				c.ID, c.Name, sqlite.NullString(c.KitchenStationID), c.Sort, sqlite.Int(c.Active))
		} else {
			err = mustAffect(tx.ExecContext(ctx, `UPDATE categories SET name=?, kitchen_station_id=?, sort=?, active=? WHERE id=?`,
				c.Name, sqlite.NullString(c.KitchenStationID), c.Sort, sqlite.Int(c.Active), c.ID))
		}
		if isUnique(err) {
			return conflict("يوجد قسم بنفس الاسم")
		}
		if err != nil {
			return noRows(err, "القسم")
		}
		return a.audit(ctx, tx, actor, "category.save", "categories", c.ID, c)
	})
	return c, err
}

// mustAffect turns an UPDATE that matched nothing into sql.ErrNoRows.
func mustAffect(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ---- kitchen stations ------------------------------------------------------

func (a *App) Stations(ctx context.Context, _ Actor) ([]Station, error) {
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id, name, coalesce(printer,''), active FROM kitchen_stations ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Station{}
	for rows.Next() {
		var s Station
		var active int64
		if err := rows.Scan(&s.ID, &s.Name, &s.Printer, &active); err != nil {
			return nil, err
		}
		s.Active = active == 1
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *App) SaveStation(ctx context.Context, actor Actor, s Station) (Station, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return s, err
	}
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		return s, invalid("اسم المحطة مطلوب")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if s.ID == "" {
			s.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO kitchen_stations(id, name, printer, active) VALUES (?,?,?,?)`, s.ID, s.Name, sqlite.NullString(s.Printer), sqlite.Int(s.Active))
		} else {
			err = mustAffect(tx.ExecContext(ctx, `UPDATE kitchen_stations SET name=?, printer=?, active=? WHERE id=?`, s.Name, sqlite.NullString(s.Printer), sqlite.Int(s.Active), s.ID))
		}
		if err != nil {
			return noRows(err, "المحطة")
		}
		return a.audit(ctx, tx, actor, "station.save", "kitchen_stations", s.ID, s)
	})
	return s, err
}

// ---- items -----------------------------------------------------------------

// Items returns the full catalog including recipes and costs.
func (a *App) Items(ctx context.Context, _ Actor) ([]Item, error) {
	q := a.db.Read
	rows, err := q.QueryContext(ctx, `SELECT id, code, name, coalesce(category_id,''), price_minor, coalesce(image_path,''), description, sort, active FROM items ORDER BY sort, name`)
	if err != nil {
		return nil, err
	}
	out := []Item{}
	idx := map[string]int{}
	for rows.Next() {
		var it Item
		var active int64
		if err := rows.Scan(&it.ID, &it.Code, &it.Name, &it.CategoryID, &it.Price, &it.Image, &it.Description, &it.Sort, &active); err != nil {
			rows.Close()
			return nil, err
		}
		it.Active = active == 1
		if it.Image != "" {
			it.Image = "/api/v1/images/" + it.Image
		}
		it.ModifierGroupIDs, it.Recipe = []string{}, []RecipeLine{}
		idx[it.ID] = len(out)
		out = append(out, it)
	}
	rows.Close()

	rows, err = q.QueryContext(ctx, `SELECT item_id, group_id FROM item_modifier_groups ORDER BY sort`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item, group string
		if err := rows.Scan(&item, &group); err != nil {
			rows.Close()
			return nil, err
		}
		if i, ok := idx[item]; ok {
			out[i].ModifierGroupIDs = append(out[i].ModifierGroupIDs, group)
		}
	}
	rows.Close()

	rows, err = q.QueryContext(ctx, `SELECT r.item_id, r.ingredient_id, g.name, g.unit, r.qty_milli, g.cost_minor
		FROM recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id ORDER BY g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item string
		var r RecipeLine
		var unitCost money.Minor
		if err := rows.Scan(&item, &r.IngredientID, &r.Name, &r.Unit, &r.Qty, &unitCost); err != nil {
			return nil, err
		}
		r.Cost = unitCost.MulQty(r.Qty)
		if i, ok := idx[item]; ok {
			out[i].Recipe = append(out[i].Recipe, r)
			out[i].Cost += r.Cost
		}
	}
	return out, rows.Err()
}

type ItemInput struct {
	Item
	ImageData string `json:"image_data"` // data URL for a new image; "-" removes it
}

func (a *App) SaveItem(ctx context.Context, actor Actor, in ItemInput) (string, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return "", err
	}
	it := in.Item
	it.Name, it.Code = strings.TrimSpace(it.Name), strings.TrimSpace(it.Code)
	if it.Name == "" {
		return "", invalid("اسم الصنف مطلوب")
	}
	if it.Price < 0 {
		return "", invalid("السعر غير صحيح")
	}
	for _, r := range it.Recipe {
		if r.Qty <= 0 || r.IngredientID == "" {
			return "", invalid("كمية الخامة في الوصفة يجب أن تكون أكبر من صفر")
		}
	}
	image, err := a.storeImage(in.ImageData)
	if err != nil {
		return "", err
	}
	err = a.tx(ctx, func(tx *sql.Tx) error {
		if it.ID == "" {
			it.ID = sqlite.NewID()
			if it.Code == "" {
				var n int
				tx.QueryRowContext(ctx, `SELECT count(*) + 1 FROM items`).Scan(&n)
				it.Code = fmt.Sprintf("I%04d", n)
			}
			_, err = tx.ExecContext(ctx,
				`INSERT INTO items(id, code, name, category_id, price_minor, image_path, description, sort, active, created_at, updated_at)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
				it.ID, it.Code, it.Name, sqlite.NullString(it.CategoryID), it.Price, sqlite.NullString(image), it.Description, it.Sort, sqlite.Int(it.Active), a.stamp(), a.stamp())
		} else {
			err = mustAffect(tx.ExecContext(ctx,
				`UPDATE items SET code=?, name=?, category_id=?, price_minor=?, description=?, sort=?, active=?, updated_at=? WHERE id=?`,
				it.Code, it.Name, sqlite.NullString(it.CategoryID), it.Price, it.Description, it.Sort, sqlite.Int(it.Active), a.stamp(), it.ID))
			if err == nil && in.ImageData != "" {
				_, err = tx.ExecContext(ctx, `UPDATE items SET image_path=? WHERE id=?`, sqlite.NullString(image), it.ID)
			}
		}
		if isUnique(err) {
			return conflict("كود الصنف مستخدم بالفعل")
		}
		if err != nil {
			return noRows(err, "الصنف")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM item_modifier_groups WHERE item_id = ?`, it.ID); err != nil {
			return err
		}
		for i, g := range it.ModifierGroupIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO item_modifier_groups(item_id, group_id, sort) VALUES (?,?,?)`, it.ID, g, i); err != nil {
				return err
			}
		}
		if err := replaceRecipe(ctx, tx, "recipe_lines", "item_id", it.ID, it.Recipe); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "item.save", "items", it.ID, map[string]any{"name": it.Name, "price": it.Price, "active": it.Active})
	})
	return it.ID, err
}

func replaceRecipe(ctx context.Context, tx *sql.Tx, table, col, id string, lines []RecipeLine) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE `+col+` = ?`, id); err != nil {
		return err
	}
	for _, r := range lines {
		_, err := tx.ExecContext(ctx, `INSERT INTO `+table+`(`+col+`, ingredient_id, qty_milli) VALUES (?,?,?)
			ON CONFLICT DO UPDATE SET qty_milli = qty_milli + excluded.qty_milli`, id, r.IngredientID, r.Qty)
		if err != nil {
			return err
		}
	}
	return nil
}

// storeImage saves a data-URL image under the data dir and returns its file
// name. "" keeps the current image, "-" clears it.
func (a *App) storeImage(dataURL string) (string, error) {
	if dataURL == "" || dataURL == "-" {
		return "", nil
	}
	meta, payload, ok := strings.Cut(dataURL, ",")
	ext := map[string]string{"data:image/png;base64": ".png", "data:image/jpeg;base64": ".jpg", "data:image/webp;base64": ".webp"}[meta]
	if !ok || ext == "" {
		return "", invalid("الصورة يجب أن تكون PNG أو JPG أو WEBP")
	}
	b, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || len(b) > 2<<20 {
		return "", invalid("الصورة غير صالحة أو أكبر من 2 ميجا")
	}
	name := sqlite.NewID() + ext
	return name, os.WriteFile(filepath.Join(a.paths.Images, name), b, 0o600)
}

// ImagePath resolves an image file name safely inside the images dir.
func (a *App) ImagePath(name string) (string, bool) {
	if name != filepath.Base(name) || strings.HasPrefix(name, ".") {
		return "", false
	}
	return filepath.Join(a.paths.Images, name), true
}

// ---- modifier groups -------------------------------------------------------

func (a *App) ModifierGroups(ctx context.Context, _ Actor) ([]ModifierGroup, error) {
	q := a.db.Read
	rows, err := q.QueryContext(ctx, `SELECT id, name, min_select, max_select, active FROM modifier_groups ORDER BY name`)
	if err != nil {
		return nil, err
	}
	out := []ModifierGroup{}
	idx := map[string]int{}
	for rows.Next() {
		var g ModifierGroup
		var active int64
		if err := rows.Scan(&g.ID, &g.Name, &g.MinSelect, &g.MaxSelect, &active); err != nil {
			rows.Close()
			return nil, err
		}
		g.Active, g.Modifiers = active == 1, []Modifier{}
		idx[g.ID] = len(out)
		out = append(out, g)
	}
	rows.Close()

	rows, err = q.QueryContext(ctx, `SELECT id, group_id, name, price_minor, sort, active FROM modifiers ORDER BY sort, name`)
	if err != nil {
		return nil, err
	}
	mods := map[string]*Modifier{}
	for rows.Next() {
		var m Modifier
		var group string
		var active int64
		if err := rows.Scan(&m.ID, &group, &m.Name, &m.Price, &m.Sort, &active); err != nil {
			rows.Close()
			return nil, err
		}
		m.Active, m.Recipe = active == 1, []RecipeLine{}
		if i, ok := idx[group]; ok {
			out[i].Modifiers = append(out[i].Modifiers, m)
		}
	}
	rows.Close()
	for i := range out {
		for j := range out[i].Modifiers {
			mods[out[i].Modifiers[j].ID] = &out[i].Modifiers[j]
		}
	}

	rows, err = q.QueryContext(ctx, `SELECT r.modifier_id, r.ingredient_id, g.name, g.unit, r.qty_milli FROM modifier_recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var mod string
		var r RecipeLine
		if err := rows.Scan(&mod, &r.IngredientID, &r.Name, &r.Unit, &r.Qty); err != nil {
			return nil, err
		}
		if m := mods[mod]; m != nil {
			m.Recipe = append(m.Recipe, r)
		}
	}
	return out, rows.Err()
}

func (a *App) SaveModifierGroup(ctx context.Context, actor Actor, g ModifierGroup) (string, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return "", err
	}
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" {
		return "", invalid("اسم مجموعة الإضافات مطلوب")
	}
	if g.MinSelect < 0 || g.MaxSelect < 0 || (g.MaxSelect > 0 && g.MinSelect > g.MaxSelect) {
		return "", invalid("الحد الأدنى والأقصى للاختيار غير صحيحين")
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if g.ID == "" {
			g.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO modifier_groups(id, name, min_select, max_select, active) VALUES (?,?,?,?,?)`,
				g.ID, g.Name, g.MinSelect, g.MaxSelect, sqlite.Int(g.Active))
		} else {
			err = mustAffect(tx.ExecContext(ctx, `UPDATE modifier_groups SET name=?, min_select=?, max_select=?, active=? WHERE id=?`,
				g.Name, g.MinSelect, g.MaxSelect, sqlite.Int(g.Active), g.ID))
		}
		if err != nil {
			return noRows(err, "مجموعة الإضافات")
		}
		// Modifiers referenced by past orders are deactivated, never deleted.
		keep := map[string]bool{}
		for i, m := range g.Modifiers {
			m.Name = strings.TrimSpace(m.Name)
			if m.Name == "" || m.Price < 0 {
				return invalid("اسم وسعر الإضافة مطلوبان")
			}
			if m.ID == "" {
				m.ID = sqlite.NewID()
				_, err = tx.ExecContext(ctx, `INSERT INTO modifiers(id, group_id, name, price_minor, sort, active) VALUES (?,?,?,?,?,?)`,
					m.ID, g.ID, m.Name, m.Price, i, sqlite.Int(m.Active))
			} else {
				_, err = tx.ExecContext(ctx, `UPDATE modifiers SET name=?, price_minor=?, sort=?, active=? WHERE id=? AND group_id=?`,
					m.Name, m.Price, i, sqlite.Int(m.Active), m.ID, g.ID)
			}
			if err != nil {
				return err
			}
			if err := replaceRecipe(ctx, tx, "modifier_recipe_lines", "modifier_id", m.ID, m.Recipe); err != nil {
				return err
			}
			keep[m.ID] = true
		}
		rows, err := tx.QueryContext(ctx, `SELECT id FROM modifiers WHERE group_id = ?`, g.ID)
		if err != nil {
			return err
		}
		var drop []string
		for rows.Next() {
			var id string
			rows.Scan(&id)
			if !keep[id] {
				drop = append(drop, id)
			}
		}
		rows.Close()
		for _, id := range drop {
			if _, err := tx.ExecContext(ctx, `UPDATE modifiers SET active = 0 WHERE id = ?`, id); err != nil {
				return err
			}
		}
		return a.audit(ctx, tx, actor, "modifier_group.save", "modifier_groups", g.ID, map[string]any{"name": g.Name, "modifiers": len(g.Modifiers)})
	})
	return g.ID, err
}

// ---- tables ----------------------------------------------------------------

func (a *App) Tables(ctx context.Context, _ Actor) ([]Table, error) {
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id, name, area, seats, sort, active FROM dining_tables ORDER BY area, sort, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Table{}
	for rows.Next() {
		var t Table
		var active int64
		if err := rows.Scan(&t.ID, &t.Name, &t.Area, &t.Seats, &t.Sort, &active); err != nil {
			return nil, err
		}
		t.Active = active == 1
		out = append(out, t)
	}
	return out, rows.Err()
}

func (a *App) SaveTable(ctx context.Context, actor Actor, t Table) (Table, error) {
	if err := actor.require(rbac.CatalogManage); err != nil {
		return t, err
	}
	t.Name, t.Area = strings.TrimSpace(t.Name), strings.TrimSpace(t.Area)
	if t.Name == "" {
		return t, invalid("اسم الطاولة مطلوب")
	}
	if t.Seats <= 0 {
		t.Seats = 4
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if t.ID == "" {
			t.ID = sqlite.NewID()
			_, err = tx.ExecContext(ctx, `INSERT INTO dining_tables(id, name, area, seats, sort, active) VALUES (?,?,?,?,?,?)`, t.ID, t.Name, t.Area, t.Seats, t.Sort, sqlite.Int(t.Active))
		} else {
			err = mustAffect(tx.ExecContext(ctx, `UPDATE dining_tables SET name=?, area=?, seats=?, sort=?, active=? WHERE id=?`, t.Name, t.Area, t.Seats, t.Sort, sqlite.Int(t.Active), t.ID))
		}
		if err != nil {
			return noRows(err, "الطاولة")
		}
		return a.audit(ctx, tx, actor, "table.save", "dining_tables", t.ID, t)
	})
	return t, err
}
