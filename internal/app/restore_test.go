package app

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"cpro/internal/domain/rbac"
	"cpro/internal/platform/paths"
	"cpro/internal/saas"
	"cpro/internal/store/sqlite"
)

var pngBytes = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)

// emptyComputer is a new install: no users yet, its own account link and backup folder.
func emptyComputer(t *testing.T) (*App, paths.Paths) {
	t.Helper()
	t.Setenv("CPRO_DATA_DIR", t.TempDir())
	p, err := paths.Resolve()
	if err != nil {
		t.Fatal(err)
	}
	db, err := sqlite.Open(context.Background(), p.DB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	a := New(db, p, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.relaunch = func() {}
	return a, p
}

func (f *fixture) backupFile() string {
	f.t.Helper()
	b, err := f.app.BackupNow(f.ctx, f.owner, "manual")
	f.must(err)
	return filepath.Join(f.app.paths.Backups, b.Name)
}

func TestBackupMovesToANewComputer(t *testing.T) {
	f := newFixture(t)
	ctx := f.ctx
	m := f.menu()
	_, err := f.app.OpenShift(ctx, f.owner, 0)
	f.must(err)
	sold := sell(f, m.burger)
	f.must(os.WriteFile(filepath.Join(f.app.paths.Images, "burger.png"), pngBytes, 0o644))
	_, err = f.app.db.Write.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES (?,'{"old":1}','x')`, platformKey)
	f.must(err)
	backup := f.backupFile()

	a, p := emptyComputer(t)
	_, err = a.db.Write.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES (?,'{"mine":1}','x')`, platformKey)
	f.must(err)
	restarted := make(chan struct{})
	a.relaunch = func() { close(restarted) }
	f.must(a.RestoreFirstRun(ctx, backup))
	select {
	case <-restarted:
	case <-time.After(5 * time.Second):
		t.Fatal("the app didn't restart")
	}

	// The next start: the backup takes over.
	f.must(a.db.Close())
	f.must(sqlite.ApplyPending(p.DB, p.PendingRestore()))
	if _, err := os.Stat(p.PendingRestore()); !os.IsNotExist(err) {
		t.Fatal("pending restore left behind")
	}
	db, err := sqlite.Open(ctx, p.DB)
	f.must(err)
	defer db.Close()
	r := New(db, p, a.log)

	if n := count(t, r, `SELECT count(*) FROM orders WHERE id = ?`, sold.ID); n != 1 {
		t.Fatal("the sale didn't come back")
	}
	if n := count(t, r, `SELECT count(*) FROM sqlite_master WHERE name = ?`, backupImagesTable); n != 0 {
		t.Fatal("the pictures table stayed in the live database")
	}
	if n := count(t, r, `SELECT count(*) FROM sessions WHERE revoked_at IS NULL`); n != 0 {
		t.Fatal("old sign-ins still work")
	}
	var link string
	f.must(db.Read.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, platformKey).Scan(&link))
	if link != `{"mine":1}` {
		t.Fatalf("account link replaced by the old computer's: %s", link)
	}
	if b, err := os.ReadFile(filepath.Join(p.Images, "burger.png")); err != nil || len(b) != len(pngBytes) {
		t.Fatalf("picture: %v", err)
	}
	if _, err := r.Login(ctx, LoginInput{Username: "owner", Password: "owner1234"}, ChannelApp, "127.0.0.1"); err != nil {
		t.Fatalf("the owner can't sign in: %v", err)
	}
}

// The account's address and license survive a restore, because they belong
// to this computer's link, not to the file.
func TestRestoreKeepsTheAccount(t *testing.T) {
	old := newFixture(t)
	backup := old.backupFile()

	f, fake := linkedFixture(t)
	a, ctx := f.app, f.ctx
	a.relaunch = func() {}
	fake.Lock()
	fake.Tenants["ACT-TEST"].Tunnel = &saas.Tunnel{Domain: "gem.menu.test", ConnectorToken: "tok"}
	fake.Unlock()
	if _, err := a.ActivateDevice(ctx, f.owner, "ACT-TEST", ""); err != nil {
		t.Fatal(err)
	}
	if acc := a.Account(); acc == nil || !acc.HasDomain || acc.Domain != "gem.menu.test" {
		t.Fatalf("account after connecting: %+v", acc)
	}
	f.must(a.RestoreUpload(ctx, f.owner, backup))

	p, client := a.paths, a.platform.client
	f.must(a.db.Close())
	f.must(sqlite.ApplyPending(p.DB, p.PendingRestore()))
	db, err := sqlite.Open(ctx, p.DB)
	f.must(err)
	defer db.Close()
	r := New(db, p, a.log)
	f.must(r.EnablePlatform(ctx, client))
	if r.NeedsConnect() {
		t.Fatal("the restored app asks to connect again")
	}
	if token, domain := r.TunnelConfig(); token != "tok" || domain != "gem.menu.test" {
		t.Fatalf("tunnel: %q %q", token, domain)
	}
}

func TestRestoreKeepsThisComputersBackupFolder(t *testing.T) {
	f := newFixture(t)
	s, err := f.app.Settings(f.ctx, f.owner)
	f.must(err)
	s.BackupDir = "/old/computer"
	f.must(f.app.tx(f.ctx, func(tx *sql.Tx) error { return f.app.saveSettings(f.ctx, tx, s) }))
	backup := f.backupFile()

	a, p := emptyComputer(t)
	f.must(a.restore(f.ctx, backup, false))
	db, err := sqlite.ReadFile(p.PendingRestore())
	f.must(err)
	defer db.Close()
	got, err := loadSettings(f.ctx, db)
	f.must(err)
	if got.BackupDir != "" {
		t.Fatalf("backup dir: %q", got.BackupDir)
	}
}

func TestRestoreRefusals(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	a.relaunch = func() {}
	backup := f.backupFile()
	dir := t.TempDir()
	write := func(name string, b []byte) string {
		p := filepath.Join(dir, name)
		f.must(os.WriteFile(p, b, 0o644))
		return p
	}

	for name, path := range map[string]string{
		"not a database": write("a.db", []byte("hello, this is not a backup")),
		"a transfer zip": write("b.db", []byte("PK\x03\x04 data")),
	} {
		if err := a.RestoreUpload(ctx, owner, path); code(err) != CodeInvalid {
			t.Errorf("%s: %v", name, err)
		}
	}
	other, _ := sqlite.Open(ctx, filepath.Join(dir, "empty.db")) // a database with no owner
	other.Close()
	if err := a.RestoreUpload(ctx, owner, filepath.Join(dir, "empty.db")); code(err) != CodeInvalid {
		t.Errorf("no owner: %v", err)
	}
	// From a newer version of the app.
	newer := filepath.Join(dir, "newer.db")
	f.must(copyFile(backup, newer))
	f.must(sqlite.EditFile(ctx, newer, false, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO goose_db_version(version_id, is_applied) VALUES (9999, 1)`)
		return err
	}))
	if err := a.RestoreUpload(ctx, owner, newer); code(err) != CodeInvalid {
		t.Errorf("newer: %v", err)
	}

	// Only the owner, only at the computer itself.
	manager := owner
	manager.Role = rbac.Manager
	if err := a.RestoreUpload(ctx, manager, backup); code(err) != CodeForbidden {
		t.Errorf("manager: %v", err)
	}
	lan := owner
	lan.Channel = ChannelLAN
	if err := a.RestoreUpload(ctx, lan, backup); code(err) != CodeForbidden {
		t.Errorf("lan: %v", err)
	}
	// With users here, the first-run door is closed.
	if err := a.RestoreFirstRun(ctx, backup); code(err) != CodeConflict {
		t.Errorf("first run: %v", err)
	}
	if _, err := os.Stat(a.paths.PendingRestore()); !os.IsNotExist(err) {
		t.Fatal("a refused restore left a pending file")
	}

	// A good one keeps the way back.
	before := count(t, a, `SELECT count(*) FROM users`)
	f.must(a.RestoreSaved(ctx, owner, filepath.Base(backup)))
	list, err := a.Backups(ctx, owner)
	f.must(err)
	found := false
	for _, b := range list {
		ok, _ := filepath.Match("cpro-*-pre-restore*.db", b.Name)
		found = found || ok
	}
	if !found || before == 0 {
		t.Fatalf("no safety backup: %+v", list)
	}
}
