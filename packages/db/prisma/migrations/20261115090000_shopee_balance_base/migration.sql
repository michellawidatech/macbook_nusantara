-- The Shopee balance's starting point (owner, 2026-11-15).
--
-- Shopee's own seller-balance report (Saldo Penjual → Export, 15 Aug – 15 Nov
-- 2026) ends at 2026-11-15 21:50:37 Asia/Jakarta with Saldo Akhir
-- Rp99.287.458. The POS Shopee balance is that figure plus every payout
-- released after the instant, less every withdrawal recorded after it
-- (`marketplacePots`, apps/web/src/lib/marketplacePot.ts). Everything before
-- it — orders, ad top-ups, adjustments, withdrawals — is inside the figure,
-- so uploading the same report again counts nothing twice.
--
-- Data only: two AppSetting rows, no schema change. Written once and never
-- overwritten: a re-run, or a database that already has the keys, keeps what
-- it has. Money is whole rupiah as a string (the store's `money`); the
-- instant is UTC ISO (the store's `instant`).
INSERT INTO "AppSetting" ("key", "value", "updatedAt")
VALUES
  ('finance.shopeeBalanceBase', '99287458', now() AT TIME ZONE 'UTC'),
  ('finance.shopeeBalanceBaseAt', '2026-11-15T14:50:37.000Z', now() AT TIME ZONE 'UTC')
ON CONFLICT ("key") DO NOTHING;
