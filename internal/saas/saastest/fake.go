// Package saastest is an in-memory Platform implementing the same contract
// as saas_control_platform.api.license, for tests and the dev server.
package saastest

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"cpro/internal/saas"
)

var b64 = base64.RawURLEncoding

type Tenant struct {
	Name, DisplayName, Code string
	Status                  string // trial | active | suspended | expired
	MaxDevices              int
	EMenu, Ordering, Remote bool
	Tunnel                  *saas.Tunnel
	EMenuSettings           map[string]any
	Ver                     int64
	ValidFor                time.Duration
	GraceDays               int
}

type device struct {
	tenant, key string
	revoked     bool
}

// Fake is a running fake Platform. Lock before touching Tenants directly,
// or use the helper methods.
type Fake struct {
	sync.Mutex
	URL     string
	Public  string
	priv    ed25519.PrivateKey
	Tenants map[string]*Tenant // by code
	devices map[string]*device
	nonces  map[string]bool
	Calls   map[string]int
	Now     func() time.Time
	srv     *httptest.Server
	handler http.Handler
}

// New starts a fake Platform with one tenant whose activation code is code.
func New(code string) *Fake {
	f := NewHandler(code)
	f.srv = httptest.NewServer(f.handler)
	f.URL = f.srv.URL
	return f
}

// NewHandler builds the fake without starting a server (mount it yourself).
func NewHandler(code string) *Fake {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	f := &Fake{
		Public:  b64.EncodeToString(pub),
		priv:    priv,
		Tenants: map[string]*Tenant{},
		devices: map[string]*device{},
		nonces:  map[string]bool{},
		Calls:   map[string]int{},
		Now:     time.Now,
	}
	f.Tenants[code] = &Tenant{
		Name: "TEN-00001", DisplayName: "مطعم التجربة", Code: code, Status: "active", MaxDevices: 1,
		EMenu: true, Ordering: true, Ver: 1, ValidFor: 7 * 24 * time.Hour, GraceDays: 14,
		EMenuSettings: map[string]any{
			"enabled": 1, "display_name": "مطعم التجربة", "tagline": "أشهى المشويات", "default_language": "ar",
			"lang_ar": 1, "lang_en": 1, "lang_fr": 0, "theme": "Midnight", "primary_color": "#D4A24C",
			"accent_color": "#E8604C", "card_style": "Photo Cards", "show_prices": 1,
			"allow_call_waiter": 1, "allow_dine_in_orders": 1, "allow_takeaway_orders": 1, "require_phone": 1,
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/method/{method}", f.serve)
	f.handler = mux
	return f
}

func (f *Fake) Handler() http.Handler { return f.handler }

func (f *Fake) Close() {
	if f.srv != nil {
		f.srv.Close()
	}
}

// Tenant returns the tenant for code (lock held by caller for writes).
func (f *Fake) Tenant(code string) *Tenant { return f.Tenants[code] }

// Update changes a tenant under the lock and bumps its version.
func (f *Fake) Update(code string, fn func(*Tenant)) {
	f.Lock()
	defer f.Unlock()
	t := f.Tenants[code]
	fn(t)
	t.Ver++
}

// Revoke marks a device revoked, as the owner would from the Platform.
func (f *Fake) Revoke(deviceID string) {
	f.Lock()
	defer f.Unlock()
	if d := f.devices[deviceID]; d != nil {
		d.revoked = true
		for _, t := range f.Tenants {
			if t.Name == d.tenant {
				t.Ver++
			}
		}
	}
}

type frappeErr struct {
	status int
	msg    string
}

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	method := strings.TrimPrefix(r.PathValue("method"), "saas_control_platform.api.license.")
	var in struct {
		DeviceID string `json:"device_id"`
		TS       int64  `json:"ts"`
		Nonce    string `json:"nonce"`
		Body     string `json:"body"`
		Sig      string `json:"sig"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, frappeErr{400, "Invalid request."})
		return
	}
	f.Lock()
	defer f.Unlock()
	f.Calls[method]++
	out, ferr := f.handle(method, in.DeviceID, in.TS, in.Nonce, in.Body, in.Sig)
	if ferr != nil {
		writeErr(w, *ferr)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"message": out})
}

func writeErr(w http.ResponseWriter, e frappeErr) {
	msg, _ := json.Marshal(map[string]string{"message": e.msg})
	list, _ := json.Marshal([]string{string(msg)})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.status)
	json.NewEncoder(w).Encode(map[string]any{"exc_type": "ValidationError", "_server_messages": string(list)})
}

func (f *Fake) verify(key, deviceID string, ts int64, nonce, body, sig string) *frappeErr {
	if d := f.Now().Unix() - ts; d > 600 || d < -600 {
		return &frappeErr{401, "The device clock is wrong. Fix the date and time and try again."}
	}
	if f.nonces[deviceID+nonce] {
		return &frappeErr{401, "Request already used."}
	}
	pub, err := b64.DecodeString(key)
	s, err2 := b64.DecodeString(sig)
	if err != nil || err2 != nil || len(pub) != ed25519.PublicKeySize || !ed25519.Verify(pub, saas.Message(deviceID, ts, nonce, body), s) {
		return &frappeErr{401, "Invalid device signature."}
	}
	f.nonces[deviceID+nonce] = true
	return nil
}

func (f *Fake) tenantByName(name string) *Tenant {
	for _, t := range f.Tenants {
		if t.Name == name {
			return t
		}
	}
	return nil
}

func (f *Fake) handle(method, deviceID string, ts int64, nonce, body, sig string) (any, *frappeErr) {
	var data map[string]any
	if err := json.Unmarshal([]byte(body), &data); err != nil {
		return nil, &frappeErr{400, "Invalid request."}
	}
	if method == "activate" {
		key, _ := data["public_key"].(string)
		if e := f.verify(key, deviceID, ts, nonce, body, sig); e != nil {
			return nil, e
		}
		code, _ := data["activation_code"].(string)
		t := f.Tenants[strings.ToUpper(code)]
		if t == nil {
			return nil, &frappeErr{401, "Invalid activation code."}
		}
		if t.Status == "suspended" {
			return nil, &frappeErr{403, "This account is not active. Please contact support."}
		}
		d := f.devices[deviceID]
		if d != nil && d.key != key {
			return nil, &frappeErr{403, "This device ID belongs to a different installation."}
		}
		if d == nil || d.revoked {
			active := 0
			for _, x := range f.devices {
				if x.tenant == t.Name && !x.revoked {
					active++
				}
			}
			if active >= t.MaxDevices {
				return nil, &frappeErr{403, fmt.Sprintf("Device limit reached (%d). Revoke an old device from your account first.", t.MaxDevices)}
			}
		}
		f.devices[deviceID] = &device{tenant: t.Name, key: key}
		return f.reply(t, deviceID, key), nil
	}
	d := f.devices[deviceID]
	if d == nil {
		return nil, &frappeErr{401, "This device is not activated."}
	}
	if e := f.verify(d.key, deviceID, ts, nonce, body, sig); e != nil {
		return nil, e
	}
	t := f.tenantByName(d.tenant)
	switch method {
	case "refresh":
		if d.revoked {
			return map[string]any{"revoked": true}, nil
		}
		return f.reply(t, deviceID, d.key), nil
	case "version":
		if d.revoked {
			return map[string]any{"revoked": true}, nil
		}
		return map[string]any{"ver": t.Ver}, nil
	case "deactivate":
		d.revoked = true
		t.Ver++
		return map[string]any{"ok": true}, nil
	}
	return nil, &frappeErr{404, "Not found"}
}

func (f *Fake) reply(t *Tenant, deviceID, key string) map[string]any {
	now := f.Now()
	exp := now.Add(t.ValidFor)
	grace := t.GraceDays
	if t.Status != "active" {
		grace = 0
	}
	if t.Status == "suspended" || t.Status == "expired" {
		exp = now
	}
	claims := map[string]any{
		"tenant": t.Name, "tenant_name": t.DisplayName, "device_id": deviceID, "device_key": key, "status": t.Status,
		"features": map[string]bool{"emenu": t.EMenu, "emenu_ordering": t.Ordering, "remote_access": t.Remote},
		"iat":      now.Unix(), "exp": exp.Unix(), "grace_days": grace, "ver": t.Ver,
	}
	return map[string]any{
		"license": f.Sign(claims),
		"sync":    map[string]any{"tunnel": t.Tunnel, "emenu": t.EMenuSettings, "ver": t.Ver, "server_time": now.Unix()},
	}
}

// Sign issues a JWS over claims with the fake Platform key.
func (f *Fake) Sign(claims map[string]any) string {
	h, _ := json.Marshal(map[string]string{"alg": "EdDSA", "typ": "JWT", "kid": "fake"})
	p, _ := json.Marshal(claims)
	msg := b64.EncodeToString(h) + "." + b64.EncodeToString(p)
	return msg + "." + b64.EncodeToString(ed25519.Sign(f.priv, []byte(msg)))
}
