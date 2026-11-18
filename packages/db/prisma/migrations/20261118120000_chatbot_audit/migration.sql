-- The chatbot audit (2026-11-18, docs/superpowers/specs/2026-11-18-chatbot-audit-design.md).
-- Additive only.
--
-- 1. "Staff"."canViewAudit" — may open /audit. Default false; switched on for
--    the login `widatech` and nobody else. Never read or written by
--    /api/staff, so the owner can neither see nor change it. No GRANT:
--    "Staff" is granted to nusantara_app at TABLE level (20260815060658).
-- 2. "ChatReviewRun" / "ChatReviewThread" / "ChatReviewFlag" — one night of
--    review, the chats it read (and the cursor), the flags. The worker writes
--    them as nusantara_agent; the app reads them and may only dismiss a flag.
-- 3. wa_thread_delete also removes a deleted conversation's review rows —
--    "ChatReviewFlag"."messageId" is RESTRICT. Otherwise 20261116120000's
--    function, unchanged; same signature, so the grant carries over and is
--    restated.
-- 4. Grants:
--      the three tables   agent SELECT, INSERT, UPDATE · app SELECT ·
--                         app UPDATE("dismissedAt", "dismissedById") on the flags
--    DELETE and TRUNCATE for neither role.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.

-- CreateEnum
CREATE TYPE "ReviewRunStatus" AS ENUM ('RUNNING', 'DONE', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewCategory" AS ENUM ('WRONG_FACT', 'UNANSWERED', 'HANDOVER', 'RULE_BROKEN', 'TONE', 'MISSED_SALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReviewSeverity" AS ENUM ('BAD', 'IMPROVE');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "canViewAudit" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatReviewRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "status" "ReviewRunStatus" NOT NULL,
    "reason" TEXT,
    "chats" INTEGER NOT NULL DEFAULT 0,
    "flags" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ChatReviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReviewThread" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "reviewedFrom" TIMESTAMP(3) NOT NULL,
    "reviewedTo" TIMESTAMP(3) NOT NULL,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatReviewThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReviewFlag" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "category" "ReviewCategory" NOT NULL,
    "severity" "ReviewSeverity" NOT NULL,
    "quote" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,

    CONSTRAINT "ChatReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatReviewRun_startedAt_idx" ON "ChatReviewRun"("startedAt");

-- CreateIndex
CREATE INDEX "ChatReviewThread_from_reviewedTo_idx" ON "ChatReviewThread"("from", "reviewedTo");

-- CreateIndex
CREATE INDEX "ChatReviewThread_runId_idx" ON "ChatReviewThread"("runId");

-- CreateIndex
CREATE INDEX "ChatReviewFlag_threadId_idx" ON "ChatReviewFlag"("threadId");

-- CreateIndex
CREATE INDEX "ChatReviewFlag_createdAt_idx" ON "ChatReviewFlag"("createdAt");

-- CreateIndex
CREATE INDEX "ChatReviewFlag_messageId_idx" ON "ChatReviewFlag"("messageId");

-- AddForeignKey
ALTER TABLE "ChatReviewThread" ADD CONSTRAINT "ChatReviewThread_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChatReviewRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReviewFlag" ADD CONSTRAINT "ChatReviewFlag_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatReviewThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReviewFlag" ADD CONSTRAINT "ChatReviewFlag_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReviewFlag" ADD CONSTRAINT "ChatReviewFlag_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Who may open /audit on the day it ships.
-- ---------------------------------------------------------------------------

UPDATE "Staff" SET "canViewAudit" = true WHERE lower(username) = 'widatech';

-- ---------------------------------------------------------------------------
-- 3. Deleting a conversation takes its review rows.
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
  IF p_from IS NULL OR p_from !~ '^([0-9]{6,20}|ig:[0-9]{5,32})$' THEN
    RAISE EXCEPTION 'wa_thread_delete: % is not a thread key', p_from;
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

  -- The chatbot audit's reading of this chat (20261118120000): its flags
  -- name messages (RESTRICT), so they go before the messages, then the
  -- thread rows they hang off.
  DELETE FROM "ChatReviewFlag"
   WHERE "messageId" = ANY (doomed_msgs)
      OR "threadId" IN (SELECT "id" FROM "ChatReviewThread" WHERE "from" = p_from);
  GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;

  DELETE FROM "ChatReviewThread" WHERE "from" = p_from;
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

  -- An Instagram thread's DM envelopes (20261116120000): the ones it sent,
  -- and the echoes of what the shop sent it. Comments are not a thread's —
  -- they are public, on the shop's own posts, and stay on the Comments tab.
  IF p_from LIKE 'ig:%' THEN
    DELETE FROM "IgRawEvent"
     WHERE jsonb_path_exists("payload",
             '$.entry[*].messaging[*].sender.id ? (@ == $f)',
             jsonb_build_object('f', substr(p_from, 4)))
        OR jsonb_path_exists("payload",
             '$.entry[*].messaging[*].recipient.id ? (@ == $f)',
             jsonb_build_object('f', substr(p_from, 4)));
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed + n;
  END IF;

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
-- 4. Grants.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON "ChatReviewRun", "ChatReviewThread", "ChatReviewFlag" TO nusantara_agent;
GRANT SELECT ON "ChatReviewRun", "ChatReviewThread", "ChatReviewFlag" TO nusantara_app;
GRANT UPDATE ("dismissedAt", "dismissedById") ON "ChatReviewFlag" TO nusantara_app;
REVOKE DELETE, TRUNCATE
  ON "ChatReviewRun", "ChatReviewThread", "ChatReviewFlag"
  FROM nusantara_app, nusantara_agent;
GRANT SELECT ON "ChatReviewRun", "ChatReviewThread", "ChatReviewFlag" TO nusantara_readonly;

DO $$
BEGIN
  IF has_table_privilege('nusantara_app', '"ChatReviewFlag"', 'INSERT')
     OR has_table_privilege('nusantara_app', '"ChatReviewRun"', 'UPDATE')
     OR has_table_privilege('nusantara_app', '"ChatReviewFlag"', 'DELETE')
     OR has_table_privilege('nusantara_agent', '"ChatReviewFlag"', 'DELETE') THEN
    RAISE EXCEPTION 'chatbot audit grants are wider than intended';
  END IF;
  IF NOT has_column_privilege('nusantara_app', '"ChatReviewFlag"', 'dismissedAt', 'UPDATE') THEN
    RAISE EXCEPTION 'nusantara_app must be able to dismiss a flag';
  END IF;
END
$$;
