package auth

import (
	"errors"
	"testing"
)

func TestPasswordHashAndVerify(t *testing.T) {
	h, err := HashPassword("kahwa2026")
	if err != nil {
		t.Fatal(err)
	}
	if Verify(h, "kahwa2026") != nil {
		t.Error("correct password rejected")
	}
	if !errors.Is(Verify(h, "kahwa2027"), ErrMismatch) {
		t.Error("wrong password accepted")
	}
	if !errors.Is(Verify("", "x"), ErrMismatch) {
		t.Error("empty hash accepted")
	}
}

func TestWeakPasswords(t *testing.T) {
	for _, pw := range []string{"123", "abcdefgh", "12345678", "short1"} {
		if _, err := HashPassword(pw); !errors.Is(err, ErrWeakPassword) {
			t.Errorf("%q accepted", pw)
		}
	}
	if _, err := HashPassword("كلمةسر123"); err != nil {
		t.Errorf("arabic password rejected: %v", err)
	}
}

func TestPIN(t *testing.T) {
	for _, bad := range []string{"123", "1234567", "12a4"} {
		if _, err := HashPIN(bad); !errors.Is(err, ErrBadPIN) {
			t.Errorf("%q accepted", bad)
		}
	}
	h, err := HashPIN("4821")
	if err != nil || Verify(h, "4821") != nil {
		t.Fatalf("pin roundtrip failed: %v", err)
	}
}

func TestToken(t *testing.T) {
	a, ha, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := NewToken()
	if a == b || len(a) < 40 || HashToken(a) != ha || ha == a {
		t.Fatalf("bad token: %q %q", a, ha)
	}
}
