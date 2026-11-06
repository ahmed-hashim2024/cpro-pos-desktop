package app

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"cpro/internal/saas"
)

func TestNewerVersion(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"1.0.1", "1.0.0", true}, {"1.2.10", "1.2.9", true}, {"2.0", "1.9.9", true}, {"v1.1.0", "1.0.9", true},
		{"1.0.0", "1.0.0", false}, {"1.0.0", "1.0.1", false}, {"x", "1.0.0", false}, {"1.0.1", "dev", false},
	} {
		if got := newerVersion(c.a, c.b); got != c.want {
			t.Errorf("newer(%s, %s) = %v", c.a, c.b, got)
		}
	}
}

func TestUntilMidnight(t *testing.T) {
	now := time.Date(2026, 3, 1, 23, 30, 0, 0, time.Local)
	if d := untilMidnight(now); d != 30*time.Minute {
		t.Fatalf("until midnight: %v", d)
	}
}

func TestMandatoryUpdate(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx := f.app, f.ctx
	old := Version
	Version = "1.0.0"
	t.Cleanup(func() { Version = old })

	installer := []byte("installer-bytes")
	sum := sha256.Sum256(installer)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(installer) }))
	t.Cleanup(srv.Close)
	a.upd.http = srv.Client()
	launched := make(chan string, 1)
	a.SetUpdateLauncher(func(p string) error { launched <- p; return nil })
	_, err := a.ActivateDevice(ctx, f.owner, "ACT-TEST", "")
	f.must(err)

	// Same version: nothing to do.
	fake.Release = saas.Release{Version: "1.0.0", Mandatory: true, URL: srv.URL + "/cpro-setup.exe", SHA256: hex.EncodeToString(sum[:])}
	f.must(a.CheckUpdate(ctx))
	if a.updateInfo().Available || a.requireLicensed() != nil {
		t.Fatal("same version offered")
	}
	// A release without https or a valid hash is ignored.
	fake.Release = saas.Release{Version: "1.1.0", Mandatory: true, URL: "http://example.com/x.exe", SHA256: hex.EncodeToString(sum[:])}
	f.must(a.CheckUpdate(ctx))
	if a.updateInfo().Available {
		t.Fatal("insecure release accepted")
	}

	// A mandatory release blocks selling until installed.
	fake.Release = saas.Release{Version: "1.1.0", Mandatory: true, URL: srv.URL + "/cpro-setup.exe", SHA256: hex.EncodeToString(sum[:])}
	f.must(a.CheckUpdate(ctx))
	if info := a.updateInfo(); !info.Available || !info.Mandatory || info.Version != "1.1.0" {
		t.Fatalf("update info: %+v", info)
	}
	if code(a.requireLicensed()) != CodeForbidden {
		t.Fatal("sold with a mandatory update pending")
	}
	// Only from the desktop window.
	if _, err := a.InstallUpdate(ctx, Actor{Channel: ChannelLAN}); code(err) != CodeForbidden {
		t.Fatalf("install from LAN: %v", err)
	}
	if _, err := a.InstallUpdate(ctx, f.owner); err != nil {
		t.Fatal(err)
	}
	select {
	case p := <-launched:
		if b, _ := os.ReadFile(p); string(b) != string(installer) {
			t.Fatal("launched the wrong file")
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("installer not launched: %+v", a.updateInfo())
	}

	waitIdle := func() UpdateInfo {
		deadline := time.Now().Add(5 * time.Second)
		for a.updateInfo().State == "downloading" && time.Now().Before(deadline) {
			time.Sleep(20 * time.Millisecond)
		}
		return a.updateInfo()
	}
	if info := waitIdle(); info.State != "ready" {
		t.Fatalf("after install: %+v", info)
	}

	// A file that doesn't match the hash is never launched.
	a.platform.mu.Lock()
	a.platform.st.Update.SHA256 = hex.EncodeToString(make([]byte, 32))
	a.platform.mu.Unlock()
	if _, err := a.InstallUpdate(ctx, f.owner); err != nil {
		t.Fatal(err)
	}
	if info := waitIdle(); info.State != "error" {
		t.Fatalf("bad hash: %+v", info)
	}
	select {
	case <-launched:
		t.Fatal("tampered installer launched")
	default:
	}

	// Once this build is the released version, nothing is pending.
	Version = "1.1.0"
	if a.updateRequired() {
		t.Fatal("still required after updating")
	}
}
