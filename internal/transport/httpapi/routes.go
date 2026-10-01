package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cpro/internal/app"
	"cpro/internal/domain/money"
)

func (s *server) routes(mux *http.ServeMux) {
	a := s.app
	idem := func(r *http.Request) string { return r.Header.Get("Idempotency-Key") }
	q := func(r *http.Request, k string) string { return r.URL.Query().Get(k) }
	today := func() string { return time.Now().Format(time.DateOnly) }
	rangeOf := func(r *http.Request) (string, string) {
		from, to := q(r, "from"), q(r, "to")
		if from == "" {
			from = today()
		}
		if to == "" {
			to = from
		}
		return from, to
	}
	type idBody struct {
		ID string `json:"id"`
	}

	// ---- public ----
	mux.HandleFunc("GET /api/v1/status", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		needs, err := a.NeedsSetup(r.Context())
		return map[string]any{"needs_setup": needs, "channel": s.channel}, err
	}))
	mux.HandleFunc("POST /api/v1/setup", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in app.SetupInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.Setup(r.Context(), in, s.channel)
	}))
	mux.HandleFunc("POST /api/v1/auth/login", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in app.LoginInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.Login(r.Context(), in, s.channel, remoteIP(r))
	}))
	mux.HandleFunc("GET /api/v1/auth/users", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return a.LoginUsers(r.Context(), s.channel)
	}))
	mux.HandleFunc("GET /api/v1/images/{name}", func(w http.ResponseWriter, r *http.Request) {
		p, ok := a.ImagePath(r.PathValue("name"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFile(w, r, p)
	})

	// ---- session ----
	mux.HandleFunc("POST /api/v1/auth/logout", s.auth(func(w http.ResponseWriter, r *http.Request, _ app.Actor) (any, error) {
		return nil, a.Logout(r.Context(), strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	}))
	mux.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		_, me, err := a.Authenticate(r.Context(), token, s.channel)
		s.respond(w, r, me, err)
	})
	mux.HandleFunc("POST /api/v1/me/password", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct{ Current, Next string }
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.ChangeOwnPassword(r.Context(), actor, in.Current, in.Next)
	}))

	// ---- settings, users, devices, backups, audit ----
	mux.HandleFunc("GET /api/v1/settings", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Settings(r.Context(), actor)
	}))
	mux.HandleFunc("PUT /api/v1/settings", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Settings
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.UpdateSettings(r.Context(), actor, in)
	}))
	mux.HandleFunc("GET /api/v1/users", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Users(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/users", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.UserInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.CreateUser(r.Context(), actor, in)
		return idBody{id}, err
	}))
	mux.HandleFunc("PUT /api/v1/users/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.UserInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.UpdateUser(r.Context(), actor, r.PathValue("id"), in)
	}))
	mux.HandleFunc("GET /api/v1/devices", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Devices(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/devices/{id}/revoke", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return nil, a.RevokeDevice(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("GET /api/v1/backups", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Backups(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/backups", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.BackupNow(r.Context(), actor, "manual")
	}))
	mux.HandleFunc("GET /api/v1/backups/{name}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		p, err := a.BackupFile(r.Context(), actor, r.PathValue("name"))
		if err != nil {
			return nil, err
		}
		f, err := os.Open(p)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(p)+`"`)
		http.ServeContent(w, r, filepath.Base(p), time.Time{}, f)
		return written{}, nil
	}))
	mux.HandleFunc("GET /api/v1/audit", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.AuditLog(r.Context(), actor, from, to, q(r, "action"), q(r, "user"))
	}))

	// ---- catalog ----
	mux.HandleFunc("GET /api/v1/categories", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Categories(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/categories", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Category
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SaveCategory(r.Context(), actor, in)
	}))
	mux.HandleFunc("GET /api/v1/stations", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Stations(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/stations", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Station
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SaveStation(r.Context(), actor, in)
	}))
	mux.HandleFunc("GET /api/v1/items", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Items(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/items", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.ItemInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.SaveItem(r.Context(), actor, in)
		return idBody{id}, err
	}))
	mux.HandleFunc("GET /api/v1/modifier-groups", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.ModifierGroups(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/modifier-groups", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.ModifierGroup
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.SaveModifierGroup(r.Context(), actor, in)
		return idBody{id}, err
	}))
	mux.HandleFunc("GET /api/v1/tables", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Tables(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/tables", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Table
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SaveTable(r.Context(), actor, in)
	}))
	mux.HandleFunc("GET /api/v1/customers", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Customers(r.Context(), actor, q(r, "q"))
	}))
	mux.HandleFunc("POST /api/v1/customers", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Customer
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SaveCustomer(r.Context(), actor, in)
	}))

	// ---- enable/disable and delete catalog records ----
	mux.HandleFunc("POST /api/v1/{kind}/{id}/active", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Active bool `json:"active"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.SetActive(r.Context(), actor, r.PathValue("kind"), r.PathValue("id"), in.Active)
	}))
	mux.HandleFunc("DELETE /api/v1/items/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.DeleteItem(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("DELETE /api/v1/tables/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.DeleteTable(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("DELETE /api/v1/categories/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return nil, a.DeleteCategory(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("DELETE /api/v1/modifier-groups/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return nil, a.DeleteModifierGroup(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("DELETE /api/v1/stations/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return nil, a.DeleteStation(r.Context(), actor, r.PathValue("id"))
	}))

	// ---- shifts ----
	mux.HandleFunc("GET /api/v1/shifts/current", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		sh, err := a.CurrentShift(r.Context(), actor)
		return map[string]any{"shift": sh}, err
	}))
	mux.HandleFunc("GET /api/v1/shifts", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.Shifts(r.Context(), actor, from, to)
	}))
	mux.HandleFunc("POST /api/v1/shifts", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Float money.Minor `json:"opening_float_minor"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.OpenShift(r.Context(), actor, in.Float)
		return idBody{id}, err
	}))
	mux.HandleFunc("POST /api/v1/shifts/cash", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Kind   string      `json:"kind"`
			Amount money.Minor `json:"amount_minor"`
			Reason string      `json:"reason"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.CashMove(r.Context(), actor, in.Kind, in.Amount, in.Reason)
	}))
	mux.HandleFunc("GET /api/v1/shifts/{id}/report", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.ShiftReport(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("POST /api/v1/shifts/{id}/close", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Counted money.Minor `json:"counted_cash_minor"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.CloseShift(r.Context(), actor, r.PathValue("id"), in.Counted)
	}))

	// ---- orders ----
	mux.HandleFunc("GET /api/v1/orders/open", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.OpenOrders(r.Context(), actor)
	}))
	mux.HandleFunc("GET /api/v1/orders", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.OrderHistory(r.Context(), actor, app.OrderFilter{From: from, To: to, Status: q(r, "status"), Type: q(r, "type"), Search: q(r, "q")})
	}))
	mux.HandleFunc("POST /api/v1/orders", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.OrderInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.CreateOrder(r.Context(), actor, in, idem(r))
	}))
	mux.HandleFunc("GET /api/v1/orders/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.GetOrder(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("PUT /api/v1/orders/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.OrderInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.UpdateOrder(r.Context(), actor, r.PathValue("id"), in)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/lines", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.LineInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.AddLine(r.Context(), actor, r.PathValue("id"), in)
	}))
	mux.HandleFunc("PUT /api/v1/orders/{id}/lines/{line}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.LineInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.UpdateLine(r.Context(), actor, r.PathValue("id"), r.PathValue("line"), in)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/lines/{line}/remove", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.VoidInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.RemoveLine(r.Context(), actor, r.PathValue("id"), r.PathValue("line"), in)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/discount", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.DiscountInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SetOrderDiscount(r.Context(), actor, r.PathValue("id"), in)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/send", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.SendToKitchen(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/hold", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Held bool `json:"held"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SetHeld(r.Context(), actor, r.PathValue("id"), in.Held)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/merge", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			SourceID string `json:"source_id"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.MergeOrders(r.Context(), actor, r.PathValue("id"), in.SourceID)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/void", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.VoidInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.VoidOrder(r.Context(), actor, r.PathValue("id"), in)
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/pay", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Tenders []app.Tender `json:"tenders"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.Pay(r.Context(), actor, r.PathValue("id"), in.Tenders, idem(r))
	}))
	mux.HandleFunc("POST /api/v1/orders/{id}/refund", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.RefundInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.Refund(r.Context(), actor, r.PathValue("id"), in, idem(r))
	}))

	// ---- kitchen ----
	mux.HandleFunc("GET /api/v1/kitchen", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.KitchenBoard(r.Context(), actor, q(r, "station"))
	}))
	mux.HandleFunc("POST /api/v1/kitchen/status", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			LineIDs []string `json:"line_ids"`
			Status  string   `json:"status"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.SetKitchenStatus(r.Context(), actor, in.LineIDs, in.Status)
	}))

	// ---- inventory ----
	mux.HandleFunc("GET /api/v1/ingredients", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Ingredients(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/ingredients", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.IngredientInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.SaveIngredient(r.Context(), actor, in)
		return idBody{id}, err
	}))
	mux.HandleFunc("POST /api/v1/ingredients/{id}/adjust", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Qty    money.Milli `json:"qty_milli"`
			Reason string      `json:"reason"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.AdjustStock(r.Context(), actor, r.PathValue("id"), in.Qty, in.Reason)
	}))
	mux.HandleFunc("GET /api/v1/suppliers", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Suppliers(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/suppliers", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Supplier
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return a.SaveSupplier(r.Context(), actor, in)
	}))
	mux.HandleFunc("GET /api/v1/purchases", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.Purchases(r.Context(), actor, from, to)
	}))
	mux.HandleFunc("POST /api/v1/purchases", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.Purchase
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.ReceivePurchase(r.Context(), actor, in)
		return idBody{id}, err
	}))
	mux.HandleFunc("GET /api/v1/waste", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.Waste(r.Context(), actor, from, to)
	}))
	mux.HandleFunc("POST /api/v1/waste", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in app.WasteInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.RecordWaste(r.Context(), actor, in)
	}))
	mux.HandleFunc("GET /api/v1/counts", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.StockCounts(r.Context(), actor)
	}))
	mux.HandleFunc("POST /api/v1/counts", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in struct {
			Notes string `json:"notes"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		id, err := a.StartCount(r.Context(), actor, in.Notes)
		return idBody{id}, err
	}))
	mux.HandleFunc("GET /api/v1/counts/{id}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.GetCount(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("PUT /api/v1/counts/{id}/lines", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		var in map[string]*int64
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, a.SetCountLines(r.Context(), actor, r.PathValue("id"), in)
	}))
	mux.HandleFunc("POST /api/v1/counts/{id}/post", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return nil, a.PostCount(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("POST /api/v1/counts/{id}/cancel", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return nil, a.CancelCount(r.Context(), actor, r.PathValue("id"))
	}))
	mux.HandleFunc("GET /api/v1/movements", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.Movements(r.Context(), actor, q(r, "ingredient"), q(r, "kind"), from, to)
	}))

	// ---- bulk import ----
	mux.HandleFunc("GET /api/v1/import/targets", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.ImportTargets(r.Context(), actor, q(r, "lang")), nil
	}))
	mux.HandleFunc("GET /api/v1/import/{entity}/template", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		b, name, err := a.ImportTemplate(r.Context(), actor, r.PathValue("entity"), app.ImportMode(q(r, "mode")), q(r, "lang"))
		if err != nil {
			return nil, err
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		w.Write(b)
		return written{}, nil
	}))
	mux.HandleFunc("POST /api/v1/import/{entity}", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
		file, _, err := r.FormFile("file")
		if err != nil {
			return nil, &app.Error{Code: app.CodeInvalid, Msg: "أرفق ملف Excel"}
		}
		defer file.Close()
		return a.Import(r.Context(), actor, r.PathValue("entity"), app.ImportMode(q(r, "mode")), file, q(r, "lang"))
	}))

	// ---- reports ----
	mux.HandleFunc("GET /api/v1/reports/dashboard", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		return a.Dashboard(r.Context(), actor)
	}))
	mux.HandleFunc("GET /api/v1/reports/sales", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.SalesReport(r.Context(), actor, from, to)
	}))
	mux.HandleFunc("GET /api/v1/reports/consumption", s.auth(func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error) {
		from, to := rangeOf(r)
		return a.ConsumptionReport(r.Context(), actor, from, to)
	}))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "غير موجود"})
	})
}
