-- Chatbot v2 (owner ask 2026-10-14; schema changes owner-approved the same
-- day: "if you need a schema change it is ok, make sure it will be fine in
-- deployment"). docs/chatbot-v2-design.md is the design.
--
--  - WaThreadMemory: a per-thread LEASE so the worker answers threads in
--    parallel without ever answering one twice; the 🔥 lead tag in two halves
--    (the bot's, the staff's) plus the clear a sale writes; the inbox read
--    marker behind the unread count.
--  - CustomerProfile: the budget as a range, an age band and an occupation
--    (both shown as estimates), and CustomerProfileFact for the bullets —
--    usage, apps, preferences — as rows, because JSON columns are forbidden.
--  - ReservationProposal(+Item): a booking the bot has proposed and the
--    customer has not confirmed. It holds nothing; confirm makes the real
--    Reservation.
--  - AgentRun(+Step): one row per bot turn — what the router read, which agents
--    ran, tokens, cost and latency.
--  - AgentEvaluation: a staff 👍/👎 on one reply; Apply writes the correction.
--  - Persona.agent: one persona per agent (ROUTER / ADVISOR / OPERATIONS).
--
-- Deploy-safe: every change is additive, every new column is nullable or has
-- a default, and the release before this one selects none of them. Nothing is
-- dropped — CustomerProfile.budget stays one release for the old reader.
--
-- ⚠️ `prisma migrate diff` also emitted DROP INDEX for "Expense_orderId_idx"
-- and "ManualIncome_orderId_idx" (hand-written in 20260923090000, never
-- declared in the schema). They are NOT dropped here.

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('ROUTER', 'ADVISOR', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "ProfileFactKind" AS ENUM ('USAGE', 'APP', 'PREFERENCE', 'ABOUT');

-- CreateEnum
CREATE TYPE "FactSource" AS ENUM ('BOT', 'STAFF');

-- CreateEnum
CREATE TYPE "EvalRating" AS ENUM ('GOOD', 'BAD');

-- CreateEnum
CREATE TYPE "EvalReason" AS ENUM ('WRONG_FACT', 'WRONG_TONE', 'TOO_LONG', 'MISSED_QUESTION', 'SHOULD_ESCALATE', 'SHOULD_NOT_ESCALATE', 'OTHER');

-- CreateEnum
CREATE TYPE "EvalStatus" AS ENUM ('OPEN', 'APPLIED', 'DISMISSED');

-- AlterTable
ALTER TABLE "CustomerProfile" ADD COLUMN     "ageEstimate" TEXT,
ADD COLUMN     "budgetMax" BIGINT,
ADD COLUMN     "budgetMin" BIGINT,
ADD COLUMN     "occupation" TEXT;

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "agent" "AgentRole";

-- AlterTable
ALTER TABLE "WaThreadMemory" ADD COLUMN     "leadAt" TIMESTAMP(3),
ADD COLUMN     "leadClearedAt" TIMESTAMP(3),
ADD COLUMN     "leadScore" INTEGER,
ADD COLUMN     "leadStaffAt" TIMESTAMP(3),
ADD COLUMN     "leadStaffById" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "leasedBy" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CustomerProfileFact" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" "ProfileFactKind" NOT NULL,
    "value" TEXT NOT NULL,
    "source" "FactSource" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerProfileFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationProposal" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "custName" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reservationId" TEXT,

    CONSTRAINT "ReservationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationProposalItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReservationProposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "messageId" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "pipeline" TEXT NOT NULL,
    "language" TEXT,
    "tone" TEXT,
    "intent" TEXT,
    "leadScore" INTEGER,
    "escalateTopic" TEXT,
    "outcome" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "agent" "AgentRole" NOT NULL,
    "model" TEXT NOT NULL,
    "tool" TEXT,
    "ok" BOOLEAN NOT NULL,
    "ms" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvaluation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "runId" TEXT,
    "rating" "EvalRating" NOT NULL,
    "reason" "EvalReason",
    "agent" "AgentRole",
    "note" TEXT,
    "corrected" TEXT,
    "status" "EvalStatus" NOT NULL DEFAULT 'OPEN',
    "correctionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AgentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerProfileFact_profileId_idx" ON "CustomerProfileFact"("profileId");

-- CreateIndex
CREATE INDEX "CustomerProfileFact_kind_value_idx" ON "CustomerProfileFact"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationProposal_reservationId_key" ON "ReservationProposal"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationProposal_from_createdAt_idx" ON "ReservationProposal"("from", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationProposalItem_proposalId_unitId_key" ON "ReservationProposalItem"("proposalId", "unitId");

-- CreateIndex
CREATE INDEX "AgentRun_from_createdAt_idx" ON "AgentRun"("from", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_messageId_idx" ON "AgentRun"("messageId");

-- CreateIndex
CREATE INDEX "AgentRunStep_runId_idx" ON "AgentRunStep"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvaluation_correctionId_key" ON "AgentEvaluation"("correctionId");

-- CreateIndex
CREATE INDEX "AgentEvaluation_status_createdAt_idx" ON "AgentEvaluation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_messageId_idx" ON "AgentEvaluation"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_agent_key" ON "Persona"("agent");

-- AddForeignKey
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_leadStaffById_fkey" FOREIGN KEY ("leadStaffById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfileFact" ADD CONSTRAINT "CustomerProfileFact_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfileFact" ADD CONSTRAINT "CustomerProfileFact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationProposal" ADD CONSTRAINT "ReservationProposal_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationProposalItem" ADD CONSTRAINT "ReservationProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ReservationProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationProposalItem" ADD CONSTRAINT "ReservationProposalItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "AgentCorrection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfills.
-- ---------------------------------------------------------------------------

-- A stated budget is a range of one.
UPDATE "CustomerProfile"
   SET "budgetMin" = "budget", "budgetMax" = "budget"
 WHERE "budget" IS NOT NULL;

-- Today's active persona is the voice customers read: the Sales Advisor's.
UPDATE "Persona" SET "agent" = 'ADVISOR' WHERE "active";

-- ---------------------------------------------------------------------------
-- Checks.
-- ---------------------------------------------------------------------------

ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_leadScore_range" CHECK (
  "leadScore" IS NULL OR "leadScore" BETWEEN 0 AND 100
);
-- A lease names its holder, and a holder holds until a time.
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_lease_whole" CHECK (
  ("leaseUntil" IS NULL) = ("leasedBy" IS NULL)
);
ALTER TABLE "WaThreadMemory" ADD CONSTRAINT "WaThreadMemory_leadStaff_whole" CHECK (
  "leadStaffAt" IS NULL OR "leadStaffById" IS NOT NULL
);

ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_budget_range" CHECK (
  ("budgetMin" IS NULL OR "budgetMin" > 0) AND
  ("budgetMax" IS NULL OR "budgetMax" > 0) AND
  ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
);

ALTER TABLE "CustomerProfileFact" ADD CONSTRAINT "CustomerProfileFact_value_shape" CHECK (
  length(btrim("value")) BETWEEN 1 AND 120
);
-- A staff fact says who; a bot fact names nobody.
ALTER TABLE "CustomerProfileFact" ADD CONSTRAINT "CustomerProfileFact_source_author" CHECK (
  ("source" = 'STAFF') = ("createdById" IS NOT NULL)
);

-- The proposal is for the sender's own number and nobody else's.
ALTER TABLE "ReservationProposal" ADD CONSTRAINT "ReservationProposal_from_waid" CHECK (
  "from" ~ '^[0-9]{8,15}$'
);
ALTER TABLE "ReservationProposal" ADD CONSTRAINT "ReservationProposal_name" CHECK (
  length(btrim("custName")) >= 1
);
ALTER TABLE "ReservationProposal" ADD CONSTRAINT "ReservationProposal_expiry" CHECK (
  "expiresAt" > "createdAt"
);
-- Confirmed means a reservation exists, and the reverse; never both confirmed
-- and cancelled.
ALTER TABLE "ReservationProposal" ADD CONSTRAINT "ReservationProposal_confirmed_is_booked" CHECK (
  ("confirmedAt" IS NULL) = ("reservationId" IS NULL) AND
  ("confirmedAt" IS NULL OR "cancelledAt" IS NULL)
);

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_outcome" CHECK (
  "outcome" IN ('REPLIED', 'HANDOFF', 'SKIPPED', 'ERROR')
);
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_counts_nonneg" CHECK (
  "inputTokens" >= 0 AND "cachedTokens" >= 0 AND "outputTokens" >= 0 AND
  "costMicros" >= 0 AND "latencyMs" >= 0 AND
  ("leadScore" IS NULL OR "leadScore" BETWEEN 0 AND 100)
);
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_counts_nonneg" CHECK (
  "ms" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0
);

-- A decided evaluation says who decided; an applied one names its correction.
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_reviewed" CHECK (
  "status" = 'OPEN' OR ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
);
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_applied_has_correction" CHECK (
  ("status" = 'APPLIED') = ("correctionId" IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Grants. Neither writer role gets default privileges (20260815070800), and
-- the agent role is an allow-list (20260820002832): a new table is closed to
-- both until it is named here.
-- ---------------------------------------------------------------------------

-- Invariant 13 — disjoint column ownership on WaThreadMemory. UPDATE there is
-- granted per column, so a new column is writable by nobody until named. The
-- lease and the bot's lead half are the agent's; the staff lead half, the
-- clear and the read marker are the app's. Neither role gets the other's.
GRANT INSERT ("leaseUntil", "leasedBy", "leadScore", "leadAt")
  ON "WaThreadMemory" TO nusantara_agent;
GRANT UPDATE ("leaseUntil", "leasedBy", "leadScore", "leadAt")
  ON "WaThreadMemory" TO nusantara_agent;
GRANT UPDATE ("leadStaffAt", "leadStaffById", "leadClearedAt", "readAt")
  ON "WaThreadMemory" TO nusantara_app;

-- ⚠️ The lease alone is ALSO granted to nusantara_app. It is coordination
-- between worker processes, not content either side owns, and on 2026-10-14
-- the Mac mini's worker connects with common.env's DATABASE_URL — that is,
-- as nusantara_app — although every pass in apps/worker is written for
-- nusantara_agent (worker.env.example now says so). Without this a deploy
-- that has not repointed the worker would claim no thread and answer nobody.
-- (nusantara_app already holds table-level INSERT here, so the INSERT path
-- needs no grant.)
GRANT UPDATE ("leaseUntil", "leasedBy") ON "WaThreadMemory" TO nusantara_app;

-- Profile facts: the bot adds what it hears, staff add and take back.
GRANT SELECT, INSERT, UPDATE ON "CustomerProfileFact" TO nusantara_agent, nusantara_app;

-- Proposals: written by the agent endpoints (API) and read by the worker.
GRANT SELECT, INSERT, UPDATE ON "ReservationProposal" TO nusantara_agent, nusantara_app;
GRANT SELECT, INSERT ON "ReservationProposalItem" TO nusantara_agent, nusantara_app;

-- Traces are append-only: the worker writes real turns, the API the simulator's.
GRANT SELECT, INSERT ON "AgentRun", "AgentRunStep" TO nusantara_agent, nusantara_app;

-- Evaluations are staff work; the agent may read them and nothing else.
GRANT SELECT, INSERT, UPDATE ON "AgentEvaluation" TO nusantara_app;
GRANT SELECT ON "AgentEvaluation" TO nusantara_agent;

REVOKE DELETE, TRUNCATE ON
  "CustomerProfileFact", "ReservationProposal", "ReservationProposalItem",
  "AgentRun", "AgentRunStep", "AgentEvaluation"
  FROM nusantara_app, nusantara_agent;
