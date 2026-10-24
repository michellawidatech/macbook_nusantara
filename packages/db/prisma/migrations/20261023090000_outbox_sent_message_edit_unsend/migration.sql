-- Editing and unsending what the shop sent (owner ask 2026-10-23: "Display the
-- photo that we sent as well. Can we edit or unsend from the web? I would want
-- to do that in case the AI is wrong.").
--
-- Three nullable columns on "Outbox", additive only:
--
--   "providerMessageId"  the id WhatsApp gave the message when it went out —
--                        what an edit or a delete-for-everyone must name. The
--                        worker writes it when it marks the row SENT; a row
--                        sent before this release has none, and so can be
--                        neither edited nor unsent.
--   "retractedAt"        when staff unsent it (delete for everyone).
--   "editedAt"           when staff last corrected its text; the new text is
--                        "payload"."body", the old one is in the AuditLog row.
--
-- Nothing is deleted: an unsent message keeps its row, so the conversation can
-- say "Unsent" where it was, and the AuditLog row says who did it.
--
-- Grants. Both writer roles ALREADY hold table-level UPDATE on "Outbox" —
-- nusantara_app from 20260815060658's `GRANT SELECT, INSERT, UPDATE ON ALL
-- TABLES`, nusantara_agent from 20260820002832's allow-list (the worker claims
-- and marks rows) — and a table-level grant covers columns added later. So no
-- GRANT is issued and nothing is widened: the API (nusantara_app) can write
-- "retractedAt", "editedAt" and "payload" the way it always could, the worker
-- (nusantara_agent) "providerMessageId". The DO block below refuses to finish
-- if that is not what the database says.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only; it reads the same after this.

ALTER TABLE "Outbox"
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "retractedAt" TIMESTAMP(3),
  ADD COLUMN "editedAt" TIMESTAMP(3);

DO $check$
BEGIN
  IF NOT has_column_privilege('nusantara_app', '"Outbox"', 'retractedAt', 'UPDATE')
     OR NOT has_column_privilege('nusantara_app', '"Outbox"', 'editedAt', 'UPDATE')
     OR NOT has_column_privilege('nusantara_app', '"Outbox"', 'payload', 'UPDATE')
     OR NOT has_column_privilege('nusantara_agent', '"Outbox"', 'providerMessageId', 'UPDATE')
     OR NOT has_column_privilege('nusantara_agent', '"Outbox"', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'outbox edit/unsend: a writer role cannot update the columns it needs on "Outbox"';
  END IF;
  -- Never wider than before: nobody deletes or truncates the queue.
  IF has_table_privilege('nusantara_app', '"Outbox"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"Outbox"', 'TRUNCATE')
     OR has_table_privilege('nusantara_agent', '"Outbox"', 'DELETE')
     OR has_table_privilege('nusantara_agent', '"Outbox"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'outbox edit/unsend: "Outbox" is deletable by a writer role';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'outbox edit/unsend: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
