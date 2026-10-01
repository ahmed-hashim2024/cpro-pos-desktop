-- +goose Up
-- Catalog rows that past orders point to can't be removed outright; they are
-- archived instead (hidden everywhere, kept for history and reports).
ALTER TABLE items ADD COLUMN deleted_at TEXT;
ALTER TABLE dining_tables ADD COLUMN deleted_at TEXT;
ALTER TABLE modifier_groups ADD COLUMN deleted_at TEXT;

-- +goose Down
