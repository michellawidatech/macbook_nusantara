/**
 * `/new` — a tester starts the conversation over (owner ask 2026-10-14:
 * *"when the user type /new it will start a new chat and retrieve no context
 * of the user"*).
 *
 * It exists for trying the bot out. Judging an answer means asking the same
 * question again from a clean slate, and without this the second ask is
 * answered in the light of the first: the last eight turns, the rolling
 * summary, and — once the bot has handed a thread to a person — nothing at
 * all, because the hold keeps it silent until staff reply.
 *
 * ## Three decisions, all the owner's (2026-10-14)
 *
 *  - **Tester numbers only.** A reset closes the thread's hand-over rows and
 *    open tasks (it used to have to lift the hand-over hold, gone since
 *    2026-10-27), and a command that does that must not be one a customer
 *    can type: it would dismiss the task a colleague is working on.
 *    The list is an `AppSetting` row the owner edits on /chat. From anybody
 *    else `/new` is an ordinary message.
 *  - **The conversation only.** What is left behind is what the chat itself
 *    produced: earlier turns, the summary, open hand-over tasks. A customer
 *    record the POS holds under that phone — a name, purchases, a booking —
 *    is still found, exactly as it is for any number writing in again.
 *  - **Nothing is deleted.** The inbox keeps every message. The reset is a
 *    MARK: the `/new` row itself, stamped `RESET_INTENT`, and everything that
 *    reads a thread's past reads only what was answered after it
 *    (`resetPointFor`).
 *
 * The worker's half — claiming the row, lifting the hold, queueing the
 * confirmation — is apps/worker/src/reset.ts.
 */
import type { PrismaClient } from "@nusantara/db";

/** `WaMessage.intent` on the row that reset its thread, and on what it closed. */
export const RESET_INTENT = "sistem:reset";

/** The `AppSetting` key holding the tester numbers, comma-joined wa_ids. */
export const TESTERS_SETTING_KEY = "chatbot.testers";

/** More than a handful is a customer list, which is what this must not be. */
export const MAX_TESTERS = 20;

/**
 * What the tester hears. Fixed, not drafted: it confirms a command, and it is
 * the one line the reset is allowed to say about itself.
 */
export const RESET_REPLY =
  "Chat baru dimulai ✅ Percakapan sebelumnya tidak dipakai lagi (mode tes).";

/** Is this message the command, and nothing else? */
export function isResetCommand(text: string | null | undefined): boolean {
  return (text ?? "").trim().toLowerCase() === "/new";
}

/**
 * A phone number as WhatsApp writes a wa_id: digits only, country code first.
 * `0812…` is read as Indonesian. Null for anything that is not a number.
 */
export function toWaId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const id = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return id.length >= 8 && id.length <= 15 ? id : null;
}

/** The stored list, read forgivingly: a bad entry is dropped, not fatal. */
export function parseTesters(value: string | null | undefined): string[] {
  const ids = (value ?? "")
    .split(",")
    .map((v) => toWaId(v))
    .filter((v): v is string => v !== null);
  return [...new Set(ids)].slice(0, MAX_TESTERS);
}

export const formatTesters = (ids: readonly string[]): string =>
  parseTesters(ids.join(",")).join(",");

export async function loadTesters(db: PrismaClient): Promise<string[]> {
  const row = await db.appSetting.findUnique({
    where: { key: TESTERS_SETTING_KEY },
    select: { value: true },
  });
  return parseTesters(row?.value);
}

/**
 * When this thread last started over, or null if it never did.
 *
 * Two things start a conversation over, and this is the LATER of them: a
 * tester's `/new` (the row stamped `RESET_INTENT`), and staff pressing *Clear
 * chat* on /chat (`WaThreadMemory.clearedAt`, owner ask 2026-10-27) — which
 * makes the bot forget a customer's conversation exactly as `/new` does,
 * without the customer typing anything. Every reader of a thread's past goes
 * through here: the draft's history, recall and "which unit was shown", the
 * summary and memory passes, and so *Write it for me*.
 *
 * Compared against `answeredAt`, which the server stamps, never against `ts`,
 * which is the sender's phone clock in whole seconds: a turn belongs to the
 * new conversation when it was answered after the reset was.
 */
export async function resetPointFor(
  db: PrismaClient,
  from: string,
): Promise<Date | null> {
  const [row, memory] = await Promise.all([
    db.waMessage.findFirst({
      where: {
        from,
        direction: "IN",
        intent: RESET_INTENT,
        answeredAt: { not: null },
      },
      orderBy: { answeredAt: "desc" },
      select: { answeredAt: true },
    }),
    db.waThreadMemory.findUnique({
      where: { from },
      select: { clearedAt: true },
    }),
  ]);
  return laterOf(row?.answeredAt ?? null, memory?.clearedAt ?? null);
}

/** The later of two instants, either of which may be absent. */
export function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * The thread's rolling summary, or null when it describes a conversation
 * from before the reset point. A summary covers turns up to
 * `coveredThroughAt`; one that stops at or before the point is all old
 * conversation. The app role cannot blank the summary (invariant 13: it is
 * the agent's column), so a clear hides it here and the summary pass starts
 * afresh on the next turn instead.
 */
export function summarySince(
  memory: { summary: string | null; coveredThroughAt: Date | null } | null,
  since: Date | null,
): string | null {
  if (!memory?.summary) return null;
  if (!since) return memory.summary;
  if (
    !memory.coveredThroughAt ||
    memory.coveredThroughAt.getTime() <= since.getTime()
  )
    return null;
  return memory.summary;
}
