-- Two owner asks of 2026-09-24, one adding a fact and one retiring a feature.
--
-- 1. `PurchaseOrderItem.outsideInvoice`. A line the shop took in that the
--    supplier's paper never billed — *"add a button called 'Add outside
--    invoice' … and mark that row as yellow"*. It is the mirror of
--    `notReceived`: that one is billed and never sent, this one is sent and
--    never billed.
--
--    A MARK and nothing else (owner answer): the line still carries its price,
--    so its units still cost what they cost and the invoice's COGS is still
--    the whole delivery. What it buys is a yellow row and a place in the list
--    under the Units card.
--
-- 2. `Supplier.openingBalance` goes, and `Payment.supplierId` with it —
--    *"remove the column 'Utang lama' or the amount from previous app, we
--    don't track it anymore (remove from database schema)"*, and the owner
--    asked for the whole feature rather than two orphaned columns.
--
--    `Payment.supplierId` existed for one purpose: a debt from before this app
--    has no invoice to hang a payment off, so the payment named the party
--    (20260922090000). With the debt gone there is nothing for such a payment
--    to settle, so invariant 7 goes back to three parents and the supplier
--    direction CHECK goes with it. A supplier is still paid — through
--    `Payment.poId`, against an invoice, as every supplier payment in the app
--    already is.
--
--    ⚠️ The B2Soft cutover loaded the shop's pre-existing payable this way
--    (`--with-balances`). It no longer has anywhere to land: after this,
--    Payable lists real inbound invoices only. `Customer.openingBalance` is
--    untouched — the owner asked about the supplier side.
--
-- No GRANT: both tables are granted to nusantara_app at TABLE level, which
-- covers a column added later and needs nothing for one removed.

ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "outsideInvoice" BOOLEAN NOT NULL DEFAULT false;

-- A payment that names only a supplier has lost the debt it was paying.
-- Its log rows go first: `PaymentLog.paymentId` is ON DELETE RESTRICT.
DELETE FROM "PaymentLog"
 WHERE "paymentId" IN (SELECT id FROM "Payment" WHERE "supplierId" IS NOT NULL);
DELETE FROM "Payment" WHERE "supplierId" IS NOT NULL;

ALTER TABLE "Payment" DROP CONSTRAINT "Payment_supplier_direction_check";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_supplierId_fkey";
DROP INDEX "Payment_supplierId_idx";

-- Invariant 7, back to three parents (it was four, 20260922090000).
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_one_parent_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_parent_check"
  CHECK (num_nonnulls("orderId", "poId", "customerId") = 1);

ALTER TABLE "Payment" DROP COLUMN "supplierId";

ALTER TABLE "Supplier"
  DROP COLUMN "openingBalance",
  DROP COLUMN "openingBalanceAt";
