package app

import (
	"path/filepath"
	"testing"

	"cpro/internal/domain/rbac"
	"cpro/internal/saas"
	"cpro/internal/saas/saastest"
)

// secondComputer is a new install connected to the same account.
func secondComputer(f *fixture, fake *saastest.Fake) *App {
	f.t.Helper()
	a, _ := emptyComputer(f.t)
	id, err := saas.LoadIdentity(filepath.Join(f.t.TempDir(), "device.json"))
	f.must(err)
	f.must(a.EnablePlatform(f.ctx, saas.NewClient(id, fake.Public)))
	f.must(a.SetPlatformURL(f.ctx, Actor{Role: rbac.Owner}, fake.URL))
	f.must(a.activateWithLink(f.ctx, "ACT-TEST"))
	return a
}

func TestAccountBringsTheRestaurantToANewComputer(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx := f.app, f.ctx
	fake.Lock()
	fake.Tenants["ACT-TEST"].MaxDevices = 5
	fake.Tenants["ACT-TEST"].Tunnel = &saas.Tunnel{Domain: "gem.menu.test", ConnectorToken: "tok"}
	fake.Unlock()
	f.must(a.activateWithLink(ctx, "ACT-TEST"))
	if acc := a.Account(); acc.Returning {
		t.Fatalf("a first computer counts as returning: %+v", acc)
	}

	s, err := a.Settings(ctx, f.owner)
	f.must(err)
	s.RestaurantName, s.Phone, s.TaxRate, s.LANEnabled, s.LANPort = "جيم", "0100", 1400, true, 9999
	_, err = a.UpdateSettings(ctx, f.owner, s)
	f.must(err)
	a.syncOnce(ctx, true)

	b := secondComputer(f, fake)
	acc := b.Account()
	if acc == nil || !acc.Returning || acc.Restaurant != "جيم" || acc.Username != "owner" || acc.Domain != "gem.menu.test" {
		t.Fatalf("account on the new computer: %+v", acc)
	}

	// No backup: only a password for this computer.
	session, err := b.Setup(ctx, SetupInput{Password: "newpass123", PIN: "2222"}, ChannelApp)
	f.must(err)
	if session.Me.Username != "owner" {
		t.Fatalf("owner: %+v", session.Me)
	}
	got, err := loadSettings(ctx, b.db.Read)
	f.must(err)
	if got.RestaurantName != "جيم" || got.Phone != "0100" || got.TaxRate != 1400 {
		t.Fatalf("settings: %+v", got)
	}
	if got.LANEnabled || got.LANPort != defaultSettings().LANPort {
		t.Fatalf("one computer's network settings travelled: %+v", got)
	}
	if n := count(t, b, `SELECT count(*) FROM items`); n != 0 {
		t.Fatalf("items on a computer without a backup: %d", n)
	}

	// Saved once; nothing is sent again until it changes.
	fake.Lock()
	fake.Tenants["ACT-TEST"].Profile = nil
	fake.Unlock()
	a.syncOnce(ctx, true)
	fake.Lock()
	defer fake.Unlock()
	if fake.Tenants["ACT-TEST"].Profile != nil {
		t.Fatal("unchanged data was sent again")
	}
}

func TestEmptyComputerDoesNotBlankTheAccount(t *testing.T) {
	f, fake := linkedFixture(t)
	fake.Lock()
	fake.Tenants["ACT-TEST"].MaxDevices = 5
	fake.Tenants["ACT-TEST"].Profile = map[string]any{"owner_name": "سام"}
	fake.Unlock()
	b := secondComputer(f, fake)
	b.syncOnce(f.ctx, true)
	fake.Lock()
	defer fake.Unlock()
	if fake.Tenants["ACT-TEST"].Profile["owner_name"] != "سام" {
		t.Fatalf("profile: %+v", fake.Tenants["ACT-TEST"].Profile)
	}
}
