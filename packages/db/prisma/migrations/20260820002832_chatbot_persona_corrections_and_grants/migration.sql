-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT,
    "prompt" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "builtIn" BOOLEAN NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCorrection" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "original" TEXT NOT NULL,
    "corrected" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Persona_name_key" ON "Persona"("name");

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCorrection" ADD CONSTRAINT "AgentCorrection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written half. Everything below is invariant, not shape.
-- ============================================================================

-- Exactly one persona is active, structurally.
--
-- The same trick as OrderItem_unitId_unreturned_key: a partial unique index on
-- the flag itself. Two active personas would mean the worker and the Chat page
-- could disagree about the shop's voice, and nothing would say which was right.
CREATE UNIQUE INDEX "Persona_active_key" ON "Persona"("active") WHERE "active";

-- ----------------------------------------------------------------------------
-- Indexes the chat pipeline needs.
--
-- `WaMessage` has carried exactly one index since the first migration — the
-- unique on `waMessageId`. Both worker passes group over `from` every two
-- seconds, so today each poll is a sequential scan plus a hash aggregate over
-- the whole table. That is survivable at this shop's volume and stops being so
-- without anybody noticing, because the symptom is latency rather than error.
-- ----------------------------------------------------------------------------
CREATE INDEX "WaMessage_from_ts_idx" ON "WaMessage"("from", "ts");
CREATE INDEX "WaMessage_from_answeredAt_idx" ON "WaMessage"("from", "answeredAt");

-- The draft pass only ever looks for BARU rows, and they are a tiny fraction of
-- the table — a partial index is the whole working set.
CREATE INDEX "WaMessage_pending_idx"
  ON "WaMessage"("from")
  WHERE "direction" = 'IN' AND "status" = 'BARU';

-- The outbox claim orders by exactly this pair.
CREATE INDEX "Outbox_due_idx"
  ON "Outbox"("nextAttemptAt", "createdAt")
  WHERE "status" = 'PENDING';

-- ----------------------------------------------------------------------------
-- The agent is a principal, and an event has to be attributable.
--
-- `UnitEvent.staffId` is NOT NULL with an FK to Staff, so an agent-created
-- reservation hold needs a row to point at. `staff_system` is NOT it: its own
-- comment reserves it for backfilled history "so a report can always separate
-- real history from reconstructed", and reusing it would destroy exactly the
-- separation it exists to provide. It is also seeded rather than migrated, and
-- `seed()` truncates every table, so it can never run against production — the
-- FK would simply fail there.
--
-- Inserted here instead, idempotently, so the row exists in every environment.
-- `active = false` means it can never be logged into and never appears in a
-- staff picker; the hash is the same unusable constant the seed uses.
-- ----------------------------------------------------------------------------
INSERT INTO "Staff" (id, username, name, role, "canApprove", active, "passwordHash", "createdAt")
VALUES (
  'staff_agent',
  'agent',
  'Agen WhatsApp',
  'STAFF',
  false,
  false,
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  now()
)
ON CONFLICT (username) DO NOTHING;

-- No Persona row is inserted here, deliberately.
--
-- A migration cannot import `DEFAULT_PERSONA` from packages/agent — that
-- dependency runs the other way — so anything written here would be a copy that
-- drifts, and a placeholder would quietly become the shop's actual voice the
-- first time the worker read it. Instead the agent falls back to the compiled-in
-- constant whenever no persona is active, which is correct in a fresh database
-- and correct in production, and the Chat page writes a real row the moment
-- somebody edits the voice.

-- ----------------------------------------------------------------------------
-- Grants on the new tables.
--
-- Staff curate both; the agent only ever reads them. An agent that could write
-- AgentKnowledge or Persona would be writing its own instructions, permanently
-- — which is why the existing grants already made AgentKnowledge read-only to
-- it, and the same reasoning applies here.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "Persona", "AgentCorrection" TO nusantara_app;
GRANT SELECT ON "Persona", "AgentCorrection" TO nusantara_agent;
GRANT SELECT ON "Persona", "AgentCorrection" TO nusantara_readonly;
REVOKE INSERT, UPDATE ON "Persona", "AgentCorrection" FROM nusantara_agent;

-- ----------------------------------------------------------------------------
-- Close the create-path hole in invariant 13.
--
-- `REVOKE UPDATE` + `GRANT UPDATE (columns)` on WaThreadMemory made the split
-- structural for updates only. `GRANT ... INSERT ON ALL TABLES` is whole-row,
-- so the agent role could always CREATE a memory row with `directive` already
-- set — bypassing "the agent can never overwrite a staff directive" on the one
-- path nobody tested. Column-level INSERT closes it.
-- ----------------------------------------------------------------------------
-- (the column-level INSERT grant is issued below, after the blanket REVOKE)

-- ----------------------------------------------------------------------------
-- Make the forbidden tier structural.
--
-- Until now `GRANT SELECT, INSERT, UPDATE ON ALL TABLES ... TO nusantara_agent`
-- meant the agent role could insert an Order, record a Payment, or rewrite
-- Unit.price. The boundary existed only in application code — the tool
-- whitelist — so a bug in one file was the only thing between a customer's
-- sentence and the shop's money.
--
-- Written as an ALLOW-list, not a deny-list, and that choice is the point. A
-- deny-list is correct on the day it is written and wrong the first time
-- somebody adds a table: the new one is writable by the agent because nobody
-- remembered this file. Revoking everything and granting back the eight tables
-- the agent actually writes means a new table is forbidden by default, and
-- extending the agent's reach has to be deliberate.
--
-- SELECT is untouched throughout. The agent reads widely and writes almost
-- nothing, which is the shape a customer-facing bot should have.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON ALL TABLES IN SCHEMA public FROM nusantara_agent;

-- What the draft pass writes: the answer onto the inbound row, and the send
-- intent. `Outbox` needs UPDATE too because the same worker claims and marks it.
GRANT INSERT, UPDATE ON "WaMessage", "Outbox" TO nusantara_agent;

-- Raw envelopes, for the webhook if it is ever run under this role.
GRANT INSERT, UPDATE ON "WaRawEvent", "IgRawEvent" TO nusantara_agent;

-- The one guarded write: a booking, its line, and the ledger entry that
-- justifies holding the unit. UnitEvent is INSERT-only for everybody already.
GRANT INSERT, UPDATE ON "Reservation", "ReservationItem" TO nusantara_agent;
GRANT INSERT ON "UnitEvent" TO nusantara_agent;

-- A customer may be CREATED by the bot and never edited by it. `update: {}` in
-- the upsert says the same thing in code; this says it where it cannot be
-- forgotten. Without it, a customer could rename themselves in the shop's CRM
-- with every message they send.
GRANT INSERT ON "Customer" TO nusantara_agent;

-- The decision cache is the agent's own.
GRANT INSERT, UPDATE ON "AgentCache" TO nusantara_agent;

-- Unit: the status projection is writable — that IS the reservation hold, and
-- appendUnitEvent writes it in the same transaction as the event. The money is
-- not writable, ever. Same column-ownership pattern as WaThreadMemory.
GRANT UPDATE ("status", "locationId", "version") ON "Unit" TO nusantara_agent;

-- Re-grant the WaThreadMemory columns: the blanket REVOKE above took them back.
GRANT INSERT ("id", "from", "customerId", "summary", "summaryAt", "summaryTurns",
              "coveredThroughAt", "coveredThroughId", "clarifyCount", "clarifyAt",
              "updatedAt")
  ON "WaThreadMemory" TO nusantara_agent;
GRANT UPDATE ("summary", "summaryAt", "summaryTurns",
              "coveredThroughAt", "coveredThroughId",
              "clarifyCount", "clarifyAt", "customerId", "updatedAt")
  ON "WaThreadMemory" TO nusantara_agent;
