-- +goose Up
-- A closed shift's counted cash can be corrected by a manager (miscount,
-- money found later). Each correction is kept; the shift holds the latest.
CREATE TABLE shift_recounts (
    id                  TEXT PRIMARY KEY,
    shift_id            TEXT NOT NULL REFERENCES shifts(id),
    previous_minor      INTEGER NOT NULL,
    counted_minor       INTEGER NOT NULL,
    reason              TEXT NOT NULL,
    user_id             TEXT NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL
);
CREATE INDEX shift_recounts_shift ON shift_recounts(shift_id, created_at);

-- +goose Down
