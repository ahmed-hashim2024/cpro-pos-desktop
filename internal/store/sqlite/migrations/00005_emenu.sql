-- +goose Up
-- E-menu: guests reach the restaurant through its domain. Each table's QR
-- code carries an unguessable token (never the table id) so the link can be
-- regenerated if a code is copied.
ALTER TABLE dining_tables ADD COLUMN qr_token TEXT;
UPDATE dining_tables SET qr_token = lower(hex(randomblob(12)));
CREATE UNIQUE INDEX dining_tables_qr ON dining_tables(qr_token);

-- "Call the waiter" / "bring the bill" from a table.
CREATE TABLE service_requests (
    id         TEXT PRIMARY KEY,
    table_id   TEXT NOT NULL REFERENCES dining_tables(id),
    kind       TEXT NOT NULL CHECK (kind IN ('waiter','bill')),
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
    created_at TEXT NOT NULL,
    done_by    TEXT REFERENCES users(id),
    done_at    TEXT
);
CREATE INDEX service_requests_open ON service_requests(status, created_at);

-- Orders placed from the e-menu wait here until staff accept them; only
-- then do they become real orders (prices are always computed here).
CREATE TABLE online_orders (
    id            TEXT PRIMARY KEY,
    public_token  TEXT NOT NULL UNIQUE,  -- what the guest's phone polls with
    type          TEXT NOT NULL CHECK (type IN ('dine_in','takeaway')),
    table_id      TEXT REFERENCES dining_tables(id),
    customer_name TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
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
CREATE INDEX online_orders_status ON online_orders(status, created_at);

-- +goose Down
