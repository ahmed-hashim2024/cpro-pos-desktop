package machine

import (
	"os/exec"
	"strings"
	"syscall"
)

func machineID() string {
	cmd := exec.Command("reg", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid", "/reg:64")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if f := strings.Fields(line); len(f) == 3 && f[0] == "MachineGuid" {
			return f[2]
		}
	}
	return ""
}
