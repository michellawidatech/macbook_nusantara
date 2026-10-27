-- ===========================================================================
-- A daily or monthly reconciliation can be deleted (owner ask 2026-10-27:
-- "I need to delete the monthly reconciliation history and the daily one").
-- Additive: one function, no table, no column, nothing backfilled.
--
-- Deleting a reconciliation removes the record and everything hanging off it:
-- its "ReconciliationEdit" log, its "BankStatementLine"s and their
-- "BankStatementMatch"es, and its "ReconciliationAside"s, active or withdrawn.
-- It does NOT undo a correction already written to a real record (an amount
-- changed, a transaction added) — those were real fixes and stay. The day or
-- month then reads as not reconciled and can be reconciled afresh.
--
-- 1. reconciliation_delete(p_id text) RETURNS integer — a SECURITY DEFINER
--    function (the pattern of reconciliation_edit_drop and
--    reconciliation_aside_drop, 20261027170000 / 20261027200000), the app's
--    one door to a DELETE on "Reconciliation", and through it on
--    "ReconciliationEdit" and "ReconciliationAside". It deletes children
--    first, in foreign-key order (every key here is RESTRICT), and answers
--    how many rows it removed in all. It takes ONE reconciliation, whole:
--    there is no form of it that removes part of one.
--
-- 2. Grants. EXECUTE to nusantara_app only; PUBLIC revoked; nothing for
--    nusantara_agent. Table-level DELETE on "Reconciliation",
--    "ReconciliationEdit" and "ReconciliationAside" stays revoked.
--
-- This is the NINTH sanctioned hard delete. Do not generalise it.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

CREATE OR REPLACE FUNCTION reconciliation_delete(p_id text) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  removed integer := 0;
  n integer;
BEGIN
  DELETE FROM "BankStatementMatch" m
   USING "BankStatementLine" l
   WHERE m."lineId" = l.id
     AND l."reconciliationId" = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed + n;

  DELETE FROM "BankStatementLine" WHERE "reconciliationId" = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed + n;

  DELETE FROM "ReconciliationAside" WHERE "reconciliationId" = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed + n;

  DELETE FROM "ReconciliationEdit" WHERE "reconciliationId" = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed + n;

  DELETE FROM "Reconciliation" WHERE id = p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed + n;

  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION reconciliation_delete(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconciliation_delete(text) TO nusantara_app;

-- ---------------------------------------------------------------------------
-- Refuse to finish if the database says anything else.
-- ---------------------------------------------------------------------------

DO $check$
BEGIN
  IF NOT has_function_privilege('nusantara_app', 'reconciliation_delete(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reconciliation delete: nusantara_app cannot execute reconciliation_delete';
  END IF;
  IF has_table_privilege('nusantara_app', '"Reconciliation"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"ReconciliationEdit"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"ReconciliationAside"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"Reconciliation"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"ReconciliationEdit"', 'TRUNCATE')
     OR has_table_privilege('nusantara_app', '"ReconciliationAside"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'reconciliation delete: deletable beyond its door';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
     AND has_function_privilege('nusantara_agent', 'reconciliation_delete(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reconciliation delete: nusantara_agent can execute reconciliation_delete';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'reconciliation delete: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
