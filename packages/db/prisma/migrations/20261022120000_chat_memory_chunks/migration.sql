-- Chatbot memory: per-turn chunks of a WhatsApp thread, for recall
-- (owner, 2026-10-22). Hand-written, additive only.
--
-- One row per answered turn — every inbound line of the burst and the reply
-- — written by the worker after the reply is on the wire, and embedded by it
-- through Voyage AI when VOYAGE_API_KEY is set. The vector is int8, one byte
-- per dimension, in BYTEA. No pgvector: it is not installed on the Mac mini
-- and CREATE EXTENSION needs a superuser; recall only ever scores ONE
-- customer's own chunks (dozens), so a scan in JS is enough.
--
-- Both message links are RESTRICT: the chunk is a copy of those messages'
-- words, so a purge of a message must take its chunk with it, never leave
-- the words behind under a dangling or nulled link.

-- CreateTable
CREATE TABLE "ChatMemoryChunk" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "fromMessageId" TEXT NOT NULL,
    "toMessageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" BYTEA,
    "model" TEXT,
    "dims" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embeddedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMemoryChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMemoryChunk_from_createdAt_idx" ON "ChatMemoryChunk"("from", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMemoryChunk" ADD CONSTRAINT "ChatMemoryChunk_fromMessageId_fkey" FOREIGN KEY ("fromMessageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMemoryChunk" ADD CONSTRAINT "ChatMemoryChunk_toMessageId_fkey" FOREIGN KEY ("toMessageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An embedding is all four columns or none of them, and its byte length is
-- its dimension count (int8: one byte each).
ALTER TABLE "ChatMemoryChunk" ADD CONSTRAINT "ChatMemoryChunk_embedded" CHECK (
  ("embedding" IS NULL AND "model" IS NULL AND "dims" IS NULL AND "embeddedAt" IS NULL)
  OR ("embedding" IS NOT NULL AND "model" IS NOT NULL AND "dims" > 0
      AND "embeddedAt" IS NOT NULL AND octet_length("embedding") = "dims")
);

-- ---------------------------------------------------------------------------
-- Grants. Neither writer role gets default privileges (20260815070800), and
-- the agent role is an allow-list (20260820002832). The worker
-- (nusantara_agent) writes the chunk and later its embedding; the words of a
-- chunk are never rewritten, so UPDATE is the four embedding columns only.
-- nusantara_app gets nothing: the API never reads this table. No change to
-- nusantara_app's existing grants, so the deploy's grant query reads as
-- before.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON "ChatMemoryChunk" TO nusantara_agent;
GRANT UPDATE ("embedding", "model", "dims", "embeddedAt")
  ON "ChatMemoryChunk" TO nusantara_agent;
REVOKE DELETE, TRUNCATE ON "ChatMemoryChunk" FROM nusantara_app, nusantara_agent;
