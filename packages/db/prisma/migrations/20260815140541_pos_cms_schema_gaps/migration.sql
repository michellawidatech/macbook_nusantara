-- pos_cms_schema_gaps — owner decisions of 2026-08-15 (schema now leads; the
-- drawio ERD is updated afterwards, per the owner's instruction).
--
--   1. SHOPEE as a sales source (Platform) + MARKETPLACE escrow (PayMethod).
--      Settlement pending-until-withdrawn is expressed with the existing
--      PayStatus BELUM → LUNAS, so no new status machinery.
--   2. ReferralSource lookup + FKs from Customer and Order.
--   3. Unit.price — per-unit asking price, set at QC.
--   4. UnitStatus QC + UnitEventType QC_SELESAI — arrival is no longer
--      sellable; QC (description + price) is what makes a unit TERSEDIA.
--   5. Discount.type PCT|NOMINAL with per-type field checks.
--   6. AgentKnowledge — staff-curated Q&A grounding for the chatbot.

-- CreateEnum
CREATE TYPE "DiscType" AS ENUM ('PCT', 'NOMINAL');

-- AlterEnum
ALTER TYPE "PayMethod" ADD VALUE 'MARKETPLACE';

-- AlterEnum
ALTER TYPE "Platform" ADD VALUE 'SHOPEE';

-- AlterEnum
ALTER TYPE "UnitEventType" ADD VALUE 'QC_SELESAI';

-- AlterEnum
ALTER TYPE "UnitStatus" ADD VALUE 'QC';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "referralSourceId" TEXT;

-- AlterTable
-- `type` arrives with a default so the ALTER succeeds on a non-empty table,
-- then loses it: application code must always state the discount type.
ALTER TABLE "Discount" ADD COLUMN     "amountRp" BIGINT,
ADD COLUMN     "type" "DiscType" NOT NULL DEFAULT 'PCT',
ALTER COLUMN "pct" DROP NOT NULL;

ALTER TABLE "Discount" ALTER COLUMN "type" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "referralSourceId" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "price" BIGINT;

-- Backfill: every existing unit predates QC, so it must satisfy the
-- sellable-implies-priced check below. Its asking price starts as the SKU
-- list price (all seeded Sku.price values are > 0 — verified before writing).
UPDATE "Unit" u
SET    "price" = s."price"
FROM   "Sku" s
WHERE  u."skuId" = s."id" AND u."price" IS NULL;

-- CreateTable
CREATE TABLE "ReferralSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentKnowledge" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralSource_name_key" ON "ReferralSource"("name");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_referralSourceId_fkey" FOREIGN KEY ("referralSourceId") REFERENCES "ReferralSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_referralSourceId_fkey" FOREIGN KEY ("referralSourceId") REFERENCES "ReferralSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledge" ADD CONSTRAINT "AgentKnowledge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written: invariants live in the database (08 §2)
-- ============================================================================

-- A unit that is past QC always carries a positive asking price. Written
-- against status::text because 'QC' was added to the enum in this same
-- transaction and Postgres forbids using a new enum *value* before commit;
-- the text comparison sidesteps that without weakening the check.
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_price_set_when_sellable_check"
  CHECK ("status"::text = 'QC' OR ("price" IS NOT NULL AND "price" > 0));

-- Exactly one side of the discount is populated, per type. Replaces the
-- old pct-only range check (pct is nullable now).
ALTER TABLE "Discount" DROP CONSTRAINT "Discount_pct_range_check";
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_type_fields_check"
  CHECK (
    ("type" = 'PCT'     AND "pct" IS NOT NULL AND "pct" BETWEEN 1 AND 100
                        AND "amountRp" IS NULL)
 OR ("type" = 'NOMINAL' AND "amountRp" IS NOT NULL AND "amountRp" > 0
                        AND "pct" IS NULL AND "maxRp" IS NULL)
  );

ALTER TABLE "ReferralSource" ADD CONSTRAINT "ReferralSource_name_nonempty_check"
  CHECK (length(btrim("name")) > 0);

ALTER TABLE "AgentKnowledge" ADD CONSTRAINT "AgentKnowledge_nonempty_check"
  CHECK (length(btrim("question")) > 0 AND length(btrim("answer")) > 0);

-- Grants: default privileges do not cover new tables (see the
-- grant_idempotency_key migration for the same pattern). The agent role
-- reads AgentKnowledge to ground replies but can never write it — staff
-- curation stays with the app.
GRANT SELECT, INSERT, UPDATE ON "ReferralSource" TO nusantara_app;
GRANT SELECT ON "ReferralSource" TO nusantara_agent, nusantara_readonly;
GRANT SELECT, INSERT, UPDATE ON "AgentKnowledge" TO nusantara_app;
GRANT SELECT ON "AgentKnowledge" TO nusantara_agent, nusantara_readonly;

-- Reference rows the UI offers on day one. Stable readable ids on purpose —
-- these are seed data, not user rows; staff add more from Settings.
INSERT INTO "ReferralSource" ("id", "name", "active", "createdAt") VALUES
  ('ref_instagram_ads', 'Instagram Ads', true, now()),
  ('ref_shopee_ads',    'Shopee Ads',    true, now()),
  ('ref_facebook_ads',  'Facebook Ads',  true, now()),
  ('ref_tiktok_ads',    'TikTok Ads',    true, now()),
  ('ref_friends',       'Friends',       true, now());
