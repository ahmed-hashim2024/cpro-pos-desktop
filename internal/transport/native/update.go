package native

import (
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// UpdateLauncher starts a downloaded, verified installer and closes the app
// so the installer can replace it. A package function, not a method, so it
// isn't exposed to JavaScript.
func UpdateLauncher(n *Native) func(path string) error {
	return func(path string) error {
		if err := startInstaller(path); err != nil {
			return err
		}
		if n.ctx != nil {
			runtime.Quit(n.ctx)
		}
		return nil
	}
}
