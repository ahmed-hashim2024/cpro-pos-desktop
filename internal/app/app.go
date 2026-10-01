// Package app holds the use cases. Every transport (HTTP in-app, LAN,
// tunnel) calls these and nothing else; each use case receives the Actor
// performing it and checks its permissions itself.
package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"cpro/internal/domain/rbac"
	"cpro/internal/platform/paths"
	"cpro/internal/store/sqlite"
)

type App struct {
	db    *sqlite.DB
	paths paths.Paths
	log   *slog.Logger
	now   func() time.Time

	platform     *platformLink       // nil: licensing off (tests, tools)
	tunnelStatus func() TunnelStatus // set by main
	limits       *rateLimiter        // public e-menu endpoints
}

func New(db *sqlite.DB, p paths.Paths, log *slog.Logger) *App {
	return &App{db: db, paths: p, log: log, now: time.Now, limits: newRateLimiter()}
}

// Channel is how a request reached the app.
type Channel string

const (
	ChannelApp    Channel = "app"    // the desktop window itself
	ChannelLAN    Channel = "lan"    // tablets / KDS screens on the restaurant network
	ChannelTunnel Channel = "tunnel" // remote access through the owner's domain
)

// Actor is the authenticated user behind a call.
type Actor struct {
	UserID   string
	Name     string
	Role     rbac.Role
	DeviceID string
	Channel  Channel
}

func (a Actor) Can(p rbac.Permission) bool { return a.Role.Can(p) }

// ---- errors ----------------------------------------------------------------

type Code string

const (
	CodeInvalid      Code = "invalid"
	CodeNotFound     Code = "not_found"
	CodeForbidden    Code = "forbidden"
	CodeConflict     Code = "conflict"
	CodeUnauthorized Code = "unauthorized"
)

// Error carries a code the transport maps to a status, and a message safe
// to show the user (Arabic).
type Error struct {
	Code Code
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

func errf(code Code, format string, args ...any) error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, args...)}
}

func invalid(msg string) error   { return &Error{CodeInvalid, msg} }
func notFound(what string) error { return &Error{CodeNotFound, what + " غير موجود"} }
func conflict(msg string) error  { return &Error{CodeConflict, msg} }

var errForbidden = &Error{CodeForbidden, "ليس لديك صلاحية لتنفيذ هذا الإجراء"}

func (a Actor) require(p rbac.Permission) error {
	if !a.Can(p) {
		return errForbidden
	}
	return nil
}

// noRows turns sql.ErrNoRows into a not-found error.
func noRows(err error, what string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return notFound(what)
	}
	return err
}

// ---- audit -----------------------------------------------------------------

func (a *App) audit(ctx context.Context, q sqlite.Querier, actor Actor, action, entity, entityID string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if data == nil {
		b = []byte("{}")
	}
	_, err = q.ExecContext(ctx,
		`INSERT INTO audit_log(id, at, user_id, device_id, channel, action, entity, entity_id, data)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		sqlite.NewID(), a.stamp(), sqlite.NullString(actor.UserID), sqlite.NullString(actor.DeviceID),
		string(actor.Channel), action, entity, entityID, string(b))
	return err
}

// ---- time ------------------------------------------------------------------

func (a *App) stamp() string { return sqlite.FormatTime(a.now()) }

// businessDate returns the trading day t belongs to. A restaurant's day
// doesn't end at midnight: with DayStartHour=6, a sale at 02:00 belongs to
// the previous day.
func businessDate(t time.Time, dayStartHour int) string {
	return t.In(time.Local).Add(-time.Duration(dayStartHour) * time.Hour).Format(time.DateOnly)
}

// dayRange converts business dates [from, to] (inclusive) into UTC
// timestamps [start, end) for querying created_at columns.
func dayRange(from, to string, dayStartHour int) (string, string, error) {
	f, err := time.ParseInLocation(time.DateOnly, from, time.Local)
	if err != nil {
		return "", "", invalid("تاريخ البداية غير صحيح")
	}
	t, err := time.ParseInLocation(time.DateOnly, to, time.Local)
	if err != nil {
		return "", "", invalid("تاريخ النهاية غير صحيح")
	}
	if t.Before(f) {
		return "", "", invalid("تاريخ النهاية قبل تاريخ البداية")
	}
	h := time.Duration(dayStartHour) * time.Hour
	return sqlite.FormatTime(f.Add(h)), sqlite.FormatTime(t.AddDate(0, 0, 1).Add(h)), nil
}

func (a *App) tx(ctx context.Context, fn func(*sql.Tx) error) error { return a.db.Tx(ctx, fn) }
