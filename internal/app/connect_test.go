package app

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"cpro/internal/domain/rbac"
	"cpro/internal/license"
	"cpro/internal/saas/saastest"
)

func TestContinueWithGoogle(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx := f.app, f.ctx
	if !a.NeedsConnect() {
		t.Fatal("a new install is connected")
	}
	if st := a.ConnectState(); st.State != "idle" {
		t.Fatalf("before start: %+v", st)
	}
	link, err := a.StartConnect(ctx)
	f.must(err)
	u, err := url.Parse(link)
	f.must(err)
	if !strings.HasPrefix(link, fake.URL+"/portal/connect?") || u.Query().Get("state") == "" {
		t.Fatalf("link: %s", link)
	}

	// A wrong state is refused, and doesn't use up the attempt.
	bad, err := http.Get("http://127.0.0.1:" + u.Query().Get("port") + "/connect?state=nope&token=x")
	f.must(err)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest || a.ConnectState().State != "waiting" {
		t.Fatalf("bad state: %d %+v", bad.StatusCode, a.ConnectState())
	}

	// The browser signs in and comes back: the app is connected, no key typed.
	res, err := http.Get(link)
	f.must(err)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), "تم ربط البرنامج") {
		t.Fatalf("page: %s", body)
	}
	if st := a.ConnectState(); st.State != "done" {
		t.Fatalf("after: %+v", st)
	}
	if a.NeedsConnect() || a.licenseStatus().State != license.Active {
		t.Fatalf("not connected: %+v", a.licenseStatus())
	}
	if _, err := a.StartConnect(ctx); code(err) != CodeConflict {
		t.Fatalf("second connect: %v", err)
	}

	// A device removed on the Platform connects again the same way.
	fake.Revoke(a.platform.client.ID.DeviceID)
	a.syncOnce(ctx, false)
	if !a.NeedsConnect() {
		t.Fatal("revoked device doesn't need connecting")
	}
	link, err = a.StartConnect(ctx)
	f.must(err)
	res, err = http.Get(link)
	f.must(err)
	res.Body.Close()
	if a.NeedsConnect() {
		t.Fatalf("not reconnected: %+v", a.ConnectState())
	}
}

func TestConnectFailureIsReported(t *testing.T) {
	f, fake := linkedFixture(t)
	a := f.app
	fake.Update("ACT-TEST", func(t *saastest.Tenant) { t.Status = "suspended" })
	link, err := a.StartConnect(f.ctx)
	f.must(err)
	res, err := http.Get(link)
	f.must(err)
	res.Body.Close()
	if st := a.ConnectState(); st.State != "failed" || st.Error == "" {
		t.Fatalf("state: %+v", st)
	}
	if !a.NeedsConnect() {
		t.Fatal("connected to a suspended account")
	}
}

func TestDomainFromTheApp(t *testing.T) {
	f, _ := linkedFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	if _, err := a.CheckDomain(ctx, "pizza"); code(err) != CodeInvalid {
		t.Fatalf("check before connecting: %v", err)
	}
	_, err := a.ActivateDevice(ctx, owner, "ACT-TEST", "")
	f.must(err)

	c, err := a.CheckDomain(ctx, " Pizza-House ")
	f.must(err)
	if !c.Available || c.Domain != "pizza-house.menu.test" {
		t.Fatalf("free: %+v", c)
	}
	if c, _ := a.CheckDomain(ctx, "taken"); c.Available || c.Reason != "taken" {
		t.Fatalf("taken: %+v", c)
	}
	if c, _ := a.ClaimDomain(ctx, owner, "taken"); c.Available || c.Reason != "taken" {
		t.Fatalf("claim taken: %+v", c)
	}
	if _, err := a.ClaimDomain(ctx, f.login(rbac.Cashier, "cashier"), "x"); code(err) != CodeForbidden {
		t.Fatalf("cashier claimed: %v", err)
	}
	c, err = a.ClaimDomain(ctx, owner, "pizza-house")
	f.must(err)
	if !c.Available {
		t.Fatalf("claim: %+v", c)
	}
	a.syncOnce(ctx, true)
	if _, domain := a.TunnelConfig(); domain != "pizza-house.menu.test" {
		t.Fatalf("tunnel not installed: %q", domain)
	}
}

func TestOfflineCountdownStopsSelling(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	_, err := a.ActivateDevice(ctx, owner, "ACT-TEST", "")
	f.must(err)
	start := time.Now()
	at := func(days int) { a.now = func() time.Time { return start.Add(time.Duration(days) * 24 * time.Hour) } }

	// The Platform stops answering. Nothing changes for two weeks.
	f.must(a.SetPlatformURL(ctx, owner, "https://127.0.0.1:1"))
	at(13)
	a.syncOnce(ctx, false)
	if st := a.licenseStatus(); st.State != license.Active {
		t.Fatalf("day 13: %+v", st)
	}
	// Then seven days of countdown, still selling.
	at(16)
	info, err := a.PlatformInfo(ctx, owner)
	f.must(err)
	if info.State != license.Grace || info.GraceUntil == "" {
		t.Fatalf("day 16: %+v", info)
	}
	if err := a.requireLicensed(); err != nil {
		t.Fatalf("day 16: %v", err)
	}
	// Then it stops.
	at(22)
	if st := a.licenseStatus(); st.State != license.Restricted || st.Reason != license.ReasonOffline {
		t.Fatalf("day 22: %+v", st)
	}
	if a.requireLicensed() == nil {
		t.Fatal("sold while offline too long")
	}

	// Back online: the next sync restores it by itself.
	fake.LicenseNow = a.now
	f.must(a.SetPlatformURL(ctx, owner, fake.URL))
	a.syncOnce(ctx, true)
	if st := a.licenseStatus(); st.State != license.Active {
		t.Fatalf("back online: %+v", st)
	}
}

func TestBackupFolder(t *testing.T) {
	f := newFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	dir := t.TempDir()
	if _, err := a.SetBackupDir(ctx, Actor{UserID: owner.UserID, Role: owner.Role, Channel: ChannelLAN}, dir); code(err) != CodeForbidden {
		t.Fatalf("set from a tablet: %v", err)
	}
	if _, err := a.SetBackupDir(ctx, owner, "relative/path"); code(err) != CodeInvalid {
		t.Fatalf("relative: %v", err)
	}
	if _, err := a.SetBackupDir(ctx, owner, filepath.Join(dir, "missing")); code(err) != CodeInvalid {
		t.Fatalf("missing folder: %v", err)
	}
	info, err := a.SetBackupDir(ctx, owner, dir)
	f.must(err)
	if info.Dir != dir || info.LastCopy.At == "" || info.LastCopy.Error != "" {
		t.Fatalf("info: %+v", info)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || !strings.HasSuffix(entries[0].Name(), ".db") {
		t.Fatalf("no copy right after choosing: %v", entries)
	}

	// A settings save from any screen can't change or lose the folder.
	s, _ := a.Settings(ctx, owner)
	s.BackupDir = "/somewhere/else"
	saved, err := a.UpdateSettings(ctx, owner, s)
	f.must(err)
	if saved.BackupDir != dir {
		t.Fatalf("settings save moved the folder: %q", saved.BackupDir)
	}

	// Only this app's old files are trimmed, never the owner's.
	mine := filepath.Join(dir, "family-photos.db")
	f.must(os.WriteFile(mine, []byte("x"), 0o644))
	for _, n := range []string{"cpro-20200101-000000-auto.db", "cpro-20200102-000000-auto.db"} {
		f.must(os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644))
	}
	pruneDir(dir, 1)
	if _, err := os.Stat(mine); err != nil {
		t.Fatal("removed the owner's file")
	}
	if _, err := os.Stat(filepath.Join(dir, "cpro-20200101-000000-auto.db")); err == nil {
		t.Fatal("old backup kept")
	}

	// The drive is unplugged: the backup still happens here, and the screen says so.
	f.must(os.RemoveAll(dir))
	b, err := a.BackupNow(ctx, Actor{}, "auto")
	f.must(err)
	if _, err := os.Stat(filepath.Join(a.paths.Backups, b.Name)); err != nil {
		t.Fatal("local backup missing")
	}
	info, err = a.BackupLocation(ctx, owner)
	f.must(err)
	if info.LastCopy.Error == "" {
		t.Fatalf("failure not reported: %+v", info)
	}

	// Clearing it stops the copies.
	info, err = a.SetBackupDir(ctx, owner, "")
	f.must(err)
	if info.Dir != "" || info.LastCopy.Error != "" {
		t.Fatalf("cleared: %+v", info)
	}
}

func TestSameDrive(t *testing.T) {
	if sameDrive("/a", "/b") {
		t.Fatal("no drive letters to compare")
	}
}
