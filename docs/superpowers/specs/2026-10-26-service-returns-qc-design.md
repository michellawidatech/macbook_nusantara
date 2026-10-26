# Service, supplier returns, unpaid returns and the QC finder — design

Owner asks of 2026-10-26, approved in chat the same day ("all OK"). Seven parts;
each is buildable and shippable on its own, in the order below.

## Background — what the code does today

- **Service** (`apps/web/src/routes/stock/ServicePage.tsx`, `lib/service.ts`).
  A visit (`ServiceRec` / prisma `ServiceVisit`) is opened from two doors:
  the QC row's Service button on `/inbound/:id` (`sendToService`, which moves
  the unit to the warehouse whose `Location.kind` is `SERVIS` by default) and
  Inventory → Stock out → "On service" (`InventoryPage.tsx`, no fee fields).
  A charge (`ServiceFee`: kind, label, amount) is never removed — the adapter
  refuses ("ubah nilainya menjadi nol") — and is never an `Expense`, so service
  money never reaches Income & Expense. `costOfUnit` already adds every visit's
  fees to the unit's cost, and Profit & Loss counts it only inside HPP
  (`OPERATING_KINDS` is a whitelist).
- **The "wh4" bug.** In the shop's database warehouse 04 is *Gudang Masuk Belum
  QC* and carries `kind = SERVIS`, so inbound units sit in it and the bench is
  it. *Back in stock* defaults its Select to `fromLocationId` (04) while
  excluding the bench from its options, so antd draws the raw value `wh-04`.
- **Supplier return** (`SupplierReturnPage.tsx`, QC `rejectToSupplier`).
  Records `UnitReturn` with `expectedCredit` and the `RETUR_SUPPLIER` event; no
  money moves, the invoice's balance does not change, and an open service visit
  is not closed (the unit stays on the bench list).
- **Unpaid sale returned.** `applyReturnCredit` cancels the DUE part, so the
  sale's balance owes nothing and `salePaymentStatus` reads **Settled**; the
  derived DUE row vanishes from Income & Expense (Accrual). Profit & Loss
  already books *Sales returns* and *COGS returned*; the unit is back in stock
  in the same mutation.
- **QC visibility.** No screen lists units in QC across invoices; `/inbound`
  searches order code and supplier only (not the invoice number its placeholder
  names, not product or serial); there is no notification system.

## 1. Purge the test unit `FV29837462` — `deploy/macmini/ops/purge-unit`

A one-off owner decision like `ops/reset-transactions`, not a feature and not
a precedent for the never-delete rule.

- zsh, modelled on `ops/release-unit` / `ops/void-sale`: `setopt err_exit
  no_unset pipe_fail`; psql as the owner role `nusantara` via `etc/pgpass`;
  serial validated `^[A-Z0-9~-]+$`; **dry run by default**, `--apply` to write.
- Finds the unit by `serial = :serial` OR `serial LIKE :serial || '~ARSIP~%'`.
- **Refuses** (RAISE EXCEPTION) when the unit is on any `OrderItem`,
  `Unit.soldOrderItemId`, `ReservationItem`, `ReservationProposalItem`,
  `TradeIn`, `WarrantyClaim`, or a `UnitReturn` as `exchangeUnitId` of another
  unit. A test unit that reached any of those needs a person.
- Deletes, children first, inside ONE transaction: `UnitNotePhoto`, `UnitNote`,
  `ServiceFee`, `ServiceVisit`, `UnitEvent`, `UnitReturn`, `SupplierReturnItem`,
  `StockIn`, `StockAdjustment`, `OpnameScan`, `OpnameSurplus` (by serial),
  `UnitAttribute`, `PurchaseOrderItemSerial`, `ChatAction.unitId` → NULL, then
  `Unit`; and every `AuditLog` row whose `entityId` is the serial or one of the
  deleted rows' ids, or whose `before`/`after` contains the serial.
- **The invoice stays as it is** (owner answer): the `PurchaseOrderItem` row is
  kept, so the slot reads *waiting for a serial*.
- The dry run prints a count per table and ends in `ROLLBACK`. `--apply`
  previews the same way, runs `ops/backup before-purge-unit`, asks for the
  serial typed back on `/dev/tty`, then commits. The transaction ends with
  `TRUNCATE "StoreChange" RESTART IDENTITY`, so every open till rebases.
- Run: `sudo -u _nusantara /opt/nusantara/current/ops/purge-unit FV29837462`
  (dry run), then the same with `--apply`. It ships in the release like the
  other ops scripts.

## 2. Service

### Warehouses
- The **Bench** statistic card goes. Nothing in the web app picks a
  warehouse by `Location.kind === "SERVIS"` any more (`serviceLocationOf`
  callers on ServicePage, InboundDetailPage, InventoryPage).
- **Send to service** (one shared dialog, §4) asks *Where is it serviced?* —
  every active warehouse, default the unit's current one. A different
  warehouse asks the courier fee, as today, and moves the unit.
- **Back in stock** offers every active warehouse, default the visit's
  `fromLocationId`. The bench is no longer excluded, so the Select can never
  hold a value missing from its options.
- `CustomerReturnPage`'s `kind !== "SERVIS"` filter goes too (04 is a real
  warehouse).

### Charges
- The charge dialog gains **Paid with**: Bank (`TRANSFER`), Other bank
  (`TRANSFER_LUAR`), Cash (`TUNAI`), or **Not paid yet**.
- Paid → in the same mutation an `Expense` with `kind: UNIT`, the amount,
  method, `date` = the charge's day, `serviceFeeId` = the charge, note = serial
  and the charge's label. Not paid → no expense; the charge row shows a
  *Not paid* tag and a **Mark paid** button (asks the method and day, writes
  the expense).
- Editing a paid charge's amount edits its expense's amount; switching a paid
  charge to *Not paid yet* deletes its expense.
- **Delete a charge** (Popconfirm) removes the `ServiceFee` and its `Expense`,
  appends nothing, and drops the charge's timeline note (`DICATAT` written by
  `saveFee`, found by unit + `at === fee.at`) through `removeEvent`.
- Every charge — paid or not — still counts in `costOfUnit`. Profit & Loss
  is unchanged: `UNIT` is not in `OPERATING_KINDS`, so it is never counted
  twice. Income & Expense lists it under **Unit expense**; the category is
  declared in `mock/seed.ts` beside the others with `needsTransaction: false`
  and is NOT offered in Add adjustment (it is written only from a charge).
- Refused inside a closed book (`lib/bookClose.ts`, on the charge’s day), in the
  browser and in the adapter.

### Delete a whole visit
- A **Delete** on the visit row (two-layer confirm: dialog, then typing the
  serial). Removes every charge and its expense, the visit, and the visit's
  history rows: the send event (unit + `at === openedAt`, `toStatus SERVIS`),
  the charge notes, and the back-in-stock event (`at === closedAt`) when
  closed. Removal goes through the existing `removeEvent` path
  (`unit_event_drop`), so the projection falls back to the row before: an open
  visit's unit returns to the status and warehouse it had before it was sent.
- Refused when the unit has moved on since the visit (a later event that is
  not one of the visit's own), or the visit's day is in a closed book.
- If a send event cannot be found by its timestamp (a visit written by an
  older build at a different instant), the delete still removes the visit and
  its charges and says the history row was not found — never guesses.

## 3. Return to supplier, with the money

- Allowed for a unit in `QC`, `TERSEDIA` or `SERVIS` (not `DIRESERVASI`, not
  sold), from the Returns page, the QC row, and the ⋯ menus of §4 — one
  dialog, `components/SupplierReturnModal`.
- Fields: supplier (from the invoice), reason, **Credit** = `Unit.buy` by
  default, editable; beside it the unit's service charges total and a
  **+ Add service charges** button that adds it to the credit.
- **Rule C (owner answer):** the credit first comes off what the unit's
  invoice still has unpaid — `applied = min(credit, poTotals(po).owed)` —
  written as a `PoPayment` with method `RETUR_SUPPLIER`, `inBalance: false`,
  linked to the return (`unitReturnId`). The rest is the **refund**:
  - **Received into** Bank / Other bank / Cash → a `ManualIncome` with reason
    `REFUND` ("Refund received"), the method, linked to the return.
  - **Not paid by supplier yet** → nothing written; the return row shows
    *Awaiting refund Rp X* (`expectedCredit − applied − received`) and a
    **Mark received** button that writes the `ManualIncome`.
- `UnitReturn.expectedCredit` stores the credit. Returning a unit with an open
  service visit closes the visit (`closedAt`, no `toLocationId`).
- `RETUR_SUPPLIER` method: `accountOfMethod` answers `undefined` for it BY NAME
  (as `TRANSFER_LUAR`), `forPo: true`, `forSale: false`, not offered in any
  payment picker; Income & Expense does not list it (it moved no money).
- Undoing a supplier return (QC *Reopen*, or a cancel) voids the linked
  payment and removes an unreceived refund; a received refund is kept and the
  history says so, the rule customer returns follow (refund stays).

## 4. One dialog per action

- `components/SendToServiceModal` and `components/SupplierReturnModal`, used
  by: the `/inbound/:id` row (now for accepted units too, not only QC rows),
  Inventory's nested unit rows (new ⋯ menu beside *Price change* / *Edit
  unit*), the Service page, and the Returns page's *To supplier*.
- **Stock out** keeps only write-offs: the "On service" status option and its
  *Send to* select are removed from `OUT_STATUSES`/the batch editor; the
  *Reason* is the adjustment reason list alone, the *Units become* select
  remains for Lost / Damaged.
- Stock out's **Counted products** picker lists only variants with on-hand
  > 0 (`onHand` from `lib/stock.ts`), in the batch's warehouse when one is
  set. Stock in keeps every variant.

## 5. Unpaid sale, returned

- `salePaymentStatus` gains `UNPAID_RETURNED` and `PARTLY_PAID_RETURNED`: a
  sale with a RETUR adjustment whose debt the return cancelled. Unpaid,
  returned = nothing settled or pending ever recorded on it; Partly paid,
  returned = something was. Words: "Unpaid, returned" / "Partly paid,
  returned". Filter and CSV export carry them.
- Income & Expense (Accrual) keeps a row for the cancelled debt: the original
  DUE amount, struck through, status tag "Unpaid, returned", never counted in
  the running balance or the Cash/Bank cards. Derived from the RETUR
  adjustment's `debtCancelled` — nothing new is stored.
- Accounting unchanged: Profit & Loss's *Sales returns* and *COGS returned*
  lines already post the reversal; Receivable already reads 0.

## 6. Waiting for QC

- `/inbound` gets a **Waiting for QC** `ProTable` above the invoice list (hidden
  when empty): Product · Serial (or "no serial yet") · Invoice (code and
  supplier invoice number) · Supplier · Arrived · Days waiting. Rows = units in
  `QC` with a `poId`, plus invoice slots with no serial yet. Search covers
  product, SKU code, serial, order code and invoice number; a row opens
  `/inbound/:id`. `OrphanQcCard` stays for units with no invoice.
- The invoice list gets a **To QC** count column, and its search reads the
  invoice number (`searchValue` on the Order column) as its placeholder says.
- The nav leaf *Inbound & QC* shows a count badge of units waiting.

## 7. Schema — migration `20261026090000_service_charges_and_supplier_refunds`

Additive, owner-approved 2026-10-26:

- `ExpenseKind` += `UNIT`.
- `Expense.serviceFeeId String? @unique`, FK → `ServiceFee`, `onDelete:
  Restrict`.
- `Payment.unitReturnId String?` and `ManualIncome.unitReturnId String?`, FK →
  `UnitReturn`, `onDelete: Restrict`, indexed.
- `PaymentMethod` row `RETUR_SUPPLIER` ("Supplier return credit", `forPo`
  true, `forSale` false, `builtIn` true).
- `GRANT DELETE ON "ServiceVisit", "ServiceFee" TO nusantara_app` — nothing
  else. This REVERSES 2026-09-08's "a charge is edited, never removed"; the
  sixth sanctioned hard delete, do not generalise it.
- Store contract (`packages/store`): the links live on the money rows, not on
  the charge or the return — `expenses[].serviceFeeId?`, `incomes[].returnId?`,
  `pos[].payments[].returnId?`; adapters project and write them.
- `prisma generate` before typechecking `packages/db`; strip the known
  `Expense_orderId_idx` / `ManualIncome_orderId_idx` / `autoReply` noise from
  any generated diff.

## Testing

- Pure rules get unit tests: `lib/service.ts` (charge paid/unpaid → expense,
  visit deletion plan), the supplier-return split (rule C), the new sale
  statuses (`test/saleStatus.test.ts`), the QC-waiting list builder.
- Page tests for the shared dialogs from each door (same mutation result from
  Inventory ⋯, inbound row and Service page), Stock out without "On service",
  the counted picker filter, the Back-in-stock default.
- `packages/db/test/store.test.ts`: a charge deleted with its expense, a visit
  deleted with its events, a supplier return writing the RETUR_SUPPLIER
  payment and refund income, all committed as `nusantara_app`.
- `purge-unit` rehearsed on a seeded throwaway database: dry run counts,
  refusal on a sold unit, apply leaves no row naming the serial and the store
  loads and commits after it.
