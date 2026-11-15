-- Instagram, connected straight to Meta with the Instagram API with Instagram
-- Login (owner-approved 2026-11-16, including the new tables).
-- docs/superpowers/specs/2026-11-16-instagram-design.md. Additive only.
--
-- An Instagram DM thread lives in the existing chat tables under the thread
-- key `ig:<IGSID>` ("WaMessage"."from" and every table keyed like it) — the
-- prefix is the channel; no column is added to any WhatsApp table.
--
-- 1. "IgContact" — one row per Instagram sender: the @username and the name
--    the User Profile API gives, fetched by the worker. The inbox and the
--    staff alert read the username from here.
-- 2. "IgConnection" — a singleton the worker writes (it holds the token, which
--    lives in worker.env and nowhere else): the account, when the token was
--    refreshed and when it expires, the last check. The Settings card reads it.
-- 3. "OutboxKind" gains IG_IMAGE, IG_PRIVATE_REPLY and IG_HIDE. IG_DM and
--    IG_REPLY have existed since the start and are first used now.
-- 4. "ChatMedia_shape" accepts an Instagram thread key as well as a wa_id.
-- 5. wa_thread_delete accepts an Instagram thread key and also removes that
--    sender's DM envelopes from "IgRawEvent"; otherwise it is 20261027150000's
--    function, unchanged. Same signature, so its EXECUTE grant carries over
--    and is restated.
-- 6. Grants. Neither writer role has default privileges (20260815070800):
--      IgContact, IgConnection  app SELECT · agent SELECT, INSERT, UPDATE
--      IgMedia                  app SELECT, INSERT, UPDATE ·
--                               agent SELECT, UPDATE(the fetched columns)
--      IgComment                app SELECT, INSERT, UPDATE ·
--                               agent SELECT, UPDATE("replyCommentId")
--      IgSettings               app SELECT, INSERT, UPDATE · agent SELECT
--    No DELETE or TRUNCATE for either role on any of them.
--
-- The deploy's grant query (t|f|t|f|t) reads "Unit", "UnitEvent" and
-- "UnitNotePhoto" only and reads the same after this.

-- ---------------------------------------------------------------------------
-- 1–2. The tables.
-- ---------------------------------------------------------------------------

CREATE TABLE "IgContact" (
    "id" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IgContact_igsid_key" ON "IgContact"("igsid");

ALTER TABLE "IgContact" ADD CONSTRAINT "IgContact_shape" CHECK (
  "igsid" ~ '^[0-9]{5,32}$'
  AND ("username" IS NULL OR length(btrim("username")) BETWEEN 1 AND 64)
);

CREATE TABLE "IgConnection" (
    "id" TEXT NOT NULL,
    "igUserId" TEXT,
    "username" TEXT,
    "name" TEXT,
    "accountType" TEXT,
    "tokenRefreshedAt" TIMESTAMP(3),
    "tokenExpiresAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgConnection_pkey" PRIMARY KEY ("id")
);

-- A singleton: the one Instagram account the shop has connected.
ALTER TABLE "IgConnection" ADD CONSTRAINT "IgConnection_singleton"
  CHECK ("id" = 'singleton');

-- ---------------------------------------------------------------------------
-- 3. The send kinds.
-- ---------------------------------------------------------------------------

ALTER TYPE "OutboxKind" ADD VALUE IF NOT EXISTS 'IG_IMAGE';
ALTER TYPE "OutboxKind" ADD VALUE IF NOT EXISTS 'IG_PRIVATE_REPLY';
ALTER TYPE "OutboxKind" ADD VALUE IF NOT EXISTS 'IG_HIDE';

-- ---------------------------------------------------------------------------
-- 4. A picture staff send to an Instagram thread.
-- ---------------------------------------------------------------------------

ALTER TABLE "ChatMedia" DROP CONSTRAINT "ChatMedia_shape";
ALTER TABLE "ChatMedia" ADD CONSTRAINT "ChatMedia_shape" CHECK (
  "from" ~ '^([0-9]{6,20}|ig:[0-9]{5,32})$'
  AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
  AND "size" > 0
  AND "size" <= 5242880
  AND octet_length("data") = "size"
);

-- ---------------------------------------------------------------------------
-- 5. Deleting an Instagram conversation.
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
-- 6. Grants.
-- ---------------------------------------------------------------------------

GRANT SELECT ON "IgContact", "IgConnection" TO nusantara_app;
GRANT SELECT, INSERT, UPDATE ON "IgContact", "IgConnection" TO nusantara_agent;
REVOKE INSERT, UPDATE ON "IgContact", "IgConnection" FROM nusantara_app;

GRANT SELECT, INSERT, UPDATE ON "IgMedia", "IgComment", "IgSettings" TO nusantara_app;
GRANT SELECT ON "IgMedia", "IgComment", "IgSettings" TO nusantara_agent;
GRANT UPDATE ("caption", "mediaType", "permalink", "thumbnailUrl", "timestamp", "fetchedAt")
  ON "IgMedia" TO nusantara_agent;
GRANT UPDATE ("replyCommentId") ON "IgComment" TO nusantara_agent;

GRANT SELECT, INSERT, UPDATE ON "IgRawEvent" TO nusantara_app;

REVOKE DELETE, TRUNCATE
  ON "IgContact", "IgConnection", "IgMedia", "IgComment", "IgSettings", "IgRawEvent"
  FROM nusantara_app, nusantara_agent;

GRANT SELECT ON "IgContact", "IgConnection" TO nusantara_readonly;
