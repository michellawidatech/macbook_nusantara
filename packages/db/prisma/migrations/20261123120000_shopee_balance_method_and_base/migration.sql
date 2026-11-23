-- The Shopee balance as a way to pay, and a new starting point (owner,
-- 2026-11-23).
--
-- 1. A payment method, `SALDO_SHOPEE` ("Shopee balance"). An adjustment on
--    Income & Expense paid through it moves the Shopee seller balance and
--    neither the cash nor the bank pot — an ad top-up ("Isi Ulang Saldo
--    Iklan/Koin Penjual", Rp111.000 most mornings) is the case that asked for
--    it. The Shopee upload writes those top-ups with it. `forPo` and
--    `forSale` are false: a supplier is not paid and a sale is not taken out
--    of the shop's own Shopee wallet. `lib/accounts.ts` names it and gives it
--    no cash/bank pot; `lib/marketplacePot.ts` puts it in Shopee's.
--
-- 2. The starting point moves to Shopee's own figure at the last row of the
--    owner's report (my_balance_transaction_report 2026-10-01 – 2026-11-23):
--    2026-11-23 13:54:42 Asia/Jakarta, Saldo Akhir Rp188.175.685. The POS had
--    Rp189.063.685 — the 15 Nov base plus the seven payouts since, exactly
--    as Shopee lists them — and the Rp888.000 between them is the eight ad
--    top-ups since 15 Nov, which nothing could record. Everything up to the
--    instant is inside the figure, so the report can be uploaded again
--    without counting anything twice.
--
-- Data only, no schema change.
INSERT INTO "PaymentMethod" ("id", "code", "label", "builtIn", "forPo", "forSale", "active", "sortOrder", "createdAt")
SELECT 'pm_saldo_shopee', 'SALDO_SHOPEE', 'Shopee balance', true, false, false, true,
       COALESCE((SELECT MAX("sortOrder") FROM "PaymentMethod"), 0) + 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "PaymentMethod" WHERE "code" = 'SALDO_SHOPEE');

INSERT INTO "AppSetting" ("key", "value", "updatedAt")
VALUES
  ('finance.shopeeBalanceBase', '188175685', now() AT TIME ZONE 'UTC'),
  ('finance.shopeeBalanceBaseAt', '2026-11-23T06:54:42.000Z', now() AT TIME ZONE 'UTC')
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt";

-- Tills already open learn both on their next poll rather than at their next
-- reload (docs/store-on-postgres.md, Concurrency); a singleton's change is
-- keyed "*" (store/commit.ts).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'paymentMethods', "id" FROM "PaymentMethod" WHERE "code" = 'SALDO_SHOPEE';
INSERT INTO "StoreChange" ("collection", "rowKey") VALUES ('settings', '*');
