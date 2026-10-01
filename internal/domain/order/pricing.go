// Package order holds the restaurant order model and its pricing rules.
// Totals are always computed here from catalog prices; whatever totals a
// client sends are ignored.
package order

import (
	"errors"

	"cpro/internal/domain/money"
)

type DiscountKind string

const (
	DiscountNone    DiscountKind = ""
	DiscountPercent DiscountKind = "percent"
	DiscountFixed   DiscountKind = "fixed"
)

// Discount is either a percentage (Rate) or a fixed amount (Amount).
type Discount struct {
	Kind   DiscountKind
	Rate   money.BasisPoints
	Amount money.Minor
}

type Modifier struct {
	Name  string
	Price money.Minor // per unit of the parent line
}

type Line struct {
	ItemID    string
	Name      string
	UnitPrice money.Minor
	Qty       money.Milli
	Modifiers []Modifier
	Discount  Discount
}

// PricingConfig comes from the settings table.
type PricingConfig struct {
	TaxRate        money.BasisPoints
	TaxInclusive   bool // menu prices already include tax
	ServiceRate    money.BasisPoints
	ServiceTaxable bool
	DeliveryFee    money.Minor // fixed, not discounted, not taxed
}

type LineTotal struct {
	Gross    money.Minor // (unit + modifiers) × qty
	Discount money.Minor
	Net      money.Minor
}

type Totals struct {
	Lines         []LineTotal
	Subtotal      money.Minor // sum of line gross
	LineDiscounts money.Minor
	OrderDiscount money.Minor
	Service       money.Minor
	Tax           money.Minor
	DeliveryFee   money.Minor
	Total         money.Minor // what the customer pays
}

var (
	ErrEmptyOrder      = errors.New("order: no lines")
	ErrInvalidQty      = errors.New("order: quantity must be positive")
	ErrInvalidPrice    = errors.New("order: price must not be negative")
	ErrInvalidDiscount = errors.New("order: invalid discount")
)

// Price computes all totals for the given lines.
func Price(lines []Line, orderDiscount Discount, cfg PricingConfig) (Totals, error) {
	if len(lines) == 0 {
		return Totals{}, ErrEmptyOrder
	}
	var t Totals
	var net money.Minor
	for _, l := range lines {
		if l.Qty <= 0 {
			return Totals{}, ErrInvalidQty
		}
		unit := l.UnitPrice
		for _, m := range l.Modifiers {
			if m.Price < 0 {
				return Totals{}, ErrInvalidPrice
			}
			unit += m.Price
		}
		if l.UnitPrice < 0 {
			return Totals{}, ErrInvalidPrice
		}
		gross := unit.MulQty(l.Qty)
		disc, err := applyDiscount(gross, l.Discount)
		if err != nil {
			return Totals{}, err
		}
		lt := LineTotal{Gross: gross, Discount: disc, Net: gross - disc}
		t.Lines = append(t.Lines, lt)
		t.Subtotal += gross
		t.LineDiscounts += disc
		net += lt.Net
	}

	od, err := applyDiscount(net, orderDiscount)
	if err != nil {
		return Totals{}, err
	}
	t.OrderDiscount = od
	base := net - od

	t.Service = base.Pct(cfg.ServiceRate)
	taxable := base
	if cfg.ServiceTaxable {
		taxable += t.Service
	}
	if cfg.TaxInclusive {
		t.Tax = taxable.ExtractInclusive(cfg.TaxRate)
		t.Total = base + t.Service
	} else {
		t.Tax = taxable.Pct(cfg.TaxRate)
		t.Total = base + t.Service + t.Tax
	}
	t.DeliveryFee = cfg.DeliveryFee
	t.Total += cfg.DeliveryFee
	return t, nil
}

func applyDiscount(amount money.Minor, d Discount) (money.Minor, error) {
	switch d.Kind {
	case DiscountNone:
		return 0, nil
	case DiscountPercent:
		if d.Rate < 0 || d.Rate > money.FullPercent {
			return 0, ErrInvalidDiscount
		}
		return amount.Pct(d.Rate), nil
	case DiscountFixed:
		if d.Amount < 0 || d.Amount > amount {
			return 0, ErrInvalidDiscount
		}
		return d.Amount, nil
	}
	return 0, ErrInvalidDiscount
}
