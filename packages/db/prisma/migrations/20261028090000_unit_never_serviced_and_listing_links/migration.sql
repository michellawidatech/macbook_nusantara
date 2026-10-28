-- Unit details and listing links (owner-approved, 2026-10-28;
-- docs/superpowers/specs/2026-10-28-unit-details-offers-links-design.md §5).
-- Additive: four nullable columns and three CHECKs. Nothing is backfilled.
--
-- 1. "Unit"."neverServiced" — asked at QC: has this unit ever been serviced
--    or opened? TRUE = never, FALSE = it has. NULL = not answered, and every
--    unit taken in before today is NULL; NULL is never read as either answer.
--    A service visit recorded in this app says "serviced" whatever this holds.
--
-- 2. "Sku"."shopeeUrl" / "tokopediaUrl" / "instagramUrl" — the variant's own
--    marketplace listings, which the bot sends a customer who asks to buy
--    online. Per VARIANT: one listing sells every unit of it. Each is NULL
--    (no listing there) or an https:// address of at most 500 characters —
--    the store contract says the same, this is where it cannot be forgotten.
--
-- No GRANT here, deliberately. The grants in 20260815060658 are TABLE-level
-- for "Unit" and "Sku" (SELECT, INSERT, UPDATE to nusantara_app; SELECT to
-- nusantara_readonly), and a table-level privilege covers columns added
-- later. 20260820002832 revoked the agent's INSERT/UPDATE on every table but
-- left its table-level SELECT untouched, so nusantara_agent reads the four
-- new columns already and writes none of them (its only "Unit" write is the
-- column grant on status/locationId/version). Adding a column grant here
-- would only narrow what already holds. The DO block below proves it on the
-- database this runs against rather than assuming it.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" table privileges only and reads the same after this.

-- ---------------------------------------------------------------------------
-- 1. The QC answer.
-- ---------------------------------------------------------------------------

ALTER TABLE "Unit" ADD COLUMN "neverServiced" BOOLEAN;

-- ---------------------------------------------------------------------------
-- 2. The listing links.
-- ---------------------------------------------------------------------------

ALTER TABLE "Sku" ADD COLUMN "shopeeUrl" TEXT;
ALTER TABLE "Sku" ADD COLUMN "tokopediaUrl" TEXT;
ALTER TABLE "Sku" ADD COLUMN "instagramUrl" TEXT;

ALTER TABLE "Sku" ADD CONSTRAINT "Sku_shopeeUrl_https" CHECK (
  "shopeeUrl" IS NULL OR ("shopeeUrl" ~ '^https://' AND length("shopeeUrl") <= 500)
);
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_tokopediaUrl_https" CHECK (
  "tokopediaUrl" IS NULL OR ("tokopediaUrl" ~ '^https://' AND length("tokopediaUrl") <= 500)
);
ALTER TABLE "Sku" ADD CONSTRAINT "Sku_instagramUrl_https" CHECK (
  "instagramUrl" IS NULL OR ("instagramUrl" ~ '^https://' AND length("instagramUrl") <= 500)
);

-- ---------------------------------------------------------------------------
-- 3. The grants hold without a GRANT.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('"Unit"', 'neverServiced'),
      ('"Sku"', 'shopeeUrl'),
      ('"Sku"', 'tokopediaUrl'),
      ('"Sku"', 'instagramUrl')
    ) AS t(tbl, col)
  LOOP
    IF NOT (
      has_column_privilege('nusantara_app', c.tbl, c.col, 'SELECT') AND
      has_column_privilege('nusantara_app', c.tbl, c.col, 'INSERT') AND
      has_column_privilege('nusantara_app', c.tbl, c.col, 'UPDATE')
    ) THEN
      RAISE EXCEPTION 'nusantara_app cannot write %.% — the table-level grant did not cover it', c.tbl, c.col
        USING HINT = 'Add an explicit column grant here and say why the assumption failed.';
    END IF;

    IF NOT has_column_privilege('nusantara_agent', c.tbl, c.col, 'SELECT') THEN
      RAISE EXCEPTION 'nusantara_agent cannot read %.%', c.tbl, c.col;
    END IF;
    IF has_column_privilege('nusantara_agent', c.tbl, c.col, 'UPDATE')
       OR has_column_privilege('nusantara_agent', c.tbl, c.col, 'INSERT') THEN
      RAISE EXCEPTION 'nusantara_agent can write %.% — it must not', c.tbl, c.col;
    END IF;

    IF NOT has_column_privilege('nusantara_readonly', c.tbl, c.col, 'SELECT') THEN
      RAISE EXCEPTION 'nusantara_readonly cannot read %.%', c.tbl, c.col;
    END IF;
  END LOOP;
END
$$;
