// Package license verifies the license the Platform issues to this device
// and decides what the app may do with it. It is pure: no I/O, no clock of
// its own, so every rule is unit-testable.
//
// The license is a compact JWS (alg EdDSA) signed with the Platform key.
// The matching public key is built into the binary:
//
//	-ldflags "-X cpro/internal/license.PublicKey=<base64url>"
//
// Development builds without it may use CPRO_LICENSE_PUBKEY instead; a
// release build ignores that variable, so it can't be pointed at a fake.
package license

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"
)

// PublicKey is the Platform's Ed25519 license key (unpadded base64url).
var PublicKey = ""

// Key returns the key licenses are checked against.
func Key() string {
	if PublicKey != "" {
		return PublicKey
	}
	return os.Getenv("CPRO_LICENSE_PUBKEY")
}

// Features are the modules the account has, keyed by name. The set is open:
// an add-on enabled on the Platform (e.g. "whatsapp_ai") shows up here with
// no change to this package; the module that owns it checks Has(key).
type Features map[string]bool

// Built-in feature keys.
const (
	FeatureEMenu         = "emenu"
	FeatureEMenuOrdering = "emenu_ordering"
	FeatureRemoteAccess  = "remote_access"
)

func (f Features) Has(key string) bool { return f[key] }
func (f Features) EMenu() bool         { return f[FeatureEMenu] }
func (f Features) EMenuOrdering() bool { return f[FeatureEMenuOrdering] }
func (f Features) RemoteAccess() bool  { return f[FeatureRemoteAccess] }

// Everything is what licensing-off builds get.
var Everything = Features{FeatureEMenu: true, FeatureEMenuOrdering: true, FeatureRemoteAccess: true}

// Claims are the signed contents of a license.
type Claims struct {
	Tenant     string   `json:"tenant"`
	TenantName string   `json:"tenant_name"`
	DeviceID   string   `json:"device_id"`
	DeviceKey  string   `json:"device_key"`
	Status     string   `json:"status"` // trial | active | suspended | expired
	Features   Features `json:"features"`
	IssuedAt   int64    `json:"iat"`
	ExpiresAt  int64    `json:"exp"`
	GraceDays  int      `json:"grace_days"`
	Ver        int64    `json:"ver"`
}

var (
	ErrNoKey     = errors.New("license: no public key configured")
	ErrMalformed = errors.New("license: malformed token")
	ErrSignature = errors.New("license: bad signature")
)

func b64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

// Verify checks the token's signature against pub and returns its claims.
func Verify(token, pub string) (Claims, error) {
	var c Claims
	if pub == "" {
		return c, ErrNoKey
	}
	key, err := b64(pub)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return c, ErrNoKey
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return c, ErrMalformed
	}
	hb, err := b64(parts[0])
	if err != nil {
		return c, ErrMalformed
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if json.Unmarshal(hb, &header) != nil || header.Alg != "EdDSA" {
		return c, ErrMalformed
	}
	sig, err := b64(parts[2])
	if err != nil {
		return c, ErrMalformed
	}
	if !ed25519.Verify(ed25519.PublicKey(key), []byte(parts[0]+"."+parts[1]), sig) {
		return c, ErrSignature
	}
	pb, err := b64(parts[1])
	if err != nil {
		return c, ErrMalformed
	}
	if err := json.Unmarshal(pb, &c); err != nil {
		return c, ErrMalformed
	}
	return c, nil
}

// State is what the app is allowed to do.
type State string

const (
	Unlicensed State = "unlicensed" // never activated (or unlinked): selling is blocked
	Active     State = "active"
	Trial      State = "trial"
	Grace      State = "grace"      // expired while offline, still within the grace days
	Restricted State = "restricted" // expired, suspended or revoked: reports and backups only
)

// Reasons for Restricted.
const (
	ReasonExpired    = "expired"
	ReasonTrialEnded = "trial_ended"
	ReasonSuspended  = "suspended"
	ReasonRevoked    = "revoked"
)

type Status struct {
	State      State     `json:"state"`
	Reason     string    `json:"reason,omitempty"`
	ExpiresAt  time.Time `json:"expires_at"`
	GraceUntil time.Time `json:"grace_until"`
}

// CanSell reports whether sales are allowed.
func (s Status) CanSell() bool { return s.State == Active || s.State == Trial || s.State == Grace }

// Evaluate decides the state of a verified license. highWater is the latest
// time this device has seen; the clock never counts as earlier than it, so
// turning the computer's date back doesn't revive an expired license.
func Evaluate(c Claims, now, highWater time.Time) Status {
	if now.Before(highWater) {
		now = highWater
	}
	exp := time.Unix(c.ExpiresAt, 0)
	st := Status{ExpiresAt: exp, GraceUntil: exp.AddDate(0, 0, c.GraceDays)}
	switch c.Status {
	case "suspended":
		st.State, st.Reason = Restricted, ReasonSuspended
		return st
	case "expired":
		st.State, st.Reason = Restricted, ReasonTrialEnded
		return st
	}
	switch {
	case now.Before(exp) && c.Status == "trial":
		st.State = Trial
	case now.Before(exp):
		st.State = Active
	case c.GraceDays > 0 && now.Before(st.GraceUntil):
		st.State = Grace
	case c.Status == "trial":
		st.State, st.Reason = Restricted, ReasonTrialEnded
	default:
		st.State, st.Reason = Restricted, ReasonExpired
	}
	return st
}
