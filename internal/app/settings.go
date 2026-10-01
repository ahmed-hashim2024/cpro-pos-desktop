package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"cpro/internal/domain/money"
	"cpro/internal/domain/order"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

type PaymentMethod struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	IsCash bool   `json:"is_cash"` // counts toward the drawer and allows change
	Active bool   `json:"active"`
}

// Settings is the restaurant configuration, stored as one JSON document.
type Settings struct {
	RestaurantName    string            `json:"restaurant_name"`
	Address           string            `json:"address"`
	Phone             string            `json:"phone"`
	TaxNumber         string            `json:"tax_number"`
	Currency          string            `json:"currency"`
	TaxRate           money.BasisPoints `json:"tax_rate_bp"`
	TaxInclusive      bool              `json:"tax_inclusive"`
	ServiceRate       money.BasisPoints `json:"service_rate_bp"`
	ServiceTaxable    bool              `json:"service_taxable"`
	ServiceOrderTypes []string          `json:"service_order_types"` // usually only dine_in
	DeliveryFee       money.Minor       `json:"delivery_fee_minor"`
	DayStartHour      int               `json:"day_start_hour"`
	ReceiptHeader     string            `json:"receipt_header"`
	ReceiptFooter     string            `json:"receipt_footer"`
	PrintKitchen      bool              `json:"print_kitchen"` // print a kitchen ticket when sending
	AutoPrintReceipt  bool              `json:"auto_print_receipt"`
	PaymentMethods    []PaymentMethod   `json:"payment_methods"`
	LANEnabled        bool              `json:"lan_enabled"`
	LANPort           int               `json:"lan_port"`
	AutoBackupHours   int               `json:"auto_backup_hours"`
	BackupKeep        int               `json:"backup_keep"`
}

func defaultSettings() Settings {
	return Settings{
		Currency:          "EGP",
		ServiceOrderTypes: []string{"dine_in"},
		DayStartHour:      6,
		ReceiptFooter:     "شكراً لزيارتكم",
		PrintKitchen:      true,
		AutoPrintReceipt:  true,
		PaymentMethods: []PaymentMethod{
			{Code: "cash", Name: "كاش", IsCash: true, Active: true},
			{Code: "card", Name: "فيزا", Active: true},
			{Code: "wallet", Name: "محفظة إلكترونية", Active: true},
			{Code: "instapay", Name: "إنستاباي", Active: true},
		},
		LANPort:         8787,
		AutoBackupHours: 24,
		BackupKeep:      30,
	}
}

const settingsKey = "general"

func loadSettings(ctx context.Context, q sqlite.Querier) (Settings, error) {
	s := defaultSettings()
	var raw string
	err := q.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, settingsKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal([]byte(raw), &s)
}

func (a *App) saveSettings(ctx context.Context, q sqlite.Querier, s Settings) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx,
		`INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		settingsKey, string(b), a.stamp())
	return err
}

// Settings is readable by every signed-in user (the POS needs tax and
// payment methods); only SettingsManage may change them.
func (a *App) Settings(ctx context.Context, _ Actor) (Settings, error) {
	return loadSettings(ctx, a.db.Read)
}

func (a *App) UpdateSettings(ctx context.Context, actor Actor, s Settings) (Settings, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return s, err
	}
	if err := validateSettings(&s); err != nil {
		return s, err
	}
	err := a.tx(ctx, func(tx *sql.Tx) error {
		if err := a.saveSettings(ctx, tx, s); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "settings.update", "settings", settingsKey, s)
	})
	return s, err
}

func validateSettings(s *Settings) error {
	s.RestaurantName = strings.TrimSpace(s.RestaurantName)
	if s.TaxRate < 0 || s.TaxRate > 5000 || s.ServiceRate < 0 || s.ServiceRate > 5000 {
		return invalid("نسبة الضريبة أو الخدمة غير صحيحة")
	}
	if s.DeliveryFee < 0 {
		return invalid("رسوم التوصيل غير صحيحة")
	}
	if s.DayStartHour < 0 || s.DayStartHour > 12 {
		return invalid("بداية اليوم يجب أن تكون بين 0 و 12")
	}
	if s.LANPort != 0 && (s.LANPort < 1024 || s.LANPort > 65535) {
		return invalid("منفذ الشبكة غير صحيح")
	}
	if s.LANPort == 0 {
		s.LANPort = 8787
	}
	if s.AutoBackupHours < 0 || s.BackupKeep < 0 {
		return invalid("إعدادات النسخ الاحتياطي غير صحيحة")
	}
	if s.Currency == "" {
		s.Currency = "EGP"
	}
	seen := map[string]bool{}
	cash := false
	for i, m := range s.PaymentMethods {
		m.Code = strings.TrimSpace(strings.ToLower(m.Code))
		if m.Code == "" || m.Name == "" || seen[m.Code] {
			return invalid("طرق الدفع: الكود والاسم مطلوبان ولا يتكرر الكود")
		}
		seen[m.Code] = true
		cash = cash || (m.IsCash && m.Active)
		s.PaymentMethods[i] = m
	}
	if !cash {
		return invalid("يجب وجود طريقة دفع نقدية واحدة مفعّلة على الأقل")
	}
	return nil
}

func (s Settings) method(code string) (PaymentMethod, bool) {
	for _, m := range s.PaymentMethods {
		if m.Code == code && m.Active {
			return m, true
		}
	}
	return PaymentMethod{}, false
}

func (s Settings) pricing(orderType string) order.PricingConfig {
	cfg := order.PricingConfig{TaxRate: s.TaxRate, TaxInclusive: s.TaxInclusive, ServiceTaxable: s.ServiceTaxable}
	for _, t := range s.ServiceOrderTypes {
		if t == orderType {
			cfg.ServiceRate = s.ServiceRate
		}
	}
	if orderType == "delivery" {
		cfg.DeliveryFee = s.DeliveryFee
	}
	return cfg
}
