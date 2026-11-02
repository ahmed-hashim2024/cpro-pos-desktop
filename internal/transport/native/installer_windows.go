package native

import (
	"os/exec"
	"syscall"
)

// startInstaller goes through the shell ("start") rather than running the
// .exe directly, so Windows shows the UAC prompt the installer needs.
func startInstaller(path string) error {
	cmd := exec.Command("cmd", "/C", "start", "", path)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd.Start()
}
