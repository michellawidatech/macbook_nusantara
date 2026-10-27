-- ===========================================================================
-- Service charges become money, and a supplier return carries its credit
-- (owner, 2026-10-26 — docs/superpowers/specs/2026-10-26-service-returns-qc-
-- design.md §7). Additive.
--
-- 1. A service charge that was PAID is an `Expense` of kind UNIT, linked to
--    the charge (`Expense.serviceFeeId`, one expense per charge at most). It
--    is already in the unit's cost (`costOfUnit` adds every visit's fees), so
--    Profit & Loss keeps UNIT out of operating expenses — it is listed on
--    Income & Expense and counted nowhere twice.
--
-- 2. A supplier return's credit first comes off what the unit's invoice still
--    owes — a `Payment` with method RETUR_SUPPLIER and `inBalance = false` —
--    and the rest, once the supplier refunds it, is a `ManualIncome` of reason
--    REFUND. Both name the return (`unitReturnId`), so undoing the return
--    voids exactly those rows rather than guessing.
--
-- 3. A charge can be removed, and a whole visit deleted. This REVERSES
--    2026-09-08's "a charge is edited, never removed" and is the SIXTH
--    sanctioned hard delete — `nusantara_app` gets DELETE on "ServiceVisit"
--    and "ServiceFee" and nothing else. Do not generalise it. The store
--    adapter refuses a charge whose expense is still standing, and a day
--    inside a closed book (`finance.booksClosedAt`).
-- ===========================================================================

-- Inside the migration's transaction: PostgreSQL 12+ allows ADD VALUE there
-- as long as nothing in the same transaction USES the value, and nothing here
-- does.
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'UNIT';

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "serviceFeeId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "unitReturnId" TEXT;
ALTER TABLE "ManualIncome" ADD COLUMN IF NOT EXISTS "unitReturnId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Expense_serviceFeeId_key" ON "Expense"("serviceFeeId");
CREATE INDEX IF NOT EXISTS "Payment_unitReturnId_idx" ON "Payment"("unitReturnId");
CREATE INDEX IF NOT EXISTS "ManualIncome_unitReturnId_idx" ON "ManualIncome"("unitReturnId");

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_serviceFeeId_fkey"
  FOREIGN KEY ("serviceFeeId") REFERENCES "ServiceFee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_unitReturnId_fkey"
  FOREIGN KEY ("unitReturnId") REFERENCES "UnitReturn"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualIncome"
  ADD CONSTRAINT "ManualIncome_unitReturnId_fkey"
  FOREIGN KEY ("unitReturnId") REFERENCES "UnitReturn"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The method a supplier-return credit is written with. It moved no money —
-- `lib/accounts.ts` gives it no pot BY NAME, as it does TRANSFER_LUAR — and
-- no payment picker offers it: only the return dialog writes it. `forSale`
-- is false: a customer's return is credited on the sale, not as a payment.
INSERT INTO "PaymentMethod" ("id", "code", "label", "builtIn", "forPo", "forSale", "active", "sortOrder", "createdAt")
SELECT 'pm_retur_supplier', 'RETUR_SUPPLIER', 'Supplier return credit', true, true, false, true,
       COALESCE((SELECT MAX("sortOrder") FROM "PaymentMethod"), 0) + 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" WHERE "code" = 'RETUR_SUPPLIER');

-- Tills already open learn it on their next poll (docs/store-on-postgres.md).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'paymentMethods', "id" FROM "PaymentMethod" WHERE "code" = 'RETUR_SUPPLIER';

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

GRANT DELETE ON "ServiceVisit", "ServiceFee" TO nusantara_app;

-- The grant is these two tables and nothing beside them: the ledger and the
-- unit stay undeletable (the deploy's `t|f|t|f|t` reads the same), and the
-- agent role gets nothing.
DO $check$
BEGIN
  IF NOT has_table_privilege('nusantara_app', '"ServiceVisit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"ServiceFee"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"ServiceVisit"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"ServiceFee"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'DELETE')
     OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
         AND (has_table_privilege('nusantara_agent', '"ServiceVisit"', 'DELETE')
              OR has_table_privilege('nusantara_agent', '"ServiceFee"', 'DELETE'))) THEN
    RAISE EXCEPTION 'service delete grants are not what 20261026090000 says they are';
  END IF;
END
$check$;
