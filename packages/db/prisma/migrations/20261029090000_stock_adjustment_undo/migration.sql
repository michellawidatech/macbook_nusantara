-- ===========================================================================
-- A stock adjustment can be undone, and the undo leaves no row in the history
-- (owner ask 2026-10-29: "they should be able to undo the stock movement and
-- it will be erased from the history").
--
-- Two records make an adjustment:
--
-- * a unit's: one "StockAdjustment" row beside its KOREKSI "UnitEvent". The
--   event goes through `unit_event_drop` (20261022140000), which is already
--   the app's door to the ledger; the adjustment row is a record OF that
--   event, nothing points at it, and this grants DELETE on it alone.
-- * a counted product's: one KOREKSI "StockMove" carrying a reason. On-hand is
--   SUM(qty), so table-level DELETE on that ledger stays revoked and
--   `stock_move_drop_adjustment` is the one door: it removes only a KOREKSI
--   with a reason and no order, invoice or stock-take link — exactly the rows
--   Stock Movement History lists — and refuses the lot otherwise. The store
--   adapter (adapters/stock.ts) checks the shelf does not go below zero.
--
-- The deploy's grant query (t|f|t|f|t) reads neither table. This is the
-- eleventh sanctioned hard delete. Do not generalise it.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

GRANT DELETE ON "StockAdjustment" TO nusantara_app;

CREATE OR REPLACE FUNCTION stock_move_drop_adjustment(ids text[]) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  offending text;
  removed integer;
BEGIN
  SELECT m.id INTO offending
    FROM "StockMove" m
   WHERE m.id = ANY(ids)
     AND (m.type <> 'KOREKSI'
          OR m."reasonId" IS NULL
          OR m."orderId" IS NOT NULL
          OR m."orderItemId" IS NOT NULL
          OR m."purchaseOrderId" IS NOT NULL
          OR m."poItemId" IS NOT NULL
          OR m."opnameSessionId" IS NOT NULL)
   LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'Pergerakan stok % bukan penyesuaian stok — tidak bisa dibatalkan.', offending
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM "StockMove" WHERE id = ANY(ids);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION stock_move_drop_adjustment(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stock_move_drop_adjustment(text[]) TO nusantara_app;

DO $check$
BEGIN
  IF has_table_privilege('nusantara_app', '"StockMove"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"StockMove"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"StockAdjustment"', 'DELETE')
     OR NOT has_function_privilege('nusantara_app', 'stock_move_drop_adjustment(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'stock_adjustment_undo: grants are not what this migration says';
  END IF;
END
$check$;
