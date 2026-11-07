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
- **Data import:** Excel templates for items, kitchen stations, categories, raw materials,
  customers, suppliers and tables, with required columns marked by a red `*`,
  dropdowns and an instructions sheet. Insert and update modes are separate;
  the update template comes prefilled with current data. Every row is
  validated, and errors are shown by row and column. Nothing is saved unless
  the whole file is valid.
- **Moving to another computer:** Import → Move data gives the owner one file
  with the menu and its pictures, stock, customers, sales history and the
  restaurant's settings. Users, devices and the license stay behind; old sales
  arrive under the owner doing the move. A backup comes first, one bad row
  saves nothing, and uploading the same file twice adds nothing.
- **Languages:** Arabic (RTL, Modern Standard Arabic), English and French (LTR), chosen per device. Numbers are always Latin digits (0-9), in every language.
- **Help:** the «?» button in the header (every user) opens Settings → Help and glossary: step-by-step guides to how the system works and a searchable glossary of business terms in Arabic, English and French, each with a link to its screen. Users without the settings permission see only Help and My account there.
- **Pictures:** at most 2 MB each. A larger picture is re-encoded at the highest quality that fits (found by a binary search), and is made smaller only if even quality 0.80 doesn't fit.
- **Connecting and license:** the first screen is «Continue with Google».
  It opens the Platform in the browser (sign up or log in), and once the
  owner is signed in the app activates by itself: no key to type. It needs
  the internet once, at that first step. The trial (3 days by default, from
  the first computer connected) and the subscription live on the Platform.
  The license is signed by the Platform, bound to this computer's key, and
  refreshed every few hours; a change on the Platform (domain, e-menu
  settings, suspension) reaches the app within a minute. A device moves to
  another computer by removing it from the account on the Platform.
- **Working offline:** the app sells with no internet. After 14 days without
  reaching the Platform a banner counts down 7 more days, then selling stops
  until it's back online, and it recovers by itself within a minute.
- **Only the real Platform is trusted:** the address is built in, and every
  reply must carry the Platform's Ed25519 signature over the request's nonce,
  so a wrong or hostile server is rejected, and nothing secret is sent until
  the server proves it holds the key. Redirects are never followed.
- **Backups:** every backup stays on this computer, with a second copy in a
  folder the owner picks on any drive (Settings → Backups). If the drive is
  missing, the local backup still happens and the screen says so.
- **Restoring:** a backup is one `.db` file holding the data and the pictures.
  Upload it on the first-run screen of a new computer or in Settings → Backups;
  the app restarts on it. The account link and backup folder stay this
  computer's. Domain and e-menu settings come from the account on connecting.
- **A new computer without a backup:** the restaurant's settings are saved on
  the account whenever they change (never the menu, sales or passwords). A
  returning owner picks a backup or starts with those settings and no data.
- **Moving computers:** when every device slot is taken, the connect page lists
  the devices to move from. A computer that lost its data keeps its slot.
- **E-menu:** needs a connected account and a menu address. The first-run
  form suggests one from the restaurant's name and checks it's free; the
  Platform creates the Cloudflare tunnel and this computer serves it.
  - Guests browse a mobile menu in ar/en/fr. The owner designs it from
    Menu → E-menu, with a live phone preview: name, logo, button and
    background colours (fixed presets), slider offers and family bundles
    (each offer is a real item in the «العروض» category, so the POS, kitchen
    and reports treat it like any item), featured items with badges, and
    category pictures. The Platform only decides whether the account has the
    e-menu and online ordering.
  - An offer can be built from menu items («2 مارجريتا + 2 برجر»): the kitchen
    sees the contents and stock is deducted from their recipes.
  - Featured items carry a short note, and a hot deal an e-menu price shown
    against the normal one struck out. The POS keeps the normal price.
  - A family offer's savings sticker («وفّر 20%») is dragged anywhere on its
    picture in the editor, sized from 60% to 200%, and moves on the guest
    menu (pulse, bounce, wiggle, shine or none; still when the phone asks
    for reduced motion). Its place is a share of the picture, so it lands
    on the same spot on every screen and in every language.
  - Every picture is framed by the owner when picked (drag and zoom).
  - Lists have unique positions: saving one in a taken place moves the rest.
  - Three ways in: the online link (browsing and delivery), each table's QR
    code (printable, regenerable; the table is known) and one shared hall QR
    at `/hall` (the guest picks the table from a list).
  - Each code downloads as a PNG card (restaurant, table, code, «scan me»)
    by clicking it in Settings → Subscription and e-menu, or all of them in
    one ZIP.
  - A table's own QR shows the guest its bill (open orders, service, tax,
    what's left to pay) and asks for it with the payment method. The hall
    QR never shows a bill: anyone there could pick any table.
  - Reports → Table calls: calls per reason, wait until «done», who
    answered, and calls by hour. Urgent calls (food problem, late order)
    ring with a sharper sound.
  - From the QR codes, the «Contact» tab (it replaces «My details» at a
    table) and a floating help button call the staff: the waiter, ready to
    order, the bill (cash or card, so the machine comes along), something
    needed (water, napkins, cutlery, ice, plates, cleaning), a late order, a
    problem with the food, or anything else in the guest's words. The staff
    screen shows the picks in its own language; one open call per reason per
    table, and the tables screen badges the most pressing one.
  - After ordering, guests see the estimated time (longest item, plus the
    delivery time) and a bell that changes when the kitchen finishes.
  - Online orders wait in the POS inbox until staff accept them. Accepted
    orders become normal orders and go to the kitchen. Prices always come
    from the menu.
- **Remote access:** the whole staff system from anywhere, on its own address
  next to the menu («tajroba-pos.<base>» beside «tajroba.<base>»), through
  the same Cloudflare tunnel. The plan must include remote access, and the
  owner allows each account in Users (off by default, the owner included).
  From outside it's password only: no PINs and no list of accounts. Taking
  the permission or the plan away ends open remote sessions at the next
  request, and remote tokens never work on the LAN or the window, nor the
  other way round. Settings → Subscription shows the address and who may
  use it; the activity log marks remote sign-ins and refusals.
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

The same tunnel's second hostname («<name>-pos») reaches a third listener on
`127.0.0.1:8789`: the staff UI and API on the `tunnel` channel (remote
access). Cloudflare's `Cf-Connecting-Ip` header is trusted only on these
tunnel listeners. The Platform creates that hostname's DNS record only while
the plan includes remote access (saas `tasks/tunnel.py` `sync_remote_route`),
and menu names ending in `-pos` are reserved for it.

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
# …and remote access (the staff system on the tunnel channel) on :8789
go run ./cmd/devserver -addr 127.0.0.1:8787 -ui frontend/dist -fake-saas -public 127.0.0.1:8788 -remote 127.0.0.1:8789
cd frontend && CPRO_API=http://127.0.0.1:8787 npm run dev   # hot reload in the browser
```

### Release builds

1. Bump `info.productVersion` in `wails.json` (that is the app version).
2. Build:

```sh
scripts/build.sh -platform windows/amd64 -nsis   # Windows installer
scripts/build.sh -platform darwin/universal      # macOS
# CPRO_SAAS_URL=https://... overrides the default https://cacherpro.ahmedhashim.site
```

3. Upload the installer, then on the Platform (SCP Settings → Desktop App) set
   *Latest Desktop Version*, the download URL and its SHA-256
   (`shasum -a 256 <file>`). With *Update is Mandatory* on, every older app
   blocks selling until it installs the new version.

The license **public key** is fixed in `internal/license/license.go`; its
private half goes in SCP Settings → *License Private Key*. Replacing the pair
means shipping an update with the new public key first.

Apps check for updates at start-up and every night at 00:00 (hourly retries
when offline). The release info comes in a Platform-signed reply, and the
download must match its SHA-256 before the installer starts.

Under `wails dev`, Vite must answer 404 for `/api` so Wails hands the request to the Go handler.
`vite.config.js` does this unless `CPRO_API` is set.

UI strings are written in Arabic and wrapped in `T('…')` (`src/lib/i18n.js`).
Add the English and French text to `src/lib/locales/{en,fr}.json`;
`npm run check:i18n` (run in CI) fails on any missing translation. Layout
classes use logical sides (`ms-`, `ps-`, `start-`, `text-start`, `border-s`)
so the same markup works in both directions.

Schema changes go in a new numbered file in
`internal/store/sqlite/migrations/`. Never edit an applied migration.
