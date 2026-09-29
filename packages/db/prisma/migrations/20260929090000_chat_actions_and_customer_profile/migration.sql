-- The chatbot's hand-overs become action items, and what it learns about a
-- customer is kept (owner ask 2026-09-29, owner-approved schema).
--
--  - ChatAction: the task a hand-over leaves for a person — a negotiation to
--    answer, a price nobody set, a booking the bot may not make — with the
--    figures a staff member needs so they do not re-read the conversation.
--  - CustomerProfile: what the customer told the bot about themselves, keyed
--    by wa_id because most people who write in have no Customer row yet.
--
-- The four capability switches (stock, price, reservation, photos) need no
-- column: they are AppSetting keys `chatbot.stock` … `chatbot.photos`.
--
-- Additive: no existing row changes, and the release before this one never
-- reads either table.

CREATE TYPE "ChatActionKind" AS ENUM (
  'NEGOTIATION',
  'PRICE',
  'STOCK',
  'RESERVATION',
  'PHOTOS',
  'OTHER'
);

CREATE TYPE "ChatActionStatus" AS ENUM ('OPEN', 'DONE');

CREATE TABLE "ChatAction" (
  "id"           TEXT NOT NULL,
  "from"         TEXT NOT NULL,
  "customerId"   TEXT,
  "kind"         "ChatActionKind" NOT NULL,
  "status"       "ChatActionStatus" NOT NULL DEFAULT 'OPEN',
  "topic"        TEXT NOT NULL,
  "summary"      TEXT NOT NULL,
  "customerText" TEXT,
  "unitId"       TEXT,
  "skuId"        TEXT,
  "listPrice"    BIGINT,
  "askPrice"     BIGINT,
  "staffPrice"   BIGINT,
  "messageId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedById" TEXT,

  CONSTRAINT "ChatAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatAction_from_status_idx" ON "ChatAction"("from", "status");
CREATE INDEX "ChatAction_status_updatedAt_idx" ON "ChatAction"("status", "updatedAt");

-- One open task of a kind per thread: the upsert the worker relies on, held
-- where a race between two ticks cannot break it.
CREATE UNIQUE INDEX "ChatAction_one_open_per_kind"
  ON "ChatAction"("from", "kind") WHERE "status" = 'OPEN';

ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "WaMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money is whole rupiah and never negative; a done task says who and when.
ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_prices_nonneg" CHECK (
  ("listPrice" IS NULL OR "listPrice" >= 0) AND
  ("askPrice" IS NULL OR "askPrice" > 0) AND
  ("staffPrice" IS NULL OR "staffPrice" > 0)
);
ALTER TABLE "ChatAction" ADD CONSTRAINT "ChatAction_done_is_resolved" CHECK (
  "status" = 'OPEN' OR "resolvedAt" IS NOT NULL
);

CREATE TABLE "CustomerProfile" (
  "id"            TEXT NOT NULL,
  "from"          TEXT NOT NULL,
  "customerId"    TEXT,
  "name"          TEXT,
  "useCase"       TEXT,
  "budget"        BIGINT,
  "currentDevice" TEXT,
  "preference"    TEXT,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerProfile_from_key" ON "CustomerProfile"("from");

ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_budget_pos" CHECK (
  "budget" IS NULL OR "budget" > 0
);

-- Grants. The agent role is an allow-list since 20260820002832: a new table
-- is unreadable and unwritable by it until named here. It writes both tables
-- (the hand-over's task, and what the customer told it), and deletes neither.
GRANT SELECT, INSERT, UPDATE ON "ChatAction", "CustomerProfile" TO nusantara_agent;
-- Staff resolve the tasks and read the profile; nothing deletes either.
GRANT SELECT, INSERT, UPDATE ON "ChatAction", "CustomerProfile" TO nusantara_app;
REVOKE DELETE, TRUNCATE ON "ChatAction", "CustomerProfile" FROM nusantara_app, nusantara_agent;
