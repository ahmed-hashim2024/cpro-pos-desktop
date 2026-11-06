package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func openTemp(t *testing.T) *DB {
	t.Helper()
	db, err := Open(context.Background(), filepath.Join(t.TempDir(), "cpro.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestOpenMigratesAndReopens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cpro.db")
	ctx := context.Background()
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.Read.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='orders'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("orders table missing: n=%d err=%v", n, err)
	}
	db.Close()
	db, err = Open(ctx, path) // no pending migrations: must not back up or fail
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
}

func TestPragmas(t *testing.T) {
	db := openTemp(t)
	var mode string
	var fk int
	db.Write.QueryRow(`PRAGMA journal_mode`).Scan(&mode)
	db.Write.QueryRow(`PRAGMA foreign_keys`).Scan(&fk)
	if mode != "wal" || fk != 1 {
		t.Fatalf("journal_mode=%s foreign_keys=%d", mode, fk)
	}
}

func TestAuditLogIsAppendOnly(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	if _, err := db.Write.ExecContext(ctx, `INSERT INTO audit_log(id, at, channel, action) VALUES ('a','now','app','test')`); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{`UPDATE audit_log SET action='x'`, `DELETE FROM audit_log`} {
		if _, err := db.Write.ExecContext(ctx, q); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Errorf("%s: err = %v", q, err)
		}
	}
}

func TestOneOpenShiftPerUserAndDevice(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	err := db.Tx(ctx, func(tx *sql.Tx) error {
		for _, q := range []string{
			`INSERT INTO users(id, username, full_name, password_hash, role, created_at, updated_at) VALUES ('u','c','C','x','cashier','t','t')`,
			`INSERT INTO devices(id, name, kind, paired_at) VALUES ('d','POS 1','terminal','t')`,
			`INSERT INTO shifts(id, user_id, device_id, status, opened_at) VALUES ('s1','u','d','open','t')`,
		} {
			if _, err := tx.ExecContext(ctx, q); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Write.ExecContext(ctx, `INSERT INTO shifts(id, user_id, device_id, status, opened_at) VALUES ('s2','u','d','open','t')`)
	if err == nil {
		t.Fatal("second open shift was allowed")
	}
}

func TestTxRollsBackOnError(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	_ = db.Tx(ctx, func(tx *sql.Tx) error {
		tx.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES ('k','1','t')`)
		return sql.ErrNoRows
	})
	var n int
	db.Read.QueryRow(`SELECT count(*) FROM settings`).Scan(&n)
	if n != 0 {
		t.Fatalf("rollback failed, %d rows", n)
	}
}

func TestBackupTo(t *testing.T) {
	db := openTemp(t)
	dest := filepath.Join(t.TempDir(), "b.db")
	if err := db.BackupTo(context.Background(), dest); err != nil {
		t.Fatal(err)
	}
	if err := db.BackupTo(context.Background(), dest); err == nil {
		t.Fatal("overwriting an existing backup must fail")
	}
}
