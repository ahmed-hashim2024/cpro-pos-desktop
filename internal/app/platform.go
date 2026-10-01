package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"cpro/internal/domain/rbac"
	"cpro/internal/license"
	"cpro/internal/saas"
	"cpro/internal/store/sqlite"
)

// Version is the app version, set at build time
// (-ldflags "-X cpro/internal/app.Version=1.2.0").
var Version = "dev"

// Linking to the Platform: activation, license checks and the config the
// owner edits on the Platform (restaurant domain, e-menu settings).
//
// Without a linked, valid license the app still opens, reports and backups
// keep working, but selling is blocked (requireLicensed).

const (
	platformKey     = "platform"
	versionInterval = time.Minute
	refreshInterval = 6 * time.Hour
)

// platformState is persisted in settings so the app starts licensed and
// configured while offline.
type platformState struct {
	URL         string          `json:"url"` // override of saas.DefaultURL
	License     string          `json:"license"`
	Tunnel      *saas.Tunnel    `json:"tunnel"`
	EMenu       json.RawMessage `json:"emenu"`
	Ver         int64           `json:"ver"`
	Revoked     bool            `json:"revoked"`
	HighWater   int64           `json:"high_water"` // latest time seen (anti clock rollback)
	LastRefresh int64           `json:"last_refresh"`
	LastSync    string          `json:"last_sync"`
	LastError   string          `json:"last_error"`
}

type platformLink struct {
	client   *saas.Client
	mu       sync.RWMutex
	st       platformState
	claims   *license.Claims // verified and bound to this device
	wake     chan struct{}
	onChange []func()
}

// EnablePlatform turns licensing on. Tests and tools that never call it run
// unlicensed-but-unrestricted.
func (a *App) EnablePlatform(ctx context.Context, c *saas.Client) error {
	p := &platformLink{client: c, wake: make(chan struct{}, 1)}
	var raw string
	err := a.db.Read.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, platformKey).Scan(&raw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &p.st); err != nil {
			a.log.Warn("platform state unreadable; starting unlinked", "err", err)
			p.st = platformState{}
		}
	}
	p.claims = verifyFor(p.st.License, c.ID)
	a.platform = p
	return nil
}

// verifyFor returns the license claims if the token is genuine and was
// issued to this exact device and key.
func verifyFor(token string, id saas.Identity) *license.Claims {
	if token == "" {
		return nil
	}
	c, err := license.Verify(token, license.Key())
	if err != nil || c.DeviceID != id.DeviceID || c.DeviceKey != id.PublicKey() {
		return nil
	}
	return &c
}

// OnPlatformChange registers fn to run after the license or synced config
// changes (the tunnel supervisor listens here).
func (a *App) OnPlatformChange(fn func()) {
	if a.platform != nil {
		a.platform.mu.Lock()
		a.platform.onChange = append(a.platform.onChange, fn)
		a.platform.mu.Unlock()
	}
}

func (p *platformLink) baseURL() string {
	if p.st.URL != "" {
		return p.st.URL
	}
	return saas.DefaultURL
}

// licenseStatus evaluates the current license. Callers hold no lock.
func (a *App) licenseStatus() license.Status {
	p := a.platform
	if p == nil {
		return license.Status{State: license.Active}
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.statusLocked(a.now())
}

func (p *platformLink) statusLocked(now time.Time) license.Status {
	if p.claims == nil {
		return license.Status{State: license.Unlicensed}
	}
	if p.st.Revoked {
		return license.Status{State: license.Restricted, Reason: license.ReasonRevoked}
	}
	return license.Evaluate(*p.claims, now, time.Unix(p.st.HighWater, 0))
}

// features are what the license grants; all on when licensing is off.
func (a *App) features() license.Features {
	p := a.platform
	if p == nil {
		return license.Features{EMenu: true, EMenuOrdering: true, RemoteAccess: true}
	}
	if !a.licenseStatus().CanSell() {
		return license.Features{}
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.claims.Features
}

var errUnlicensed = &Error{CodeForbidden, "البرنامج غير مفعّل أو انتهى الاشتراك. فعّل البرنامج من الإعدادات ← الحساب"}

// requireLicensed blocks selling without a valid license.
func (a *App) requireLicensed() error {
	if !a.licenseStatus().CanSell() {
		return errUnlicensed
	}
	return nil
}

// TunnelConfig is what the tunnel supervisor should run: a connector token
// when the account has an active domain and a feature that needs it.
func (a *App) TunnelConfig() (token, domain string) {
	p := a.platform
	if p == nil {
		return "", ""
	}
	f := a.features()
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.st.Tunnel == nil || !(f.EMenu || f.RemoteAccess) {
		return "", ""
	}
	return p.st.Tunnel.ConnectorToken, p.st.Tunnel.Domain
}

// ---- persistence -------------------------------------------------------------

func (a *App) savePlatformLocked(ctx context.Context) error {
	b, err := json.Marshal(a.platform.st)
	if err != nil {
		return err
	}
	_, err = a.db.Write.ExecContext(ctx,
		`INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		platformKey, string(b), a.stamp())
	return err
}

func (a *App) notifyPlatform() {
	p := a.platform
	p.mu.RLock()
	fns := append([]func(){}, p.onChange...)
	p.mu.RUnlock()
	for _, fn := range fns {
		fn()
	}
}

// apply stores a Platform reply. It never downgrades to an invalid license:
// a token that doesn't verify for this device is an error.
func (a *App) applyReply(ctx context.Context, r saas.Reply) error {
	p := a.platform
	p.mu.Lock()
	now := a.now()
	if r.Revoked {
		p.st.Revoked = true
	} else {
		claims := verifyFor(r.License, p.client.ID)
		if claims == nil {
			p.mu.Unlock()
			return errors.New("platform returned a license this device can't verify")
		}
		p.claims = claims
		p.st.License = r.License
		p.st.Revoked = false
		p.st.Tunnel = r.Sync.Tunnel
		if len(r.Sync.EMenu) > 0 {
			p.st.EMenu = r.Sync.EMenu
		}
		p.st.Ver = r.Sync.Ver
		p.st.HighWater = max(p.st.HighWater, claims.IssuedAt)
	}
	p.st.HighWater = max(p.st.HighWater, now.Unix())
	p.st.LastRefresh = now.Unix()
	p.st.LastSync = sqlite.FormatTime(now)
	p.st.LastError = ""
	err := a.savePlatformLocked(ctx)
	p.mu.Unlock()
	a.notifyPlatform()
	return err
}

func (a *App) recordPlatformError(ctx context.Context, err error) {
	p := a.platform
	p.mu.Lock()
	p.st.LastError = err.Error()
	p.st.HighWater = max(p.st.HighWater, a.now().Unix())
	a.savePlatformLocked(ctx)
	p.mu.Unlock()
}

// ---- sync loop -------------------------------------------------------------------

// RunPlatformSync keeps the license and config fresh until ctx ends: a
// cheap version check every minute, a full refresh when it moves, and a
// refresh every few hours regardless (license renewal).
func (a *App) RunPlatformSync(ctx context.Context) {
	p := a.platform
	if p == nil {
		return
	}
	t := time.NewTicker(versionInterval)
	defer t.Stop()
	a.syncOnce(ctx, true)
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.wake:
			a.syncOnce(ctx, true)
		case <-t.C:
			a.syncOnce(ctx, false)
		}
		// Pick up time-based changes (expiry, grace) even when nothing synced.
		a.notifyPlatform()
	}
}

func (a *App) syncOnce(ctx context.Context, force bool) {
	p := a.platform
	p.mu.RLock()
	linked := p.claims != nil
	base := p.baseURL()
	ver := p.st.Ver
	due := a.now().Unix()-p.st.LastRefresh >= int64(refreshInterval/time.Second)
	p.mu.RUnlock()
	if !linked || base == "" {
		return
	}
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if !force && !due {
		remote, revoked, err := p.client.Version(cctx, base)
		if err != nil {
			a.recordPlatformError(ctx, err)
			return
		}
		if !revoked && remote == ver {
			return
		}
	}
	r, err := p.client.Refresh(cctx, base)
	if err != nil {
		a.log.Warn("platform refresh", "err", err)
		a.recordPlatformError(ctx, err)
		return
	}
	if err := a.applyReply(ctx, r); err != nil {
		a.log.Error("platform reply", "err", err)
		a.recordPlatformError(ctx, err)
	}
}

// ---- use cases -------------------------------------------------------------------

type PlatformInfo struct {
	Enabled     bool             `json:"enabled"` // licensing is on in this build
	Linked      bool             `json:"linked"`
	State       license.State    `json:"state"`
	Reason      string           `json:"reason"`
	TenantName  string           `json:"tenant_name"`
	Plan        string           `json:"plan"` // trial | active | ...
	Features    license.Features `json:"features"`
	ExpiresAt   string           `json:"expires_at"`
	GraceUntil  string           `json:"grace_until"`
	DeviceID    string           `json:"device_id"`
	URL         string           `json:"url"`
	DefaultURL  string           `json:"default_url"`
	LastSync    string           `json:"last_sync"`
	LastError   string           `json:"last_error"`
	Domain      string           `json:"domain"`
	MenuURL     string           `json:"menu_url"`
	MenuEnabled bool             `json:"menu_enabled"`
	Tunnel      TunnelStatus     `json:"tunnel"`
	Version     string           `json:"app_version"`
}

// TunnelStatus is reported by the tunnel supervisor.
type TunnelStatus struct {
	State string `json:"state"` // off | starting | connected | error
	Error string `json:"error"`
}

// SetTunnelStatusFunc lets main plug the supervisor's status into PlatformInfo.
func (a *App) SetTunnelStatusFunc(fn func() TunnelStatus) { a.tunnelStatus = fn }

// PlatformInfo is readable by every signed-in user: the POS shows the
// activation screen from it.
func (a *App) PlatformInfo(ctx context.Context, actor Actor) (PlatformInfo, error) {
	info := PlatformInfo{Version: Version, DefaultURL: saas.DefaultURL}
	p := a.platform
	if p == nil {
		info.State = license.Active
		return info, nil
	}
	st := a.licenseStatus()
	info.Enabled = true
	info.State, info.Reason = st.State, st.Reason
	f := a.features()
	p.mu.RLock()
	info.Linked = p.claims != nil
	if p.claims != nil {
		info.TenantName = p.claims.TenantName
		info.Plan = p.claims.Status
		info.ExpiresAt = sqlite.FormatTime(st.ExpiresAt)
		if st.GraceUntil.After(st.ExpiresAt) {
			info.GraceUntil = sqlite.FormatTime(st.GraceUntil)
		}
	}
	info.Features = f
	info.DeviceID = p.client.ID.DeviceID
	info.URL = p.baseURL()
	info.LastSync, info.LastError = p.st.LastSync, p.st.LastError
	if p.st.Tunnel != nil {
		info.Domain = p.st.Tunnel.Domain
		info.MenuURL = "https://" + p.st.Tunnel.Domain
	}
	p.mu.RUnlock()
	info.MenuEnabled = a.menuOpen()
	if a.tunnelStatus != nil {
		info.Tunnel = a.tunnelStatus()
	} else {
		info.Tunnel = TunnelStatus{State: "off"}
	}
	if !actor.Can(rbac.SettingsManage) {
		info.DeviceID, info.LastError, info.URL = "", "", ""
	}
	return info, nil
}

func deviceInfo(name string) saas.DeviceInfo {
	host, _ := os.Hostname()
	sum := sha256.Sum256([]byte(host + "|" + runtime.GOOS + "|" + runtime.GOARCH))
	if name == "" {
		name = host
	}
	return saas.DeviceInfo{
		Name:        name,
		OS:          runtime.GOOS + "/" + runtime.GOARCH,
		AppVersion:  Version,
		Fingerprint: hex.EncodeToString(sum[:8]),
	}
}

// platformErr turns client errors into messages for the user.
func platformErr(err error) error {
	var se *saas.Error
	switch {
	case errors.As(err, &se):
		return &Error{CodeConflict, "رد المنصة: " + se.Message}
	case errors.Is(err, saas.ErrUnreachable):
		return &Error{CodeConflict, "تعذر الاتصال بالمنصة. تأكد من الإنترنت وحاول مرة أخرى"}
	}
	return err
}

func (a *App) platformRequired() (*platformLink, error) {
	if a.platform == nil {
		return nil, conflict("الربط بالمنصة غير مفعّل في هذه النسخة")
	}
	return a.platform, nil
}

// ActivateDevice links this computer to the owner's account with the
// activation code shown on the Platform.
func (a *App) ActivateDevice(ctx context.Context, actor Actor, code, deviceName string) (PlatformInfo, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return PlatformInfo{}, err
	}
	p, err := a.platformRequired()
	if err != nil {
		return PlatformInfo{}, err
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) < 6 || len(code) > 40 {
		return PlatformInfo{}, invalid("اكتب كود التفعيل كما يظهر في حسابك على المنصة")
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	if base == "" {
		return PlatformInfo{}, invalid("عنوان المنصة غير مضبوط")
	}
	r, err := p.client.Activate(ctx, base, code, deviceInfo(strings.TrimSpace(deviceName)))
	if err != nil {
		return PlatformInfo{}, platformErr(err)
	}
	if err := a.applyReply(ctx, r); err != nil {
		return PlatformInfo{}, err
	}
	a.audit(ctx, a.db.Write, actor, "platform.activate", "settings", platformKey, map[string]string{"device_id": p.client.ID.DeviceID})
	return a.PlatformInfo(ctx, actor)
}

// SyncPlatform refreshes now (the "sync" button).
func (a *App) SyncPlatform(ctx context.Context, actor Actor) (PlatformInfo, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return PlatformInfo{}, err
	}
	p, err := a.platformRequired()
	if err != nil {
		return PlatformInfo{}, err
	}
	p.mu.RLock()
	linked, base := p.claims != nil, p.baseURL()
	p.mu.RUnlock()
	if !linked {
		return PlatformInfo{}, conflict("الجهاز غير مفعّل")
	}
	r, err := p.client.Refresh(ctx, base)
	if err != nil {
		a.recordPlatformError(ctx, err)
		return PlatformInfo{}, platformErr(err)
	}
	if err := a.applyReply(ctx, r); err != nil {
		return PlatformInfo{}, err
	}
	return a.PlatformInfo(ctx, actor)
}

// UnlinkDevice frees this computer's slot on the account. With force, the
// local link is removed even if the Platform can't be reached (the owner
// can then revoke the device from the Platform).
func (a *App) UnlinkDevice(ctx context.Context, actor Actor, force bool) error {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return err
	}
	p, err := a.platformRequired()
	if err != nil {
		return err
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	if err := p.client.Deactivate(ctx, base); err != nil && !force {
		return platformErr(err)
	}
	p.mu.Lock()
	url, hw := p.st.URL, p.st.HighWater
	p.st = platformState{URL: url, HighWater: hw}
	p.claims = nil
	err = a.savePlatformLocked(ctx)
	p.mu.Unlock()
	a.notifyPlatform()
	if err != nil {
		return err
	}
	return a.audit(ctx, a.db.Write, actor, "platform.unlink", "settings", platformKey, map[string]bool{"force": force})
}

// SetPlatformURL overrides the Platform address (Settings → Advanced).
// Empty restores the built-in default.
func (a *App) SetPlatformURL(ctx context.Context, actor Actor, raw string) error {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return err
	}
	p, err := a.platformRequired()
	if err != nil {
		return err
	}
	url := ""
	if strings.TrimSpace(raw) != "" {
		if url, err = saas.NormalizeURL(raw); err != nil {
			return invalid("عنوان المنصة غير صحيح، يجب أن يبدأ بـ https://")
		}
	}
	p.mu.Lock()
	p.st.URL = url
	err = a.savePlatformLocked(ctx)
	p.mu.Unlock()
	if err != nil {
		return err
	}
	return a.audit(ctx, a.db.Write, actor, "platform.url", "settings", platformKey, map[string]string{"url": url})
}
