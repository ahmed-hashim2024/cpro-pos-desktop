package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
)

// The restaurant's data also lives on the owner's account, so a new computer
// without a backup starts with it instead of a blank form. Only this travels:
// the menu, sales and customers stay on the computer and in its backups, and
// passwords never leave it.

// savedProfile is what the account keeps.
type savedProfile struct {
	Settings  Settings `json:"settings"`
	OwnerName string   `json:"owner_name"`
	Username  string   `json:"username"`
}

// readProfile decodes what the Platform sent. What can't be trusted to open
// the app is treated as nothing saved.
func readProfile(raw json.RawMessage) *savedProfile {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	p := savedProfile{Settings: defaultSettings()}
	if json.Unmarshal(raw, &p) != nil || validateSettings(&p.Settings) != nil {
		return nil
	}
	// What belongs to one computer starts fresh on each.
	def := defaultSettings()
	p.Settings.LANEnabled, p.Settings.LANPort, p.Settings.BackupDir = def.LANEnabled, def.LANPort, def.BackupDir
	return &p
}

func (a *App) accountProfile() *savedProfile {
	p := a.platform
	if p == nil {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return readProfile(p.st.Profile)
}

// pushProfile saves the restaurant's data on the account when it changed. It
// runs with every sync, so changes made offline go out once back online. A
// computer that isn't set up has nothing to say, and must not blank the account.
func (a *App) pushProfile(ctx context.Context, base string) {
	if err := a.syncProfile(ctx, base); err != nil {
		a.log.Warn("save profile", "err", err)
	}
}

func (a *App) syncProfile(ctx context.Context, base string) error {
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return err
	}
	var out savedProfile
	err = a.db.Read.QueryRowContext(ctx, `SELECT full_name, username FROM users WHERE role = 'owner' AND active = 1 ORDER BY created_at LIMIT 1`).
		Scan(&out.OwnerName, &out.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	s.LANEnabled, s.LANPort, s.BackupDir = false, 0, ""
	out.Settings = s
	b, err := json.Marshal(out)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(b)
	hash := hex.EncodeToString(sum[:])
	p := a.platform
	p.mu.RLock()
	same, revoked := p.st.ProfileHash == hash, p.st.Revoked
	p.mu.RUnlock()
	if same || revoked {
		return nil
	}
	if err := p.client.SaveProfile(ctx, base, out); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.st.ProfileHash = hash
	return a.savePlatformLocked(ctx)
}
