package order

import (
	"errors"
	"testing"

	"cpro/internal/domain/money"
)

func burger(qty money.Milli) Line {
	return Line{ItemID: "b", UnitPrice: 15000, Qty: qty, Modifiers: []Modifier{{Name: "جبنة", Price: 1000}}}
}

func TestPriceExclusiveWithServiceAndDiscounts(t *testing.T) {
	lines := []Line{
		burger(2 * money.OneUnit), // (150+10)×2 = 320
		{ItemID: "t", UnitPrice: 2000, Qty: money.OneUnit, Discount: Discount{Kind: DiscountFixed, Amount: 500}}, // 20-5 = 15
	}
	cfg := PricingConfig{TaxRate: 1400, ServiceRate: 1200, ServiceTaxable: true}
	got, err := Price(lines, Discount{Kind: DiscountPercent, Rate: 1000}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	// net 335, order disc 33.50, base 301.50, service 36.18, tax 14% of 337.68 = 47.28
	want := Totals{Subtotal: 34000, LineDiscounts: 500, OrderDiscount: 3350, Service: 3618, Tax: 4728, Total: 30150 + 3618 + 4728}
	if got.Subtotal != want.Subtotal || got.LineDiscounts != want.LineDiscounts || got.OrderDiscount != want.OrderDiscount ||
		got.Service != want.Service || got.Tax != want.Tax || got.Total != want.Total {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

func TestPriceInclusiveTax(t *testing.T) {
	got, err := Price([]Line{{UnitPrice: 11400, Qty: money.OneUnit}}, Discount{}, PricingConfig{TaxRate: 1400, TaxInclusive: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.Total != 11400 || got.Tax != 1400 {
		t.Errorf("got total %d tax %d", got.Total, got.Tax)
	}
}

func TestPriceRejectsBadInput(t *testing.T) {
	cases := []struct {
		lines []Line
		disc  Discount
		err   error
	}{
		{nil, Discount{}, ErrEmptyOrder},
		{[]Line{burger(0)}, Discount{}, ErrInvalidQty},
		{[]Line{{UnitPrice: -1, Qty: 1000}}, Discount{}, ErrInvalidPrice},
		{[]Line{burger(1000)}, Discount{Kind: DiscountFixed, Amount: 999999}, ErrInvalidDiscount},
		{[]Line{burger(1000)}, Discount{Kind: DiscountPercent, Rate: 10001}, ErrInvalidDiscount},
		{[]Line{burger(1000)}, Discount{Kind: "bogus"}, ErrInvalidDiscount},
	}
	for i, c := range cases {
		if _, err := Price(c.lines, c.disc, PricingConfig{}); !errors.Is(err, c.err) {
			t.Errorf("case %d: err = %v, want %v", i, err, c.err)
		}
	}
}
