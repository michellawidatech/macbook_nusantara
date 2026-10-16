-- ===========================================================================
-- A warehouse's code is the shop's own number for it (owner ask 2026-10-08).
--
-- The shop has called its warehouses 01, 02, 03 and 04 for six years, and the
-- app now prints that number beside the name everywhere a warehouse is shown.
-- `Location.code` was always the column for it, but the store adapter filled
-- it with the row's id — so the B2Soft master import left `wh-01`…`wh-04`
-- there, with the shop's number inside it.
--
-- Data only, no schema change: take the number back out of every code that
-- is still that id copy. A code somebody chose (`code <> id`) is untouched,
-- and so is any id that is not the importer's `wh-<digits>` shape.
-- ===========================================================================

UPDATE "Location"
SET code = substring(code FROM 4)
WHERE code = id
  AND code ~ '^wh-[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM "Location" other WHERE other.code = substring("Location".code FROM 4)
  );
