-- Sell, don't hold (owner, 2026-10-27): "the goal of this chatbot is to
-- convert the casual chatter to a lead and even customer … if reservation
-- makes the stock decrease and reduce sale, it is bad." Owner-approved
-- schema. Additive: one enum value, one table, three grants, and
-- wa_thread_delete replaced with one more DELETE.
--
-- 1. "ChatActionKind" gains CLOSING — the customer is ready to buy, wants a
--    unit kept (a DP) or asks how to pay, and a person closes the sale. The
--    one-OPEN-task-per-(thread, kind) partial index covers it as it covers
--    every kind. Not used in this migration, so ADD VALUE is safe here.
--
-- 2. "StockWatch" — "tell me when it's in stock". Keyed by wa_id like
--    "ChatMemoryChunk"."from"; what was asked as text and, when the words
--    name exactly one, the product and/or the variant (RESTRICT: a watch is
--    history of what somebody wanted). The worker writes and closes them;
--    staff close one from /chat.
--      nusantara_agent  SELECT, INSERT, UPDATE
--      nusantara_app    SELECT, UPDATE ("closedAt") — closing is all /chat does
--    No DELETE or TRUNCATE for either; wa_thread_delete removes a deleted
--    conversation's.
--
-- 3. GRANT SELECT ON "StockMove" TO nusantara_agent. Counted stock is a
--    ledger and on-hand is its sum; the worker's out-of-stock answer offers
--    a fitting accessory from it, which as nusantara_agent it could not read
--    (CLAUDE.md 2026-10-27). Read only: the agent still writes no stock.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.

-- ---------------------------------------------------------------------------
-- 1. The closing task.
-- ---------------------------------------------------------------------------

ALTER TYPE "ChatActionKind" ADD VALUE IF NOT EXISTS 'CLOSING';

-- ---------------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------------

CREATE TABLE "StockWatch" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "customerId" TEXT,
    "query" TEXT NOT NULL,
    "modelId" TEXT,
    "skuId" TEXT,
    "budget" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "StockWatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockWatch_from_createdAt_idx" ON "StockWatch"("from", "createdAt");

ALTER TABLE "StockWatch" ADD CONSTRAINT "StockWatch_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockWatch" ADD CONSTRAINT "StockWatch_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "CatalogModel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockWatch" ADD CONSTRAINT "StockWatch_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "Sku"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- A thread, words, a ceiling that is money, and a task stamped no earlier
-- than the wish it answers.
ALTER TABLE "StockWatch" ADD CONSTRAINT "StockWatch_shape" CHECK (
  length(btrim("from")) > 0
  AND length(btrim("query")) BETWEEN 1 AND 200
  AND ("budget" IS NULL OR "budget" > 0)
  AND ("notifiedAt" IS NULL OR "notifiedAt" >= "createdAt")
  AND ("closedAt" IS NULL OR "closedAt" >= "createdAt")
);

-- ---------------------------------------------------------------------------
-- 3. Grants.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON "StockWatch" TO nusantara_agent;
GRANT SELECT ON "StockWatch" TO nusantara_app;
GRANT UPDATE ("closedAt") ON "StockWatch" TO nusantara_app;
REVOKE DELETE, TRUNCATE ON "StockWatch" FROM nusantara_app, nusantara_agent;

GRANT SELECT ON "StockMove" TO nusantara_agent;

-- ---------------------------------------------------------------------------
-- 4. wa_thread_delete, now taking the thread's stock watches with it.
--    Everything else is 20261027120000's function, unchanged.
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

  -- "Tell me when it's in stock" (20261027150000): the thread's own wishes.
  -- Nothing points at "StockWatch", so the order is free.
  DELETE FROM "StockWatch" WHERE "from" = p_from;
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
  IF NOT has_table_privilege('nusantara_agent', '"StockWatch"', 'SELECT')
     OR NOT has_table_privilege('nusantara_agent', '"StockWatch"', 'INSERT')
     OR NOT has_table_privilege('nusantara_agent', '"StockWatch"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"StockWatch"', 'SELECT')
     OR NOT has_column_privilege('nusantara_app', '"StockWatch"', 'closedAt', 'UPDATE')
     OR NOT has_table_privilege('nusantara_agent', '"StockMove"', 'SELECT') THEN
    RAISE EXCEPTION 'sales: a role cannot do what it needs';
  END IF;
  IF has_table_privilege('nusantara_app', '"StockWatch"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"StockWatch"', 'UPDATE')
     OR has_column_privilege('nusantara_app', '"StockWatch"', 'query', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"StockWatch"', 'DELETE')
     OR has_table_privilege('nusantara_app', '"StockWatch"', 'TRUNCATE')
     OR has_table_privilege('nusantara_agent', '"StockWatch"', 'DELETE')
     OR has_table_privilege('nusantara_agent', '"StockWatch"', 'TRUNCATE')
     OR has_table_privilege('nusantara_agent', '"StockMove"', 'INSERT')
     OR has_table_privilege('nusantara_agent', '"StockMove"', 'UPDATE')
     OR has_table_privilege('nusantara_agent', '"StockMove"', 'DELETE') THEN
    RAISE EXCEPTION 'sales: a role can do more than it was granted';
  END IF;
  -- The delete is still ONE door, and only the app may open it.
  IF has_function_privilege('nusantara_agent', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE')
     OR has_function_privilege('nusantara_readonly', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE')
     OR NOT has_function_privilege('nusantara_app', 'wa_thread_delete(text, text, timestamp)', 'EXECUTE') THEN
    RAISE EXCEPTION 'sales: wa_thread_delete is reachable by a role other than nusantara_app';
  END IF;
  -- The deploy's check, asked here too so a surprise shows at migrate time.
  IF NOT has_table_privilege('nusantara_app', '"Unit"', 'SELECT')
     OR has_table_privilege('nusantara_app', '"Unit"', 'DELETE')
     OR NOT has_table_privilege('nusantara_app', '"UnitEvent"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"UnitEvent"', 'UPDATE')
     OR NOT has_table_privilege('nusantara_app', '"UnitNotePhoto"', 'DELETE') THEN
    RAISE EXCEPTION 'sales: nusantara_app no longer reads t|f|t|f|t';
  END IF;
END
$check$;
