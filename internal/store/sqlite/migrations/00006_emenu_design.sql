-- +goose Up
-- E-menu designer: the owner builds the guest menu from the desktop app.

-- Round picture shown for each category in the guest menu.
ALTER TABLE categories ADD COLUMN image_path TEXT;

-- Offers shown on the guest home page. Each offer is a real catalog item
-- (name, price, description and picture live on the item), so ordering,
-- kitchen routing, reports and refunds treat it like any other item.
--   single: the big slider at the top (one person)
--   family: the wide banners lower down (bundles for groups / families)
CREATE TABLE emenu_offers (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('single','family')),
    item_id    TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    badge      TEXT NOT NULL DEFAULT '',   -- small label, e.g. «جديد»
    highlight  TEXT NOT NULL DEFAULT '',   -- round sticker, e.g. «وفّر 20%»
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Items picked for the "popular" row, each with an optional badge.
CREATE TABLE emenu_featured (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    badge   TEXT NOT NULL DEFAULT '' CHECK (badge IN ('','bestseller','hot_deal','new')),
    sort    INTEGER NOT NULL DEFAULT 0
);

-- Guest accounts: a customer signs in on the e-menu with phone + password.
-- Only a bcrypt hash is stored; sessions keep only a SHA-256 of the token.
ALTER TABLE customers ADD COLUMN password_hash TEXT;

CREATE TABLE customer_sessions (
    token_hash  TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
CREATE INDEX customer_sessions_customer ON customer_sessions(customer_id);

-- Orders placed while signed in are attached to the customer.
ALTER TABLE online_orders ADD COLUMN customer_id TEXT REFERENCES customers(id);

-- +goose Down
