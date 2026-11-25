# Unit value write-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff lower a held unit's COGS by an amount with a reason; the loss shows on Profit & Loss as *Penurunan harga barang*, no money moves.

**Architecture:** A new table `UnitWriteDown` carried by the store as collection `writeDowns` (not a finance collection). `costIndex`/`costBreakdown` subtract the write-downs since the last buy-back; P&L costs each past event with only the write-downs made before it, and lists the write-downs on their own line.

**Tech Stack:** Prisma/PostgreSQL, Zod store contract, React + antd 6, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-unit-write-down-design.md`

## Global Constraints

- Money is BigInt whole rupiah on the server, a string on the wire, a number in the browser.
- Every user-facing string through `t("key", "English")` with Indonesian in `apps/web/src/i18n/locales/id.ts`.
- Held statuses: `QC`, `TERSEDIA`, `DIRESERVASI`, `SERVIS`. Exit statuses: `TERJUAL`, `HILANG`, `KOREKSI_KELUAR`, `RETUR_SUPPLIER`.
- `nusantara_app` gets SELECT, INSERT, UPDATE, DELETE on `UnitWriteDown` only; `nusantara_agent` nothing.
- Label: *Penurunan harga barang* (id) / *Unit value write-downs* (en); menu entry *Lower COGS* / *Turunkan harga modal*.

## Review Focus

- A write-down larger than the unit's current COGS → refused ("below zero"), checked against the cost WITHOUT the row being edited.
- A write-down on a unit sold, bought back and written down again → the first sale's HPP unchanged (test in Task 2).
- A unit renamed (Inventory Edit unit, opname match, Inbound QC) → its write-downs follow (Task 3 asserts renameUnitSerial; Inbound's renameUnit edited the same way).
- An account without finance access → still sees the same COGS (collection not in FINANCE_COLLECTIONS; Task 1).
- Date in the future → refused by the modal (DatePicker disables days after today).

---

### Task 1: Schema, migration, store contract, adapter

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `UnitWriteDown`, back-relations on `Unit` and `Staff`)
- Create: `packages/db/prisma/migrations/20261125090000_unit_write_down/migration.sql`
- Modify: `packages/store/src/collections.ts` (`writeDowns: spec("id")` after `unitNotes`)
- Modify: `packages/store/src/schemas.ts` (row `writeDown`, in `rows` and `db`)
- Modify: `packages/db/src/store/adapters/units.ts` (adapter `writeDowns`), `adapters/index.ts`
- Test: `packages/db/test/store.test.ts`

**Interfaces — Produces:** wire row `{ id, serial, amount: money, reason, date: day, staff: text, createdAt: instant, updatedAt: instant }`.

- [ ] Adapter rules: insert/update/remove refused unless the unit is held; update/remove refused when an exit event of the unit is dated after the row's `createdAt`; update may not change `serial` except by a rename of the same unit; `ctx.touch("writeDowns", id)`.
- [ ] DB tests: insert projects back; refused on a TERJUAL unit; remove refused after a sale event; update amount/reason ok.
- [ ] Migration: table, FK `unitId` → Unit RESTRICT, `staffId` → Staff RESTRICT, index, CHECKs (amount > 0, reason non-blank, date shape), grants.

### Task 2: Cost and P&L

**Files:**
- Create: `apps/web/src/lib/writeDown.ts` — `HELD_STATUSES`, `writeDownBlock(status)`, `rowLocked(row, events)`, `writeDownProblem(amount, reason, costBefore)`, `writeDownsOf(serial, db)`, `writeDownAt(rows, events)` → `(serial, at) => number`.
- Modify: `apps/web/src/lib/service.ts` — export `isBuyBack`; `UnitCost.writeDown`; `CostSources.writeDowns` (optional); `costParts` subtracts.
- Modify: `apps/web/src/lib/profitLoss.ts` — sold/returned/lost costs use `cost.total + cost.writeDown − at(serial, eventAt)`; line `writeDown` in `otherExpense` after `stockAdjust`.
- Modify: `apps/web/src/mock/seed.ts` (`WriteDown` type, `MockDb.writeDowns`, `[]` in seeds), `mock/store.ts` empty db, `serialTracker.ts`, `StockOutPage.tsx` literal.
- Test: `apps/web/test/writeDown.test.ts`, `apps/web/test/profitLoss.test.ts`.

### Task 3: UI

**Files:**
- Create: `apps/web/src/components/WriteDownModal.tsx`
- Modify: `apps/web/src/components/CostBreakdown.tsx` (write-down line + list; `editable` Edit/Delete)
- Modify: `apps/web/src/routes/stock/InventoryTable.tsx` (⋯ entry, ↓ marker, modal state)
- Modify: `apps/web/src/lib/unitRename.ts`, `routes/inbound/InboundDetailPage.tsx` (renames), P&L page label, `id.ts`
- Test: `apps/web/test/writeDownPage.test.tsx`

### Task 4: Docs and release

- [ ] CLAUDE.md entry; full web/db suites; format; lint; tag.
