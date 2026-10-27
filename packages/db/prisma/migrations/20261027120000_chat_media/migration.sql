-- A picture from staff's own device, sent in a /chat conversation (owner ask
-- 2026-10-27: staff can send a picture that is NOT in the POS). Owner-approved
-- table. Additive: one table, its grants, and wa_thread_delete replaced with
-- one more DELETE.
--
-- 1. "ChatMedia" — the bytes, what they are, how big, the thread they were
--    sent to and who uploaded them. "from" is the wa_id, a plain indexed
--    column like "ChatMemoryChunk"."from": there is no thread table to point
--    at (a thread is every "WaMessage" sharing a "from", and a
--    "WaThreadMemory" row exists only for some). The API writes the row and
--    the WA_IMAGE "Outbox" row naming it ("payload"."chatMediaId") in ONE
--    transaction; the worker reads the bytes at send time, as it reads a QC
--    photo's ("UnitNotePhoto"."data"). Nothing is ever updated, so nothing
--    grants UPDATE.
--
-- 2. Grants. Neither writer role gets default privileges (20260815070800).
--      nusantara_app    SELECT, INSERT   the API stores it and serves it back
--      nusantara_agent  SELECT           the worker reads the bytes to send
--    No DELETE, UPDATE or TRUNCATE for either. nusantara_readonly reads it
--    through the default privileges every table has (20260815060658).
--
-- 3. Deleting a conversation removes its pictures: wa_thread_delete is
--    replaced with every behaviour it had plus one DELETE on "ChatMedia".
--    Same signature, so its EXECUTE grant (nusantara_app only) carries over;
--    it is restated below and checked.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

CREATE TABLE "ChatMedia" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMedia_from_createdAt_idx" ON "ChatMedia"("from", "createdAt");

ALTER TABLE "ChatMedia" ADD CONSTRAINT "ChatMedia_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "Staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- What the route accepts, held by the database too: a wa_id, one of the three
-- image types, a size that is the bytes' own and at most 5 MB.
ALTER TABLE "ChatMedia" ADD CONSTRAINT "ChatMedia_shape" CHECK (
  "from" ~ '^[0-9]{6,20}$'
  AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
  AND "size" > 0
  AND "size" <= 5242880
  AND octet_length("data") = "size"
);

-- ---------------------------------------------------------------------------
-- 2. Grants.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON "ChatMedia" TO nusantara_app;
GRANT SELECT ON "ChatMedia" TO nusantara_agent;
REVOKE UPDATE, DELETE, TRUNCATE ON "ChatMedia" FROM nusantara_app, nusantara_agent;

-- ---------------------------------------------------------------------------
-- 3. wa_thread_delete, now taking the thread's pictures with it. Everything
--    else is 20261027090000's function, unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION wa_thread_delete(p_from text, p_staff text, p_at timestamp)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  removed integer := 0;
  n integer;
  kept_runs text[];
  kept_msgs text[];
  doomed_msgs text[];
BEGIN
  IF p_from IS NULL OR p_from !~ '^[0-9]{6,20}$' THEN
    RAISE EXCEPTION 'wa_thread_delete: % is not a wa_id', p_from;
  END IF;
  IF p_staff IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'wa_thread_delete: who and when are required';
  END IF;

  -- What the evaluations and corrections name stays: their runs, their
  -- messages, and the message each kept run names (AgentRun.messageId is
  -- RESTRICT, so a kept run pins its message).
  SELECT COALESCE(array_agg(DISTINCT e."runId"), '{}')
    INTO kept_runs
    FROM "AgentEvaluation" e
    JOIN "WaMessage" m ON m."id" = e."messageId"
   WHERE m."from" = p_from AND e."runId" IS NOT NULL;

  SELECT COALESCE(array_agg(DISTINCT k.id), '{}')
    INTO kept_msgs
    FROM (
      SELECT e."messageId" AS id
        FROM "AgentEvaluation" e
        JOIN "WaMessage" m ON m."id" = e."messageId"
       WHERE m."from" = p_from
      UNION
      SELECT c."messageId"
        FROM "AgentCorrection" c
        JOIN "WaMessage" m ON m."id" = c."messageId"
       WHERE m."from" = p_from
      UNION
      SELECT r."messageId"
        FROM "AgentRun" r
       WHERE r."id" = ANY (kept_runs) AND r."messageId" IS NOT NULL
    ) k;

  SELECT COALESCE(array_agg(m."id"), '{}')
    INTO doomed_msgs
    FROM "WaMessage" m
   WHERE m."from" = p_from AND NOT (m."id" = ANY (kept_msgs));

  -- Recall's copies of the words, whichever end names the thread.
  DELETE FROM "ChatMemoryChunk"
   WHERE "from" = p_from
      OR "fromMessageId" = ANY (doomed_msgs)
      OR "toMessageId" = ANY (doomed_msgs);
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "ChatAction"
   WHERE "from" = p_from OR "messageId" = ANY (doomed_msgs);
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "AgentRunStep"
   WHERE "runId" IN (
           SELECT r."id" FROM "AgentRun" r
            WHERE (r."from" = p_from OR r."messageId" = ANY (doomed_msgs))
              AND NOT (r."id" = ANY (kept_runs)));
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "AgentRun"
   WHERE ("from" = p_from OR "messageId" = ANY (doomed_msgs))
     AND NOT ("id" = ANY (kept_runs));
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  -- Before the messages: "coveredThroughId" points at one.
  DELETE FROM "WaThreadMemory" WHERE "from" = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "WaMessage" WHERE "id" = ANY (doomed_msgs);
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "Outbox" WHERE "payload"->>'to' = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  -- The pictures staff sent from their own device (20261027120000). After
  -- the Outbox rows that named them: nothing points at "ChatMedia" by a
  -- foreign key ("payload"."chatMediaId" is JSON), so the order is only
  -- tidiness — no queued send is left naming a picture that is gone.
  DELETE FROM "ChatMedia" WHERE "from" = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "WaRawEvent"
   WHERE jsonb_path_exists("payload",
           '$.entry[*].changes[*].value.messages[*].from ? (@ == $f)',
           jsonb_build_object('f', p_from))
      OR jsonb_path_exists("payload",
           '$.entry[*].changes[*].value.contacts[*].wa_id ? (@ == $f)',
           jsonb_build_object('f', p_from))
      OR jsonb_path_exists("payload",
           '$.entry[*].changes[*].value.statuses[*].recipient_id ? (@ == $f)',
           jsonb_build_object('f', p_from));
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "ReservationProposalItem"
   WHERE "proposalId" IN (SELECT "id" FROM "ReservationProposal" WHERE "from" = p_from);
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "ReservationProposal" WHERE "from" = p_from;
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  -- What survives is hidden the way a clear hides: a kept row is closed (it
  -- was answered — that is what a rating is of) and the thread starts again
  -- after this instant.
  IF array_length(kept_msgs, 1) > 0 THEN
    UPDATE "WaMessage"
       SET "status" = CASE WHEN "status" IN ('BARU', 'PERLU_STAF')
                           THEN 'DIJAWAB_STAF'::"WaMsgStatus" ELSE "status" END,
           "answeredAt" = LEAST(COALESCE("answeredAt", p_at), p_at)
     WHERE "id" = ANY (kept_msgs);
    INSERT INTO "WaThreadMemory"
           ("id", "from", "summaryTurns", "clarifyCount", "updatedAt",
            "clearedAt", "clearedById")
    VALUES ('wtm_' || replace(gen_random_uuid()::text, '-', ''), p_from, 0, 0,
            p_at, p_at, p_staff);
  END IF;

  RETURN removed;
END
$fn$;

REVOKE ALL ON FUNCTION wa_thread_delete(text, text, timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wa_thread_delete(text, text, timestamp) TO nusantara_app;

-- ---------------------------------------------------------------------------
-- Refuse to finish if the database says anything else.
-- ---------------------------------------------------------------------------

DO $check$
BEGIN
  IF NOT has_table_privilege('nusantara_app', '"ChatMedia"', 'SELECT')
     OR NOT has_table_privilege('nusantara_app', '"ChatMedia"', 'INSERT')
     OR NOT has_table_privilege('nusantara_agent', '"ChatMedia"', 'SELECT') THEN
    RAISE EXCEPTION 'chat media: a role cannot do what it needs on "ChatMedia"';
  END IF;
  IF has_table_privilege('nusantara_app', '"ChatMedia"', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"ChatMedia"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"ChatMedia"', 'TRUNCATE')
     OR has_table_privilege('nusantara_agent', '"ChatMedia"', 'INSERT')
     OR has_table_privilege('nusantara_agent', '"ChatMedia"', 'UPDATE')
     OR has_table_privilege('nusantara_agent', '"ChatMedia"', 'DELETE')
     OR has_table_privilege('nusantara_agent', '"ChatMedia"', 'TRUNCATE') THEN
    RAISE EXCEPTION 'chat media: "ChatMedia" is writable beyond INSERT by the API';
  END IF;
  -- The delete is still ONE door, and only the app may open it.
  IF has_function_privilege('nusantara_agent', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE')
     OR has_function_privilege('nusantara_readonly', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE')
     OR NOT has_function_privilege('nusantara_app', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE') THEN
    RAISE EXCEPTION 'chat media: wa_thread_delete is reachable by a role other than nusantara_app';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'chat media: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
