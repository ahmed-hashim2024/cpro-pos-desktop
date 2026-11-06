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
		{"after grace", c, exp.Add(15 * day), time.Time{}, Restricted, ReasonOffline, false},
		{"clock turned back", c, exp.Add(-day), exp.Add(15 * day), Restricted, ReasonOffline, false},
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

func TestOfflineWindow(t *testing.T) {
	iat := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	// The Platform's own exp and grace don't change the two-week rule.
	c := Claims{Status: "active", IssuedAt: iat.Unix(), ExpiresAt: iat.Add(7 * 24 * time.Hour).Unix(), GraceDays: 14}
	day := 24 * time.Hour
	if st := Evaluate(c, iat.Add(13*day), time.Time{}); st.State != Active {
		t.Fatalf("day 13: %+v", st)
	}
	st := Evaluate(c, iat.Add(15*day), time.Time{})
	if st.State != Grace || !st.CanSell() || !st.GraceUntil.Equal(iat.Add(21*day)) {
		t.Fatalf("day 15: %+v", st)
	}
	st = Evaluate(c, iat.Add(21*day+time.Minute), time.Time{})
	if st.State != Restricted || st.Reason != ReasonOffline || st.CanSell() {
		t.Fatalf("day 21: %+v", st)
	}
	// Turning the clock back doesn't buy time.
	if st := Evaluate(c, iat.Add(day), iat.Add(22*day)); st.State != Restricted {
		t.Fatalf("clock back: %+v", st)
	}
	// A trial ends on its date, with no grace.
	tr := Claims{Status: "trial", IssuedAt: iat.Unix(), ExpiresAt: iat.Add(3 * day).Unix()}
	if st := Evaluate(tr, iat.Add(4*day), time.Time{}); st.State != Restricted || st.Reason != ReasonTrialEnded {
		t.Fatalf("trial: %+v", st)
	}
}
