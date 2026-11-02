// Package machine identifies the computer the app runs on. The Platform
// uses the fingerprint to limit how many accounts one computer can
// activate, so it must survive reinstalling the app or renaming the
// computer: it hashes the OS machine ID, never sending the raw value.
package machine

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"runtime"
	"strings"
	"sync"
)

var (
	once sync.Once
	fp   string
)

// Fingerprint is a stable, anonymous id for this computer (32 hex chars).
func Fingerprint() string {
	once.Do(func() {
		id := strings.TrimSpace(machineID())
		if id == "" {
			// No OS id available: fall back to what is stable enough.
			host, _ := os.Hostname()
			id = "host:" + host
		}
		sum := sha256.Sum256([]byte("cpro-machine|" + runtime.GOOS + "|" + strings.ToLower(id)))
		fp = hex.EncodeToString(sum[:16])
	})
	return fp
}
