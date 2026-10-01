// Package paths resolves where the app keeps its data. Never relative to the
// working directory: a packaged app is often launched from "/" or Program Files.
package paths

import (
	"os"
	"path/filepath"
)

const appDir = "CPro"

type Paths struct {
	Data    string // root data dir
	DB      string // main SQLite file
	Backups string
	Logs    string
	Images  string // item images
}

// Resolve returns the per-user data paths. CPRO_DATA_DIR overrides the root
// (used by tests and portable installs).
func Resolve() (Paths, error) {
	root := os.Getenv("CPRO_DATA_DIR")
	if root == "" {
		base, err := os.UserConfigDir() // %AppData% / ~/Library/Application Support / ~/.config
		if err != nil {
			return Paths{}, err
		}
		root = filepath.Join(base, appDir)
	}
	p := Paths{
		Data:    root,
		DB:      filepath.Join(root, "cpro.db"),
		Backups: filepath.Join(root, "backups"),
		Logs:    filepath.Join(root, "logs"),
		Images:  filepath.Join(root, "images"),
	}
	for _, d := range []string{p.Data, p.Backups, p.Logs, p.Images} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return Paths{}, err
		}
	}
	return p, nil
}
