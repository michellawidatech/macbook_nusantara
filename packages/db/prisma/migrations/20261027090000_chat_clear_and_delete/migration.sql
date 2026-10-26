-- Clearing and deleting a WhatsApp conversation, and taking back a rating
-- (owner asks 2026-10-27).
--
-- 1. *Clear chat* — any signed-in staff, audited. The conversation leaves
--    /chat and the bot forgets it exactly as a tester's `/new` makes it
--    forget: every reader of the thread's past starts at the later of the
--    last `/new` and "WaThreadMemory"."clearedAt" (packages/agent reset.ts
--    `resetPointFor`). NOTHING is deleted. Two staff-owned columns:
--
--      "clearedAt"    when it was cleared; null = never.
--      "clearedById"  who (FK → "Staff", RESTRICT, like "leadStaffById").
--
--    Invariant 13 — disjoint column ownership on "WaThreadMemory": UPDATE
--    there is granted per column, so both new columns go to nusantara_app
--    ONLY. The agent role can read them (table-level SELECT) and never write
--    them. The app role already holds table-level INSERT (20260815060658),
--    which covers a column added later, so a clear on a thread with no memory
--    row can create one.
--
-- 2. *Delete conversation* — OWNER ONLY, behind a typed confirm. PERMANENT.
--    "wa_thread_delete(from, staff, at)" is a SECURITY DEFINER function, the
--    one door to a DELETE on the chat tables (neither writer role holds
--    DELETE on any of them, and none is granted here). It removes, in an
--    order every RESTRICT foreign key accepts:
--      "ChatMemoryChunk", "ChatAction", "AgentRunStep" + "AgentRun",
--      "WaThreadMemory", "WaMessage", "Outbox" rows addressed to the number
--      ("payload"->>'to'), "WaRawEvent" envelopes naming it (a message's
--      `from`, a contact's `wa_id`, a status's `recipient_id`), and
--      "ReservationProposalItem" + "ReservationProposal".
--    and KEEPS (owner answer, "keep the knowledge"):
--      the knowledge base (never touched), "CustomerProfile" and its facts,
--      the POS "Customer", every "AgentEvaluation" and "AgentCorrection" —
--      and therefore exactly the "WaMessage" and "AgentRun" rows those name,
--      plus the message a kept run names. A real "Reservation" is a hold on a
--      unit and is never touched.
--    When anything is kept, a fresh "WaThreadMemory" row is written with
--    "clearedAt" = the delete's instant, so the kept rows (all answered at
--    or before it) stay hidden from /chat and from every reader of the past.
--    Returns how many rows it removed. EXECUTE: nusantara_app only.
--    ⚠️ The seventh sanctioned hard delete. Do not generalise it.
--
-- 3. *Undo 👍/👎* — DELETE on "AgentEvaluation" to nusantara_app, nothing
--    else. Nothing references "AgentEvaluation" (it references its message,
--    run and correction, never the reverse), so a delete orphans nothing; the
--    API refuses an APPLIED one, which became a knowledge-base correction.
--
-- Additive and safe for the release before this one: two nullable columns, a
-- function and a grant. The deploy's grant query (t|f|t|f|t) reads "Unit",
-- "UnitEvent" and "UnitNotePhoto" only and reads the same after this.

-- ---------------------------------------------------------------------------
-- 1. Clear.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaThreadMemory"
  ADD COLUMN "clearedAt" TIMESTAMP(3),
  ADD COLUMN "clearedById" TEXT;

ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_clearedById_fkey"
  FOREIGN KEY ("clearedById") REFERENCES "Staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A clear names who cleared it, and a name means a clear.
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_cleared_whole" CHECK (
  ("clearedAt" IS NULL) = ("clearedById" IS NULL)
);

GRANT UPDATE ("clearedAt", "clearedById") ON "WaThreadMemory" TO nusantara_app;

-- ---------------------------------------------------------------------------
-- 2. Delete.
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
-- 3. Undo a rating.
-- ---------------------------------------------------------------------------

GRANT DELETE ON "AgentEvaluation" TO nusantara_app;

-- ---------------------------------------------------------------------------
-- Refuse to finish if the database says anything else.
-- ---------------------------------------------------------------------------

DO $check$
BEGIN
  -- The clear is staff's: the app writes both columns, the agent neither.
  IF NOT has_column_privilege('nusantara_app', '"WaThreadMemory"', 'clearedAt', 'UPDATE')
     OR NOT has_column_privilege('nusantara_app', '"WaThreadMemory"', 'clearedById', 'UPDATE')
     OR has_column_privilege('nusantara_agent', '"WaThreadMemory"', 'clearedAt', 'UPDATE')
     OR has_column_privilege('nusantara_agent', '"WaThreadMemory"', 'clearedById', 'UPDATE')
     OR has_column_privilege('nusantara_agent', '"WaThreadMemory"', 'clearedAt', 'INSERT')
     OR has_column_privilege('nusantara_agent', '"WaThreadMemory"', 'clearedById', 'INSERT') THEN
    RAISE EXCEPTION 'chat clear: "clearedAt"/"clearedById" are not the app role''s alone';
  END IF;
  -- The delete is ONE door, and only the app may open it.
  IF has_function_privilege('nusantara_agent', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE')
     OR has_function_privilege('nusantara_readonly', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE')
     OR NOT has_function_privilege('nusantara_app', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE') THEN
    RAISE EXCEPTION 'chat delete: wa_thread_delete is reachable by a role other than nusantara_app';
  END IF;
  IF has_table_privilege('nusantara_app', '"WaMessage"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"WaThreadMemory"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"Outbox"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"AgentRun"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"AgentCorrection"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"CustomerProfile"', 'DELETE')
     OR has_table_privilege('nusantara_agent', '"WaMessage"', 'DELETE')
     OR has_table_privilege('nusantara_agent', '"AgentEvaluation"', 'DELETE') THEN
    RAISE EXCEPTION 'chat delete: a writer role can DELETE a chat table directly';
  END IF;
  IF NOT has_table_privilege('nusantara_app', '"AgentEvaluation"', 'DELETE') THEN
    RAISE EXCEPTION 'rating undo: nusantara_app cannot delete an evaluation';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'chat clear/delete: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
