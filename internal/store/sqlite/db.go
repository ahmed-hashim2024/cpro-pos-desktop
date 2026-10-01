// Package sqlite opens the local database, applies migrations and provides
// transactions. It uses the pure-Go modernc driver so builds need no CGO.
package sqlite

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB keeps writes on a single connection (SQLite allows one writer at a
// time; serialising in Go avoids SQLITE_BUSY) and reads on a pool.
type DB struct {
	Write *sql.DB
	Read  *sql.DB
	path  string
}

func dsn(path string, readOnly bool) string {
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(ON)")
	if readOnly {
		// Switching journal mode is a write; read-only handles inherit WAL
		// from the file the writer already converted.
		q.Add("mode", "ro")
	} else {
		q.Add("_pragma", "journal_mode(WAL)")
		q.Add("_pragma", "synchronous(NORMAL)")
		q.Add("_txlock", "immediate")
	}
	return "file:" + filepath.ToSlash(path) + "?" + q.Encode()
}

// Open opens (creating if needed) the database at path and migrates it to
// the latest schema. If there are pending migrations on an existing file,
// a backup is written next to it first.
func Open(ctx context.Context, path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	w, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	if err := w.PingContext(ctx); err != nil {
		w.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	db := &DB{Write: w, path: path}
	if err := db.migrate(ctx); err != nil {
		w.Close()
		return nil, err
	}
	r, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(4)
	db.Read = r
	return db, nil
}

func (db *DB) Close() error {
	errR := db.Read.Close()
	errW := db.Write.Close()
	if errW != nil {
		return errW
	}
	return errR
}

func (db *DB) migrate(ctx context.Context) error {
	dir, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, db.Write, dir, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		return err
	}
	pending, err := provider.HasPending(ctx)
	if err != nil {
		return err
	}
	if !pending {
		return nil
	}
	current, err := provider.GetDBVersion(ctx)
	if err != nil {
		return err
	}
	if current > 0 {
		name := fmt.Sprintf("%s.pre-migrate-v%d-%s.bak", db.path, current, time.Now().UTC().Format("20060102T150405"))
		if err := db.BackupTo(ctx, name); err != nil {
			return fmt.Errorf("pre-migration backup: %w", err)
		}
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}

// BackupTo writes a consistent copy of the live database to dest.
func (db *DB) BackupTo(ctx context.Context, dest string) error {
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("backup target %s already exists", dest)
	}
	_, err := db.Write.ExecContext(ctx, "VACUUM INTO ?", dest)
	return err
}

// Tx runs fn in a write transaction, committing on nil and rolling back on
// error or panic.
func (db *DB) Tx(ctx context.Context, fn func(*sql.Tx) error) (err error) {
	tx, err := db.Write.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		}
		if err != nil {
			tx.Rollback()
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// CheckIntegrity opens a database file read-only and runs integrity_check.
func CheckIntegrity(ctx context.Context, path string) (string, error) {
	db, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		return "", err
	}
	defer db.Close()
	var res string
	err = db.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&res)
	return res, err
}
