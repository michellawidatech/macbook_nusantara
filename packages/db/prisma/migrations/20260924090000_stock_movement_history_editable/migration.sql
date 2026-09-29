-- The stock movement history is editable (owner ask 2026-09-24): "make the
-- movement log editable ... each row is editable."
--
-- Two tables hold that history. A unit's adjustment is a "StockAdjustment"
-- row; a counted product's is a KOREKSI "StockMove". Both were written once
-- and never again — 20260913120000 revoked UPDATE on the first, and
-- 20260919120000 never granted it on the second — and both stay that way for
-- everything that makes a row what it IS: which unit, which way the stock
-- moved, how many pieces, at what cost, whose batch, whose hand. What a person
-- can get wrong and find out about later is granted per column instead: when,
-- why, the sentence, and the battery reading typed alongside a unit.
--
-- Column-level, deliberately. has_table_privilege(..., 'UPDATE') stays false on
-- both tables, so the 20260913 self-check and the deploy's grant query read as
-- before, and no code path — not the store's adapters, which refuse it first
-- (packages/db/src/store/adapters/units.ts, stock.ts), and not a bug in one —
-- can rewrite a quantity or move a row onto another unit.
--
-- Additive and safe for the release before this one: a grant changes no shape,
-- and a release that never issues the UPDATE is unaffected by being allowed to.
-- No StoreChange rows: nothing any till has projected changes.

GRANT UPDATE ("at", "reasonId", "description", "batteryHealth", "cycleCount", "fcc")
  ON "StockAdjustment" TO nusantara_app;

GRANT UPDATE ("at", "reasonId", "note")
  ON "StockMove" TO nusantara_app;

-- Refuse to finish if the ledger half of either table has become writable.
DO $check$
BEGIN
  IF has_table_privilege('nusantara_app', '"StockAdjustment"', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"StockMove"', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"StockAdjustment"', 'unitId', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"StockAdjustment"', 'kind', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"StockMove"', 'qty', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"StockMove"', 'skuId', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"StockMove"', 'unitCost', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"StockMove"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"StockAdjustment"', 'DELETE') THEN
    RAISE EXCEPTION 'stock_movement_history_editable: a ledger column of StockMove or StockAdjustment is writable by nusantara_app';
  END IF;
END
$check$;
