# CPro POS — Desktop

Restaurant and café point of sale. A single desktop app (Wails: Go + React)
with its own local SQLite database. Tablets, kitchen screens and the owner's
phone connect to it over the restaurant network, and later through the
owner's own domain.

## Features

- **POS:** dine-in / takeaway / delivery orders and modifiers with min/max
  rules. Kitchen notes, hold/recall, table transfer and merge, order and line
  discounts, voids with a reason, split payments, cash change, and printed
  receipts and kitchen tickets (80 mm).
- **Kitchen display:** stations, ticket timers, per-line status, and voided
  lines flagged to stop preparation.
- **Shifts:** per cashier and terminal, with opening float, cash in/out, X
  report while open and Z report on close (expected vs counted cash).
- **Refunds:** partial refunds against the original invoice, refunded pro rata
  including discounts, service and tax, with optional restocking.
- **Inventory:** raw materials, recipes per item and per modifier, automatic
  deduction on sale, purchases with weighted-average cost, waste (raw or
  prepared dish), stock counts (جرد) that post variances, and a full movement
  ledger.
- **Reports:** sales summary, profit and margin from recipe cost, items,
  categories, payment methods, cashiers, hours, order types, voids and waste.
  The ingredient consumption report compares theoretical recipe usage to
  actual usage. Everything exports to Excel (CSV) or prints.
- **Users:** roles (owner, manager, cashier, waiter, kitchen) checked on the
  server. Quick PIN switching, manager-PIN approval for voids, discounts and
  refunds, login throttling, revocable sessions, and an append-only audit log.
- **Operations:**
  - Automatic and on-exit backups with an integrity check.
  - An automatic backup before every schema migration.
  - Arabic RTL UI, with the business day ending at a configurable hour.

## Architecture

```
main.go                     wiring only: data dir, logging, DB, HTTP handler, Wails window
cmd/devserver/              same API + UI in a browser (localhost only) for development and UI tests
internal/
  domain/                   pure logic, no I/O
    money/                  integer minor units, basis points, milli-quantities, rounding
    order/                  pricing: modifiers, discounts, service, tax (inclusive/exclusive), delivery
    rbac/                   roles → permissions
  app/                      use cases; every call takes an Actor and checks permissions
  auth/                     bcrypt passwords and PINs, hashed session tokens
  store/sqlite/             modernc SQLite (no CGO), WAL, single writer, goose migrations, backups
  transport/httpapi/        JSON API under /api/v1, one handler per channel
  platform/                 per-OS data dir, logging
frontend/                   React 19 + Vite + Tailwind 4
```

There is one API for every client. Inside the window, Wails routes `/api/v1`
to the Go handler, with no open port. When LAN access is enabled, the same
handler and UI are served on `:8787` for tablets and kitchen screens. Session
tokens are bound to the channel they were issued on.

All totals are computed on the server from catalog prices. Money is stored as
`int64` piasters and quantities as thousandths (`0.150 kg` = `150`). Every
stock change is a row in `stock_movements`.

Data lives in the per-user config directory (`%AppData%\CPro`,
`~/Library/Application Support/CPro`). Set `CPRO_DATA_DIR` to override it.

## Development

Requires Go 1.26+, Node 20+ and the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`).

```sh
go test ./internal/...                 # domain, store, use-case and HTTP tests
cd frontend && npm ci && npm run build && cd ..
wails dev                              # desktop window with hot reload
wails build                            # build/bin/

# or in a browser:
go run ./cmd/devserver -addr 127.0.0.1:8787 -ui frontend/dist
```

Schema changes go in a new numbered file in
`internal/store/sqlite/migrations/`. Never edit an applied migration.
