package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"cpro/internal/domain/rbac"
)

// Connecting this computer to the owner's account with «Continue with
// Google». The app opens the Platform in the browser; once the owner is
// signed in, the Platform sends the browser back to a one-time listener on
// this computer's loopback address with a short-lived link token. Loopback
// only: a link sent to someone else can only ever reach their own computer,
// so nobody can attach their device to another person's account with it.

const connectTimeout = 10 * time.Minute

// ConnectStatus is what the first-run screen polls.
type ConnectStatus struct {
	State string `json:"state"` // idle | waiting | done | failed
	Error string `json:"error"`
}

type connectFlow struct {
	state  string
	srv    *http.Server
	status ConnectStatus
	timer  *time.Timer
}

func (f *connectFlow) close() {
	f.timer.Stop()
	go f.srv.Close()
}

// NeedsConnect reports whether this computer still has to be connected to an
// account (never connected, or removed from the account on the Platform).
func (a *App) NeedsConnect() bool {
	p := a.platform
	if p == nil {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.claims == nil || p.st.Revoked
}

// ConnectedAccount is what the first-run form needs from the linked account.
type ConnectedAccount struct {
	Name      string `json:"name"`
	EMenu     bool   `json:"emenu"`
	HasDomain bool   `json:"has_domain"`
	Domain    string `json:"domain"` // the address the account already has

	// A returning owner is offered their backup; these fill the new computer.
	Returning  bool   `json:"returning"`
	Restaurant string `json:"restaurant"`
	OwnerName  string `json:"owner_name"`
	Username   string `json:"username"`
}

// Account returns the linked account, or nil when not connected.
func (a *App) Account() *ConnectedAccount {
	p := a.platform
	if p == nil || a.NeedsConnect() {
		return nil
	}
	f := a.features()
	p.mu.RLock()
	defer p.mu.RUnlock()
	domain := p.st.AccountDomain
	if p.st.Tunnel != nil {
		domain = p.st.Tunnel.Domain
	}
	out := &ConnectedAccount{Name: p.claims.TenantName, EMenu: f.EMenu(), HasDomain: domain != "", Domain: domain, Returning: p.st.Returning}
	if profile := readProfile(p.st.Profile); profile != nil {
		out.Restaurant, out.OwnerName, out.Username = profile.Settings.RestaurantName, profile.OwnerName, profile.Username
	}
	return out
}

// StartConnect begins a connection and returns the page to open in the
// browser. Starting again replaces a flow in progress.
func (a *App) StartConnect(context.Context) (string, error) {
	p, err := a.platformRequired()
	if err != nil {
		return "", err
	}
	if !a.NeedsConnect() {
		return "", conflict("البرنامج متربط بحسابك بالفعل")
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	if base == "" {
		return "", invalid("عنوان المنصة غير مضبوط")
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	b := make([]byte, 24)
	rand.Read(b)
	f := &connectFlow{state: hex.EncodeToString(b), status: ConnectStatus{State: "waiting"}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /connect", func(w http.ResponseWriter, r *http.Request) { a.finishConnect(w, r, f) })
	f.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	f.timer = time.AfterFunc(connectTimeout, func() {
		a.connectMu.Lock()
		defer a.connectMu.Unlock()
		if a.connect == f && f.status.State == "waiting" {
			f.status = ConnectStatus{State: "failed", Error: "انتهى وقت الربط، حاول مرة تانية"}
		}
		f.close()
	})

	a.connectMu.Lock()
	if a.connect != nil {
		a.connect.close()
	}
	a.connect = f
	a.connectMu.Unlock()
	go f.srv.Serve(ln)

	port := ln.Addr().(*net.TCPAddr).Port
	return fmt.Sprintf("%s/portal/connect?port=%d&state=%s&device=%s&fp=%s", base, port, f.state,
		url.QueryEscape(p.client.ID.DeviceID), url.QueryEscape(deviceInfo("").Fingerprint)), nil
}

// ConnectState is the progress of the latest StartConnect.
func (a *App) ConnectState() ConnectStatus {
	a.connectMu.Lock()
	defer a.connectMu.Unlock()
	if a.connect == nil {
		return ConnectStatus{State: "idle"}
	}
	return a.connect.status
}

// finishConnect receives the browser coming back from the Platform.
func (a *App) finishConnect(w http.ResponseWriter, r *http.Request, f *connectFlow) {
	state := r.URL.Query().Get("state")
	if subtle.ConstantTimeCompare([]byte(state), []byte(f.state)) != 1 {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	a.connectMu.Lock()
	if f.status.State != "waiting" {
		a.connectMu.Unlock()
		connectPage(w, "الربط تم بالفعل", "ارجع للبرنامج.")
		return
	}
	f.status.State = "working" // one token, one try
	a.connectMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	err := a.activateWithLink(ctx, r.URL.Query().Get("token"))

	a.connectMu.Lock()
	if err != nil {
		a.log.Warn("connect failed", "err", err)
		f.status = ConnectStatus{State: "failed", Error: err.Error()}
	} else {
		f.status = ConnectStatus{State: "done"}
	}
	a.connectMu.Unlock()
	if err != nil {
		connectPage(w, "تعذر ربط البرنامج", err.Error())
	} else {
		connectPage(w, "تم ربط البرنامج بحسابك", "تقدر تقفل الصفحة دي وترجع للبرنامج.")
	}
	f.close()
}

func (a *App) activateWithLink(ctx context.Context, token string) error {
	if token == "" || len(token) > 128 {
		return invalid("رابط الربط غير صحيح، حاول مرة تانية")
	}
	p, err := a.platformRequired()
	if err != nil {
		return err
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	r, err := p.client.ActivateLink(ctx, base, token, deviceInfo(""))
	if err != nil {
		return platformErr(err)
	}
	return a.applyReply(ctx, r)
}

func connectPage(w http.ResponseWriter, title, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprintf(w, `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>CPro POS</title>
<body style="font-family:Tahoma,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;color:#1e293b">
<div><h1 style="font-size:24px">%s</h1><p>%s</p></div></body></html>`, html.EscapeString(title), html.EscapeString(body))
}

// ---- the restaurant's domain ------------------------------------------------------

// DomainCheck says whether a menu address is free.
type DomainCheck struct {
	Available bool   `json:"available"`
	Domain    string `json:"domain"` // full address, when valid
	Reason    string `json:"reason"` // invalid | taken | has_tunnel
}

// CheckDomain asks the Platform whether subdomain is free. It works before
// the owner's user exists: the first-run form checks the name as it's typed.
func (a *App) CheckDomain(ctx context.Context, subdomain string) (DomainCheck, error) {
	p, err := a.linkedPlatform()
	if err != nil {
		return DomainCheck{}, err
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	r, err := p.client.CheckSubdomain(ctx, base, normalizeSubdomain(subdomain))
	if err != nil {
		return DomainCheck{}, platformErr(err)
	}
	return DomainCheck{Available: r.Available, Domain: r.Domain, Reason: r.Reason}, nil
}

// ClaimDomain creates the restaurant's domain on the Platform. The tunnel is
// built in the background there; the sync installs it here when it's ready.
func (a *App) ClaimDomain(ctx context.Context, actor Actor, subdomain string) (DomainCheck, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return DomainCheck{}, err
	}
	p, err := a.linkedPlatform()
	if err != nil {
		return DomainCheck{}, err
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	r, err := p.client.ClaimSubdomain(ctx, base, normalizeSubdomain(subdomain))
	if err != nil {
		return DomainCheck{}, platformErr(err)
	}
	if !r.Available {
		return DomainCheck{Available: false, Domain: r.Domain, Reason: r.Reason}, nil
	}
	p.mu.Lock()
	p.st.TunnelError = "" // a new attempt: forget the last failure
	p.mu.Unlock()
	for _, after := range []time.Duration{5, 15, 40} {
		time.AfterFunc(after*time.Second, func() {
			select {
			case p.wake <- struct{}{}:
			default:
			}
		})
	}
	a.audit(ctx, a.db.Write, actor, "platform.domain", "settings", platformKey, map[string]string{"domain": r.Domain})
	return DomainCheck{Available: true, Domain: r.Domain}, nil
}

func normalizeSubdomain(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func (a *App) linkedPlatform() (*platformLink, error) {
	p, err := a.platformRequired()
	if err != nil {
		return nil, err
	}
	if a.NeedsConnect() {
		return nil, invalid("اربط البرنامج بحسابك الأول")
	}
	return p, nil
}
