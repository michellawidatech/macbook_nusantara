-- November's Shopee ad top-ups, one expense each (owner, 2026-11-23: "we
-- should include the expense in Shopee from ads").
--
-- The 23 "Isi Ulang Saldo Iklan/Koin Penjual" rows of the owner's seller
-- balance report (my_balance_transaction_report 2026-10-01 – 2026-11-23),
-- 1–23 Nov, Rp111.000 each, Rp2.553.000 together. Each is a Marketing &
-- Advertisement expense paid through `SALDO_SHOPEE`, dated on its Jakarta day
-- with `createdAt` at Shopee's own instant (stored UTC, as Prisma stores
-- DateTime), so Income & Expense lists it at the hour Shopee took it.
--
-- The Shopee balance does not move: every one is before the balance's
-- starting point (2026-11-23 13:54:42 WIB, migration 20261123120000), whose
-- Rp188.175.685 already holds them — `marketplacePots` counts only what came
-- after it. They exist for the record and for Profit & Loss's marketing line.
-- October's 27 top-ups (Rp2.997.000) are already in as one expense, "IKLAN
-- SHOPEE OKT 2026", which the owner chose to leave as it is.
--
-- The shop's database only (and staging, its copy): inserted where
-- `finance.marketplacePotFrom` is the instant migration 20261113090000
-- stamped there with now() — no other database has it — so a test, demo or
-- fresh database gets none. Fixed ids, so a
-- re-run inserts nothing. Attributed to the `widatech` login, which recorded
-- them on the owner's instruction. A later upload of the same report adds
-- none: they are before the base, and `planMovements` would skip them anyway.
INSERT INTO "Expense" ("id", "kind", "amount", "date", "note", "methodId", "staffId", "createdAt")
SELECT v.id, 'MARKETING'::"ExpenseKind", v.amount, v.date, 'Isi Ulang Saldo Iklan/Koin Penjual', pm."id", s."id", v.created
  FROM (VALUES
  ('e_shopee_ad_20261101_101727', '2026-11-01', 111000, TIMESTAMP '2026-11-01 03:17:27'),
  ('e_shopee_ad_20261102_152737', '2026-11-02', 111000, TIMESTAMP '2026-11-02 08:27:37'),
  ('e_shopee_ad_20261103_101106', '2026-11-03', 111000, TIMESTAMP '2026-11-03 03:11:06'),
  ('e_shopee_ad_20261104_134648', '2026-11-04', 111000, TIMESTAMP '2026-11-04 06:46:48'),
  ('e_shopee_ad_20261105_190548', '2026-11-05', 111000, TIMESTAMP '2026-11-05 12:05:48'),
  ('e_shopee_ad_20261106_102720', '2026-11-06', 111000, TIMESTAMP '2026-11-06 03:27:20'),
  ('e_shopee_ad_20261107_101258', '2026-11-07', 111000, TIMESTAMP '2026-11-07 03:12:58'),
  ('e_shopee_ad_20261108_100812', '2026-11-08', 111000, TIMESTAMP '2026-11-08 03:08:12'),
  ('e_shopee_ad_20261109_114241', '2026-11-09', 111000, TIMESTAMP '2026-11-09 04:42:41'),
  ('e_shopee_ad_20261110_112157', '2026-11-10', 111000, TIMESTAMP '2026-11-10 04:21:57'),
  ('e_shopee_ad_20261111_101031', '2026-11-11', 111000, TIMESTAMP '2026-11-11 03:10:31'),
  ('e_shopee_ad_20261112_102539', '2026-11-12', 111000, TIMESTAMP '2026-11-12 03:25:39'),
  ('e_shopee_ad_20261113_101427', '2026-11-13', 111000, TIMESTAMP '2026-11-13 03:14:27'),
  ('e_shopee_ad_20261114_101736', '2026-11-14', 111000, TIMESTAMP '2026-11-14 03:17:36'),
  ('e_shopee_ad_20261115_101818', '2026-11-15', 111000, TIMESTAMP '2026-11-15 03:18:18'),
  ('e_shopee_ad_20261116_153534', '2026-11-16', 111000, TIMESTAMP '2026-11-16 08:35:34'),
  ('e_shopee_ad_20261117_102751', '2026-11-17', 111000, TIMESTAMP '2026-11-17 03:27:51'),
  ('e_shopee_ad_20261118_100719', '2026-11-18', 111000, TIMESTAMP '2026-11-18 03:07:19'),
  ('e_shopee_ad_20261119_100638', '2026-11-19', 111000, TIMESTAMP '2026-11-19 03:06:38'),
  ('e_shopee_ad_20261120_102553', '2026-11-20', 111000, TIMESTAMP '2026-11-20 03:25:53'),
  ('e_shopee_ad_20261121_100713', '2026-11-21', 111000, TIMESTAMP '2026-11-21 03:07:13'),
  ('e_shopee_ad_20261122_101924', '2026-11-22', 111000, TIMESTAMP '2026-11-22 03:19:24'),
  ('e_shopee_ad_20261123_100808', '2026-11-23', 111000, TIMESTAMP '2026-11-23 03:08:08')
  ) AS v(id, date, amount, created)
  JOIN "PaymentMethod" pm ON pm."code" = 'SALDO_SHOPEE'
  JOIN "Staff" s ON s."username" = 'widatech'
 WHERE EXISTS (SELECT 1 FROM "AppSetting"
                WHERE "key" = 'finance.marketplacePotFrom'
                  AND "value" = '2026-11-13T09:36:32.537Z')
   AND NOT EXISTS (SELECT 1 FROM "Expense" e WHERE e."id" = v.id);

-- Tills already open learn them on their next poll.
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'expenses', "id" FROM "Expense" WHERE "id" LIKE 'e_shopee_ad_202611%';
