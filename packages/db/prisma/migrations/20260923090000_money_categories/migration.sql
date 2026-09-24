-- The adjustment categories the owner named (2026-09-23).
--
-- Income & Expense stopped being one "Type" column carrying a category and a
-- method glued together, and became Type (income or expense) · Category ·
-- Method. The categories are the owner's own list, and five of them had no
-- enum value to be written under:
--
--   income   Interest (bunga), Balance mismatch
--   expense  Interest, Balance mismatch, Customer compensation,
--            Supplier payment, Bank transfer
--
-- "Supplier payment" and "Bank transfer" exist as EXPENSE kinds although the
-- page also DERIVES supplier-payment rows from `Payment`: a payment against
-- an invoice is derived, and a payment somebody records by hand — an old debt
-- settled outside any invoice — needs somewhere to live under the same name.
--
-- PROFESSIONAL and SOFTWARE stay in the type although the picker no longer
-- offers them (owner's list). Rows written under them still read back; only
-- new ones cannot be made. Removing a value from a Postgres enum means
-- rebuilding the type, which is not worth doing to hide two options.
ALTER TYPE "IncomeReason" ADD VALUE IF NOT EXISTS 'BUNGA';
ALTER TYPE "IncomeReason" ADD VALUE IF NOT EXISTS 'SELISIH';

ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'BUNGA';
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'SELISIH';
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'KOMPENSASI';
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'SUPPLIER';
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'TRANSFER';

-- The transaction an adjustment is about (owner ask 2026-09-23).
--
-- Four of the categories mean nothing on their own: a customer compensation,
-- a refund in either direction and an off-app sale are all *about* a
-- particular receipt, and a figure with no receipt beside it cannot be
-- reconciled against one. Nullable, because the other categories name none —
-- an account transfer, interest, a balance mismatch.
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "ManualIncome" ADD COLUMN IF NOT EXISTS "orderId" TEXT;

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualIncome"
  ADD CONSTRAINT "ManualIncome_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Expense_orderId_idx" ON "Expense"("orderId");
CREATE INDEX IF NOT EXISTS "ManualIncome_orderId_idx" ON "ManualIncome"("orderId");

-- A method that settles a debt and moves neither pot (owner ask 2026-09-23):
--
-- > *"Add payment method: Transfer from other bank for expense/deposit to
-- > supplier, which does not reduce the bank balance in the POS."*
--
-- The owner pays a supplier from an account this app does not keep. The
-- invoice has to read as settled and the balance must not move, and those two
-- are exactly what a method with NO pot gives: `accountOfMethod` in
-- `lib/accounts.ts` names it and answers undefined, so every balance skips it
-- while every debt screen counts it.
--
-- `forSale` is false: a customer does not pay the shop out of the shop's own
-- other account.
INSERT INTO "PaymentMethod" ("id", "code", "label", "builtIn", "forPo", "forSale", "active", "sortOrder", "createdAt")
SELECT 'pm_transfer_luar', 'TRANSFER_LUAR', 'Transfer from another bank', true, true, false, true,
       COALESCE((SELECT MAX("sortOrder") FROM "PaymentMethod"), 0) + 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" WHERE "code" = 'TRANSFER_LUAR');

-- Tills already open learn it on their next poll rather than at their next
-- reload (docs/store-on-postgres.md, Concurrency).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'paymentMethods', "id" FROM "PaymentMethod" WHERE "code" = 'TRANSFER_LUAR';
