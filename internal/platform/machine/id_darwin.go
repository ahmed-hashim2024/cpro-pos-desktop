package machine

import (
	"os/exec"
	"regexp"
)

var uuidRe = regexp.MustCompile(`"IOPlatformUUID"\s*=\s*"([^"]+)"`)

func machineID() string {
	out, err := exec.Command("ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return ""
	}
	if m := uuidRe.FindSubmatch(out); m != nil {
		return string(m[1])
	}
	return ""
}
