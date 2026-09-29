-- A stock take of what the shop COUNTS rather than scans (owner ask
-- 2026-09-15: "in stock opname, they will only be counted and validated by
-- qty, not serial").
--
-- One row per variant in the count's scope whose category has
-- `tracksSerial = false`. A variant with no row is one the counter never
-- reached, which is not the same fact as a row saying zero — zero means
-- somebody looked at the shelf and found none, and that is a discrepancy the
-- count has to report.
CREATE TABLE "OpnameCount" (
  "id"        TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "skuId"     TEXT NOT NULL,
  "qty"       INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "removedAt" TIMESTAMP(3),

  CONSTRAINT "OpnameCount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpnameCount_sessionId_skuId_key"
  ON "OpnameCount"("sessionId", "skuId");

ALTER TABLE "OpnameCount"
  ADD CONSTRAINT "OpnameCount_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "OpnameSession"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OpnameCount"
  ADD CONSTRAINT "OpnameCount_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "Sku"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A quantity is a count of things, never negative. The same shape as the
-- CHECKs in 20260913120100_store_on_postgres_checks.
ALTER TABLE "OpnameCount"
  ADD CONSTRAINT "OpnameCount_qty_nonneg" CHECK ("qty" >= 0);
