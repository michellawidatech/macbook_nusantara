-- Counted products as quantities (owner decision 2026-09-19: "for accessories
-- literally don't record any individual measurements … that should purely be
-- by qty", and asked how far: in the database too).
--
-- A category with `tracksSerial = false` has no `Unit` rows any more. What a
-- location holds of one of its variants is SUM("qty") over this table, and
-- nothing stores that sum, so there is no projection to drift from the ledger.
-- Additive: no existing row changes, and the release before this one never
-- reads the table.

CREATE TYPE "StockMoveType" AS ENUM (
  'MASUK',
  'MASUK_BATAL',
  'TERJUAL',
  'RETUR_PELANGGAN',
  'TUKAR_TAMBAH',
  'OPNAME',
  'KOREKSI'
);

CREATE TABLE "StockMove" (
  "id"              TEXT NOT NULL,
  "skuId"           TEXT NOT NULL,
  "locationId"      TEXT NOT NULL,
  "qty"             INTEGER NOT NULL,
  "unitCost"        BIGINT NOT NULL,
  "type"            "StockMoveType" NOT NULL,
  "at"              TIMESTAMP(3) NOT NULL,
  "refCode"         TEXT,
  "purchaseOrderId" TEXT,
  "poItemId"        TEXT,
  "orderId"         TEXT,
  "orderItemId"     TEXT,
  "opnameSessionId" TEXT,
  "reasonId"        TEXT,
  "note"            TEXT,
  "staffId"         TEXT NOT NULL,

  CONSTRAINT "StockMove_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMove_skuId_locationId_idx" ON "StockMove"("skuId", "locationId");
CREATE INDEX "StockMove_orderId_idx" ON "StockMove"("orderId");
CREATE INDEX "StockMove_poItemId_idx" ON "StockMove"("poItemId");

ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_poItemId_fkey"
  FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_opnameSessionId_fkey"
  FOREIGN KEY ("opnameSessionId") REFERENCES "OpnameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_reasonId_fkey"
  FOREIGN KEY ("reasonId") REFERENCES "Reason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A movement moves something: signed, never zero. A piece's cost is never
-- negative.
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_qty_nonzero" CHECK ("qty" <> 0);
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_unitCost_nonneg" CHECK ("unitCost" >= 0);

-- Append-only, the rule UnitEvent follows (invariant 14): INSERT and SELECT,
-- never UPDATE, never DELETE. nusantara_readonly reads it through the default
-- privileges of 20260815060658.
GRANT SELECT, INSERT ON "StockMove" TO nusantara_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "StockMove" FROM nusantara_app;

-- 20260915141000 created OpnameCount without a grant, so the application
-- role could not write a quantity count at all. The count is how a counted
-- shelf is checked, so it is granted here with the ledger it now corrects.
GRANT SELECT, INSERT, UPDATE ON "OpnameCount" TO nusantara_app;
