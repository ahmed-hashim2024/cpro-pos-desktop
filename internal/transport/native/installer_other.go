//go:build !windows

package native

import (
	"os/exec"
	"runtime"
)

// startInstaller opens the downloaded package (.pkg/.dmg/.zip on macOS)
// with the system's default handler.
func startInstaller(path string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", path).Start()
	}
	return exec.Command("xdg-open", path).Start()
}
