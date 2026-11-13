-- ===========================================================================
-- Edit and delete approvals (owner/user 2026-11-13; design
-- docs/superpowers/specs/2026-11-13-approvals-today-marketplace-design.md,
-- Part B). Additive: nothing existing is rewritten.
--
-- "ChangeRequest" (CR-…): an edit or a delete of money — a past sale, a
-- purchase invoice's prices / expenses / payments, a typed Income & Expense
-- adjustment — that an account without "Staff"."canApprove" ASKED for, with
-- why. The approver's Approve commits the stored changeset as the approver
-- (`commitStore`); a record that changed since makes it STALE.
--
-- "changeset" is JSONB — the SEVENTH JSON exception, taken under the user's
-- go-ahead of 2026-11-13: it is a store changeset in wire form, whose shape is
-- the whole store contract (`@nusantara/store`).
--
-- At most one target, by CHECK. A sale and an invoice are never hard-deleted
-- (RESTRICT); an expense or an income can be (2026-10-24), so those two links
-- are SET NULL and "label" still names what it was about.
--
-- Grants: nusantara_app SELECT, INSERT, UPDATE; no DELETE, no TRUNCATE — a
-- decided request is the record of a decision. Nothing for nusantara_agent.
-- The deploy's t|f|t|f|t query reads "Unit", "UnitEvent" and "UnitNotePhoto"
-- only and is unchanged.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "ChangeRequestKind" AS ENUM ('EDIT', 'DELETE');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'STALE');

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT next_doc_code('CR'::text),
    "kind" "ChangeRequestKind" NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "purchaseOrderId" TEXT,
    "expenseId" TEXT,
    "manualIncomeId" TEXT,
    "label" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "changeset" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_code_key" ON "ChangeRequest"("code");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_requestedAt_idx" ON "ChangeRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "ChangeRequest_requestedById_requestedAt_idx" ON "ChangeRequest"("requestedById", "requestedAt");

-- CreateIndex
CREATE INDEX "ChangeRequest_orderId_idx" ON "ChangeRequest"("orderId");

-- CreateIndex
CREATE INDEX "ChangeRequest_purchaseOrderId_idx" ON "ChangeRequest"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "ChangeRequest_expenseId_idx" ON "ChangeRequest"("expenseId");

-- CreateIndex
CREATE INDEX "ChangeRequest_manualIncomeId_idx" ON "ChangeRequest"("manualIncomeId");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_manualIncomeId_fkey" FOREIGN KEY ("manualIncomeId") REFERENCES "ManualIncome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- What the service holds, held by the database too.
-- ---------------------------------------------------------------------------

-- At most one target.
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_one_target_check"
  CHECK (num_nonnulls("orderId", "purchaseOrderId", "expenseId", "manualIncomeId") <= 1);

-- A pending request is undecided; a decided one says who and when.
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_decision_check"
  CHECK (("status" = 'PENDING') = ("decidedAt" IS NULL));

-- The changeset is an object, never a scalar or a list.
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_changeset_check"
  CHECK (jsonb_typeof("changeset") = 'object');

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

REVOKE DELETE, TRUNCATE ON "ChangeRequest" FROM nusantara_app;
GRANT SELECT, INSERT, UPDATE ON "ChangeRequest" TO nusantara_app;

DO $agent$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent') THEN
    REVOKE ALL ON "ChangeRequest" FROM nusantara_agent;
  END IF;
END
$agent$;

DO $check$
BEGIN
  IF NOT has_table_privilege('nusantara_app', '"ChangeRequest"', 'INSERT')
     OR NOT has_table_privilege('nusantara_app', '"ChangeRequest"', 'UPDATE') THEN
    RAISE EXCEPTION 'change request: nusantara_app cannot write it';
  END IF;
  IF has_table_privilege('nusantara_app', '"ChangeRequest"', 'DELETE') THEN
    RAISE EXCEPTION 'change request: nusantara_app can delete it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
     AND has_table_privilege('nusantara_agent', '"ChangeRequest"', 'SELECT') THEN
    RAISE EXCEPTION 'change request: nusantara_agent reaches the table';
  END IF;
END
$check$;
