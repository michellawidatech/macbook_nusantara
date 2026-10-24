-- ===========================================================================
-- A product is facts, not a name (owner ask 2026-10-21: "a smart system and
-- structured product to detect that" — after one MacBook Air turned up three
-- times under three names, and AppleDB re-added models already there).
--
-- ADDITIVE ONLY. Every column is nullable and nothing is backfilled here:
-- the shop's catalogue still holds duplicates, and a key filled in by this
-- migration would collide with itself and fail the deploy. The app fills the
-- keys as products are saved and merged, and the partial unique indexes below
-- cover only non-null keys of LIVE rows — so they refuse a NEW duplicate and
-- never get in the way of an existing one.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

-- The product's facts and its key.
ALTER TABLE "CatalogModel" ADD COLUMN "chip" TEXT,
ADD COLUMN "extra" TEXT,
ADD COLUMN "family" TEXT,
ADD COLUMN "productKey" TEXT;

CREATE UNIQUE INDEX "CatalogModel_productKey_live"
  ON "CatalogModel"("productKey")
  WHERE "archived" = false AND "productKey" IS NOT NULL;

-- A variant merged into another stays (receipts name it) and points at it.
ALTER TABLE "Sku" ADD COLUMN "mergedIntoId" TEXT,
ADD COLUMN "variantKey" TEXT;

ALTER TABLE "Sku" ADD CONSTRAINT "Sku_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Sku_variantKey_live"
  ON "Sku"("modelId", "variantKey")
  WHERE "archived" = false AND "variantKey" IS NOT NULL;

-- A merged variant cannot be merged into itself, nor stay live.
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_merged_is_archived"
  CHECK ("mergedIntoId" IS NULL OR ("archived" AND "mergedIntoId" <> "id"));

-- AppleDB identifiers linked to a product.
CREATE TABLE "ModelIdentifier" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelIdentifier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModelIdentifier_identifier_key" ON "ModelIdentifier"("identifier");
CREATE INDEX "ModelIdentifier_modelId_idx" ON "ModelIdentifier"("modelId");
ALTER TABLE "ModelIdentifier" ADD CONSTRAINT "ModelIdentifier_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pairs a person said are different products.
CREATE TABLE "ModelNotDuplicate" (
    "id" TEXT NOT NULL,
    "aModelId" TEXT NOT NULL,
    "bModelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelNotDuplicate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModelNotDuplicate_ordered" CHECK ("aModelId" < "bModelId")
);
CREATE UNIQUE INDEX "ModelNotDuplicate_aModelId_bModelId_key" ON "ModelNotDuplicate"("aModelId", "bModelId");
ALTER TABLE "ModelNotDuplicate" ADD CONSTRAINT "ModelNotDuplicate_aModelId_fkey" FOREIGN KEY ("aModelId") REFERENCES "CatalogModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModelNotDuplicate" ADD CONSTRAINT "ModelNotDuplicate_bModelId_fkey" FOREIGN KEY ("bModelId") REFERENCES "CatalogModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Both are written once and nothing is deleted. A link moves ONLY when the
-- product it named is merged away, so the app may update that one column.
-- New tables are readable by nusantara_readonly through the default
-- privileges.
GRANT SELECT, INSERT ON "ModelIdentifier", "ModelNotDuplicate" TO nusantara_app;
GRANT UPDATE ("modelId") ON "ModelIdentifier" TO nusantara_app;
