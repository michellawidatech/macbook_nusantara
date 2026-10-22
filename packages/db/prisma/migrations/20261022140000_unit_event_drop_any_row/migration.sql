-- A unit's history row may be deleted from anywhere in its chain, not only
-- the top (owner ask 2026-10-22: "delete the serial [history] per unit … the
-- reason is that some of the history is irrelevant"). The store's events
-- adapter judges every removal in full (packages/db/src/store/adapters/
-- units.ts, `removeEvents`) — including that a SOLD row stays while its sale
-- still has the unit on it; this function is the database holding the part
-- of the line it can see: a unit is never left with no history, since a unit
-- with none is a unit whose status nothing explains.
--
-- `unit_event_drop_last` (20260924130000) is kept, unchanged, for the release
-- before this one, which still calls it during a deploy. No table privilege
-- changes: DELETE on "UnitEvent" stays revoked and this SECURITY DEFINER
-- function is the app role's one door to it, so the deploy's grant query
-- (t|f|t|f|t) and the 20260913 self-check read as before. No StoreChange
-- rows: nothing any till has projected changes.

CREATE OR REPLACE FUNCTION unit_event_drop(ids text[]) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  offending text;
  removed integer;
BEGIN
  SELECT e.serial INTO offending
    FROM "UnitEvent" e
   WHERE e.id = ANY(ids)
     AND NOT EXISTS (SELECT 1 FROM "UnitEvent" y
                      WHERE y."unitId" = e."unitId"
                        AND NOT (y.id = ANY(ids)))
   LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Unit % harus punya riwayat.', offending
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM "UnitEvent" WHERE id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION unit_event_drop(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unit_event_drop(text[]) TO nusantara_app;

DO $check$
BEGIN
  IF has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'DELETE')
     OR NOT has_function_privilege('nusantara_app', 'unit_event_drop(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'unit_event_drop_any_row: the ledger is writable by nusantara_app beyond unit_event_drop';
  END IF;
END
$check$;
