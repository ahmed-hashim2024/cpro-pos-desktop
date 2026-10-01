// Package rbac defines what each role may do. The server checks these on
// every use case; the UI only uses them to hide what the user can't do.
package rbac

type Permission string

const (
	POSSell        Permission = "pos.sell"         // create orders, add items, send to kitchen
	POSPay         Permission = "pos.pay"          // take payment
	OrderDiscount  Permission = "order.discount"   // apply discounts
	OrderVoid      Permission = "order.void"       // void sent lines / whole orders
	OrderRefund    Permission = "order.refund"     // refund paid invoices
	OrderViewAll   Permission = "order.view_all"   // see other users' orders and history
	ShiftCash      Permission = "shift.cash"       // open/close own shift, cash in/out
	ShiftManage    Permission = "shift.manage"     // close other users' shifts, see all shifts
	KitchenView    Permission = "kitchen.view"     // KDS
	CatalogManage  Permission = "catalog.manage"   // menu, modifiers, tables, stations
	InventoryView  Permission = "inventory.view"   // stock levels
	InventoryEdit  Permission = "inventory.manage" // ingredients, recipes, purchases, waste
	InventoryCount Permission = "inventory.count"  // stock counts (جرد)
	ReportsView    Permission = "reports.view"
	CustomersEdit  Permission = "customers.manage"
	UsersManage    Permission = "users.manage"
	SettingsManage Permission = "settings.manage"
	AuditView      Permission = "audit.view"
)

type Role string

const (
	Owner   Role = "owner"
	Manager Role = "manager"
	Cashier Role = "cashier"
	Waiter  Role = "waiter"
	Kitchen Role = "kitchen"
)

var All = []Permission{
	POSSell, POSPay, OrderDiscount, OrderVoid, OrderRefund, OrderViewAll,
	ShiftCash, ShiftManage, KitchenView, CatalogManage, InventoryView, InventoryEdit,
	InventoryCount, ReportsView, CustomersEdit, UsersManage, SettingsManage, AuditView,
}

var roles = map[Role][]Permission{
	Owner: All,
	Manager: {
		POSSell, POSPay, OrderDiscount, OrderVoid, OrderRefund, OrderViewAll,
		ShiftCash, ShiftManage, KitchenView, CatalogManage, InventoryView, InventoryEdit,
		InventoryCount, ReportsView, CustomersEdit, AuditView,
	},
	Cashier: {POSSell, POSPay, ShiftCash, KitchenView, CustomersEdit},
	Waiter:  {POSSell, KitchenView},
	Kitchen: {KitchenView, InventoryView},
}

func ValidRole(r Role) bool {
	_, ok := roles[r]
	return ok
}

func (r Role) Can(p Permission) bool {
	for _, x := range roles[r] {
		if x == p {
			return true
		}
	}
	return false
}

func (r Role) Permissions() []Permission { return roles[r] }
