-- Clearing the activity log (owner ask 2026-10-22: "a button to clear all the
-- activity history"). Settings → Activity gains an owner-only button behind a
-- typed confirm; DELETE /api/kontrol/audit calls this function and then writes
-- ONE fresh "AuditLog" row saying who cleared it, when, and how many rows went
-- — in the same transaction, so a cleared log is never silently empty.
--
-- "AuditLog" stays append-only for the app role (invariant 14, 20260815060658):
-- no table-level DELETE or UPDATE is granted. The one door to a DELETE is
-- `audit_log_clear`, a SECURITY DEFINER function that removes EVERY row —
-- there is no "delete these ids" form, so no code path can quietly edit the
-- history by taking single lines out of it. The same pattern as
-- `unit_event_drop_last` (20260924130000). The app role may execute it;
-- nothing else may.
--
-- Additive and safe for the release before this one: a function changes no
-- shape, and a release that never calls it is unaffected. The deploy's grant
-- query (t|f|t|f|t) reads no "AuditLog" privilege and is unchanged.

CREATE OR REPLACE FUNCTION audit_log_clear() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  removed integer;
BEGIN
  DELETE FROM "AuditLog";
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION audit_log_clear() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_log_clear() TO nusantara_app;

-- Refuse to finish if the log has become writable beyond this one door.
DO $check$
BEGIN
  IF has_table_privilege('nusantara_app', '"AuditLog"', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"AuditLog"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"AuditLog"', 'TRUNCATE')
     OR has_function_privilege('nusantara_agent', 'audit_log_clear()', 'EXECUTE')
     OR NOT has_function_privilege('nusantara_app', 'audit_log_clear()', 'EXECUTE') THEN
    RAISE EXCEPTION 'audit_log_clear: "AuditLog" is writable by nusantara_app beyond INSERT and audit_log_clear(), or the function is reachable by another role';
  END IF;
END
$check$;
