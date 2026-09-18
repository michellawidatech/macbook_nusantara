-- A supplier is paid in cash, by transfer, or through a marketplace
-- (owner revision 2026-09-15: "The payment method is wrong, it should be Cash,
-- Transfer, and Marketplace").
--
-- `forPo` was seeded on 2026-08-24 as TUNAI, KARTU_KREDIT and DEPOSIT. The
-- browser's demo seed moved TRANSFER in on 2026-09-09 and dropped DEPOSIT, but
-- no migration followed it, so a live database went on offering Credit card
-- and Deposit on an invoice and never Transfer. This states the whole set, so
-- it is right whatever a database held before.
--
-- Payments already recorded keep their method. The flag only decides what is
-- OFFERED for a new one; every screen still looks a stored code's label up.
UPDATE "PaymentMethod"
   SET "forPo" = ("code" IN ('TUNAI', 'TRANSFER', 'MARKETPLACE'));

-- Tills already open learn it on their next poll rather than at their next
-- reload (docs/store-on-postgres.md, Concurrency).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'paymentMethods', "id" FROM "PaymentMethod";
