package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"cpro/internal/domain/rbac"
	"cpro/internal/saas"
	"cpro/internal/store/sqlite"
)

// App updates. The Platform publishes the latest version per OS with its
// download URL and SHA-256 (SCP Settings → Desktop App); the reply is signed
// like every Platform reply, so a tampered download never runs.
//
// The app checks at start-up and every night at midnight. A mandatory
// update blocks selling until it is installed: the app downloads it,
// checks the hash and starts the installer.

const maxUpdateSize = 1 << 30 // 1 GiB

// UpdateInfo is what the UI shows about updates.
type UpdateInfo struct {
	Current   string `json:"current"`
	Available bool   `json:"available"`
	Mandatory bool   `json:"mandatory"`
	Version   string `json:"version"`
	Notes     string `json:"notes"`
	CheckedAt string `json:"checked_at"`
	State     string `json:"state"` // idle | downloading | ready | error
	Error     string `json:"error"`
}

type updater struct {
	mu     sync.Mutex
	state  string
	err    string
	launch func(path string) error // set by main: start the installer
	http   *http.Client            // nil: a client with no redirects to plain http
}

// SetUpdateLauncher plugs in how a verified installer is started (and the
// app closed, if the OS needs it).
func (a *App) SetUpdateLauncher(fn func(path string) error) { a.upd.launch = fn }

func updatePlatform() string { return runtime.GOOS + "/" + runtime.GOARCH }

// newerVersion reports whether a is a later version than b ("1.2.10" >
// "1.2.9"). Anything unparsable is never newer.
func newerVersion(a, b string) bool {
	pa, oka := parseVersion(a)
	pb, okb := parseVersion(b)
	if !oka || !okb {
		return false
	}
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func parseVersion(v string) ([3]int, bool) {
	var out [3]int
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(v), "v"), ".")
	if len(parts) == 0 || len(parts) > 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// pendingUpdate is the stored release when it is newer than this build.
func (p *platformLink) pendingUpdateLocked() *saas.Release {
	if r := p.st.Update; r != nil && newerVersion(r.Version, Version) {
		return r
	}
	return nil
}

// updateRequired is true while a mandatory update waits to be installed.
func (a *App) updateRequired() bool {
	p := a.platform
	if p == nil {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	r := p.pendingUpdateLocked()
	return r != nil && r.Mandatory
}

var errUpdateRequired = &Error{CodeForbidden, "يوجد تحديث إجباري للبرنامج. ثبّت التحديث للمتابعة"}

// CheckUpdate asks the Platform for the latest release and stores it.
func (a *App) CheckUpdate(ctx context.Context) error {
	p := a.platform
	if p == nil || Version == "dev" {
		return nil
	}
	p.mu.RLock()
	base := p.baseURL()
	p.mu.RUnlock()
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	r, err := p.client.Update(cctx, base, updatePlatform(), Version)
	if err != nil {
		return err
	}
	p.mu.Lock()
	if newerVersion(r.Version, Version) && validRelease(r) {
		p.st.Update = &r
	} else {
		p.st.Update = nil
	}
	p.st.UpdateChecked = a.now().Unix()
	err = a.savePlatformLocked(ctx)
	p.mu.Unlock()
	a.notifyPlatform()
	return err
}

// CheckUpdateNow is the "check for updates" button.
func (a *App) CheckUpdateNow(ctx context.Context, actor Actor) (UpdateInfo, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return UpdateInfo{}, err
	}
	if err := a.CheckUpdate(ctx); err != nil {
		return a.updateInfo(), platformErr(err)
	}
	return a.updateInfo(), nil
}

func validRelease(r saas.Release) bool {
	u, err := url.Parse(r.URL)
	sum, herr := hex.DecodeString(r.SHA256)
	return err == nil && u.Scheme == "https" && u.Host != "" && herr == nil && len(sum) == sha256.Size
}

// RunUpdateChecks checks shortly after start-up, then every night at
// midnight; a failed check (offline) is retried every hour.
func (a *App) RunUpdateChecks(ctx context.Context) {
	if a.platform == nil || Version == "dev" {
		return
	}
	wait := 15 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if err := a.CheckUpdate(ctx); err != nil {
			a.log.Warn("update check", "err", err)
			wait = time.Hour
			continue
		}
		wait = untilMidnight(a.now())
	}
}

func untilMidnight(now time.Time) time.Duration {
	y, m, d := now.Date()
	return time.Date(y, m, d+1, 0, 0, 0, 0, now.Location()).Sub(now)
}

func (a *App) updateInfo() UpdateInfo {
	info := UpdateInfo{Current: Version, State: "idle"}
	p := a.platform
	if p == nil {
		return info
	}
	p.mu.RLock()
	if p.st.UpdateChecked > 0 {
		info.CheckedAt = sqlite.FormatTime(time.Unix(p.st.UpdateChecked, 0))
	}
	if r := p.pendingUpdateLocked(); r != nil {
		info.Available, info.Mandatory, info.Version, info.Notes = true, r.Mandatory, r.Version, r.Notes
	}
	p.mu.RUnlock()
	a.upd.mu.Lock()
	if a.upd.state != "" {
		info.State, info.Error = a.upd.state, a.upd.err
	}
	a.upd.mu.Unlock()
	return info
}

// InstallUpdate downloads the pending release in the background, checks its
// SHA-256 and starts the installer. Only from the desktop window itself:
// the installer runs on this computer.
func (a *App) InstallUpdate(ctx context.Context, actor Actor) (UpdateInfo, error) {
	if actor.Channel != ChannelApp {
		return UpdateInfo{}, errForbidden
	}
	p := a.platform
	if p == nil {
		return UpdateInfo{}, conflict("التحديث غير متاح في هذه النسخة")
	}
	p.mu.RLock()
	r := p.pendingUpdateLocked()
	p.mu.RUnlock()
	if r == nil {
		return a.updateInfo(), conflict("لا يوجد تحديث جديد")
	}
	a.upd.mu.Lock()
	if a.upd.state == "downloading" {
		a.upd.mu.Unlock()
		return a.updateInfo(), nil
	}
	a.upd.state, a.upd.err = "downloading", ""
	a.upd.mu.Unlock()
	rel := *r
	go func() {
		err := a.downloadAndLaunch(context.WithoutCancel(ctx), rel)
		a.upd.mu.Lock()
		if err != nil {
			a.log.Error("update", "version", rel.Version, "err", err)
			a.upd.state, a.upd.err = "error", err.Error()
		} else {
			a.upd.state = "ready"
		}
		a.upd.mu.Unlock()
	}()
	a.audit(ctx, a.db.Write, actor, "update.install", "settings", platformKey, map[string]string{"version": rel.Version})
	return a.updateInfo(), nil
}

func (a *App) downloadAndLaunch(ctx context.Context, r saas.Release) error {
	dir := filepath.Join(a.paths.Data, "updates")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	u, _ := url.Parse(r.URL)
	name := path.Base(u.Path)
	if name == "" || name == "/" || name == "." || strings.ContainsAny(name, `\/:`) {
		name = "cpro-update"
	}
	dest := filepath.Join(dir, name)
	cctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, r.URL, nil)
	if err != nil {
		return err
	}
	client := a.upd.http
	if client == nil {
		client = &http.Client{CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if req.URL.Scheme != "https" {
				return errors.New("redirect away from https")
			}
			return nil
		}}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("تعذر تحميل التحديث: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("تعذر تحميل التحديث (%d)", resp.StatusCode)
	}
	tmp, err := os.CreateTemp(dir, "dl-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(resp.Body, maxUpdateSize+1))
	tmp.Close()
	if err != nil {
		return fmt.Errorf("تعذر تحميل التحديث: %w", err)
	}
	if n > maxUpdateSize {
		return errors.New("ملف التحديث أكبر من المسموح")
	}
	if !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), r.SHA256) {
		return errors.New("ملف التحديث غير مطابق (تم رفضه لحمايتك)")
	}
	if err := os.Rename(tmp.Name(), dest); err != nil {
		return err
	}
	if err := os.Chmod(dest, 0o700); err != nil {
		return err
	}
	if a.upd.launch == nil {
		return errors.New("لا يمكن تشغيل المثبّت من هذه النسخة")
	}
	return a.upd.launch(dest)
}
