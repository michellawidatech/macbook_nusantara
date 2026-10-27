-- ===========================================================================
-- A POS entry the bank never saw is paired or explained before a month closes
-- (owner-approved 2026-10-27). Additive: one table, one function, nothing
-- backfilled.
--
-- The monthly reconciliation lists "In the POS, not on the statement": money
-- the POS says went through the bank that the e-statement does not show. Until
-- now a month could be marked reconciled with that list still full. From this
-- migration a month is reconciled only once each of those movements is paired
-- with a statement line or SET ASIDE with a note saying why the bank never saw
-- it — and the note is kept, with who wrote it and when.
--
-- 1. "ReconciliationAside" — one note against one money row: a "Payment",
--    an "Expense", a "ManualIncome" or a "SupplierDeposit", exactly one
--    (CHECK, as "ReconciliationEdit" and "BankStatementMatch"). It belongs to
--    a MONTHLY reconciliation; that is a fact about another row, held by the
--    adapter, as the statement lines' own "monthly only" is.
--
-- 2. Taken back by stamping "withdrawnAt", never by a delete. An aside is
--    withdrawn by Undo, and by the app itself when the movement is paired
--    later. At most one ACTIVE aside per (reconciliation, money row): four
--    partial unique indexes, one per reference column, which Prisma cannot
--    declare (schema.prisma says so beside the model). A withdrawn aside stays
--    as history and does not count.
--
-- 3. Grants. nusantara_app: SELECT and INSERT, and UPDATE on "withdrawnAt"
--    ALONE — what an aside says, against what and by whom is written once. No
--    DELETE, no TRUNCATE; nothing for nusantara_agent.
--
-- 4. reconciliation_aside_drop(text[]) — a SECURITY DEFINER function, the
--    app's one door to a DELETE on the table (the pattern of
--    reconciliation_edit_drop, 20261027170000). Every foreign key here is
--    RESTRICT (schema.prisma: SetNull would silently erase history), so an
--    aside would otherwise keep an Income & Expense adjustment from ever being
--    deleted. The adapter refuses that delete while an ACTIVE aside on a
--    reconciliation that is not OPEN names the row ("reopen it first"),
--    withdraws an active one on an OPEN reconciliation, and then drops the
--    aside through this function — which refuses any aside not withdrawn.
--    Part of the eighth sanctioned hard delete; do not generalise it.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.
-- ===========================================================================

-- CreateTable
CREATE TABLE "ReconciliationAside" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "depositId" TEXT,
    "note" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationAside_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationAside_reconciliationId_idx" ON "ReconciliationAside"("reconciliationId");

-- CreateIndex
CREATE INDEX "ReconciliationAside_paymentId_idx" ON "ReconciliationAside"("paymentId");

-- CreateIndex
CREATE INDEX "ReconciliationAside_expenseId_idx" ON "ReconciliationAside"("expenseId");

-- CreateIndex
CREATE INDEX "ReconciliationAside_incomeId_idx" ON "ReconciliationAside"("incomeId");

-- CreateIndex
CREATE INDEX "ReconciliationAside_depositId_idx" ON "ReconciliationAside"("depositId");

-- CreateIndex
CREATE INDEX "ReconciliationAside_staffId_idx" ON "ReconciliationAside"("staffId");

-- AddForeignKey
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "ManualIncome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "SupplierDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- What the adapter holds, held by the database too.
-- ---------------------------------------------------------------------------

ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_one_ref_check" CHECK (
  num_nonnulls("paymentId", "expenseId", "incomeId", "depositId") = 1
);
ALTER TABLE "ReconciliationAside" ADD CONSTRAINT "ReconciliationAside_note_check" CHECK (
  btrim("note") <> ''
);

-- One ACTIVE aside per reconciliation and money row.
CREATE UNIQUE INDEX "ReconciliationAside_payment_active_key"
  ON "ReconciliationAside"("reconciliationId", "paymentId")
  WHERE "withdrawnAt" IS NULL AND "paymentId" IS NOT NULL;
CREATE UNIQUE INDEX "ReconciliationAside_expense_active_key"
  ON "ReconciliationAside"("reconciliationId", "expenseId")
  WHERE "withdrawnAt" IS NULL AND "expenseId" IS NOT NULL;
CREATE UNIQUE INDEX "ReconciliationAside_income_active_key"
  ON "ReconciliationAside"("reconciliationId", "incomeId")
  WHERE "withdrawnAt" IS NULL AND "incomeId" IS NOT NULL;
CREATE UNIQUE INDEX "ReconciliationAside_deposit_active_key"
  ON "ReconciliationAside"("reconciliationId", "depositId")
  WHERE "withdrawnAt" IS NULL AND "depositId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

-- Revoked FIRST: revoking a table-level privilege takes the same privilege off
-- every column, so the column grant has to come after it.
REVOKE UPDATE, DELETE, TRUNCATE ON "ReconciliationAside" FROM nusantara_app;
GRANT SELECT, INSERT ON "ReconciliationAside" TO nusantara_app;
GRANT UPDATE ("withdrawnAt") ON "ReconciliationAside" TO nusantara_app;

-- ---------------------------------------------------------------------------
-- The one door to removing an aside.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reconciliation_aside_drop(ids text[]) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  offending text;
  removed integer;
BEGIN
  SELECT a.id INTO offending
    FROM "ReconciliationAside" a
   WHERE a.id = ANY(ids)
     AND a."withdrawnAt" IS NULL
   LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Catatan rekonsiliasi % masih berlaku — batalkan dulu.', offending
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM "ReconciliationAside" WHERE id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION reconciliation_aside_drop(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation_aside_drop(text[]) TO nusantara_app;

-- ---------------------------------------------------------------------------
-- Refuse to finish if the database says anything else.
-- ---------------------------------------------------------------------------

DO $check$
BEGIN
  IF NOT has_table_privilege('nusantara_app', '"ReconciliationAside"', 'SELECT')
     OR NOT has_table_privilege('nusantara_app', '"ReconciliationAside"', 'INSERT')
     OR NOT has_column_privilege('nusantara_app', '"ReconciliationAside"', 'withdrawnAt', 'UPDATE')
     OR NOT has_function_privilege('nusantara_app', 'reconciliation_aside_drop(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'reconciliation aside: nusantara_app cannot do what the store needs';
  END IF;
  IF has_table_privilege('nusantara_app', '"ReconciliationAside"', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"ReconciliationAside"', 'note', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"ReconciliationAside"', 'expenseId', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"ReconciliationAside"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"ReconciliationAside"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'reconciliation aside: an aside is rewritable or deletable beyond its door';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
     AND (has_table_privilege('nusantara_agent', '"ReconciliationAside"', 'SELECT')
          OR has_table_privilege('nusantara_agent', '"ReconciliationAside"', 'INSERT')
          OR has_function_privilege('nusantara_agent', 'reconciliation_aside_drop(text[])', 'EXECUTE')) THEN
    RAISE EXCEPTION 'reconciliation aside: nusantara_agent reaches the table';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'reconciliation aside: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
