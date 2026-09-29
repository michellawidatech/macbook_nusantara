-- A supplier is paid in cash or by transfer, and nothing else (owner revision
-- 2026-09-21: *"In Inbound page (step 1 input inbound form), remove
-- 'marketplace escrow' from the payment method. It is hard coded: 'Bank
-- Transfer' and 'Cash'."*).
--
-- This narrows the set migration `20260915090000_po_payment_methods` wrote.
-- MARKETPLACE went in there because stock bought through a marketplace
-- checkout is paid through it; the owner has since decided the invoice form
-- asks only how the shop's own money moved, and an escrow balance is not a way
-- of moving it. The code itself is untouched — it is still what a marketplace
-- SALE is written with (`lib/tillPayments.ts`) — it is only no longer offered
-- on an invoice.
--
-- Payments already recorded keep their method, and every screen still looks a
-- stored code's label up, so an invoice paid through MARKETPLACE before today
-- still reads as one.
UPDATE "PaymentMethod"
   SET "forPo" = ("code" IN ('TUNAI', 'TRANSFER'));

-- Tills already open learn it on their next poll rather than at their next
-- reload (docs/store-on-postgres.md, Concurrency).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'paymentMethods', "id" FROM "PaymentMethod";
