-- ===========================================================================
-- A discount nobody has used can be deleted (owner decision 2026-10-02).
--
-- The app's third hard delete, after QC photos at sale (20260902090100) and a
-- draft stock count. Same reasoning as the draft count: a discount no sale has
-- redeemed is pointed at by nothing but its own SKU list, so removing it loses
-- no history. A redeemed one stays — `Order.discountId` is ON DELETE RESTRICT,
-- which is what refuses it here even if the application's check were bypassed.
--
-- Scope: these two tables, `nusantara_app` alone. The agent never manages
-- discounts; TRUNCATE stays revoked everywhere.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

GRANT DELETE ON "Discount", "DiscountSku" TO nusantara_app;
