-- `Unit.description` — what QC saw, as a comma-joined list of phrases.
--
-- The column every docblock in this repo already refers to and which was never
-- actually added. `apps/web` reads it in thirty-one files; `schema.prisma` did
-- not have it, and CLAUDE.md's rule is that where the two disagree the schema
-- wins — so until now the schema said those thirty-one files were reading
-- something that did not exist. It exists now (owner decision 2026-09-02).
--
-- NULLABLE, for two independent reasons:
--
--   1. Sealed stock has nothing to describe. "New needs neither" (owner
--      decision 2026-08-28) — there is nothing to inspect in an unopened box,
--      so the QC grid does not ask and must not be forced to invent one.
--   2. Every unit taken in before today has none. A NOT NULL would need a
--      backfilled default, and '' would be a description somebody wrote.
--
-- The rule that a SECOND-HAND unit may not be accepted without one is a QC
-- rule, not a storage rule, and it stays in `lib/inboundQc.ts` where it can say
-- why it is refusing.

ALTER TABLE "Unit" ADD COLUMN "description" TEXT;

-- No GRANT here, and that is deliberate rather than an omission.
--
-- The grants in 20260815060658 are TABLE-level for "Unit" (SELECT, INSERT,
-- UPDATE to nusantara_app; SELECT to nusantara_readonly), and a table-level
-- privilege covers every column the table has, including ones added later. The
-- ⚠️ in CLAUDE.md is about new TABLES, which arrive with no grants at all and
-- are unreadable to the app until their migration says otherwise.
--
-- Column-level grants exist in this database in exactly one place — the
-- disjoint ownership of "WaThreadMemory", which is what makes invariant 13
-- structural — and adding one here would silently REPLACE the table-level
-- grant for this column with something narrower.
--
-- Proven rather than assumed: the assertion below fails the migration if a
-- fresh database does not in fact let the app role write this column.

DO $$
BEGIN
  IF NOT (
    has_column_privilege('nusantara_app', '"Unit"', 'description', 'SELECT') AND
    has_column_privilege('nusantara_app', '"Unit"', 'description', 'INSERT') AND
    has_column_privilege('nusantara_app', '"Unit"', 'description', 'UPDATE')
  ) THEN
    RAISE EXCEPTION
      'nusantara_app cannot write Unit.description — the table-level grant did not cover the new column'
      USING HINT = 'Add an explicit column grant here and say why the assumption failed.';
  END IF;

  -- The reader must see it too, or the Monitor app and every report go blind
  -- to a column Inventory shows.
  IF NOT has_column_privilege('nusantara_readonly', '"Unit"', 'description', 'SELECT') THEN
    RAISE EXCEPTION 'nusantara_readonly cannot read Unit.description';
  END IF;
END
$$;
