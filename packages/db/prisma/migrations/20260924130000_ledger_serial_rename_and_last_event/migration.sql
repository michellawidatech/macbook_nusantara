-- The ledger's two admitted edits reach the database (owner decision
-- 2026-09-23; owner report 2026-09-24: "Why I cannot edit the serial number
-- in the inbound"). A unit's serial may be corrected, and its ledger rows —
-- which carry a denormalised copy — follow it; and a unit's LAST rows may be
-- taken back, which is how a unit is swapped on a recorded sale without a
-- trace of the one it replaced. The store's adapters judge both in full
-- (packages/db/src/store/adapters/units.ts); this migration is the database
-- holding the same line, so no code path — and no bug in one — can do more.
--
-- The `serial` column alone is granted, so has_table_privilege(...,'UPDATE')
-- on "UnitEvent" stays false: the 20260913 self-check and the deploy's grant
-- query (t|f|t|f|t) read as before, and `seq`, `type`, the statuses and the
-- unit an event belongs to cannot be rewritten by the API's role.
--
-- No DELETE is granted. The one door to one is `unit_event_drop_last`, a
-- SECURITY DEFINER function that refuses any row that is not the top of its
-- unit's chain — a row above it that would stay — or that is the last one
-- standing, since a unit with no history is a unit whose status nothing
-- explains. The app role may execute it and nothing else may.
--
-- Additive and safe for the release before this one: a grant and a function
-- change no shape, and a release that never issues the UPDATE or the call is
-- unaffected by being allowed to. No StoreChange rows: nothing any till has
-- projected changes.

GRANT UPDATE ("serial") ON "UnitEvent" TO nusantara_app;

CREATE OR REPLACE FUNCTION unit_event_drop_last(ids text[]) RETURNS integer
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
     AND (
       -- a row above it stays: this is not the top of its unit's chain
       EXISTS (SELECT 1 FROM "UnitEvent" x
                WHERE x."unitId" = e."unitId"
                  AND x.seq > e.seq
                  AND NOT (x.id = ANY(ids)))
       -- or nothing below it stays: the unit would be left with no history
       OR NOT EXISTS (SELECT 1 FROM "UnitEvent" y
                       WHERE y."unitId" = e."unitId"
                         AND y.seq < e.seq
                         AND NOT (y.id = ANY(ids)))
     )
   LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Hanya kejadian terakhir unit % yang bisa dihapus, dan unit harus punya riwayat.', offending
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM "UnitEvent" WHERE id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION unit_event_drop_last(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unit_event_drop_last(text[]) TO nusantara_app;

-- Refuse to finish if the ledger has become writable beyond these two doors.
DO $check$
BEGIN
  IF has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'DELETE')
     OR has_column_privilege('nusantara_app', '"UnitEvent"', 'unitId', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"UnitEvent"', 'seq', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"UnitEvent"', 'type', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"UnitEvent"', 'toStatus', 'UPDATE')
     OR NOT has_column_privilege('nusantara_app', '"UnitEvent"', 'serial', 'UPDATE')
     OR NOT has_function_privilege('nusantara_app', 'unit_event_drop_last(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'ledger_serial_rename_and_last_event: the ledger is writable by nusantara_app beyond its serial column and unit_event_drop_last';
  END IF;
END
$check$;
