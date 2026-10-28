-- The bot may say "belum pernah servis" only when QC said so AND the unit
-- has never been to the Service bench (owner, 2026-10-28; `servicedState`,
-- packages/domain). The stock lookups count a unit's `ServiceVisit` rows for
-- that, and the worker runs them as nusantara_agent, which had no privilege
-- on the table at all — so every search failed as the agent (found by
-- apps/worker/test/agentRole.test.ts).
--
-- Two columns and nothing else: WHICH unit a visit was for. Not the note,
-- not who sent it, not the dates, and no write of any kind. The deploy's
-- t|f|t|f|t grant query does not read this table.

GRANT SELECT ("id", "unitId") ON "ServiceVisit" TO nusantara_agent;

DO $$
BEGIN
  IF NOT has_column_privilege('nusantara_agent', '"ServiceVisit"', 'unitId', 'SELECT') THEN
    RAISE EXCEPTION 'nusantara_agent cannot read ServiceVisit.unitId';
  END IF;
  IF has_column_privilege('nusantara_agent', '"ServiceVisit"', 'note', 'SELECT')
     OR has_table_privilege('nusantara_agent', '"ServiceVisit"', 'INSERT')
     OR has_table_privilege('nusantara_agent', '"ServiceVisit"', 'UPDATE')
     OR has_table_privilege('nusantara_agent', '"ServiceVisit"', 'DELETE') THEN
    RAISE EXCEPTION 'nusantara_agent holds more on ServiceVisit than which unit it was for';
  END IF;
END
$$;
