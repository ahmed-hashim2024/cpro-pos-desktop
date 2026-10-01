// Package auth handles credentials and sessions. Passwords and PINs are
// stored only as bcrypt hashes; session tokens only as SHA-256 hashes.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const (
	bcryptCost = 12
	// PINs are short, so their real protection is login throttling; a lower
	// cost keeps manager-PIN overrides (which try each manager) fast.
	pinCost = 10
)

var (
	ErrWeakPassword = errors.New("auth: password must be at least 8 characters and contain a letter and a digit")
	ErrBadPIN       = errors.New("auth: PIN must be 4 to 6 digits")
	ErrMismatch     = errors.New("auth: invalid credentials")
)

func HashPassword(pw string) (string, error) {
	if err := checkPassword(pw); err != nil {
		return "", err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	return string(h), err
}

func HashPIN(pin string) (string, error) {
	if len(pin) < 4 || len(pin) > 6 {
		return "", ErrBadPIN
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return "", ErrBadPIN
		}
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pin), pinCost)
	return string(h), err
}

// Verify compares a password or PIN to its stored hash in constant time.
func Verify(hash, secret string) error {
	if hash == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(secret)) != nil {
		return ErrMismatch
	}
	return nil
}

// dummyHash is compared against when a user doesn't exist, so a login for
// an unknown username takes as long as one with a wrong password.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dummy-password-1"), bcryptCost)

func VerifyMissing(secret string) {
	_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(secret))
}

func checkPassword(pw string) error {
	if len([]rune(pw)) < 8 || len(pw) > 72 { // bcrypt ignores bytes past 72
		return ErrWeakPassword
	}
	var letter, digit bool
	for _, c := range pw {
		letter = letter || unicode.IsLetter(c)
		digit = digit || unicode.IsDigit(c)
	}
	if !letter || !digit {
		return ErrWeakPassword
	}
	return nil
}

// NewToken returns a random bearer token and the hash to store for it.
func NewToken() (token, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token), nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
