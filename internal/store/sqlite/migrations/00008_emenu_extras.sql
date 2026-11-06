-- +goose Up
-- Estimated time: minutes each item takes, and what a guest was promised.
ALTER TABLE items ADD COLUMN prep_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE online_orders ADD COLUMN eta_minutes INTEGER NOT NULL DEFAULT 0;

-- Featured items carry a short note, and a hot deal its e-menu price.
ALTER TABLE emenu_featured ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE emenu_featured ADD COLUMN deal_price_minor INTEGER NOT NULL DEFAULT 0;

-- What an offer is made of, from items already on the menu. The offer stays
-- one item with its own price; these rows tell the kitchen what to make and
-- stock what to deduct.
CREATE TABLE emenu_offer_items (
    offer_id TEXT NOT NULL REFERENCES emenu_offers(id) ON DELETE CASCADE,
    item_id  TEXT NOT NULL REFERENCES items(id),
    qty      INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 50),
    sort     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (offer_id, item_id)
);
CREATE INDEX emenu_offer_items_item ON emenu_offer_items(item_id);

-- Guests can also report a problem with the food, with a short description.
-- SQLite can't change a CHECK constraint in place, so the table is rebuilt.
CREATE TABLE service_requests_new (
    id         TEXT PRIMARY KEY,
    table_id   TEXT NOT NULL REFERENCES dining_tables(id),
    kind       TEXT NOT NULL CHECK (kind IN ('waiter','bill','issue')),
    note       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
    created_at TEXT NOT NULL,
    done_by    TEXT REFERENCES users(id),
    done_at    TEXT
);
INSERT INTO service_requests_new (id, table_id, kind, status, created_at, done_by, done_at)
SELECT id, table_id, kind, status, created_at, done_by, done_at FROM service_requests;
DROP TABLE service_requests;
ALTER TABLE service_requests_new RENAME TO service_requests;
CREATE INDEX service_requests_open ON service_requests(status, created_at);

-- +goose Down
