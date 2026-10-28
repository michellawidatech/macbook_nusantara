-- Chatbot → Settings, 2026-10-28 (owner: "set the prompt — can choose & have
-- multiple but 1 is used"). The prompt in use is the ACTIVE `Persona`
-- (already one at most, `Persona_active_key`), and the worker reads that one.
--
-- 1. Data: until today the bot's voice was the row holding the ADVISOR seat
--    (`Persona.agent`), which outranked the active one. Where such a row
--    exists it becomes the active one, so the voice the shop has today is
--    the voice it has after this release. Deactivate first: the partial
--    unique index allows one active row.
UPDATE "Persona" SET "active" = false, "updatedAt" = now()
 WHERE "active"
   AND EXISTS (SELECT 1 FROM "Persona" WHERE "agent" = 'ADVISOR')
   AND "agent" IS DISTINCT FROM 'ADVISOR';
UPDATE "Persona" SET "active" = true, "updatedAt" = now()
 WHERE "agent" = 'ADVISOR' AND NOT "active";

-- 2. A prompt nobody uses can be deleted (the tenth sanctioned hard delete;
--    the route refuses the active and the built-in one). No row points at
--    `Persona`. DELETE on this table to the app and nothing else.
GRANT DELETE ON "Persona" TO nusantara_app;

DO $$
BEGIN
  IF has_table_privilege('nusantara_agent', '"Persona"', 'DELETE') THEN
    RAISE EXCEPTION 'nusantara_agent must not delete a prompt';
  END IF;
END
$$;
