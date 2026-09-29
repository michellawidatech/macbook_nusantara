-- Refund adjustments in both directions (owner ask 2026-09-21):
--
-- A return's cash movement is recorded as an adjustment tagged "Refund" so
-- Income & Expense's single table can show it beside every other movement.
-- Two categories, one per direction: EXPENSE.REFUND when the shop hands money
-- back on a plain return or a cheaper exchange, INCOME.REFUND when the
-- customer pays extra on a dearer exchange. The RETUR adjustment on the sale
-- is unchanged and still says a unit came back; this pair says where the
-- rupiah went.
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "IncomeReason" ADD VALUE IF NOT EXISTS 'REFUND';
