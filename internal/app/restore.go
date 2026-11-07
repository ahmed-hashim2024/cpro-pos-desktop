package app

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"cpro/internal/store/sqlite"
)

// A backup is one file that carries the whole restaurant, so an owner on a
// new computer can upload it and carry on: the database, plus the pictures in
// a table that exists only in the backup.
//
// Restoring replaces this computer's database, which can't happen under a
// running app. The file is checked and prepared now, waits next to the
// database, and takes over when the app starts again. What belongs to this
// computer stays: the link to the account and the backup folder.

const backupImagesTable = "backup_images"

// packImages adds the pictures to a fresh backup. A picture that can't be read
// is logged and left out: it's no reason to lose the whole backup.
func (a *App) packImages(ctx context.Context, path string) error {
	names, err := a.imageFiles()
	if errors.Is(err, fs.ErrNotExist) || (err == nil && len(names) == 0) {
		return nil
	}
	if err != nil {
		return err
	}
	return sqlite.EditFile(ctx, path, false, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `CREATE TABLE `+backupImagesTable+`(name TEXT PRIMARY KEY, data BLOB NOT NULL)`); err != nil {
			return err
		}
		for _, name := range names {
			b, err := os.ReadFile(filepath.Join(a.paths.Images, name))
			if err != nil {
				a.log.Error("backup image", "name", name, "err", err)
				continue
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO `+backupImagesTable+`(name, data) VALUES (?,?)`, name, b); err != nil {
				return err
			}
		}
		return nil
	})
}

// RestoreUpload restores a backup the owner uploaded.
func (a *App) RestoreUpload(ctx context.Context, actor Actor, path string) error {
	if err := requireRestore(actor); err != nil {
		return err
	}
	return a.restore(ctx, path, true)
}

// RestoreSaved restores one of the backups kept on this computer.
func (a *App) RestoreSaved(ctx context.Context, actor Actor, name string) error {
	if err := requireRestore(actor); err != nil {
		return err
	}
	path, err := a.BackupFile(ctx, actor, name)
	if err != nil {
		return err
	}
	return a.restore(ctx, path, true)
}

// RestoreFirstRun restores a backup instead of filling the setup form. With no
// user yet nobody can sign in, so it works only while this computer is empty
// and already connected to the owner's account.
func (a *App) RestoreFirstRun(ctx context.Context, path string) error {
	empty, err := a.NeedsSetup(ctx)
	if err != nil {
		return err
	}
	if !empty {
		return conflict("البرنامج مُعدّ بالفعل، فاسترجع النسخة من الإعدادات")
	}
	if a.NeedsConnect() {
		return invalid("اربط البرنامج بحسابك أولاً")
	}
	return a.restore(ctx, path, false)
}

func requireRestore(actor Actor) error {
	if err := requireOwner(actor); err != nil {
		return err
	}
	if actor.Channel != ChannelApp {
		return &Error{CodeForbidden, "يتم الاسترجاع من الجهاز الرئيسي لنقطة البيع فقط"}
	}
	return nil
}

func (a *App) restore(ctx context.Context, src string, keepCurrent bool) error {
	if a.relaunch == nil {
		return conflict("الاسترجاع متاح من البرنامج نفسه")
	}
	if err := a.checkBackup(ctx, src); err != nil {
		return err
	}
	pending := a.paths.PendingRestore()
	work := pending + ".work"
	defer os.Remove(work)
	if err := copyFile(src, work); err != nil {
		return err
	}
	if keepCurrent {
		// The way back if it was the wrong file.
		if _, err := a.BackupNow(ctx, Actor{}, "pre-restore"); err != nil {
			return err
		}
	}
	if err := a.adoptBackup(ctx, work); err != nil {
		return err
	}
	if err := os.Rename(work, pending); err != nil {
		return err
	}
	time.AfterFunc(time.Second, a.relaunch) // let the screen get its answer first
	return nil
}

func (a *App) checkBackup(ctx context.Context, path string) error {
	bad := invalid("هذا الملف ليس نسخة احتياطية من البرنامج. اختر ملفاً بامتداد ‎.db من مجلد النسخ الاحتياطية")
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	head := make([]byte, 16)
	n, _ := f.Read(head)
	f.Close()
	if bytes.HasPrefix(head[:n], []byte("PK")) {
		return invalid("هذا ملف نقل بيانات وليس نسخة احتياطية. ارفعه من «استيراد وتصدير البيانات» ← «نقل البيانات» بعد إعداد البرنامج")
	}
	if !bytes.Equal(head[:n], []byte("SQLite format 3\x00")) {
		return bad
	}
	if res, err := sqlite.CheckIntegrity(ctx, path); err != nil || res != "ok" {
		return invalid("ملف النسخة تالف، جرّب نسخة أخرى")
	}
	db, err := sqlite.ReadFile(path)
	if err != nil {
		return bad
	}
	defer db.Close()
	var owners int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role = 'owner' AND active = 1`).Scan(&owners); err != nil || owners == 0 {
		return bad
	}
	version, err := sqlite.SchemaVersion(ctx, db)
	if err != nil {
		return bad
	}
	current, err := sqlite.SchemaVersion(ctx, a.db.Read)
	if err != nil {
		return err
	}
	if version > current {
		return invalid("هذه النسخة من إصدار مختلف من البرنامج، ولا يمكن استرجاعها على هذا الإصدار")
	}
	return nil
}

// adoptBackup makes a copy of a backup fit this computer.
func (a *App) adoptBackup(ctx context.Context, path string) error {
	cur, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return err
	}
	var link sql.NullString
	err = a.db.Read.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, platformKey).Scan(&link)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return sqlite.EditFile(ctx, path, true, func(tx *sql.Tx) error {
		// The license in a backup was issued to the computer it came from.
		if _, err := tx.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, platformKey); err != nil {
			return err
		}
		if link.Valid {
			if _, err := tx.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)`, platformKey, link.String, a.stamp()); err != nil {
				return err
			}
		}
		// A path on the old computer means nothing here.
		if _, err := tx.ExecContext(ctx, `UPDATE settings SET value = json_set(value, '$.backup_dir', ?) WHERE key = ?`, cur.BackupDir, settingsKey); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL`, a.stamp()); err != nil {
			return err
		}
		if err := a.unpackImages(ctx, tx); err != nil {
			return err
		}
		return a.audit(ctx, tx, Actor{Channel: ChannelApp}, "backup.restore", "backups", "", nil)
	})
}

// unpackImages puts a backup's pictures in place and removes them from it.
// Backups taken before pictures were included simply have none.
func (a *App) unpackImages(ctx context.Context, tx *sql.Tx) error {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, backupImagesTable).Scan(&found)
	if err != nil || found == 0 {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT name, data FROM `+backupImagesTable)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var b []byte
		if err := rows.Scan(&name, &b); err != nil {
			return err
		}
		p, ok := a.ImagePath(name)
		if !ok {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			continue
		}
		a.saveImage(name, p, b)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()
	_, err = tx.ExecContext(ctx, `DROP TABLE `+backupImagesTable)
	return err
}

// SetRelaunch sets how the app closes and starts again. Without it (tools,
// tests that don't restore) a restore is refused.
func (a *App) SetRelaunch(fn func()) { a.relaunch = fn }
