-- Per-thread bot switch: hand one customer to a person without switching the
-- bot off for the whole shop.
--
-- Lives on WaThreadMemory because that is already the one-row-per-`wa_id`
-- record (unique on "from") and already the home of the other standing staff
-- instruction, `directive`. A thread is otherwise just "every WaMessage sharing
-- a from" — there is no Thread table to hang this on, and this build does not
-- invent one.
--
-- DEFAULT true is the compatibility story: every row that exists, and every
-- number that has never been ruled on, keeps being answered by the bot exactly
-- as it was before this column.

ALTER TABLE "WaThreadMemory"
  ADD COLUMN "autoReply"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoReplyAt"   TIMESTAMP(3),
  ADD COLUMN "autoReplyById" TEXT;

ALTER TABLE "WaThreadMemory"
  ADD CONSTRAINT "WaThreadMemory_autoReplyById_fkey"
  FOREIGN KEY ("autoReplyById") REFERENCES "Staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariant 13 — disjoint column ownership on WaThreadMemory.
--
-- `REVOKE UPDATE` + `GRANT UPDATE (columns)` in 20260815060658 means UPDATE on
-- this table is granted per column and NOT covered by any blanket grant. A new
-- column is therefore unwritable by everybody until it is named here, so this
-- grant is not tidying — without it the toggle endpoint fails at runtime with a
-- permission error on a table the role can otherwise write.
--
-- The switch is staff-owned, like the directive beside it: whether the bot
-- answers a customer is a decision a person makes about that customer, and the
-- agent must not be able to grant itself a thread or quietly step off one. So
-- nusantara_app is granted these three columns and nusantara_agent is not, on
-- either the UPDATE path or the column-level INSERT path that 20260820002832
-- pinned down. The agent's create branch names its columns explicitly
-- (packages/agent/src/memory.ts) and does not name these, so a memory row the
-- summariser creates takes the DEFAULT above — true, the bot answers — which is
-- the safe direction for the one role that cannot choose.
-- ---------------------------------------------------------------------------
GRANT UPDATE ("autoReply", "autoReplyAt", "autoReplyById")
  ON "WaThreadMemory" TO nusantara_app;
