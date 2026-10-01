// Package money holds amounts as integer minor units (e.g. piasters) so totals
// never drift the way float64 sums do. All rounding happens here.
package money

import (
	"errors"
	"fmt"
	"strings"
)

// Minor is an amount in the currency's minor unit (1 EGP = 100 Minor).
type Minor int64

// BasisPoints is a rate in 1/100 of a percent: 1400 = 14%.
type BasisPoints int64

// Milli is a quantity in thousandths: 1000 = 1 unit, 250 = 0.25 kg.
type Milli int64

const (
	OneUnit     Milli       = 1000
	FullPercent BasisPoints = 10000
)

var ErrInvalidAmount = errors.New("money: invalid amount")

// MulQty returns price × qty, rounded half away from zero.
func (m Minor) MulQty(q Milli) Minor {
	return Minor(divRound(int64(m)*int64(q), int64(OneUnit)))
}

// Pct returns m × rate, rounded half away from zero.
func (m Minor) Pct(rate BasisPoints) Minor {
	return Minor(divRound(int64(m)*int64(rate), int64(FullPercent)))
}

// ExtractInclusive splits a tax-inclusive gross into its tax part:
// tax = gross × rate / (1 + rate).
func (m Minor) ExtractInclusive(rate BasisPoints) Minor {
	return Minor(divRound(int64(m)*int64(rate), int64(FullPercent+rate)))
}

// String formats with two decimals, e.g. 12345 -> "123.45".
func (m Minor) String() string {
	sign := ""
	v := int64(m)
	if v < 0 {
		sign, v = "-", -v
	}
	return fmt.Sprintf("%s%d.%02d", sign, v/100, v%100)
}

// Parse reads "123", "123.4" or "123.45" (no more than two decimals).
func Parse(s string) (Minor, error) {
	s = strings.TrimSpace(s)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	whole, frac, _ := strings.Cut(s, ".")
	if whole == "" || len(frac) > 2 || !digits(whole) || !digits(frac) {
		return 0, ErrInvalidAmount
	}
	for len(frac) < 2 {
		frac += "0"
	}
	var v int64
	for _, c := range whole + frac {
		v = v*10 + int64(c-'0')
	}
	if neg {
		v = -v
	}
	return Minor(v), nil
}

func digits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// divRound divides rounding half away from zero.
func divRound(n, d int64) int64 {
	if (n < 0) != (d < 0) {
		return -((abs(n) + abs(d)/2) / abs(d))
	}
	return (abs(n) + abs(d)/2) / abs(d)
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// Mul multiplies two quantities: 0.150 kg per burger × 3 burgers = 0.450 kg.
func (q Milli) Mul(o Milli) Milli {
	return Milli(divRound(int64(q)*int64(o), int64(OneUnit)))
}

// Scale returns m × num / den, rounded; used to split an amount pro rata.
func (m Minor) Scale(num, den int64) Minor {
	if den == 0 {
		return 0
	}
	return Minor(divRound(int64(m)*num, den))
}
