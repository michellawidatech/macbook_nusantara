-- ===========================================================================
-- Indexes for reading the audit log.
--
-- `GET /api/kontrol/audit` returned a hardcoded `{ entries: [] }` until now,
-- so nothing had ever SELECTed this table and it carried no index but its
-- primary key. The three added here are the three questions the screen asks:
--
--   at                    "what happened lately" — the default listing
--   entity, entityId, at  "what happened to THIS row" — the timeline of one
--                         order, one unit, one staff account
--   staffId, at           "what did this person do" — the reason an audit log
--                         exists at all
--
-- `at` descends in all three: an audit reader is always newest-first, and a
-- btree walked backwards for every page is the one access pattern worth
-- spending an index's sort direction on.
--
-- AuditLog is INSERT-only for the app role (invariant 14, migration
-- 20260815060658), so these cost three index writes per audit row and are
-- never touched by an UPDATE.
--
-- NOTE for a large deployment: these are plain CREATE INDEX, which takes a
-- write lock for the duration. Prisma runs a migration in one transaction, so
-- CONCURRENTLY cannot be used here. On a table big enough for that to matter,
-- build them by hand with CONCURRENTLY first — an index that already exists
-- makes this migration a no-op.
-- ===========================================================================

CREATE INDEX IF NOT EXISTS "AuditLog_at_idx"
  ON "AuditLog" ("at" DESC);

CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_at_idx"
  ON "AuditLog" ("entity", "entityId", "at" DESC);

CREATE INDEX IF NOT EXISTS "AuditLog_staffId_at_idx"
  ON "AuditLog" ("staffId", "at" DESC);
