package app

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

// The owner can keep a second copy of every backup in a folder of their
// choice, ideally on another drive, so a failed disk doesn't take the
// backups with it. The local copy always comes first: if the chosen drive is
// missing the backup still exists here and the screen shows the problem.

// BackupCopy is the result of the latest copy to the chosen folder.
type BackupCopy struct {
	At    string `json:"at"`
	Error string `json:"error"`
}

// BackupLocationInfo is what the backups screen shows.
type BackupLocationInfo struct {
	Dir       string     `json:"dir"`
	Default   string     `json:"default"`    // where backups always go
	SameDrive bool       `json:"same_drive"` // the chosen folder won't survive a disk failure
	LastCopy  BackupCopy `json:"last_copy"`
}

func (a *App) BackupLocation(ctx context.Context, actor Actor) (BackupLocationInfo, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return BackupLocationInfo{}, err
	}
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return BackupLocationInfo{}, err
	}
	a.backupMu.Lock()
	last := a.backupCopy
	a.backupMu.Unlock()
	return BackupLocationInfo{Dir: s.BackupDir, Default: a.paths.Backups, SameDrive: s.BackupDir != "" && sameDrive(s.BackupDir, a.paths.Backups), LastCopy: last}, nil
}

// sameDrive compares Windows drive letters (other systems have none to compare).
func sameDrive(x, y string) bool {
	vx, vy := filepath.VolumeName(x), filepath.VolumeName(y)
	return vx != "" && strings.EqualFold(vx, vy)
}

// SetBackupDir chooses the folder, or clears it with "". It takes a path on
// this computer, so only the desktop window may set it, never a tablet.
func (a *App) SetBackupDir(ctx context.Context, actor Actor, dir string) (BackupLocationInfo, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return BackupLocationInfo{}, err
	}
	if actor.Channel != ChannelApp {
		return BackupLocationInfo{}, &Error{CodeForbidden, "يُغيَّر موقع النسخ من الجهاز الرئيسي لنقطة البيع فقط"}
	}
	dir = strings.TrimSpace(dir)
	if dir != "" {
		if !filepath.IsAbs(dir) {
			return BackupLocationInfo{}, invalid("اختر مجلداً من الجهاز")
		}
		dir = filepath.Clean(dir)
		if err := checkWritable(dir); err != nil {
			return BackupLocationInfo{}, invalid("لا يستطيع البرنامج الكتابة في هذا المجلد، فاختر موقعاً آخر")
		}
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		s, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		s.BackupDir = dir
		if err := a.saveSettings(ctx, tx, s); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "backup.location", "settings", settingsKey, map[string]string{"dir": dir})
	})
	if err != nil {
		return BackupLocationInfo{}, err
	}
	a.backupMu.Lock()
	a.backupCopy = BackupCopy{}
	a.backupMu.Unlock()
	if dir != "" {
		// Protect the owner right away instead of at the next scheduled backup.
		if _, err := a.BackupNow(ctx, actor, "manual"); err != nil {
			return BackupLocationInfo{}, err
		}
	}
	return a.BackupLocation(ctx, actor)
}

func checkWritable(dir string) error {
	f, err := os.CreateTemp(dir, ".cpro-write-test-*")
	if err != nil {
		return err
	}
	f.Close()
	return os.Remove(f.Name())
}

// copyBackup puts a backup in the chosen folder and trims old copies there.
func (a *App) copyBackup(path string, s Settings) {
	if s.BackupDir == "" {
		return
	}
	res := BackupCopy{At: sqlite.FormatTime(a.now())}
	if err := copyFile(path, filepath.Join(s.BackupDir, filepath.Base(path))); err != nil {
		a.log.Error("backup copy failed", "dir", s.BackupDir, "err", err)
		res.Error = "المجلد غير متاح. حُفظت النسخة على الجهاز؛ صِل القرص الصلب أو ذاكرة USB، أو اختر موقعاً آخر."
	} else {
		pruneDir(s.BackupDir, s.BackupKeep)
	}
	a.backupMu.Lock()
	a.backupCopy = res
	a.backupMu.Unlock()
}

// copyFile writes through a temporary name, so a pulled drive or a full disk
// never leaves something that looks like a complete backup.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return fmt.Errorf("copy: %w", err)
	}
	return os.Rename(tmp, dst)
}

// pruneDir keeps the newest keep backups. It only touches this app's files,
// because the folder is the owner's and may hold other things.
func pruneDir(dir string, keep int) {
	if keep <= 0 {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "cpro-") && strings.HasSuffix(e.Name(), ".db") {
			names = append(names, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names))) // the name starts with the date
	for _, n := range names[min(keep, len(names)):] {
		os.Remove(filepath.Join(dir, n))
	}
}
