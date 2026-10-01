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
- **Data import:** Excel templates for items, categories, raw materials,
  customers, suppliers and tables, with required columns marked by a red `*`,
  dropdowns and an instructions sheet. Insert and update modes are separate;
  the update template comes prefilled with current data. Every row is
  validated, and errors are shown by row and column. Nothing is saved unless
  the whole file is valid.
- **Languages:** Arabic (RTL), English and French (LTR), chosen per device.
- **Platform link and license:** the app is activated with the owner's code
  from the CPro Platform. Selling is blocked until it is activated, and when
  the subscription ends, the trial ends or the device is revoked. Reports,
  exports and backups always work. The license is signed by the Platform,
  bound to this computer's key, and refreshed every few hours. A change on the
  Platform (domain, e-menu settings, suspension) reaches the app within a
  minute. When offline, a paid license keeps working for its grace days.
- **E-menu:** the restaurant's domain (a Cloudflare tunnel the Platform
  creates) is served from this computer.
  - Guests browse a mobile menu in ar/en/fr with themes and colours set on
    the Platform.
  - Each table has its own QR code (printable, regenerable).
  - Guests can call the waiter or ask for the bill. When the owner allows it,
    they can order at the table or for takeaway.
  - Online orders wait in the POS inbox until staff accept them. Accepted
    orders become normal orders and go to the kitchen. Prices always come
    from the menu.
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
  transport/httpapi/        JSON API under /api/v1, one handler per channel; public.go = guest e-menu only
  license/                  license (EdDSA JWS) verification and states — pure
  saas/                     signed client for the Platform (+ saastest: in-memory fake Platform)
  tunnel/                   cloudflared supervisor (pinned version, SHA-256 verified download)
  platform/                 per-OS data dir, logging
frontend/                   React 19 + Vite + Tailwind 4 (index.html = staff app, menu.html = guest e-menu)
```

There is one API for every client. Inside the window, Wails routes `/api/v1`
to the Go handler, with no open port. When LAN access is enabled, the same
handler and UI are served on `:8787` for tablets and kitchen screens. Session
tokens are bound to the channel they were issued on.

The restaurant's domain reaches a second listener on `127.0.0.1:8788`
(`httpapi.NewPublic`). It serves only the guest menu page, its assets, item
images and `/api/public/v1`. The staff API is not routed there at all.

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
# …with a fake Platform (activation code ACT-DEMO) and the guest menu on :8788
go run ./cmd/devserver -addr 127.0.0.1:8787 -ui frontend/dist -fake-saas -public 127.0.0.1:8788
cd frontend && CPRO_API=http://127.0.0.1:8787 npm run dev   # hot reload in the browser
```

### Release builds

```sh
CPRO_SAAS_URL=https://your-platform.com \
CPRO_LICENSE_PUBKEY=<SCP Settings → License Public Key> \
CPRO_VERSION=1.0.0 scripts/build.sh -platform windows/amd64
```

The key comes from the Platform:
`bench --site <site> execute saas_control_platform.licensing.signing.generate_keys`.
A build without a key (e.g. `wails dev`) runs with licensing **off** and logs a
warning. `scripts/build.sh` refuses to build a release without one.

Under `wails dev`, Vite must answer 404 for `/api` so Wails hands the request to the Go handler.
`vite.config.js` does this unless `CPRO_API` is set.

UI strings are written in Arabic and wrapped in `T('…')` (`src/lib/i18n.js`).
Add the English and French text to `src/lib/locales/{en,fr}.json`;
`npm run check:i18n` (run in CI) fails on any missing translation. Layout
classes use logical sides (`ms-`, `ps-`, `start-`, `text-start`, `border-s`)
so the same markup works in both directions.

Schema changes go in a new numbered file in
`internal/store/sqlite/migrations/`. Never edit an applied migration.
