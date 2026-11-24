# Unit value write-down (Penurunan harga barang) — design

2026-11-24. Branch `michellawidatech/unit-writedown`, off `v2026.11.24.2`.

## Intent

> *"Now the modal price cannot be edited, but it can go down in valuation. For
> example, it might decrease by 500k because it has been broken while they
> still store it. And this 500k minus will get into 'penurunan harga barang'
> expense category, it will not decrease any bank balance or shopee or cash,
> but it will get into the PnL. When we click that unit we shall be able to
> see which unit is the value going down, the reason, and the amount. This
> only decreases the modal price and adds it to PnL but not to transaction."*

A unit that loses value while the shop still holds it (a cracked screen, a
dead port) is worth less than it cost. Today its COGS (harga modal) can only
grow — invoice price, its share of the invoice's expenses, repairs — so the
loss surfaces only at the sale, as a thin margin nobody can explain. A
write-down records the loss the day it happens, with its reason, and the
unit's COGS drops by that amount.

## Goals

- From Inventory, staff lower one unit's COGS by an amount, with a reason
  and a date.
- The unit's COGS everywhere — Inventory's COGS column and range, the "i"
  breakdown, the till's margin, HPP when it sells — is the lowered figure.
  (Export stock prints `Unit.buy` and no COGS today; it is unchanged.)
- Profit & Loss carries a **Penurunan harga barang** line in the month of the
  write-down; its items name the unit (product + serial), the reason and the
  amount.
- Clicking the unit's "i" shows each write-down: amount, reason, date, who.
- A mistaken write-down is corrected or removed (owner choice **A**) while
  the unit is still held.

## Non-goals

- No money moves: nothing on Income & Expense, the Cash/Bank/Shopee
  balances, Reconciliation, Transaction History or Receivable/Payable.
- The **sell price** is untouched. Repricing is still *Price change* /
  *Set price*.
- `Unit.buy` (the supplier's invoice line) is untouched — the invoice and the
  unit must keep agreeing.
- Counted products (accessories, no `Unit` rows) are out: their cost is a
  moving average over `StockMove`, and a damaged piece is already a Stock out.
- No bulk write-down of a whole line.
- Not on the S/N history timeline (no `UnitEvent`) — see Approaches.

## Anti-goals

- A write-down must never be counted twice in P&L: once on its own line and
  again as a smaller HPP is correct (that is the point — the loss moves from
  the sale's month to the damage's month); the same loss on its own line in
  two months, or both on the line and in full HPP, is the failure.
- A past month's P&L must not shift because somebody edited a write-down of a
  unit that has since sold.

## Constraints

- New schema needs owner approval (CLAUDE.md) — this design asks for it.
- Money is `BigInt` whole rupiah, a string on the wire.
- No JSON columns; every link an FK with an explicit `onDelete`.
- Every user-facing string through `t()` with Indonesian in `id.ts`.
- Delete is a hard delete — the twelfth sanctioned one, scoped to this table.
- Approving this document approves the `UnitWriteDown` table and its
  migration (the owner's schema sign-off).

## Approaches

1. **A table of its own, `UnitWriteDown`, read into the cost** (chosen). One
   row per write-down. `costBreakdown`/`costIndex` (`lib/service.ts`) gain a
   `writeDown` part, so every reader of COGS follows without being touched;
   P&L reads the table for its line. Visible to every account, because COGS
   must be the same figure for everybody.
2. **An `Expense` of a new kind with a "no pot" method** (like the
   trade-in offset). Rejected: an expense must name a `PaymentMethod`, is
   listed on Income & Expense (the owner said "not to transaction"), sits in
   reconciliation's way, and `expenses` is a FINANCE collection withheld from
   staff without finance access — they would see a different COGS for the
   same unit.
3. **Lower `Unit.buy`.** Rejected: `Unit.buy` is what the supplier's invoice
   says; rewriting it breaks invoice totals and the "what it COST" fact, and
   leaves no reason or P&L line.
4. **A `UnitEvent` (`DICATAT`) carrying the amount.** Rejected: an event has
   no amount column, the ledger is not where money lives, and correcting one
   means deleting ledger rows.

Owner choice on corrections: **A — editable and deletable while the unit is
held**, locked once it has left (sold, written off, returned to supplier).
Chosen over B (immutable, corrected by a write-up) under the 2026-10-22 rule
"mistakes are corrected, not appended around".

Who may record one: **any signed-in staff** (my call — Edit unit and Set price
are open to all, and each row records who). The owner can narrow it to
finance access later.

## Design

### Schema — migration `20261124090000_unit_write_down`

```prisma
model UnitWriteDown {
  id        String   @id @default(cuid())
  unitId    String
  /// Whole rupiah, > 0. What the unit's COGS is lowered by.
  amount    BigInt
  /// Why — "Layar retak", "Port USB-C mati". Required, trimmed, non-empty.
  reason    String
  /// YYYY-MM-DD, the day the value was lost; decides the P&L month.
  date      String
  staffId   String
  createdAt DateTime
  updatedAt DateTime

  unit  Unit  @relation(fields: [unitId], references: [id], onDelete: Restrict)
  staff Staff @relation(fields: [staffId], references: [id], onDelete: Restrict)

  @@index([unitId])
}
```

- CHECKs: `amount > 0`, `length(btrim(reason)) > 0`,
  `date ~ '^\d{4}-\d{2}-\d{2}$'`.
- Grants: `nusantara_app` SELECT, INSERT, UPDATE, DELETE on `UnitWriteDown`
  only. `nusantara_agent` nothing. A DO block refuses if `nusantara_app`
  gains anything else by it. The deploy's `t|f|t|f|t` grant query reads no
  privilege of this table.

### Store contract (`packages/store`)

- Collection `writeDowns: spec("id")`, NOT in `FINANCE_COLLECTIONS`.
- Row: `{ id, serial, amount: money string, reason, date, staffId,
  createdAt, updatedAt }`. `serial` is how the browser names the unit (as
  `unitNotes` does); the server stores `unitId` and projects `serial` from
  the unit, so a serial rename is carried for free on Postgres.

### Adapter (`packages/db/src/store/adapters/units.ts`, beside `unitNotes`)

- Insert / update / remove, each re-checking against the DATABASE:
  - the unit exists and its status is held — `QC`, `TERSEDIA`,
    `DIRESERVASI` or `SERVIS`; otherwise refused ("the unit has left the
    shop");
  - for update / remove, the row is not LOCKED: no `UnitEvent` of the unit
    after the row's `createdAt` moved it out of the shop (to `TERJUAL`,
    `HILANG`, `KOREKSI_KELUAR` or `RETUR_SUPPLIER`). A unit that left and
    came back (customer return, found again, buy-back) is held again, but
    its earlier write-downs stay locked — they are already in a past month's
    HPP;
  - an update may change `amount`, `reason`, `date` only (not the unit,
    not `staffId`/`createdAt`);
  - amount > 0, reason non-empty (the CHECKs are the second guard).
- The server does NOT check "not below zero": it does not know the expense
  share. The browser does (below).
- `ctx.touch("writeDowns", id)` on each write; a unit rename touches its
  write-downs so every till redraws them.
- Register in `adapters/index.ts`.

### Cost (`apps/web/src/lib/service.ts`)

- `UnitCost` gains `writeDown: number` (positive, the sum);
  `total = buy + shippingTax + repair − writeDown`.
- `CostSources` gains `writeDowns`. `costBreakdown` and `costIndex` sum the
  unit's write-downs **since its latest buy-back** — the same `since` rule
  repairs already use, so a unit sold and bought back starts clean. This is
  the CURRENT cost: Inventory, the "i", the till's margin, `recommend.ts`.
- **A sale's HPP counts only the write-downs made before that sale** (my
  call, from the builder check). P&L recomputes every past sale's cost from
  today's data (`soldPieces`, `stockWriteOffs`, `cogsBack` in
  `profitLoss.ts`), so "since the latest buy-back" would give an old sale its
  write-downs back the day the unit is bought back — the loss would then sit
  on its own line AND in full HPP, i.e. counted twice. Add
  `writeDownBefore(serial, from, until)` (lib/writeDown.ts): the sum of the
  unit's rows with `createdAt` in `(from, until]`, where `until` is the
  event's instant and `from` the unit's previous buy-back before it (or the
  beginning). P&L's three cost readers take the write-down part from it
  instead of from `costIndex`'s current figure: cost = `costIndex(u).total
  + costIndex(u).writeDown − writeDownBefore(…)`. A unit lost after a
  write-down is lost at the lowered cost — no double count. Repairs keep
  today's behaviour; fixing that for them is out of scope.
- Callers that need a small edit once the shapes grow: `serialTracker.ts`
  (builds `CostSources` by hand) and `routes/stock/StockOutPage.tsx` (writes
  a `UnitCost` literal) — both add the write-down part.
- The server's `Order.cogs` is written from `Unit.buy` alone today and stays
  so — P&L does not read it.

### Rules (`apps/web/src/lib/writeDown.ts`, pure, tested)

- `writeDownBlock(unit)`: `"LEFT"` unless the unit's status is held.
- `rowLocked(row, events)`: true once an exit event of the unit follows the
  row's `createdAt` — the same rule the adapter checks.
- `writeDownProblem(amount, reason, costBefore)`: `"AMOUNT"` if ≤ 0,
  `"REASON"` if blank, `"BELOW_ZERO"` if `amount > costBefore` — where
  `costBefore` is the unit's COGS without THIS row (so editing a row checks
  against the cost before it).
- `writeDownsOf(serial, db)`: the unit's rows since its buy-back, newest
  first.

### UI

- **Record** — Inventory's unit ⋯ menu gains **Lower COGS** (*Turunkan
  harga modal*), drawn only while the unit is held. It opens
  `components/WriteDownModal.tsx`:

  ```
  Lower the COGS of C02XK1ABJG5J
  MacBook Air 13" M1 8/256 · Grade B

  Current COGS              Rp 9.200.000
  Lower by   [ Rp 500.000          ]
  Reason     [ Layar retak di pojok kiri ]
  Date       [ 24/11/2026 ]
  ─────────────────────────────────────
  New COGS                  Rp 8.700.000
                       [Cancel] [Save]
  ```

  Amount, reason and date are required (date defaults to today); Save is grey
  until valid; one `mutate` inserts the row.
- **See** — the "i" popover (`CostBreakdown`) gains a line
  **Penurunan harga barang −Rp 500.000** above COGS, and under the divider
  a list of the unit's write-downs: date · amount · reason · who. Each row
  has **Edit** (the same modal, prefilled) and **Delete** (Popconfirm) while
  the unit is held; neither is drawn once it has left. The COGS cell in
  Inventory's unit table draws a small red ↓ beside a written-down figure so
  the unit can be spotted without opening anything.
  `CostInfoButton` needs `serial`'s rows; it takes them from the store.
  ⚠️ The Popover sits inside Inventory's nested table; the modal opens at
  `zIndex 1100` like `UnitEditModal`.
  `CostInfoButton` is also drawn in `PriceEditorModal`; there it lists the
  write-downs read-only — Edit / Delete only on Inventory (an `editable`
  prop).
- **P&L** — `profitLoss` gains a line `writeDown` in **Biaya lain-lain**
  (other expenses), after `stockAdjust`: label *Penurunan harga barang* /
  *Unit value write-downs*. Items: `date` = the row's date, `ref` = the
  serial, `description` = `"{product} · {reason}"`, `amount` = the amount.
  The month is the row's `date` (local day, as an expense's).
  Edited after the sale? Impossible — a row is locked by the first exit
  after it (see the adapter), and a sale counts only rows before it, which
  together keep a past month still.

### Browser bits that rewrite serials

Every place that renames a serial in the browser rewrites
`writeDowns[].serial` in the same mutation: `UnitEditModal`'s correction,
`lib/unitRename.ts` (`renameUnitSerial`, used by stock opname) and
`InboundDetailPage`'s own `renameUnit`.

### Seed & tests

- `MockDb.writeDowns: []` in `mock/seed.ts`; the fixture seeds none.
- `test/writeDown.test.ts` — rules, cost with/without, buy-back reset,
  below-zero against cost-before-this-row on edit.
- `test/profitLoss.test.ts` — the line, its month, and HPP of a later sale
  at the lowered cost (sum of the two equals the unlowered HPP); a sale,
  a buy-back and a second write-down leave the first sale's HPP unchanged;
  a customer return leaves the pre-sale row locked.
- `test/writeDownPage.test.tsx` — record from the ⋯, see it in the "i",
  edit, delete, buttons gone on a sold unit.
- `packages/db/test/store.test.ts` — insert, update, remove, refused on a
  sold unit, refused an edit of `unitId`; `invariants.test.ts` — the grants
  as `nusantara_app`.
- i18n: every string in `id.ts`.

## What is left to the builder

- Icon for the ⋯ entry and the ↓ marker; exact column widths.
- Whether the P&L item `ref` links to the serial popup (`SerialLink`) if the
  P&L items table already supports links.
- CLAUDE.md entry once built.
