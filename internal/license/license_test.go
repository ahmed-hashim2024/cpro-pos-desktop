package license

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// The vector is shared with the Platform's tests (Python); both sides must
// agree on it byte for byte.
type vector struct {
	PlatformPublic string `json:"platform_public"`
	LicenseToken   string `json:"license_token"`
	DevicePublic   string `json:"device_public"`
}

func loadVector(t *testing.T) vector {
	t.Helper()
	b, err := os.ReadFile("../saas/testdata/license_vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vector
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestVerifyPlatformVector(t *testing.T) {
	v := loadVector(t)
	c, err := Verify(v.LicenseToken, v.PlatformPublic)
	if err != nil {
		t.Fatal(err)
	}
	if c.Tenant != "TEN-00001" || c.TenantName != "مطعم الكرامة" || c.DeviceID != "01JDEVICE0000000000000000A" {
		t.Fatalf("claims: %+v", c)
	}
	if c.Status != "active" || !c.Features.EMenu() || !c.Features.EMenuOrdering() || c.Features.RemoteAccess() {
		t.Fatalf("claims: %+v", c)
	}
	if c.ExpiresAt != 1790604800 || c.GraceDays != 14 || c.Ver != 3 {
		t.Fatalf("claims: %+v", c)
	}
}

func TestVerifyRejectsTampering(t *testing.T) {
	v := loadVector(t)
	parts := strings.Split(v.LicenseToken, ".")
	// A payload re-encoded with a later expiry, keeping the original signature.
	forged := parts[0] + "." + "eyJleHAiOjk5OTk5OTk5OTksInN0YXR1cyI6ImFjdGl2ZSJ9" + "." + parts[2]
	if _, err := Verify(forged, v.PlatformPublic); err != ErrSignature {
		t.Fatalf("forged payload: %v", err)
	}
	if _, err := Verify(v.LicenseToken, v.DevicePublic); err != ErrSignature {
		t.Fatalf("wrong key: %v", err)
	}
	if _, err := Verify(v.LicenseToken, ""); err != ErrNoKey {
		t.Fatalf("no key: %v", err)
	}
	if _, err := Verify("a.b", v.PlatformPublic); err != ErrMalformed {
		t.Fatalf("malformed: %v", err)
	}
}

func TestEvaluate(t *testing.T) {
	exp := time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC)
	c := Claims{Status: "active", ExpiresAt: exp.Unix(), GraceDays: 14}
	day := 24 * time.Hour
	cases := []struct {
		name    string
		c       Claims
		now, hw time.Time
		want    State
		reason  string
		canSell bool
	}{
		{"valid", c, exp.Add(-day), time.Time{}, Active, "", true},
		{"grace", c, exp.Add(3 * day), time.Time{}, Grace, "", true},
		{"after grace", c, exp.Add(15 * day), time.Time{}, Restricted, ReasonExpired, false},
		{"clock turned back", c, exp.Add(-day), exp.Add(15 * day), Restricted, ReasonExpired, false},
		{"trial", Claims{Status: "trial", ExpiresAt: exp.Unix()}, exp.Add(-day), time.Time{}, Trial, "", true},
		{"trial over", Claims{Status: "trial", ExpiresAt: exp.Unix()}, exp.Add(time.Minute), time.Time{}, Restricted, ReasonTrialEnded, false},
		{"suspended", Claims{Status: "suspended", ExpiresAt: exp.Unix()}, exp.Add(-day), time.Time{}, Restricted, ReasonSuspended, false},
		{"expired trial", Claims{Status: "expired", ExpiresAt: exp.Unix()}, exp.Add(-day), time.Time{}, Restricted, ReasonTrialEnded, false},
	}
	for _, tc := range cases {
		st := Evaluate(tc.c, tc.now, tc.hw)
		if st.State != tc.want || st.Reason != tc.reason || st.CanSell() != tc.canSell {
			t.Errorf("%s: got %+v", tc.name, st)
		}
	}
}
