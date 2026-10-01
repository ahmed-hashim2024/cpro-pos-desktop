// Package native exposes the few things a web page can't do well inside
// the desktop window, as Wails bindings. Business logic never goes here.
package native

import (
	"context"
	"encoding/base64"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Native struct{ ctx context.Context }

func New() *Native { return &Native{} }

// OnStartup returns the hook that hands n the Wails runtime context. It is a
// package function, not a method, so it isn't exposed to JavaScript.
func OnStartup(n *Native) func(context.Context) {
	return func(ctx context.Context) { n.ctx = ctx }
}

// SaveFile asks where to save and writes the base64 data there. It returns
// the chosen path, or "" if the user cancelled.
func (n *Native) SaveFile(defaultName, dataBase64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(n.ctx, runtime.SaveDialogOptions{DefaultFilename: defaultName})
	if err != nil || path == "" {
		return "", err
	}
	return path, os.WriteFile(path, data, 0o644)
}
