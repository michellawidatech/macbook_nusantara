-- "Add Expense" on an inbound invoice (owner ask 2026-09-18): "add like
-- additional payment, this is like what we owe … in the 'Add Expense' should
-- be able to mark as paid, which will automatically record the payment. When
-- adding expense we should be able to add if we want to divide it to COGS per
-- unit or not."
--
-- An expense is a `PurchaseOrderFee` row, which already had a label, a kind
-- and an amount. What it lacked:
--
-- * `inCogs` — whether the expense is spread over the invoice's machines as
--   part of what each one cost. Default true, because shipping and tax were
--   spread that way before this column existed (owner ask 2026-09-15), and a
--   default of false would quietly lower every machine's COGS.
-- * `removedAt` — an expense taken off the invoice. Nothing is hard-deleted,
--   and a payment may still point at it.
--
-- And `Payment.poFeeId` says which expense a payment settles, so marking an
-- expense paid, correcting its amount or un-marking it touches the one payment
-- it made rather than guessing among the invoice's payments.
--
-- No GRANT: both tables are granted to nusantara_app at TABLE level, which
-- covers columns added later.
ALTER TABLE "PurchaseOrderFee"
  ADD COLUMN "inCogs" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "removedAt" TIMESTAMP(3);

ALTER TABLE "Payment" ADD COLUMN "poFeeId" TEXT;

CREATE INDEX "Payment_poFeeId_idx" ON "Payment"("poFeeId");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_poFeeId_fkey" FOREIGN KEY ("poFeeId")
  REFERENCES "PurchaseOrderFee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A zero fee meant "none" until now. The browser held one shipping and one tax
-- figure per invoice, and the store adapter zeroed a row rather than deleting
-- it when either was cleared. Each expense is its own row from here on, so a
-- row saying Rp0 would show as an expense nobody entered.
UPDATE "PurchaseOrderFee"
   SET "removedAt" = CURRENT_TIMESTAMP
 WHERE "amount" = 0
   AND "removedAt" IS NULL;

-- A shipping or tax payment made before this migration names a bucket, not an
-- expense. Where the bucket holds exactly one expense, that is the expense it
-- paid, so the link is written down. Anything more ambiguous is left alone:
-- the browser still reads an unlinked bucket payment against that bucket's
-- expenses (`poTotals` in apps/web/src/lib/inbound.ts).
UPDATE "Payment" AS p
   SET "poFeeId" = f."id"
  FROM "PurchaseOrderFee" AS f
 WHERE p."poId" = f."poId"
   AND p."poFeeId" IS NULL
   AND p."voidedAt" IS NULL
   AND f."removedAt" IS NULL
   AND p."appliedTo" = 'ONGKIR'
   AND f."kind" = 'ONGKIR'
   AND (SELECT count(*) FROM "PurchaseOrderFee" AS g
         WHERE g."poId" = f."poId"
           AND g."kind" = 'ONGKIR'
           AND g."removedAt" IS NULL) = 1;

-- The tax bucket has always held every expense that was not shipping.
UPDATE "Payment" AS p
   SET "poFeeId" = f."id"
  FROM "PurchaseOrderFee" AS f
 WHERE p."poId" = f."poId"
   AND p."poFeeId" IS NULL
   AND p."voidedAt" IS NULL
   AND f."removedAt" IS NULL
   AND p."appliedTo" = 'PAJAK'
   AND f."kind" <> 'ONGKIR'
   AND (SELECT count(*) FROM "PurchaseOrderFee" AS g
         WHERE g."poId" = f."poId"
           AND g."kind" <> 'ONGKIR'
           AND g."removedAt" IS NULL) = 1;

-- Tills already open learn the new shape on their next poll rather than at
-- their next reload (docs/store-on-postgres.md, Concurrency).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'pos', "id" FROM "PurchaseOrder" WHERE "status" <> 'BATAL';
