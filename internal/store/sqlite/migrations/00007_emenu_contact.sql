-- +goose Up
-- Guest accounts (phone + password) are replaced by contact details the
-- guest keeps on their own phone and sends with each order. Staff link the
-- order to a customer by phone when they accept it.
DROP TABLE customer_sessions;
ALTER TABLE customers DROP COLUMN password_hash;

-- Online orders can now be delivery orders (with an address), and dine-in
-- orders can name the table by its number instead of a QR code. SQLite
-- can't change a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE online_orders_new (
    id            TEXT PRIMARY KEY,
    public_token  TEXT NOT NULL UNIQUE,
    type          TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','delivery')),
    table_id      TEXT REFERENCES dining_tables(id),
    customer_id   TEXT REFERENCES customers(id),
    customer_name TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    address       TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    lines_json    TEXT NOT NULL,
    total_minor   INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired')),
    order_id      TEXT REFERENCES orders(id),
    reject_reason TEXT NOT NULL DEFAULT '',
    ip            TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    decided_at    TEXT,
    decided_by    TEXT REFERENCES users(id)
);
INSERT INTO online_orders_new (id, public_token, type, table_id, customer_id, customer_name, phone, notes, lines_json, total_minor,
                               status, order_id, reject_reason, ip, created_at, decided_at, decided_by)
SELECT id, public_token, type, table_id, customer_id, customer_name, phone, notes, lines_json, total_minor,
       status, order_id, reject_reason, ip, created_at, decided_at, decided_by
  FROM online_orders;
DROP TABLE online_orders;
ALTER TABLE online_orders_new RENAME TO online_orders;
CREATE INDEX online_orders_status ON online_orders(status, created_at);

-- +goose Down
