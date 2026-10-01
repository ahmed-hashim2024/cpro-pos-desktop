package money

import "testing"

func TestParseAndString(t *testing.T) {
	cases := map[string]Minor{"0": 0, "12": 1200, "12.5": 1250, "12.05": 1205, "-3.10": -310}
	for in, want := range cases {
		got, err := Parse(in)
		if err != nil || got != want {
			t.Errorf("Parse(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	for _, bad := range []string{"", ".5", "1.234", "1,5", "abc", "1.-2"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%q) should fail", bad)
		}
	}
	if s := Minor(-1205).String(); s != "-12.05" {
		t.Errorf("String = %q", s)
	}
}

func TestRounding(t *testing.T) {
	if got := Minor(333).MulQty(500); got != 167 { // 3.33 × 0.5 = 1.665 -> 1.67
		t.Errorf("MulQty = %d", got)
	}
	if got := Minor(1005).Pct(1400); got != 141 { // 10.05 × 14% = 1.407 -> 1.41
		t.Errorf("Pct = %d", got)
	}
	if got := Minor(-1005).Pct(1400); got != -141 {
		t.Errorf("negative Pct = %d", got)
	}
	if got := Minor(11400).ExtractInclusive(1400); got != 1400 { // 114 incl. 14% -> 14 tax
		t.Errorf("ExtractInclusive = %d", got)
	}
}

func TestMilliMulAndScale(t *testing.T) {
	if got := Milli(150).Mul(3000); got != 450 {
		t.Errorf("Mul = %d", got)
	}
	if got := Minor(1000).Scale(1, 3); got != 333 {
		t.Errorf("Scale = %d", got)
	}
	if got := Minor(1000).Scale(1, 0); got != 0 {
		t.Errorf("Scale by zero = %d", got)
	}
}
