-- A marketplace's money is in its own pot until it is withdrawn (owner
-- 2026-11-13, docs/superpowers/specs/2026-11-13-approvals-today-marketplace-design.md
-- Part A).
--
-- Shopee pays a sale into the shop's SELLER BALANCE, and staff withdraw lumps
-- of any size from there to the bank; no withdrawal names an order. So a
-- released marketplace payment is no longer bank money — it is in that
-- channel's pot — and the bank moves when a withdrawal is recorded, as an
-- income adjustment of one of the two new reasons below. Not revenue: the
-- sale already was.
--
-- Additive: two enum values, and one AppSetting row. Nothing is backfilled
-- and nothing is rewritten.
ALTER TYPE "IncomeReason" ADD VALUE IF NOT EXISTS 'PENARIKAN_SHOPEE';
ALTER TYPE "IncomeReason" ADD VALUE IF NOT EXISTS 'PENARIKAN_TOKOPEDIA';

-- The cutoff. A marketplace payment released BEFORE this release keeps
-- counting as bank, as it always did: the bank balance the shop has reconciled
-- since 2026-10-27 must not move by itself the morning after a deploy. Only
-- money released from now on sits in the seller balance. Written once, as an
-- ISO instant in UTC (the store's `instant`), and never overwritten — a
-- re-run, or a database that already has the key, keeps what it has.
INSERT INTO "AppSetting" ("key", "value", "updatedAt")
VALUES (
  'finance.marketplacePotFrom',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  now() AT TIME ZONE 'UTC'
)
ON CONFLICT ("key") DO NOTHING;
