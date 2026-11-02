//go:build !darwin && !windows

package machine

import "os"

func machineID() string {
	for _, p := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		if b, err := os.ReadFile(p); err == nil {
			return string(b)
		}
	}
	return ""
}
