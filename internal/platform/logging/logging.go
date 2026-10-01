// Package logging writes structured JSON logs to a file in the data dir,
// rotating it when it grows past a size limit.
package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

const maxSize = 10 << 20 // rotate at 10 MB, keep one previous file

func New(dir string) (*slog.Logger, func(), error) {
	path := filepath.Join(dir, "cpro.log")
	if st, err := os.Stat(path); err == nil && st.Size() > maxSize {
		os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, nil, err
	}
	w := io.MultiWriter(f, os.Stderr)
	log := slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
	return log, func() { f.Close() }, nil
}
