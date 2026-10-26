# The POS store, on PostgreSQL

**Status 2026-09-13: in progress.** Owner ask: *"Make all the POS screen read
the Postgres not Mock."*

Until this change 26 route files read `apps/web/src/mock/store.ts`, an
in-memory store that reset on reload and that every device held its own copy
of. This document is the design that moves every one of them onto PostgreSQL
at once, and the reasons behind each choice.

## Why all at once, and why not one endpoint per screen

The rule learned twice (CLAUDE.md, 2026-09-07 and 2026-09-08) is that *a read
may not migrate ahead of its writes*: S/N Tracking and Reservations were each
moved to the API alone and each broke, because the screens that WRITE the same
rows still wrote the browser store. The screens share one data model, so moving
them one at a time guarantees a window in which two of them disagree.

Rewriting 115 write sites as bespoke endpoints would take that window from days
to months. Instead the store keeps its shape — `MockDb`, the one every page and
every tested `lib/` function already reads — and its *backend* moves:

```
page ── useDb() ──▶ store (browser) ── GET /api/store ─────────▶ project()  ─┐
page ── mutate(fn) ▶ store ── diff ── POST /api/store/commit ─▶ commit()   ─┼─ PostgreSQL
                     store ◀─ poll ── GET /api/store/changes ─▶ changes()  ─┘
```

- **`@nusantara/store`** (`packages/store`) is the contract both sides compile
  against: the `MockDb` types, which field of each collection is its key, which
  fields are money, the diff that turns a mutation into a changeset, and the
  wire encoding. Pure — no React, no Prisma, no I/O.
- **`packages/db/src/store/`** is the server: `project` reads Postgres into the
  contract's shape, `commit` writes a changeset in ONE transaction, `changes`
  answers "what moved since cursor N".
- **`apps/web/src/mock/store.ts`** keeps `useDb`, `mutate`, `nextId`,
  `docCode`, `appendEvent`. Under the test runner it still runs on the
  in-memory seed, so the 639 web tests keep testing the pages; in the browser
  it loads from and commits to the API.

## The rules the commit enforces

These are the non-negotiables of CLAUDE.md, and each is enforced on the server,
not trusted from the browser.

1. **The ledger is append-only, with two edits the owner admitted on
   2026-09-23 and nothing else.** An event in a changeset is new. The two
   exceptions are a row's `serial` following its unit to a corrected serial
   (`renameEvents` — that column alone, onto the unit that holds the row; the
   unit itself is renamed in PLACE by the units adapter, same `Unit.id`, so
   its history stays its own) and the removal of a unit's LAST rows
   (`removeLastEvents` — never one in the middle, never the last one
   standing). `commit.ts` admits exactly those two shapes to the events
   adapter, which judges them in full. The database holds the same line:
   `nusantara_app` may UPDATE `UnitEvent.serial` and no other column, has no
   DELETE on the table, and reaches one only through `unit_event_drop_last`,
   a definer function that refuses the same rows (20260924130000).
   ⚠️ From 2026-09-23 to 2026-09-24 the adapter admitted both and the gate
   refused them first, so neither ever reached PostgreSQL — every serial
   correction came back "Not saved". The stock movement history — `adjustments`, and a `KOREKSI`
   in `stockMoves` — is the one collection written once and CORRECTABLE
   afterwards (2026-09-24): when, why, what was said, and a unit's battery
   reading may change; the unit, the direction, the quantity and whose hand
   may not, and nothing removes a row. `CORRECTABLE` in `commit.ts` lets the
   edit through, each adapter checks its fields (`sameApartFrom`), and the app
   role's UPDATE on both tables is granted per column, so the rule holds three
   times over.
2. **Projection and event travel together.** A unit whose status or location
   changes must carry the event that explains it, in the same changeset, and
   the unit's new status and location must equal that event's. Sequence numbers
   are continuous per unit and `fromStatus` is the previous `toStatus`.
3. **Money is BigInt.** On the wire every money field is a decimal string;
   `@nusantara/store` lists them, and the browser converts to a number only
   after asserting it is a safe integer.
4. **The client's total is never trusted.** An order's total must equal
   `Σ prices − discount + extra − trade-in`; `Order_total_arithmetic_check`
   holds the pre-trade-in figure.
5. **Document numbers come from `next_doc_code`.** The browser writes a
   provisional code (`SI-2026/09-T4k9x2ab`, `T` and seven characters); the commit swaps it for the real one
   everywhere it appears in the changeset — the order, the events' `refCode` —
   and returns the mapping so the browser swaps it too.
6. **The actor is the session.** Rows a commit creates are attributed to the
   signed-in staff member, whatever name the browser wrote.
7. **Nothing is hard-deleted**, with the two exceptions CLAUDE.md already
   names, and removals are mapped rather than executed:

   | removal in the browser | what the commit does |
   |---|---|
   | a QC photo, or all of them on sale | DELETE — the sanctioned exception, `tag = 'QC'` only |
   | a draft stock take | `OpnameSession.status = BATAL` (the owner decision left open on 2026-09-01; the soft option) |
   | a service charge, or a whole service visit (2026-10-26) | DELETE `ServiceFee` / `ServiceVisit` — after every adapter has run (`ctx.later`), refused while an `Expense` still names the charge (`serviceFeeId`; remove it in the same changeset) and inside a closed book |
   | a unit removed from the intake grid | `archivedAt`, a `DIARSIPKAN` event, and the serial moved aside so the row can be re-keyed |
   | a variant with no stock | `Sku.archived` |
   | a PO line, a hold's machine, an axis value, a grading option or rule, an order fee, a payment, an address, a settlement fee, a deposit allocation, a draft count's scope or scan | `removedAt` / `voidedAt` on that row |

   Projection leaves removed rows out, so the page sees what it wrote; the rows
   themselves stay for anybody asking what happened.

## Concurrency

Each changed row carries the version the browser started from. The commit
locks the rows, projects their current version and compares: equal applies,
different answers 409 with the current rows, and the browser re-runs the
mutation on them. Commits from one browser are queued, one in flight at a time.
A successful commit returns the canonical version of every row it touched.

Other browsers learn about it from `StoreChange`: every writer in
`packages/db` appends `(collection, key)` in the transaction that changed the
row, and the browser polls `/api/store/changes?after=<cursor>`. Outside the
commit that is `appendUnitEvent` (an arrival over `/api/inbound`, a hold the
agent books) and the hold writers in `reservations.ts`; a new writer that
skips it is invisible to every till until a reload.

A customer return closes the receipts dated BEFORE it, not every open line of
the machine: the B2Soft import commits a month at a time, so a return and the
resale that followed it arrive in one changeset.

## Counted products — `stockMoves` (2026-09-19)

A category with `tracksSerial = false` has no `Unit` rows: what a location
holds of one of its variants is `SUM(StockMove.qty)`. The adapter
(`adapters/stock.ts`) refuses a removal and every edit but one — a `KOREKSI`'s
`at`, `reasonId` and `note`, which is the Stock Movement History's row
(2026-09-24; the app role's UPDATE is those three columns and nothing else,
and the quantity is never rewritten) — refuses a move of a variant
whose category tracks serials, and on a till refuses any commit that leaves a
shelf below zero — checked after the insert, under the store lock every commit
holds. A `TERJUAL` move adds `-qty × unitCost` to its `OrderItem.cogs` and
`Order.cogs`: the order row is written earlier in the same commit, before the
moves naming it exist. Import mode skips the zero floor, because the B2Soft
history replays a sale before the purchase it came off.

## Import mode

`commitStore(…, { mode: "import" })` is the B2Soft migration
(`tools/b2soft/README.md`). It differs from a till's commit in four ways and no
others: no base is compared, so no 409; document codes must be real, never
provisional; rows are dated by their documents (`receivedAt`, `createdAt`)
rather than by the clock; and an event's `staff` is looked up by name, falling
back to the import's own inactive account. Validation, the ledger check and the
change feed are the same.

## Photographs

`UnitNotePhoto.url` held a `data:` URL in the browser build. The commit stores
the bytes in `UnitNotePhoto.data` and projects `url` as
`/api/store/photos/<id>`. Bytes in the database rather than on a disk because
the nightly `pg_dump` then carries them, and the sale purge deletes row and
file in one statement.

## Schema added for it

Every field below was browser-only and marked ⚠️ in `seed.ts`. The migration is
`20260913120000_store_on_postgres`. No JSON columns: every list is a table.

- **Enums extended.** `UnitStatus` + `SERVIS`; `Platform` + `TOKOPEDIA`,
  `TIKTOK`, `LAINNYA` (owner answer 2026-09-13); `DiscType` + `BUNDLE`;
  `ScanResult` + `HILANG`.
- **New tables.** `Rack`, `Reason`, `Salesperson`, `GradingCriterion`,
  `GradingOption`, `GradingRule`, `GradingRuleOption`, `SkuAxisValue`,
  `AppleDbHiddenModel`, `StockIn`, `StockAdjustment`, `CustomerAddress`,
  `OrderFee`, `UnitReturn`, `Expense`, `ManualIncome`, `PaymentLog`,
  `Settlement`, `SettlementFee`, `SettlementLog`, `ServiceVisit`, `ServiceFee`,
  `SupplierDeposit`, `DepositAllocation`, `OpnameScopeLocation`,
  `OpnameScopeRack`, `OpnameScopeCategory`, `OpnameScopeCondition`,
  `OpnameSurplus`, `StoreChange`.
- **New columns.** `Supplier.code/address` (~~`openingBalance`,
  `openingBalanceAt`~~ — dropped 2026-09-24, the owner stopped tracking a
  supplier's debt from before this app, and `Payment.supplierId` went with
  them); `Customer.openingBalance/openingBalanceAt` and `phone` nullable
  (B2Soft has none — owner answer 2026-09-13); `CatalogModel.identifier/source`;
  `Unit.rackId/price/marketPrice/purchaseOrderId`; `UnitEvent.unitReturnId` (the event's `refCode` is projected from its document link);
  `PurchaseOrder.discount`;
  `PurchaseOrderItem.notReceived/discount/outsideInvoice` (money off ONE line,
  owner ask 2026-09-20 — `PurchaseOrder.discount` stays the one negotiated off
  the whole order — and, 2026-09-24, a line the shop took in that the
  supplier's paper never billed);
  `Payment.channel/note/recordedAt/fromDepositId/voidedAt`;
  `Order.salespersonId/shippingAddress/payMethod/grossTotal/netReceived/reservationId`;
  `OrderItem.listPrice`; `TradeIn.skuId/condition/grade`;
  `Discount.bundleQty/bundlePriceRp/modelId`; `OpnameSession.countDate`;
  `OpnameScan.note/sortOrder`; `UnitNotePhoto.data/contentType`;
  `Staff.defaultLocationId`; and the `removedAt` columns in the table above.

## What is still not enforced

**Arrow legality.** `packages/domain/unitState.ts` has no `SERVIS`, and the
browser records a machine going to service as `DICATAT` with a status change —
an arrow the domain table does not declare. The commit enforces continuity
(rule 2) but not the arrow table, because enforcing it would refuse flows the
shop uses today. Declaring the service arrows, and giving the service trip its
own event type, is the follow-up.

## Where each collection lives

| `MockDb` | tables | key |
|---|---|---|
| `settings` | `AppSetting` rows | singleton |
| `paymentMethods` | `PaymentMethod` | id |
| `warehouses` / `racks` | `Location` / `Rack` | id |
| `suppliers` | `Supplier` | id |
| `reasons` / `qcDescriptions` | `Reason` / `QcDescription` | id |
| `gradingCriteria` / `gradingRules` | `GradingCriterion` + `GradingOption` / `GradingRule` + `GradingRuleOption` | id |
| `reservationSources` / `referralSources` / `salesmen` | `ReservationSource` / `ReferralSource` / `Salesperson` | id |
| `models` / `skus` | `CatalogModel` + `ModelAxis` + `ModelAxisValue` / `Sku` + `SkuAxisValue` | id |
| `appleDbHidden` | `AppleDbHiddenModel` | singleton list |
| `units` | `Unit` + battery `UnitAttribute`s | serial |
| `events` | `UnitEvent` | id |
| `stockMoves` | `StockMove` — the counted products' append-only ledger (2026-09-19) | id |
| `unitNotes` | `UnitNote` + `UnitNotePhoto` | id |
| `pos` | `PurchaseOrder` + items, serials, fees, payments | id |
| `stockIns` / `adjustments` | `StockIn` (written once) / `StockAdjustment` (correctable since 2026-09-24: when, why, description, battery) | id |
| `customers` | `Customer` + `CustomerAddress` | id |
| `orders` | `Order` + `OrderItem` (a unit per line, or a counted product's `lines` with `unitId` null), `OrderFee`, `TradeIn`, `Payment` | id |
| `returns` | `UnitReturn` | id |
| `reservations` | `Reservation` + `ReservationItem` | id |
| `discounts` | `Discount` | id |
| `expenses` / `incomes` | `Expense` / `ManualIncome` | id |
| `paymentLog` | `PaymentLog` | id |
| `settlements` / `settlementLog` | `Settlement` + `SettlementFee` / `SettlementLog` | id |
| `services` | `ServiceVisit` + `ServiceFee` | id |
| `deposits` | `SupplierDeposit` + `DepositAllocation` | id |
| `opnames` | `OpnameSession` + scope tables, `OpnameScan`, `OpnameSurplus` | id |
| `knowledge` | `AgentKnowledge` | id |
| `personas`, `activePersonaId`, `corrections`, `chats` | read-only here — `/chat` already talks to its own API | — |
| `myWarehouseId` | `Staff.defaultLocationId` of the session | singleton |
