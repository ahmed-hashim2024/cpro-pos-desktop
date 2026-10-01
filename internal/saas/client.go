// Package saas talks to the CPro Platform (the Frappe SaaS): device
// activation, license refresh and the config the owner edits on the
// Platform (domain, e-menu settings).
//
// Every call is signed with this device's Ed25519 key. The signed message is
// the exact text "device_id\nts\nnonce\nbody" where body is the JSON string
// sent, so neither side depends on how the other serialises JSON.
package saas

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

// DefaultURL is the Platform address, set at build time:
//
//	-ldflags "-X cpro/internal/saas.DefaultURL=https://cpro.example.com"
//
// The owner can override it in Settings → Account.
var DefaultURL = ""

var b64 = base64.RawURLEncoding

// ---- identity ----------------------------------------------------------------

// Identity is this installation's device ID and signing key. It lives in a
// file next to the database, not inside it, so restoring a backup on
// another computer doesn't clone the device.
type Identity struct {
	DeviceID string
	key      ed25519.PrivateKey
}

type identityFile struct {
	DeviceID string `json:"device_id"`
	Seed     string `json:"seed"`
}

// LoadIdentity reads the identity at path, creating it on first run.
func LoadIdentity(path string) (Identity, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		seed := make([]byte, ed25519.SeedSize)
		if _, err := rand.Read(seed); err != nil {
			return Identity{}, err
		}
		f := identityFile{DeviceID: ulid.Make().String(), Seed: b64.EncodeToString(seed)}
		data, _ := json.Marshal(f)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return Identity{}, err
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, data, 0o600); err != nil {
			return Identity{}, err
		}
		if err := os.Rename(tmp, path); err != nil {
			return Identity{}, err
		}
		return Identity{DeviceID: f.DeviceID, key: ed25519.NewKeyFromSeed(seed)}, nil
	}
	if err != nil {
		return Identity{}, err
	}
	var f identityFile
	if err := json.Unmarshal(b, &f); err != nil {
		return Identity{}, fmt.Errorf("device identity: %w", err)
	}
	seed, err := b64.DecodeString(f.Seed)
	if err != nil || len(seed) != ed25519.SeedSize || f.DeviceID == "" {
		return Identity{}, errors.New("device identity: corrupt file")
	}
	return Identity{DeviceID: f.DeviceID, key: ed25519.NewKeyFromSeed(seed)}, nil
}

// NewIdentity builds an identity from a raw seed (tests).
func NewIdentity(deviceID string, seed []byte) Identity {
	return Identity{DeviceID: deviceID, key: ed25519.NewKeyFromSeed(seed)}
}

// PublicKey is the device key as unpadded base64url.
func (i Identity) PublicKey() string {
	return b64.EncodeToString(i.key.Public().(ed25519.PublicKey))
}

// Message is the exact byte string both sides sign and verify.
func Message(deviceID string, ts int64, nonce, body string) []byte {
	return []byte(deviceID + "\n" + strconv.FormatInt(ts, 10) + "\n" + nonce + "\n" + body)
}

func (i Identity) Sign(ts int64, nonce, body string) string {
	return b64.EncodeToString(ed25519.Sign(i.key, Message(i.DeviceID, ts, nonce, body)))
}

// ---- wire types --------------------------------------------------------------

type Tunnel struct {
	Domain         string `json:"domain"`
	ConnectorToken string `json:"connector_token"`
}

// Sync is the unsigned config the owner manages on the Platform. EMenu is
// kept raw; the app decodes the fields it knows.
type Sync struct {
	Tunnel *Tunnel         `json:"tunnel"`
	EMenu  json.RawMessage `json:"emenu"`
	// Integrations holds each enabled add-on's settings by feature key
	// (e.g. "whatsapp_ai"); the module owning the key reads its own entry.
	Integrations map[string]json.RawMessage `json:"integrations"`
	Ver          int64                      `json:"ver"`
	ServerTime   int64                      `json:"server_time"`
}

type Reply struct {
	License string `json:"license"`
	Sync    Sync   `json:"sync"`
	Revoked bool   `json:"revoked"`
}

type DeviceInfo struct {
	Name        string `json:"device_name"`
	OS          string `json:"os"`
	AppVersion  string `json:"app_version"`
	Fingerprint string `json:"fingerprint"`
}

// Error is a refusal from the Platform; Message is safe to show the user.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

// ErrUnreachable wraps network failures (offline, DNS, TLS, timeouts).
var ErrUnreachable = errors.New("platform unreachable")

// ---- client --------------------------------------------------------------------

type Client struct {
	ID   Identity
	HTTP *http.Client
	Now  func() time.Time
}

func NewClient(id Identity) *Client {
	return &Client{ID: id, HTTP: &http.Client{Timeout: 20 * time.Second}, Now: time.Now}
}

// NormalizeURL validates a Platform base URL. Plain http is accepted only
// for localhost (development).
func NormalizeURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" {
		return "", errors.New("invalid platform URL")
	}
	host := u.Hostname()
	local := host == "localhost" || host == "127.0.0.1" || host == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return "", errors.New("the platform URL must start with https://")
	}
	return raw, nil
}

func (c *Client) Activate(ctx context.Context, base, code string, info DeviceInfo) (Reply, error) {
	body := map[string]any{
		"activation_code": strings.ToUpper(strings.TrimSpace(code)),
		"public_key":      c.ID.PublicKey(),
		"device_name":     info.Name,
		"os":              info.OS,
		"app_version":     info.AppVersion,
		"fingerprint":     info.Fingerprint,
	}
	var r Reply
	return r, c.call(ctx, base, "activate", body, &r)
}

// LinkStart is a pending browser link: show Code, open URL, poll every
// Interval seconds until approved or ExpiresIn runs out.
type LinkStart struct {
	Code      string `json:"code"`
	URL       string `json:"url"`
	ExpiresIn int    `json:"expires_in"`
	Interval  int    `json:"interval"`
}

// LinkPoll is pending | approved | denied | expired; approved carries the
// same license and sync as Activate.
type LinkPoll struct {
	Status string `json:"status"`
	Reply
}

// StartLink begins linking this device from the browser (the owner signs in
// on the Platform and approves). The request is signed with the key the
// license will be bound to.
func (c *Client) StartLink(ctx context.Context, base string, info DeviceInfo) (LinkStart, error) {
	body := map[string]any{
		"public_key":  c.ID.PublicKey(),
		"device_name": info.Name,
		"os":          info.OS,
		"app_version": info.AppVersion,
		"fingerprint": info.Fingerprint,
	}
	var r LinkStart
	return r, c.call(ctx, base, "start_link", body, &r)
}

func (c *Client) PollLink(ctx context.Context, base string) (LinkPoll, error) {
	var r LinkPoll
	return r, c.call(ctx, base, "poll_link", map[string]any{}, &r)
}

func (c *Client) Refresh(ctx context.Context, base string) (Reply, error) {
	var r Reply
	return r, c.call(ctx, base, "refresh", map[string]any{}, &r)
}

// Version returns the Platform's config version for this device's account;
// a change means Refresh should be called.
func (c *Client) Version(ctx context.Context, base string) (ver int64, revoked bool, err error) {
	var r struct {
		Ver     int64 `json:"ver"`
		Revoked bool  `json:"revoked"`
	}
	err = c.call(ctx, base, "version", map[string]any{}, &r)
	return r.Ver, r.Revoked, err
}

func (c *Client) Deactivate(ctx context.Context, base string) error {
	return c.call(ctx, base, "deactivate", map[string]any{}, nil)
}

func (c *Client) call(ctx context.Context, base, method string, payload any, out any) error {
	if base == "" {
		return &Error{Message: "platform URL is not set"}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	nb := make([]byte, 12)
	rand.Read(nb)
	nonce := hex.EncodeToString(nb)
	ts := c.Now().Unix()
	req := map[string]any{
		"device_id": c.ID.DeviceID,
		"ts":        ts,
		"nonce":     nonce,
		"body":      string(body),
		"sig":       c.ID.Sign(ts, nonce, string(body)),
	}
	rb, _ := json.Marshal(req)
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/method/saas_control_platform.api.license."+method, bytes.NewReader(rb))
	if err != nil {
		return err
	}
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(hr)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnreachable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return &Error{Status: resp.StatusCode, Message: frappeMessage(raw, resp.StatusCode)}
	}
	var env struct {
		Message json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return &Error{Status: resp.StatusCode, Message: "unexpected response from the platform"}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(env.Message, out)
}

// frappeMessage extracts the user-facing text from a Frappe error response:
// _server_messages is a JSON list of JSON-encoded {"message": ...} objects.
func frappeMessage(raw []byte, status int) string {
	var e struct {
		ServerMessages string `json:"_server_messages"`
		Exception      string `json:"exception"`
		ExcType        string `json:"exc_type"`
	}
	if json.Unmarshal(raw, &e) == nil {
		var list []string
		if json.Unmarshal([]byte(e.ServerMessages), &list) == nil {
			for _, item := range list {
				var m struct {
					Message string `json:"message"`
				}
				if json.Unmarshal([]byte(item), &m) == nil && m.Message != "" {
					return stripTags(m.Message)
				}
			}
		}
		if e.Exception != "" {
			if i := strings.Index(e.Exception, ": "); i >= 0 {
				return e.Exception[i+2:]
			}
			return e.Exception
		}
	}
	if status == http.StatusTooManyRequests {
		return "too many attempts, try again later"
	}
	return fmt.Sprintf("platform error (%d)", status)
}

func stripTags(s string) string {
	var b strings.Builder
	in := false
	for _, r := range s {
		switch {
		case r == '<':
			in = true
		case r == '>':
			in = false
		case !in:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}
