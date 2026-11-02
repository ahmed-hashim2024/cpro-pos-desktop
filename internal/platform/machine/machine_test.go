package machine

import "testing"

func TestFingerprintStable(t *testing.T) {
	a, b := Fingerprint(), Fingerprint()
	if len(a) != 32 || a != b {
		t.Fatalf("fingerprint %q %q", a, b)
	}
}
