# Increments

Eleven increments. Each is independently shippable, each ends with a Definition
of Done that is testable as written, and nothing later is required to demo
anything earlier.

**Every increment carries the same three obligations**, and they are not optional
extras at the end:

1. Its screens pass the checklist in [02 §16](02-interaction.md#16-per-screen-checklist).
2. Its writes obey the transaction boundaries in [08 §3](08-data-integrity.md#3-transaction-boundaries).
3. Its events are logged with the `evt` names in [05 §4](05-logging.md#4-what-each-app-logs).

---

## Increment 0 — Foundation, integrity, walking skeleton

**Goal.** A logged-in staff member sees one real screen backed by the new schema,
and the database can already refuse to be wrong.

This is the largest increment and it is deliberately front-loaded. Constraints,
transaction helpers and the ledger are cheap now and expensive in Increment 6.

**Scope.**
- Full Prisma schema — 62 tables, 34 enums, every FK explicit with an `onDelete`.
- Hand-written SQL in migrations for what Prisma cannot express: `CHECK`
  constraints, partial unique indexes, and the `INSERT`-only grants on `AuditLog`
  and `UnitEvent`.
- `packages/db`: `withRetry` (serializable + 40001 backoff), `withUnitLocks`
  (ordered `SELECT … FOR UPDATE`), the outbox table and its worker.
- `packages/domain/src/unitState.ts` — the state machine from
  [08 §4](08-data-integrity.md#4-the-unit-state-machine).
- `packages/logging` rewritten to pino → stdout NDJSON. `HttpLog` deleted.
- Auth: Argon2id, `StaffSession` with hashed tokens, HttpOnly cookie, revocation.
- `Idempotency-Key` middleware on every mutating route.
- App shell: nav, `⌘K` palette shell, account menu, ID/EN toggle, error boundary.
- One real screen: **Inventori, read-only** — proves schema → API → table → filters.
- Seed script: locations, categories, a handful of models/SKUs/units.

**Interaction requirements.** The shell renders before data. Login failure names
the reason and keeps the username. Route changes never blank the shell. The
`rid` from a failed request is shown as a short reference the operator can quote.

**Definition of done.**
- [ ] `prisma migrate deploy` on an empty database produces the full schema, verified by a real query — not by `migrate status`
- [ ] Every invariant in [08 §2](08-data-integrity.md#2-invariants-and-what-enforces-each) has a test that provokes it and asserts the Postgres error code
- [ ] A test proves the app role **cannot** `DELETE` from `AuditLog` or `UnitEvent`
- [ ] Two concurrent transactions locking the same two serials in opposite order do not deadlock
- [ ] A replayed `Idempotency-Key` returns the stored response and creates no second row
- [ ] Logs are NDJSON on stdout with `t/lvl/app/env/rid`; no log row reaches Postgres
- [ ] Login, logout, session revocation and "log out everywhere" all work
- [ ] Inventori renders 5 000 seeded units under the [02 §1](02-interaction.md#1-latency-budgets) budgets

**Risks.** The recorded-but-unapplied-migration trap in this repo makes
`migrate status` untrustworthy — always verify with a query. Argon2 parameters
tuned on a fast laptop will be painful on the deployment host; tune on the host.

---

## Increment 1 — Interaction kit

**Goal.** Build once, in one place, the components every later screen depends on.
Skipping this is how the current build ended up with the interaction problems
this rebuild exists to fix.

**Scope.**
- `DataTable`: explicit resizable column widths persisted per user, ellipsis +
  tooltip, multi-select filters as removable chips, tri-state header selection,
  `Shift+click` ranges, docked bulk-action bar, compact/normal density,
  virtualization above ~200 rows, distinct empty vs no-match states.
- `URLState` hook — filters, sort, page and open-drawer id live in the query string.
- `Overlay` (drawer + dialog) on Radix: focus trap, `Esc`, outside-click, and the
  "holds unsaved input" exception.
- `MoneyInput` / `Money`: accepts `4200000`, `4.200.000`, `4,2jt`, `4200rb`;
  `BigInt` end to end; tabular figures; right-aligned.
- `ScanField`: focus on mount, refocus after each scan, inter-keystroke timing
  detection, unknown-serial inline recovery, duplicate-scan highlight.
- `UndoToast` with a visible timer, `aria-live="polite"`.
- `CommandPalette` (`⌘K`) with a pluggable provider registry.
- `KeyboardHelp` (`?`) rendering the current page's registered shortcuts.
- `tokens.css` — colour, spacing, radius, type scale, elevation. No component
  hardcodes a hex value.
- `DraftStore` — `localStorage` autosave keyed by staff + entity, with the
  "Draft dari 14:32 — Pulihkan / Buang" bar.

**Definition of done.**
- [ ] Every component has a Testing Library test asserting its *interaction contract*, not its markup
- [ ] A scripted 200-scan burst into `ScanField` drops nothing and never loses focus
- [ ] `DataTable` with 10 000 rows filters in < 100 ms and scrolls at 60 fps
- [ ] Column widths, density and filters survive a reload and a shared URL
- [ ] Keyboard-only: reach and operate every control in a kit demo page
- [ ] `⌘K` opens from any screen; `?` lists that screen's shortcuts
- [ ] Contrast and focus-ring audit passes on the demo page

**Risks.** This increment produces no user-visible feature and is the one most
likely to be cut under pressure. It is also the one whose absence costs the most
later. Do not cut it; cut a report instead.

---

## Increment 2 — Migration and data cleanup

**Goal.** Every later increment develops against **real, cleaned** data. Building
screens against seed data and migrating at the end is how you discover in month
three that 4% of serials are duplicates.

**Scope.** The full ETL from [08 §8](08-data-integrity.md#8-migrating-the-existing-data):
- Phase A profiling report with real counts from the current database.
- Phase B written decisions per defect class, in this repo, before any loading.
- Phase C loader in dependency order, idempotent, with a `migration_rejects` table.
- `UnitEvent` backfill — `DITERIMA`, plus `TERJUAL` where `soldRef` resolves.
  Nothing invented. Every backfilled row identifiable by `staffId = system`.
- `lokasi` free text → `Location` rows, mapped **by hand** with the owner present.
  This is a business decision, not a string-normalisation exercise.
- Phase D verification: all eight reconciliation checks, plus row-count and
  money-total reconciliation against the source.

**Definition of done.**
- [ ] The profiling report exists with real numbers and is committed
- [ ] Every defect class has a written, reviewed decision
- [ ] The loader is re-runnable and produces an identical result
- [ ] Rejected rows land in `migration_rejects` with a reason; the list has been read by a human
- [ ] All §6 checks pass, or every failure is explained in writing
- [ ] Money totals reconcile against the source, or each delta is explained
- [ ] The old database is read-only and retained

**Risks.** The `lokasi` mapping needs the owner's time. Book it before starting.
Duplicate serials are the likeliest blocker — profile for them in the first hour,
not the last.

---

## Increment 3 — Catalog, inventory and the serial lifecycle

**Goal.** The serial-number spine works end to end: a device arrives, is noted,
moves between locations, and its whole history is one scan away.

**Scope.**
- **Master Katalog** `/katalog` — categories (drag to reorder), per-category
  attributes and variant axes as real tables, models, variant matrix that shows
  which combinations already exist and generates only the missing ones.
- **Inventori** `/katalog/inventori` — the densest table in the app. Columns
  driven by `CategoryAttribute`, not hardcoded. No delete, ever.
- **Riwayat Serial** `/katalog/unit/:serial` *(new)* — the payoff screen. A
  vertical timeline of `UnitEvent`: arrival, notes, transfers, reservation, sale,
  return, claim, opname findings. Each entry names who, when, and the document.
  Reachable by scanning from anywhere via `⌘K`.
- **Catatan Unit** — free-text notes with an optional free-text tag and photos.
  Deliberately unstructured: no scores, no criteria, no computed grade.
- **Lokasi** `/kontrol/lokasi` — CRUD for `Location`.
- **Transfer** — select units, choose destination, one transaction, one
  `DIPINDAH` event each.
- **Harga** `/katalog/harga` — price list with margin against landed cost;
  below-floor changes create a `PriceReq` instead of applying.

**Interaction requirements.** Scanning a serial anywhere opens its history.
Transfers are multi-select from the inventory table, not a per-unit form. Notes
are one keystroke from the unit drawer and never block on a category schema.
Margin shows both rupiah and percent.

**Definition of done.**
- [ ] Scan → full unit history in < 300 ms
- [ ] A transfer of 50 units is one transaction and produces exactly 50 events
- [ ] `Unit.status` / `locationId` match the latest event for every unit (check §6 green)
- [ ] Inventory filters are multi-select, chipped, URL-mirrored, resettable
- [ ] Attribute columns come from `CategoryAttribute`; adding one needs no code change
- [ ] A note with three photos saves offline-tolerantly and survives a reload
- [ ] There is no delete affordance anywhere in inventory

**Note.** `Grade` survives as an **optional free label** on `Sku` and `Unit`. The
scoring engine, criteria, weights, thresholds and downgrade rules are gone, as is
`GradingConfig`. See open question 1 if you want the label gone too.

---

## Increment 4 — Cashier and payments

**Goal.** The screen that must be fastest, selling specific serials, with real
split payments.

**Scope.**
- **Kasir** `/penjualan` — scan or search → serial-level picker → cart → price
  edit against the category margin guide → trade-in → discount → **payments** →
  fulfilment → receipt.
- **Payments as rows.** One order can have cash + transfer + tempo. The payment
  panel shows running remaining balance and refuses to close an order whose
  payments do not reconcile with its status.
- **Trade-in** — product chosen from the catalog by dropdown, never free text.
  Creates an incoming `Unit` + `DITERIMA` event in the same transaction.
- **Shift** — open with a float, close with a declared count, variance computed.
- **Riwayat Transaksi** `/penjualan/riwayat` — filters, expand to serials, full
  and partial returns, void, refund, reprint, CSV export (owner-only, audited).
- Checkout is the reference implementation of
  [08 §3](08-data-integrity.md#3-transaction-boundaries).

**Interaction requirements.** Scan-to-cart < 150 ms with focus returned. Two
units of one SKU are two lines with two serials. `Enter` adds a line; **`⌘Enter`
checks out** and bare `Enter` never does. Cart survives reload. Below-COGS needs
approval with the numbers in the dialog; below-margin needs a reason. Anonymous
sale requires no customer form. Checkout is **not** optimistic — the cashier's
next physical action depends on the true result.

**Definition of done.**
- [ ] Sell 5 units by scanner in under 30 seconds without touching the mouse
- [ ] A double-clicked Checkout with the same `Idempotency-Key` creates one order
- [ ] Two cashiers racing for the same serial: one succeeds, the other sees "Serial `…` sudah terjual" naming the serial
- [ ] A killed process mid-checkout leaves no partial order (verified by killing it)
- [ ] Split payment across three methods reconciles; `paidTotal` = Σ payments
- [ ] Partial return restocks exactly the returned units and writes the events
- [ ] Cart survives a hard reload with prices and trade-ins intact

**Risks.** The single highest-risk increment. Budget for the concurrency tests
explicitly — they are the reason Increment 0 exists.

---

## Increment 5 — Inbound

**Goal.** Purchase orders through goods arrival, with landed cost that is
traceable to its inputs.

**Scope.**
- **Purchase Order** `/inbound` — header, lines from the catalog, fee rows
  (`PurchaseOrderFee`), packages, landed total. A 20–90 minute session: autosave
  every change, show saved-at, `⌘S` anyway.
- Serial capture per line (`PurchaseOrderItemSerial`) with scanner autofocus.
- **Kedatangan** `/inbound/kedatangan` — receive against an open PO. Discrepancies
  shown as a diff, never swallowed. Arrival photos. Creates every `Unit` and its
  `DITERIMA` event in one transaction, allocating fees across lines.
- **Retur Supplier** — `SupplierReturn` + items, moving units to `RETUR_SUPPLIER`.
- Excel import mapping to the same line shape.

**Interaction requirements.** Never lose a half-entered batch. Serial capture is
scanner-first: type nothing, scan 50 devices, see 50 rows. A duplicate serial is
flagged inline at the row, not on submit. The landed-cost figure is hoverable and
shows the allocation arithmetic.

**Definition of done.**
- [ ] A 200-line PO drafts, autosaves and restores after a crash
- [ ] Receiving 200 serials is one transaction; killing it mid-way creates zero units
- [ ] Fee allocation across lines sums exactly to the fee total (no rounding drift)
- [ ] A serial already in stock is rejected at entry, naming where it already is
- [ ] Every created unit has exactly one `DITERIMA` event with the PO attached

---

## Increment 6 — Fulfilment and people

**Scope.**
- **Pengiriman** — `Shipment` + `ShipmentItem` + `ShipmentEvent`. Queue by status,
  `PERLU_RESI` first. Zip lookup autocompletes from `PostalCode`. Events as a
  timeline. `resi` accepts a scan.
- **Reservasi** — `Reservation` + `ReservationItem`, showing whether staff or the
  agent created it. Reserving a unit writes `DIRESERVASI`; expiry releases it.
- **Garansi** *(new page)* — claim queue, lookup by scanning the serial,
  resolution `STOK` / `RETUR` / `REFUND` each with its stock consequence and its
  event.
- **Pelanggan** / **Supplier** — CRUD, history, and the phone → WhatsApp thread
  link that joins POS to chatbot.

**Definition of done.**
- [ ] A claim resolution moves the unit correctly for all three resolutions
- [ ] A reservation that expires releases the unit and logs the event
- [ ] Zip entry fills province/city/district without a second request
- [ ] A customer's page shows orders, claims and their WhatsApp thread

---

## Increment 7 — Chatbot inbox

**Goal.** Both channels answerable from the POS, with the webhook contract intact
and sends made durable.

**Scope.**
- **Pesan** `/penjualan/pesan` — thread list keyed by `WaMessage.from`, default
  `PERLU_STAF` oldest-first. Interleaved customer / agent / staff messages, each
  labelled. Side panel: agent summary (read-only, timestamped, marked
  machine-written) and staff directive (editable, never agent-writable).
- **Komentar** `/penjualan/komentar` — comments grouped by post, public reply,
  DM with the 7-day window shown as remaining time and disabled *with a stated
  reason* when expired, hide, mark done, auto-reply settings.
- **Sends move to the outbox** ([08 §5](08-data-integrity.md#5-crossing-the-boundary-outbox-not-fire-and-forget)).
  The transaction records intent; a worker sends.
- The **24-hour WhatsApp window** rendered per thread; the composer disables with
  an explanation rather than failing silently.
- Webhook wiring, credentials and verification per
  [06](06-webhook-integration.md).

**Interaction requirements.** New messages never re-sort the list under the
cursor — a "3 pesan baru" pill brings them in. Send is irreversible: no confirm,
no undo, button labelled with the destination. Missing credentials say "Mode
simulasi: balasan disimpan tapi tidak dikirim".

**Definition of done.**
- [ ] Handshake, signature rejection, fail-closed and dedup tests all green, with no `.env` present
- [ ] A staff reply survives a process kill between commit and send (outbox delivers it)
- [ ] The agent cannot write a directive column; the summarizer cannot either — asserted by test
- [ ] Thread view makes agent vs staff authorship unmistakable to a first-time user
- [ ] Expired DM window and expired 24 h window both explain themselves

---

## Increment 8 — Control and audit

**Scope.**
- **Log Transaksi** — orders, adjustments, shifts; filter by cashier/date/type.
- **Log Harga** — `PriceLog` history and the `PriceReq` approval queue.
- **Diskon** — scope, window, usage limit and count.
- **Stock Opname** — `OpnameSession` + `OpnameScan`. Continuous scanning with a
  running tally, no dialog between scans, unknown serials collected for review
  rather than interrupting. Posting is a confirmed action with the variance
  counts in the dialog body, and it is one serializable transaction.
- **Jejak Audit** — `AuditLog` search by staff, entity and date. Owner-only.
  Reading it is itself an audit event.

**Definition of done.**
- [ ] 300 continuous scans with zero interruptions and a correct live tally
- [ ] Posting an opname produces exactly one event per discrepancy and closes the session atomically
- [ ] A below-floor price request cannot be self-approved
- [ ] Every field-level edit in the app appears in `AuditLog` with before and after

---

## Increment 9 — Reports and finance

**Scope.** Arus Kas (`FinSettings`, `OpexItem`, `PettyCash` + entries, payments
in and out), Insight (revenue, margin, COGS, aging stock, movers), Supplier
report (spend, return rate, claim rate).

**Interaction requirement, non-negotiable.** Every figure drills through to the
rows behind it. A number that cannot be traced to records will be disbelieved,
and rightly.

**Definition of done.**
- [ ] Every headline figure drills to its rows in one click
- [ ] Report totals reconcile with the §6 checks
- [ ] A month of data renders inside the latency budget
- [ ] Aging stock is computed from `UnitEvent`, not from `intakeAt` alone

---

## Increment 10 — Observability and hardening

**Scope.** The Monitor app (traffic, errors, webhook health, **Integritas Data**,
audit search) on a read-only DB role; the alerting from
[05 §9](05-logging.md#9-alerting); the nightly reconciliation job; perf budget
measurement against [02 §1](02-interaction.md#1-latency-budgets); a WCAG 2.2 AA
pass; Playwright E2E for three journeys (sell a unit, receive a PO, answer a
thread); backup **restore rehearsal**; and the handover docs.

**Definition of done.**
- [ ] Every latency budget measured on the target hardware, with numbers published
- [ ] Every §9 alert fired once deliberately in staging
- [ ] A backup restored into a scratch database and verified
- [ ] Keyboard-only run of all three E2E journeys
- [ ] `pnpm audit` clean of high-severity advisories in CI
- [ ] Root `README.md` current; every doc in this folder has no stale open question

---

## Sequencing notes

- **0 → 1 → 2 is a hard chain.** Everything after 2 can be reordered.
- **3 before 4.** The cashier sells units; units must exist properly first.
- **7 is independent** of 4–6 and can run in parallel with a second pair of hands.
- **8 and 9 read what 3–6 write.** Attempting them earlier means rewriting them.
- 10 is continuous in spirit; it is listed last because that is when its
  *acceptance* happens, not when the work starts.

---

## Open questions

The eight from the first pass are answered and folded in. These are new, raised
by those answers:

1. **Does `Grade` survive at all?** With grading gone, `Grade` (A/B/C) is a free
   label with no engine behind it. Keep it as a manual label, or drop it and let
   the free-text notes carry condition entirely?
2. **How many locations exist today?** `Location` is built for several. If there
   is one shop and one back room, the transfer UI should be quiet by default
   rather than prominent.
3. **Serial format.** Are all serials scannable barcodes on the device? Any
   category where staff type them by hand? That changes `ScanField`'s tolerance
   and whether a check-digit validation is worth having.
4. **Who is the `system` staff row** used for migration backfill and agent
   actions? It needs a name staff will recognise in a timeline.
5. **Receipts** — thermal printer, PDF, or WhatsApp? This changes checkout's last
   step and its latency budget.
6. **Offline.** If the internet drops mid-shift, should the cashier keep selling
   into a local queue? This is a large architectural commitment; answering "no"
   explicitly is a valid and much cheaper answer.
7. **Do payments need reconciliation against a bank/QRIS statement**, or is
   recording the method sufficient?
8. **Instagram permissions** need App Review, which takes days. Start it during
   Increment 0 or accept that Increment 7 slips?
