-- ===========================================================================
-- An Income & Expense adjustment can be deleted (owner ask 2026-10-24: "we
-- should be able to delete the income expense adjustment").
--
-- Same footing as 20261002090000 (unused discounts) and 20261021120000
-- (unused suppliers and customers). No foreign key points at either table, so
-- a deleted row orphans nothing; the store adapter refuses a day inside a
-- closed book (`finance.booksClosedAt`).
--
-- Scope: these two tables, `nusantara_app` alone. TRUNCATE stays revoked.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

GRANT DELETE ON "Expense", "ManualIncome" TO nusantara_app;
