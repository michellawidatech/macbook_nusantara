# Macbook Nusantara — UI rebuild plan

Rebuilding the POS front end from scratch, **without** marketplace/ecommerce and
competitor analysis, **with** the WhatsApp + Instagram chatbot kept intact, and
against a data model that is properly organised for the first time.

The data model is the contract. Everything here assumes
[`docs/erd-pos-chatbot.drawio`](../erd-pos-chatbot.drawio) — 62 tables, 34 enums,
101 real foreign keys, no loose string links, no JSON blobs standing in for
relations.

## Why this rebuild exists

Two problems, and they are different problems.

**The interaction is poor.** Single-select filters where staff need multi-select,
tables that wrap values onto three lines, a cashier that cannot pick a specific
serial, confirmation dialogs where an undo would do, and chrome inherited from a
component library rather than chosen. The goal is **not a prettier app** — it is
an app a cashier can drive at speed, with a scanner in one hand, without reading
anything twice. If a decision makes the app look better but slower to operate, it
loses.

**The data is not organised.** Relations are untyped strings the database does
not enforce; sixteen columns are JSON blobs that cannot be queried or
constrained; stock movement is a free-text log rather than a ledger; a unit's
history is reconstructed from conventions instead of keys. That is invisible
until two numbers disagree and nobody can say which is right.

## Read in this order

| # | Document | What it settles |
|---|---|---|
| — | this file | Scope, the increment ladder, how to use the plan |
| 01 | [Conventions](01-conventions.md) | Stack, repo layout, naming, API contract, code rules |
| 02 | [Interaction principles](02-interaction.md) | The standard every screen is held to |
| 03 | [Pages & features](03-pages-and-features.md) | Every screen, its tables, its endpoints, its job |
| 04 | [Increments](04-increments.md) | The build order — **the plan proper** |
| 05 | [Logging](05-logging.md) | Four layers, a sink outside the app database, correlation |
| 06 | [Webhook integration](06-webhook-integration.md) | End-to-end chatbot webhook guide (WA + IG) |
| 07 | [Credentials](07-credentials.md) | Every key: what, source, reader, rotation, leak response |
| 08 | [Data integrity](08-data-integrity.md) | ACID, invariants, the serial ledger, migration, security |
| 09 | [Bootstrap & prompts](09-bootstrap-prompts.md) | What to build first, and the paste-ready AI prompts |

**Starting in an empty folder? Go to [09](09-bootstrap-prompts.md).** It has the
copy commands, the `CLAUDE.md` to create first, and ten prompts that get you to a
walking skeleton. Read this file and **08** before the first prompt; everything
else is reference you consult while building.

This folder plus `secrets/webhook-credentials.env` is self-contained — nothing
here depends on the old repository except the webhook source, which
[09 §3](09-bootstrap-prompts.md#3-before-the-first-prompt-already-done) copies
into `reference/` for reading.

**This project's home is `~/claudeproject/macbook_nusantara`.** The old repo,
`~/claudeproject/macnus_redo`, is reference only.

## Scope

**In.** Catalog and serial-level inventory, multi-location stock with transfers,
purchase orders and goods arrival, free-form per-unit notes, cashier/checkout
with split payments, returns, shipments, reservations, warranty claims,
customers, suppliers, discounts, stock opname, price control, audit trail, cash
flow and reports, staff/roles, and the WhatsApp + Instagram chatbot inbox with
its agent pipeline and staff handoff.

**Out.** Marketplace listings, channel state and marketplace orders; competitor
analysis and market-price caching; the Shopee catalog import. Also out: the
**grading engine** — criteria, weights, thresholds, downgrade rules and computed
scores. Staff record free-text notes about each device instead, because their
process is not standardised.

**Deliberately reshaped** (this is the "data is not organised" fix):

| Was | Now |
|---|---|
| ~28 loose string links | Real foreign keys, every one with an explicit `onDelete` |
| `StockLog` free-text movements | `UnitEvent` — an append-only, gapless ledger per serial |
| `lokasi` free text on `Sku`/`Unit` | `Location` table; location is a property of a unit |
| One `PayMethod` per order | `Payment` rows — split, partial, tempo, DP all expressible |
| 16 JSON blob columns | Real tables (fees, packages, photos, trade-ins, shipment items and events, reservation items, petty-cash entries, opex, category attributes, model axes) |
| `GradingRecord` + `GradingConfig` | `UnitNote` — free text, optional tag, photos |
| `HttpLog` in the app database | NDJSON to a log sink outside Postgres |
| `VoidRec` + `RefundRec` | `OrderAdjustment` |
| `OpnameLog` counters | `OpnameSession` + `OpnameScan`, counters derived |
| — | New: `StaffSession`, `AuditLog`, `Outbox` |

**Carried over unchanged.** The webhook service and its fail-closed contract, the
agent pipeline, the Graph API clients, the redaction rules, and the credentials
recorded in `secrets/webhook-credentials.env`.

## The one rule

> **The serial number is the subject of this database.**

A unit is a physical device with a serial. Every state change — arrival, note,
transfer, reservation, sale, return, warranty, opname finding — is an event row.
`Unit.status` and `Unit.locationId` are projections of that stream, written in
the same transaction. Nothing is ever deleted.

That is what makes "each serial has a complete lifecycle" true rather than
aspirational, and it is why [08](08-data-integrity.md) comes before the screens.

## The increment ladder

| Inc | Name | Ships |
|---|---|---|
| 0 | Foundation, integrity, walking skeleton | Schema + every constraint, transaction helpers, auth, logging, one real screen |
| 1 | Interaction kit | Table, overlay, money, scanner, palette, undo, tokens |
| 2 | Migration & data cleanup | Profiled, decided, loaded, reconciled real data |
| 3 | Catalog, inventory & serial lifecycle | Master katalog, inventori, **Riwayat Serial**, notes, locations, transfers |
| 4 | Cashier & payments | Serial-level checkout, split payments, trade-in, returns, shift |
| 5 | Inbound | PO, fees, arrival, serial capture, landed cost, supplier returns |
| 6 | Fulfilment & people | Shipments, reservations, warranty, customers, suppliers |
| 7 | Chatbot inbox | WA + IG inbox, thread memory, directive, handoff, outbox sends |
| 8 | Control & audit | Price control, discounts, opname, audit trail |
| 9 | Reports & finance | Cash flow, insight, supplier report |
| 10 | Observability & hardening | Monitor, alerting, perf, a11y, E2E, restore rehearsal |

Full detail per increment — scope, interaction requirements, Definition of Done
and risks — is in [04-increments.md](04-increments.md).

## How to use this plan

1. **Do not start an increment without its Definition of Done.** If a criterion
   is untestable as written, fix the criterion before writing code.
2. **Every screen is checked against [02 §16](02-interaction.md#16-per-screen-checklist)
   before it is called done.** That section is a checklist, not an essay.
3. **Every write is checked against [08 §3](08-data-integrity.md#3-transaction-boundaries).**
   A partial checkout is worse than a failed one.
4. **Update the root `README.md` in the same commit as the increment.**
5. **Open questions live at the bottom of [04](04-increments.md#open-questions).**
   Answer them there; do not answer them in code and leave the doc stale.

## Before Increment 0

- Answer, or accept the stated default for, the eight
  [open questions](04-increments.md#open-questions) — particularly whether
  `Grade` survives, how many locations exist, and what a receipt is.
- Create `secrets/webhook-credentials.env` from its template
  ([07 §3](07-credentials.md#3-creating-the-canonical-backup)) and put a second
  copy in a password manager.
- Start Instagram App Review — it takes days and gates Increment 7.
- Book the owner's time for the `lokasi` → `Location` mapping in Increment 2.
