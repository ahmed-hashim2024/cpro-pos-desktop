package saas_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"cpro/internal/license"
	"cpro/internal/saas"
	"cpro/internal/saas/saastest"
)

func TestRequestSignatureMatchesPlatformVector(t *testing.T) {
	b, err := os.ReadFile("testdata/license_vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		DevicePrivate string `json:"device_private"`
		DevicePublic  string `json:"device_public"`
		Request       struct {
			DeviceID string `json:"device_id"`
			TS       int64  `json:"ts"`
			Nonce    string `json:"nonce"`
			Body     string `json:"body"`
			Sig      string `json:"sig"`
		} `json:"request"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	seed, _ := base64.RawURLEncoding.DecodeString(v.DevicePrivate)
	id := saas.NewIdentity(v.Request.DeviceID, seed)
	if id.PublicKey() != v.DevicePublic {
		t.Fatalf("public key %s, want %s", id.PublicKey(), v.DevicePublic)
	}
	if got := id.Sign(v.Request.TS, v.Request.Nonce, v.Request.Body); got != v.Request.Sig {
		t.Fatalf("signature mismatch:\n got %s\nwant %s", got, v.Request.Sig)
	}
}

func TestIdentityPersists(t *testing.T) {
	p := filepath.Join(t.TempDir(), "device.json")
	a, err := saas.LoadIdentity(p)
	if err != nil {
		t.Fatal(err)
	}
	b, err := saas.LoadIdentity(p)
	if err != nil {
		t.Fatal(err)
	}
	if a.DeviceID != b.DeviceID || a.PublicKey() != b.PublicKey() {
		t.Fatal("identity changed between loads")
	}
	if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
		t.Fatalf("identity file mode %v", st.Mode().Perm())
	}
}

func TestClientAgainstFakePlatform(t *testing.T) {
	ctx := context.Background()
	f := saastest.New("ACT-TEST")
	defer f.Close()
	id, _ := saas.LoadIdentity(filepath.Join(t.TempDir(), "d.json"))
	c := saas.NewClient(id)

	_, err := c.Activate(ctx, f.URL, "act-wrong", saas.DeviceInfo{Name: "x"})
	var se *saas.Error
	if !errors.As(err, &se) || se.Message != "Invalid activation code." {
		t.Fatalf("bad code: %v", err)
	}

	r, err := c.Activate(ctx, f.URL, "act-test", saas.DeviceInfo{Name: "الكاشير"})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := license.Verify(r.License, f.Public)
	if err != nil {
		t.Fatal(err)
	}
	if claims.DeviceID != id.DeviceID || claims.DeviceKey != id.PublicKey() || claims.Status != "active" {
		t.Fatalf("claims %+v", claims)
	}

	ver, revoked, err := c.Version(ctx, f.URL)
	if err != nil || revoked || ver != 1 {
		t.Fatalf("version %d %v %v", ver, revoked, err)
	}
	f.Update("ACT-TEST", func(t *saastest.Tenant) { t.Tunnel = &saas.Tunnel{Domain: "x.example.com", ConnectorToken: "tok"} })
	if ver, _, _ = c.Version(ctx, f.URL); ver != 2 {
		t.Fatalf("version after update %d", ver)
	}
	r, err = c.Refresh(ctx, f.URL)
	if err != nil || r.Sync.Tunnel == nil || r.Sync.Tunnel.Domain != "x.example.com" {
		t.Fatalf("refresh %+v %v", r, err)
	}

	// A second device exceeds the limit of one.
	id2, _ := saas.LoadIdentity(filepath.Join(t.TempDir(), "d2.json"))
	if _, err := saas.NewClient(id2).Activate(ctx, f.URL, "ACT-TEST", saas.DeviceInfo{}); !errors.As(err, &se) || se.Status != 403 {
		t.Fatalf("device limit: %v", err)
	}

	f.Revoke(id.DeviceID)
	if r, err = c.Refresh(ctx, f.URL); err != nil || !r.Revoked {
		t.Fatalf("revoked refresh %+v %v", r, err)
	}

	if _, err := c.Refresh(ctx, "http://127.0.0.1:1"); !errors.Is(err, saas.ErrUnreachable) {
		t.Fatalf("unreachable: %v", err)
	}
}

func TestNormalizeURL(t *testing.T) {
	for in, ok := range map[string]bool{
		"https://cpro.example.com":   true,
		"https://cpro.example.com/":  true,
		"http://localhost:8000":      true,
		"http://cpro.example.com":    false,
		"https://cpro.example.com/x": false,
		"cpro.example.com":           false,
	} {
		if _, err := saas.NormalizeURL(in); (err == nil) != ok {
			t.Errorf("%s: %v", in, err)
		}
	}
}
