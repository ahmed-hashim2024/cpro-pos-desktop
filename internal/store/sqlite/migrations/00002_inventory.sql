-- +goose Up
-- Inventory: raw materials (ingredients), recipes, purchases, waste and stock
-- counts. Every stock change is a row in stock_movements (the ledger);
-- ingredients.stock_milli is a cached running total updated in the same
-- transaction. Quantities are in the ingredient's own unit × 1000.

CREATE TABLE ingredients (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    unit            TEXT NOT NULL CHECK (unit IN ('kg','g','l','ml','pcs')),
    stock_milli     INTEGER NOT NULL DEFAULT 0,   -- may go negative: a kitchen never stops selling
    min_stock_milli INTEGER NOT NULL DEFAULT 0,   -- low-stock threshold
    cost_minor      INTEGER NOT NULL DEFAULT 0,   -- weighted average cost per 1 unit
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- What one unit of a menu item consumes.
CREATE TABLE recipe_lines (
    item_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
    qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
    PRIMARY KEY (item_id, ingredient_id)
);

-- What one selected modifier consumes (e.g. "extra cheese").
CREATE TABLE modifier_recipe_lines (
    modifier_id   TEXT NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
    qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
    PRIMARY KEY (modifier_id, ingredient_id)
);

CREATE TABLE suppliers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    phone      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE purchases (
    id          TEXT PRIMARY KEY,
    supplier_id TEXT REFERENCES suppliers(id),
    reference   TEXT NOT NULL DEFAULT '',   -- supplier invoice number
    total_minor INTEGER NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    user_id     TEXT NOT NULL REFERENCES users(id),
    received_at TEXT NOT NULL
);

CREATE TABLE purchase_lines (
    id             TEXT PRIMARY KEY,
    purchase_id    TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    qty_milli      INTEGER NOT NULL CHECK (qty_milli > 0),
    unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
    total_minor    INTEGER NOT NULL
);

-- Stock counts (جرد): a draft is filled in, then posted. Posting records
-- the expected quantity at that moment and books the variance.
CREATE TABLE stock_counts (
    id         TEXT PRIMARY KEY,
    status     TEXT NOT NULL CHECK (status IN ('draft','posted','cancelled')),
    notes      TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    posted_by  TEXT REFERENCES users(id),
    posted_at  TEXT
);
-- only one count in progress at a time
CREATE UNIQUE INDEX stock_counts_one_draft ON stock_counts(status) WHERE status = 'draft';

CREATE TABLE stock_count_lines (
    count_id       TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
    ingredient_id  TEXT NOT NULL REFERENCES ingredients(id),
    counted_milli  INTEGER NOT NULL CHECK (counted_milli >= 0),
    expected_milli INTEGER,             -- set on post
    cost_minor     INTEGER,             -- unit cost at post, to value the variance
    PRIMARY KEY (count_id, ingredient_id)
);

CREATE TABLE stock_movements (
    id            TEXT PRIMARY KEY,
    ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
    kind          TEXT NOT NULL CHECK (kind IN ('opening','purchase','sale','refund','waste','adjustment','count')),
    qty_milli     INTEGER NOT NULL,     -- signed: + in, - out
    cost_minor    INTEGER NOT NULL,     -- unit cost used to value this movement
    ref_type      TEXT NOT NULL DEFAULT '',
    ref_id        TEXT NOT NULL DEFAULT '',
    reason        TEXT NOT NULL DEFAULT '',
    user_id       TEXT REFERENCES users(id),
    created_at    TEXT NOT NULL
);
CREATE INDEX stock_movements_ingredient ON stock_movements(ingredient_id, created_at);
CREATE INDEX stock_movements_kind ON stock_movements(kind, created_at);
CREATE INDEX stock_movements_ref ON stock_movements(ref_type, ref_id);

-- Waste of a menu item (dropped plate, returned dish) or of a raw material.
CREATE TABLE waste_entries (
    id            TEXT PRIMARY KEY,
    item_id       TEXT REFERENCES items(id),
    ingredient_id TEXT REFERENCES ingredients(id),
    qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
    reason        TEXT NOT NULL,
    cost_minor    INTEGER NOT NULL,     -- total cost lost
    user_id       TEXT NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL,
    CHECK ((item_id IS NULL) <> (ingredient_id IS NULL))
);

-- Refund lines can optionally put stock back (e.g. sealed drinks).
ALTER TABLE refunds ADD COLUMN restock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refunds ADD COLUMN method TEXT NOT NULL DEFAULT 'cash';

-- Cost of goods sold, snapshotted on the order line when it is paid.
ALTER TABLE order_lines ADD COLUMN cost_minor INTEGER NOT NULL DEFAULT 0;

-- Fixed delivery charge, added after service and tax.
ALTER TABLE orders ADD COLUMN delivery_fee_minor INTEGER NOT NULL DEFAULT 0;

-- +goose Down
