package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"time"

	"github.com/oklog/ulid/v2"
)

// Querier is satisfied by *sql.DB and *sql.Tx, so the same query code runs
// inside or outside a transaction.
type Querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// TimeFormat sorts lexically in time order (fixed width, always UTC).
const TimeFormat = "2006-01-02T15:04:05.000Z"

func FormatTime(t time.Time) string { return t.UTC().Format(TimeFormat) }

func ParseTime(s string) time.Time {
	t, _ := time.Parse(TimeFormat, s)
	return t
}

// NewID returns a ULID: unique, sortable by creation time.
func NewID() string {
	return ulid.MustNew(ulid.Timestamp(time.Now()), rand.Reader).String()
}

// Bool converts SQLite's 0/1 integers.
func Bool(i int64) bool { return i != 0 }

func Int(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// NullString maps "" to NULL for optional foreign keys.
func NullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}
