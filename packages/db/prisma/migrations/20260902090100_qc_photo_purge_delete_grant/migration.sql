-- ===========================================================================
-- The one sanctioned hard delete, granted.
--
-- CLAUDE.md: "Nothing is ever hard-deleted, with exactly one sanctioned
-- exception: QC photos are purged — row and file both — when the unit is sold
-- (owner decision 2026-08-24)."
--
-- That exception was unimplementable. Migration 20260815060658 does
--
--     REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public
--       FROM nusantara_app, nusantara_agent, nusantara_readonly;
--
-- and nothing has granted it back since, on any table. Verified against the
-- dev database before writing this: DELETE on "UnitNote" and "UnitNotePhoto"
-- was held by `nusantara` — the migration/owner role — and by nobody else. A
-- developer's shell connects as that owner and so never sees it; the API
-- connecting as `nusantara_app` gets SQLSTATE 42501 on the first sale of a
-- photographed machine.
--
-- Scope, deliberately: these two tables, this one role.
--
--   * `nusantara_agent` is NOT granted. The purge is a consequence of a sale,
--     which the agent cannot make. A bot that can delete photographs is a
--     larger blast radius bought for nothing.
--   * `nusantara_readonly` is NOT granted, obviously — Monitor and reporting.
--   * TRUNCATE stays revoked everywhere. The purge names serials; it never
--     empties a table, and the two failure modes are not comparable.
--
-- Considered and rejected: enforcing "only QC notes, only once sold" in the
-- database with RLS or a BEFORE DELETE trigger, the way invariants 13 and 14
-- are structural rather than conventional. It would be the stricter thing, but
-- an RLS policy on "UnitNote" also has to be written not to change what SELECT
-- returns, and a trigger encodes the sale rule in a second place that can
-- disagree with the application's. The grant is the privilege this feature
-- needs and no more; the narrowing is a separate decision with its own risks.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
END
$grants$;

GRANT DELETE ON "UnitNote", "UnitNotePhoto" TO nusantara_app;
