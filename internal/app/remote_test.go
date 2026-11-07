package app

import (
	"testing"

	"cpro/internal/domain/rbac"
	"cpro/internal/saas"
	"cpro/internal/saas/saastest"
)

// Signing in from outside the restaurant (the tunnel's staff hostname) needs
// the plan's remote access and, per account, the owner's permission. Taking
// either away ends the sessions already open.
func TestRemoteAccess(t *testing.T) {
	f, fake := linkedFixture(t)
	a, ctx, owner := f.app, f.ctx, f.owner
	_, err := a.ActivateDevice(ctx, owner, "ACT-TEST", "")
	f.must(err)
	const ip = "203.0.113.7"
	login := func(user, pass string) (Session, error) {
		return a.Login(ctx, LoginInput{Username: user, Password: pass}, ChannelTunnel, ip)
	}

	// Not in the plan: refused before the password is even looked at.
	if _, err := login("owner", "owner1234"); err != errRemoteOff {
		t.Fatalf("plan without remote access: %v", err)
	}
	fake.Update("ACT-TEST", func(t *saastest.Tenant) {
		t.Remote = true
		t.Tunnel = &saas.Tunnel{Domain: "karama.menu.test", RemoteDomain: "karama-pos.menu.test", ConnectorToken: "tok"}
	})
	a.syncOnce(ctx, false)
	info, err := a.PlatformInfo(ctx, owner)
	f.must(err)
	if info.RemoteURL != "https://karama-pos.menu.test" {
		t.Fatalf("remote url: %q", info.RemoteURL)
	}

	// In the plan, but nobody is allowed yet, the owner included. A wrong
	// password still says only «wrong password».
	if _, err := login("owner", "nope-nope1"); err != errBadLogin {
		t.Fatalf("wrong password: %v", err)
	}
	if _, err := login("owner", "owner1234"); err != errRemoteDenied {
		t.Fatalf("owner not allowed yet: %v", err)
	}

	// Only the owner hands it out.
	yes, no := true, false
	mgrID, err := a.CreateUser(ctx, owner, UserInput{FullName: "المدير", Username: "mgr", Role: rbac.Manager, Password: "manager123", Active: true})
	f.must(err)
	mgrSession, err := a.Login(ctx, LoginInput{Username: "mgr", Password: "manager123"}, ChannelLAN, "10.0.0.5")
	f.must(err)
	manager, _, err := a.Authenticate(ctx, mgrSession.Token, ChannelLAN)
	f.must(err)
	if err := a.UpdateUser(ctx, manager, mgrID, UserInput{FullName: "المدير", Role: rbac.Manager, Active: true, Remote: &yes}); code(err) != CodeForbidden {
		t.Fatalf("manager granted remote access: %v", err)
	}
	if _, err := a.CreateUser(ctx, manager, UserInput{FullName: "كاشير", Username: "c1", Role: rbac.Cashier, Password: "cashier123", Active: true, Remote: &yes}); code(err) != CodeForbidden {
		t.Fatalf("manager created a remote user: %v", err)
	}
	f.must(a.UpdateUser(ctx, owner, mgrID, UserInput{FullName: "المدير العام", Role: rbac.Manager, Active: true, Remote: &yes}))
	s, err := login("mgr", "manager123")
	f.must(err)
	if s.Me.Channel != ChannelTunnel {
		t.Fatalf("session channel: %+v", s.Me)
	}
	users, err := a.Users(ctx, owner)
	f.must(err)
	for _, u := range users {
		if u.Username == "mgr" && !u.Remote {
			t.Fatal("remote flag not listed")
		}
	}

	// A tunnel token doesn't work on the LAN, nor the other way round.
	if _, _, err := a.Authenticate(ctx, s.Token, ChannelLAN); code(err) != CodeUnauthorized {
		t.Fatalf("tunnel token on the LAN: %v", err)
	}
	if _, _, err := a.Authenticate(ctx, mgrSession.Token, ChannelTunnel); code(err) != CodeUnauthorized {
		t.Fatalf("LAN token on the tunnel: %v", err)
	}
	// No PIN from outside, and no list of who has one.
	if _, err := a.Login(ctx, LoginInput{UserID: mgrID, PIN: "1234"}, ChannelTunnel, ip); code(err) != CodeForbidden {
		t.Fatalf("PIN over the tunnel: %v", err)
	}
	if list, _ := a.LoginUsers(ctx, ChannelTunnel); len(list) != 0 {
		t.Fatalf("users listed over the tunnel: %+v", list)
	}

	// Taking the permission away ends the remote session (the LAN one stays).
	f.must(a.UpdateUser(ctx, owner, mgrID, UserInput{FullName: "المدير العام", Role: rbac.Manager, Active: true, Remote: &no}))
	if _, _, err := a.Authenticate(ctx, s.Token, ChannelTunnel); code(err) != CodeUnauthorized {
		t.Fatalf("remote session survived: %v", err)
	}
	if _, _, err := a.Authenticate(ctx, mgrSession.Token, ChannelLAN); err != nil {
		t.Fatalf("LAN session ended too: %v", err)
	}

	// The plan losing remote access shuts open sessions at the next request.
	f.must(a.UpdateUser(ctx, owner, mgrID, UserInput{FullName: "المدير العام", Role: rbac.Manager, Active: true, Remote: &yes}))
	s, err = login("mgr", "manager123")
	f.must(err)
	fake.Update("ACT-TEST", func(t *saastest.Tenant) { t.Remote = false })
	a.syncOnce(ctx, false)
	if _, _, err := a.Authenticate(ctx, s.Token, ChannelTunnel); code(err) != CodeUnauthorized {
		t.Fatalf("session survived the plan change: %v", err)
	}
	if info, _ := a.PlatformInfo(ctx, owner); info.RemoteURL != "" {
		t.Fatalf("remote url without the feature: %q", info.RemoteURL)
	}
}
