package app

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// ---- audit log ---------------------------------------------------------------

type AuditEntry struct {
	ID       string `json:"id"`
	At       string `json:"at"`
	User     string `json:"user_name"`
	Device   string `json:"device_name"`
	Channel  string `json:"channel"`
	Action   string `json:"action"`
	Entity   string `json:"entity"`
	EntityID string `json:"entity_id"`
	Data     string `json:"data"`
}

func (a *App) AuditLog(ctx context.Context, actor Actor, from, to, action, userID string) ([]AuditEntry, error) {
	if err := actor.require(rbac.AuditView); err != nil {
		return nil, err
	}
	s, _ := loadSettings(ctx, a.db.Read)
	start, end, err := dayRange(from, to, s.DayStartHour)
	if err != nil {
		return nil, err
	}
	q := `SELECT l.id, l.at, coalesce(u.full_name,''), coalesce(d.name,''), l.channel, l.action, l.entity, l.entity_id, l.data
		FROM audit_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN devices d ON d.id = l.device_id
		WHERE l.at >= ? AND l.at < ?`
	args := []any{start, end}
	if action != "" {
		q += ` AND l.action LIKE ?`
		args = append(args, action+"%")
	}
	if userID != "" {
		q += ` AND l.user_id = ?`
		args = append(args, userID)
	}
	rows, err := a.db.Read.QueryContext(ctx, q+` ORDER BY l.at DESC LIMIT 3000`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.At, &e.User, &e.Device, &e.Channel, &e.Action, &e.Entity, &e.EntityID, &e.Data); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---- devices -----------------------------------------------------------------

type Device struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	PairedAt string `json:"paired_at"`
	LastSeen string `json:"last_seen"`
	Revoked  bool   `json:"revoked"`
}

func (a *App) Devices(ctx context.Context, actor Actor) ([]Device, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id, name, kind, paired_at, coalesce(last_seen,''), revoked_at IS NOT NULL FROM devices ORDER BY paired_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		var d Device
		var revoked int64
		if err := rows.Scan(&d.ID, &d.Name, &d.Kind, &d.PairedAt, &d.LastSeen, &revoked); err != nil {
			return nil, err
		}
		d.Revoked = revoked == 1
		out = append(out, d)
	}
	return out, rows.Err()
}

// RevokeDevice signs a LAN/remote device out and blocks it from logging in.
func (a *App) RevokeDevice(ctx context.Context, actor Actor, id string) error {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return err
	}
	terminal, _ := a.EnsureTerminal(ctx)
	if id == terminal {
		return conflict("لا يمكن إيقاف الجهاز الرئيسي")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if err := mustAffect(tx.ExecContext(ctx, `UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, a.stamp(), id)); err != nil {
			return noRows(err, "الجهاز")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL`, a.stamp(), id); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "device.revoke", "devices", id, nil)
	})
}

// ---- backups -----------------------------------------------------------------

type Backup struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	At   string `json:"created_at"`
}

// BackupNow writes a consistent snapshot of the database to the backups dir.
func (a *App) BackupNow(ctx context.Context, actor Actor, reason string) (Backup, error) {
	if actor.UserID != "" {
		if err := actor.require(rbac.SettingsManage); err != nil {
			return Backup{}, err
		}
	}
	now := a.now()
	name := fmt.Sprintf("cpro-%s-%s.db", now.Format("20060102-150405"), reason)
	path := filepath.Join(a.paths.Backups, name)
	if err := a.db.BackupTo(ctx, path); err != nil {
		return Backup{}, err
	}
	integrity, err := sqlite.CheckIntegrity(ctx, path)
	if err != nil || integrity != "ok" {
		os.Remove(path)
		return Backup{}, fmt.Errorf("backup integrity check failed: %v %s", err, integrity)
	}
	if actor.UserID != "" {
		_ = a.audit(ctx, a.db.Write, actor, "backup.create", "backups", name, nil)
	}
	s, _ := loadSettings(ctx, a.db.Read)
	a.pruneBackups(s.BackupKeep)
	st, _ := os.Stat(path)
	return Backup{Name: name, Size: st.Size(), At: sqlite.FormatTime(now)}, nil
}

func (a *App) Backups(ctx context.Context, actor Actor) ([]Backup, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return nil, err
	}
	return a.listBackups()
}

func (a *App) listBackups() ([]Backup, error) {
	entries, err := os.ReadDir(a.paths.Backups)
	if err != nil {
		return nil, err
	}
	out := []Backup{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, Backup{Name: e.Name(), Size: info.Size(), At: sqlite.FormatTime(info.ModTime())})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out, nil
}

func (a *App) pruneBackups(keep int) {
	if keep <= 0 {
		return
	}
	list, err := a.listBackups()
	if err != nil {
		return
	}
	for _, b := range list[min(keep, len(list)):] {
		os.Remove(filepath.Join(a.paths.Backups, b.Name))
	}
}

// AutoBackup runs a backup if the newest one is older than the configured
// interval. Called at startup and periodically.
func (a *App) AutoBackup(ctx context.Context) {
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil || s.AutoBackupHours <= 0 {
		return
	}
	list, _ := a.listBackups()
	if len(list) > 0 {
		if latest, err := time.Parse(sqlite.TimeFormat, list[0].At); err == nil && a.now().Sub(latest) < time.Duration(s.AutoBackupHours)*time.Hour {
			return
		}
	}
	if _, err := a.BackupNow(ctx, Actor{}, "auto"); err != nil {
		a.log.Error("auto backup failed", "err", err)
	}
}

// BackupFile resolves a backup file name safely for download.
func (a *App) BackupFile(ctx context.Context, actor Actor, name string) (string, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return "", err
	}
	if name != filepath.Base(name) || !strings.HasSuffix(name, ".db") {
		return "", notFound("النسخة")
	}
	p := filepath.Join(a.paths.Backups, name)
	if _, err := os.Stat(p); err != nil {
		return "", notFound("النسخة")
	}
	return p, nil
}
