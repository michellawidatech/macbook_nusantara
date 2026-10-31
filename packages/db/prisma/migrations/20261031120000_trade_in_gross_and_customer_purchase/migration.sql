-- ===========================================================================
-- Every trade-in recorded the same way, and a unit bought from a customer with
-- no sale (owner-approved 2026-10-31). Additive: nothing existing is rewritten.
--
-- 1. "Order"."tradeInGross". From this release a sale with a trade-in is
--    recorded GROSS: "total" is the whole bill, a "Payment" of method
--    TUKAR_TAMBAH (inBalance false) is what the trade-in paid of it, and money
--    the shop handed the customer back is an "Expense" of kind TUKAR_TAMBAH.
--    Default false: every earlier sale netted the trade-in off "total", and
--    reads exactly as before.
--
-- 2. "ExpenseKind" TUKAR_TAMBAH — buying a customer's unit. The unit is stock
--    at that cost, so Profit & Loss never counts it as operating.
--    "Expense"."ref" — the transfer's reference number (a payout's).
--
-- 3. "CustomerPurchase" (BP-…) and its items — "+ Trade-in" on Inbound: units
--    bought from a person with no sale, paid in full on the spot by ONE
--    "Expense" naming it ("Expense"."customerPurchaseId"); a unit's ledger
--    rows name it too ("UnitEvent"."customerPurchaseId"). The person is
--    required: a unit bought from a stranger is the one somebody comes
--    looking for.
--
-- 4. The PaymentMethod row TUKAR_TAMBAH ("Trade-in"): what the trade-in paid
--    of a bill. No pot (lib/accounts.ts), offered by no picker.
--
-- 5. Grants: nusantara_app SELECT, INSERT, UPDATE on both tables; no DELETE,
--    no TRUNCATE; nothing for nusantara_agent. The deploy's t|f|t|f|t query
--    reads "Unit", "UnitEvent" and "UnitNotePhoto" only and is unchanged.
-- ===========================================================================

-- AlterEnum
ALTER TYPE "ExpenseKind" ADD VALUE IF NOT EXISTS 'TUKAR_TAMBAH';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tradeInGross" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "customerPurchaseId" TEXT,
ADD COLUMN     "ref" TEXT;

-- CreateTable
CREATE TABLE "CustomerPurchase" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT next_doc_code('BP'::text),
    "at" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "unitId" TEXT,
    "label" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerPurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPurchase_code_key" ON "CustomerPurchase"("code");

-- CreateIndex
CREATE INDEX "CustomerPurchaseItem_purchaseId_idx" ON "CustomerPurchaseItem"("purchaseId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_customerPurchaseId_fkey" FOREIGN KEY ("customerPurchaseId") REFERENCES "CustomerPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchase" ADD CONSTRAINT "CustomerPurchase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchase" ADD CONSTRAINT "CustomerPurchase_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseItem" ADD CONSTRAINT "CustomerPurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CustomerPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseItem" ADD CONSTRAINT "CustomerPurchaseItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPurchaseItem" ADD CONSTRAINT "CustomerPurchaseItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "Expense_customerPurchaseId_idx" ON "Expense"("customerPurchaseId");

-- The unit's ledger names the purchase that brought it in, as it names a
-- sale or an invoice (`refCode` BP-… resolves to it).
ALTER TABLE "UnitEvent" ADD COLUMN "customerPurchaseId" TEXT;
ALTER TABLE "UnitEvent" ADD CONSTRAINT "UnitEvent_customerPurchaseId_fkey" FOREIGN KEY ("customerPurchaseId") REFERENCES "CustomerPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "UnitEvent_customerPurchaseId_idx" ON "UnitEvent"("customerPurchaseId");

-- ---------------------------------------------------------------------------
-- What the adapters hold, held by the database too.
-- ---------------------------------------------------------------------------

ALTER TABLE "CustomerPurchaseItem" ADD CONSTRAINT "CustomerPurchaseItem_money_check"
  CHECK ("value" > 0 AND "qty" > 0);

-- ---------------------------------------------------------------------------
-- The trade-in's payment method.
-- ---------------------------------------------------------------------------

INSERT INTO "PaymentMethod" ("id", "code", "label", "builtIn", "forPo", "forSale", "active", "sortOrder", "createdAt")
SELECT 'pm_tukar_tambah', 'TUKAR_TAMBAH', 'Trade-in', true, false, false, true,
       COALESCE((SELECT MAX("sortOrder") FROM "PaymentMethod"), 0) + 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" WHERE "code" = 'TUKAR_TAMBAH');

-- Tills already open learn it on their next poll (docs/store-on-postgres.md).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'paymentMethods', "id" FROM "PaymentMethod" WHERE "code" = 'TUKAR_TAMBAH';

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

REVOKE DELETE, TRUNCATE ON "CustomerPurchase", "CustomerPurchaseItem" FROM nusantara_app;
GRANT SELECT, INSERT, UPDATE ON "CustomerPurchase", "CustomerPurchaseItem" TO nusantara_app;

DO $check$
BEGIN
  IF NOT has_table_privilege('nusantara_app', '"CustomerPurchase"', 'INSERT')
     OR NOT has_table_privilege('nusantara_app', '"CustomerPurchaseItem"', 'INSERT') THEN
    RAISE EXCEPTION 'customer purchase: nusantara_app cannot write it';
  END IF;
  IF has_table_privilege('nusantara_app', '"CustomerPurchase"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"CustomerPurchaseItem"', 'DELETE') THEN
    RAISE EXCEPTION 'customer purchase: nusantara_app can delete it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
     AND (has_table_privilege('nusantara_agent', '"CustomerPurchase"', 'SELECT')
          OR has_table_privilege('nusantara_agent', '"CustomerPurchaseItem"', 'SELECT')) THEN
    RAISE EXCEPTION 'customer purchase: nusantara_agent reaches the table';
  END IF;
END
$check$;
