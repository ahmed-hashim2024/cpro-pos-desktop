-- +goose Up
-- Schema v1: restaurant core. Conventions:
--   ids are ULID TEXT; money columns are *_minor INTEGER (piasters);
--   quantities are *_milli INTEGER (1000 = 1); rates are *_bp (basis points);
--   timestamps are UTC RFC3339 TEXT.

CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,           -- JSON
    updated_at TEXT NOT NULL
);

CREATE TABLE users (
    id                   TEXT PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name            TEXT NOT NULL,
    password_hash        TEXT NOT NULL,
    pin_hash             TEXT,
    role                 TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','waiter','kitchen')),
    active               INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);

CREATE TABLE devices (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('terminal','kds','waiter','display','remote')),
    paired_at  TEXT NOT NULL,
    last_seen  TEXT,
    revoked_at TEXT
);

CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,      -- sha256 of the bearer token; the token itself is never stored
    user_id      TEXT NOT NULL REFERENCES users(id),
    device_id    TEXT REFERENCES devices(id),
    channel      TEXT NOT NULL CHECK (channel IN ('app','lan','tunnel')),
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE kitchen_stations (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    printer TEXT,                       -- printer config key, NULL = KDS only
    active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE categories (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL UNIQUE,
    kitchen_station_id TEXT REFERENCES kitchen_stations(id),
    sort               INTEGER NOT NULL DEFAULT 0,
    active             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id),
    price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
    image_path  TEXT,                   -- file under the data dir, not base64 in the row
    description TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX items_category ON items(category_id);

CREATE TABLE modifier_groups (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    min_select INTEGER NOT NULL DEFAULT 0,
    max_select INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
    active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE modifiers (
    id          TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
    sort        INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE item_modifier_groups (
    item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    sort     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, group_id)
);

CREATE TABLE dining_tables (
    id     TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    area   TEXT NOT NULL DEFAULT '',
    seats  INTEGER NOT NULL DEFAULT 4,
    sort   INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE customers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT UNIQUE,
    address    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE shifts (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id),
    device_id           TEXT NOT NULL REFERENCES devices(id),
    status              TEXT NOT NULL CHECK (status IN ('open','closed')),
    opening_float_minor INTEGER NOT NULL DEFAULT 0,
    expected_cash_minor INTEGER,
    counted_cash_minor  INTEGER,
    opened_at           TEXT NOT NULL,
    closed_at           TEXT
);
-- one open shift per cashier per terminal
CREATE UNIQUE INDEX shifts_one_open ON shifts(user_id, device_id) WHERE status = 'open';

CREATE TABLE cash_movements (
    id           TEXT PRIMARY KEY,
    shift_id     TEXT NOT NULL REFERENCES shifts(id),
    kind         TEXT NOT NULL CHECK (kind IN ('in','out')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    reason       TEXT NOT NULL,
    user_id      TEXT NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL
);

CREATE TABLE orders (
    id                    TEXT PRIMARY KEY,
    number                INTEGER NOT NULL,          -- daily ticket number shown to kitchen/customer
    business_date         TEXT NOT NULL,             -- YYYY-MM-DD
    type                  TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','delivery')),
    status                TEXT NOT NULL CHECK (status IN ('open','held','paid','void')),
    table_id              TEXT REFERENCES dining_tables(id),
    customer_id           TEXT REFERENCES customers(id),
    shift_id              TEXT REFERENCES shifts(id),
    user_id               TEXT NOT NULL REFERENCES users(id),
    guests                INTEGER NOT NULL DEFAULT 0,
    notes                 TEXT NOT NULL DEFAULT '',
    discount_kind         TEXT NOT NULL DEFAULT '',
    discount_rate_bp      INTEGER NOT NULL DEFAULT 0,
    discount_amount_minor INTEGER NOT NULL DEFAULT 0,
    discount_reason       TEXT NOT NULL DEFAULT '',
    subtotal_minor        INTEGER NOT NULL DEFAULT 0,
    line_discounts_minor  INTEGER NOT NULL DEFAULT 0,
    order_discount_minor  INTEGER NOT NULL DEFAULT 0,
    service_minor         INTEGER NOT NULL DEFAULT 0,
    tax_minor             INTEGER NOT NULL DEFAULT 0,
    total_minor           INTEGER NOT NULL DEFAULT 0,
    void_reason           TEXT NOT NULL DEFAULT '',
    idempotency_key       TEXT UNIQUE,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    closed_at             TEXT,
    UNIQUE (business_date, number)
);
CREATE INDEX orders_status ON orders(status);
CREATE INDEX orders_shift ON orders(shift_id);
CREATE INDEX orders_created ON orders(created_at);

CREATE TABLE order_lines (
    id                    TEXT PRIMARY KEY,
    order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id               TEXT NOT NULL REFERENCES items(id),
    name                  TEXT NOT NULL,             -- snapshot at sale time
    unit_price_minor      INTEGER NOT NULL,          -- snapshot at sale time
    qty_milli             INTEGER NOT NULL CHECK (qty_milli > 0),
    discount_kind         TEXT NOT NULL DEFAULT '',
    discount_rate_bp      INTEGER NOT NULL DEFAULT 0,
    discount_amount_minor INTEGER NOT NULL DEFAULT 0,
    gross_minor           INTEGER NOT NULL,
    net_minor             INTEGER NOT NULL,
    notes                 TEXT NOT NULL DEFAULT '',
    course                INTEGER NOT NULL DEFAULT 1,
    kitchen_status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (kitchen_status IN ('pending','sent','preparing','ready','served')),
    sent_at               TEXT,
    voided_at             TEXT,
    void_reason           TEXT NOT NULL DEFAULT '',
    voided_by             TEXT REFERENCES users(id),
    sort                  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX order_lines_order ON order_lines(order_id);
CREATE INDEX order_lines_kitchen ON order_lines(kitchen_status) WHERE voided_at IS NULL;

CREATE TABLE order_line_modifiers (
    id          TEXT PRIMARY KEY,
    line_id     TEXT NOT NULL REFERENCES order_lines(id) ON DELETE CASCADE,
    modifier_id TEXT REFERENCES modifiers(id),
    name        TEXT NOT NULL,
    price_minor INTEGER NOT NULL
);

CREATE TABLE payments (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES orders(id),
    shift_id        TEXT REFERENCES shifts(id),
    method          TEXT NOT NULL,           -- cash, card, wallet, ... (configurable)
    amount_minor    INTEGER NOT NULL,        -- negative for refunds
    tendered_minor  INTEGER,                 -- cash given, for change calculation
    reference       TEXT NOT NULL DEFAULT '',
    user_id         TEXT NOT NULL REFERENCES users(id),
    idempotency_key TEXT UNIQUE,
    created_at      TEXT NOT NULL
);
CREATE INDEX payments_order ON payments(order_id);
CREATE INDEX payments_shift ON payments(shift_id);

-- Gapless invoice numbering per terminal; incremented inside the payment transaction.
CREATE TABLE invoice_counters (
    device_id   TEXT PRIMARY KEY REFERENCES devices(id),
    prefix      TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoices (
    id        TEXT PRIMARY KEY,
    order_id  TEXT NOT NULL UNIQUE REFERENCES orders(id),
    number    TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL REFERENCES devices(id),
    issued_at TEXT NOT NULL
);

CREATE TABLE refunds (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES invoices(id),
    shift_id        TEXT REFERENCES shifts(id),
    reason          TEXT NOT NULL,
    total_minor     INTEGER NOT NULL,
    user_id         TEXT NOT NULL REFERENCES users(id),
    idempotency_key TEXT UNIQUE,
    created_at      TEXT NOT NULL
);

CREATE TABLE refund_lines (
    id            TEXT PRIMARY KEY,
    refund_id     TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
    order_line_id TEXT NOT NULL REFERENCES order_lines(id),
    qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
    amount_minor  INTEGER NOT NULL
);

-- Append-only: the triggers below reject any UPDATE or DELETE.
CREATE TABLE audit_log (
    id        TEXT PRIMARY KEY,
    at        TEXT NOT NULL,
    user_id   TEXT,
    device_id TEXT,
    channel   TEXT NOT NULL,
    action    TEXT NOT NULL,
    entity    TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    data      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log(at);
CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);

-- +goose StatementBegin
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
-- +goose StatementEnd

-- +goose Down
-- Intentionally empty: customer data is never migrated down.
-- Roll back by restoring the automatic pre-migration backup.
