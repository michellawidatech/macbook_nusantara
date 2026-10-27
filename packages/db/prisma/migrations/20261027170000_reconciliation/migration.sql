-- ===========================================================================
-- Reconciliation (owner ask 2026-10-27, answers "1B 2B 3B 4A" — docs/
-- superpowers/specs/2026-10-27-reconciliation-design.md). Additive.
--
-- 1. "Reconciliation" — a DAILY count of one pot (the bank balance, the
--    counted drawer) or a MONTHLY match of the bank against its e-statement.
--    One per (kind, pot, periodStart): reconciling a day again rewrites it.
--    "posBalance" is the POS figure as it was when it was saved; the page
--    reads "changed since reconciled" by comparing it with today's, so
--    nothing else is stored for that.
--
-- 2. "ReconciliationEdit" — what a reconciliation corrected on a real record
--    (EDITED, before → after) or added (ADDED). Exactly one money row: a
--    "Payment" (sale payment, refund, old-debt payment, supplier payment),
--    an "Expense", a "ManualIncome" or a "SupplierDeposit".
--
-- 3. "BankStatementLine" + "BankStatementMatch" — the e-statement's lines,
--    signed whole rupiah (a debit is negative; the sen are checked when the
--    file is read and not carried), and what each is paired with.
--
-- 4. Grants. nusantara_app: SELECT, INSERT, UPDATE on all four. DELETE on
--    "BankStatementLine" and "BankStatementMatch" ONLY — re-uploading a month
--    replaces its lines and their matches; the corrections already written
--    stay. This is the EIGHTH sanctioned hard delete. Do not generalise it.
--    No TRUNCATE; nothing for nusantara_agent.
--
-- 5. reconciliation_edit_drop(text[]) — a SECURITY DEFINER function, the
--    app's one door to a DELETE on "ReconciliationEdit" (the pattern of
--    unit_event_drop, 20261022140000). An Income & Expense adjustment is not
--    deletable while a reconciliation that is not OPEN names it ("reopen the
--    reconciliation first"); once it is reopened the delete must work, and
--    the edit's foreign key (RESTRICT) would otherwise stop it. The function
--    refuses any edit whose reconciliation is not OPEN.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "ReconKind" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReconPot" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('OPEN', 'MATCHED', 'ADJUSTED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'SUGGESTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReconEditAction" AS ENUM ('EDITED', 'ADDED');

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "kind" "ReconKind" NOT NULL,
    "pot" "ReconPot" NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "posBalance" BIGINT NOT NULL,
    "actualBalance" BIGINT NOT NULL,
    "statementOpening" BIGINT,
    "statementClosing" BIGINT,
    "statementFile" TEXT,
    "status" "ReconStatus" NOT NULL,
    "note" TEXT,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationEdit" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "depositId" TEXT,
    "action" "ReconEditAction" NOT NULL,
    "before" BIGINT,
    "after" BIGINT NOT NULL,
    "staffId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance" BIGINT,
    "status" "StatementLineStatus" NOT NULL,
    "note" TEXT,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementMatch" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "incomeId" TEXT,
    "depositId" TEXT,
    "reason" TEXT NOT NULL,

    CONSTRAINT "BankStatementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reconciliation_staffId_idx" ON "Reconciliation"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_kind_pot_periodStart_key" ON "Reconciliation"("kind", "pot", "periodStart");

-- CreateIndex
CREATE INDEX "ReconciliationEdit_reconciliationId_idx" ON "ReconciliationEdit"("reconciliationId");

-- CreateIndex
CREATE INDEX "ReconciliationEdit_paymentId_idx" ON "ReconciliationEdit"("paymentId");

-- CreateIndex
CREATE INDEX "ReconciliationEdit_expenseId_idx" ON "ReconciliationEdit"("expenseId");

-- CreateIndex
CREATE INDEX "ReconciliationEdit_incomeId_idx" ON "ReconciliationEdit"("incomeId");

-- CreateIndex
CREATE INDEX "ReconciliationEdit_depositId_idx" ON "ReconciliationEdit"("depositId");

-- CreateIndex
CREATE INDEX "ReconciliationEdit_staffId_idx" ON "ReconciliationEdit"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_reconciliationId_lineNo_key" ON "BankStatementLine"("reconciliationId", "lineNo");

-- CreateIndex
CREATE INDEX "BankStatementMatch_lineId_idx" ON "BankStatementMatch"("lineId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_paymentId_idx" ON "BankStatementMatch"("paymentId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_expenseId_idx" ON "BankStatementMatch"("expenseId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_incomeId_idx" ON "BankStatementMatch"("incomeId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_depositId_idx" ON "BankStatementMatch"("depositId");

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "ManualIncome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "SupplierDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BankStatementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_incomeId_fkey" FOREIGN KEY ("incomeId") REFERENCES "ManualIncome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "SupplierDeposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- What the adapters hold, held by the database too.
-- ---------------------------------------------------------------------------

ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_period_check" CHECK (
  "periodStart" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND "periodEnd" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND "periodEnd" >= "periodStart"
  AND ("kind" <> 'DAILY' OR "periodEnd" = "periodStart")
  AND ("kind" <> 'MONTHLY' OR "pot" = 'BANK')
);

ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_one_ref_check" CHECK (
  num_nonnulls("paymentId", "expenseId", "incomeId", "depositId") = 1
);
ALTER TABLE "ReconciliationEdit" ADD CONSTRAINT "ReconciliationEdit_added_check" CHECK (
  "action" <> 'ADDED' OR "before" IS NULL
);

ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_shape_check" CHECK (
  "date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "lineNo" >= 1
);

ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_one_ref_check" CHECK (
  num_nonnulls("paymentId", "expenseId", "incomeId", "depositId") = 1
);

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

GRANT SELECT, INSERT, UPDATE ON "Reconciliation", "ReconciliationEdit",
  "BankStatementLine", "BankStatementMatch" TO nusantara_app;
GRANT DELETE ON "BankStatementLine", "BankStatementMatch" TO nusantara_app;
REVOKE DELETE, TRUNCATE ON "Reconciliation", "ReconciliationEdit" FROM nusantara_app;
REVOKE TRUNCATE ON "BankStatementLine", "BankStatementMatch" FROM nusantara_app;

-- ---------------------------------------------------------------------------
-- The one door to removing an edit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reconciliation_edit_drop(ids text[]) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  offending text;
  removed integer;
BEGIN
  SELECT r."periodStart" INTO offending
    FROM "ReconciliationEdit" e
    JOIN "Reconciliation" r ON r.id = e."reconciliationId"
   WHERE e.id = ANY(ids)
     AND r.status <> 'OPEN'
   LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Rekonsiliasi % sudah ditutup — buka kembali dulu.', offending
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM "ReconciliationEdit" WHERE id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION reconciliation_edit_drop(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation_edit_drop(text[]) TO nusantara_app;

-- ---------------------------------------------------------------------------
-- Refuse to finish if the database says anything else.
-- ---------------------------------------------------------------------------

DO $check$
BEGIN
  IF NOT has_table_privilege('nusantara_app', '"Reconciliation"', 'SELECT')
     OR NOT has_table_privilege('nusantara_app', '"Reconciliation"', 'INSERT')
     OR NOT has_table_privilege('nusantara_app', '"Reconciliation"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"ReconciliationEdit"', 'INSERT')
     OR NOT has_table_privilege('nusantara_app', '"BankStatementLine"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"BankStatementMatch"', 'DELETE') THEN
    RAISE EXCEPTION 'reconciliation: nusantara_app cannot do what the store needs';
  END IF;
  IF has_table_privilege('nusantara_app', '"Reconciliation"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"ReconciliationEdit"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"Reconciliation"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"ReconciliationEdit"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"BankStatementLine"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"BankStatementMatch"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'reconciliation: deletable beyond the statement lines and their matches';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
     AND (has_table_privilege('nusantara_agent', '"Reconciliation"', 'SELECT')
          OR has_table_privilege('nusantara_agent', '"ReconciliationEdit"', 'INSERT')
          OR has_table_privilege('nusantara_agent', '"BankStatementLine"', 'INSERT')
          OR has_table_privilege('nusantara_agent', '"BankStatementMatch"', 'DELETE')
          OR has_function_privilege('nusantara_agent', 'reconciliation_edit_drop(text[])', 'EXECUTE')) THEN
    RAISE EXCEPTION 'reconciliation: nusantara_agent reaches the reconciliation tables';
  END IF;
  IF NOT has_function_privilege('nusantara_app', 'reconciliation_edit_drop(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'reconciliation: nusantara_app cannot execute reconciliation_edit_drop';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'reconciliation: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
