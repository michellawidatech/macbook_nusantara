-- ===========================================================================
-- A supplier or customer no document names can be deleted (owner decision
-- 2026-10-21: "hard delete it as long as there are no transaction linked").
--
-- Same footing as 20261002090000 (unused discounts): every link into these
-- tables is ON DELETE RESTRICT, so a row that any invoice, sale, hold, return,
-- deposit, payment or chat names is refused here even if the application's
-- check were bypassed. A customer's saved addresses go with it.
--
-- Scope: these three tables, `nusantara_app` alone. TRUNCATE stays revoked.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

GRANT DELETE ON "Supplier", "Customer", "CustomerAddress" TO nusantara_app;
