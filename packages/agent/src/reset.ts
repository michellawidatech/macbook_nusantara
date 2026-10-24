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
 *  - **Tester numbers only.** A reset has to lift a hand-over hold or the bot
 *    stays silent after it, and a command that lifts a hold must not be one a
 *    customer can type: it would dismiss the task a colleague is working on.
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
 * Compared against `answeredAt`, which the server stamps, never against `ts`,
 * which is the sender's phone clock in whole seconds: a turn belongs to the
 * new conversation when it was answered after the reset was.
 */
export async function resetPointFor(
  db: PrismaClient,
  from: string,
): Promise<Date | null> {
  const row = await db.waMessage.findFirst({
    where: {
      from,
      direction: "IN",
      intent: RESET_INTENT,
      answeredAt: { not: null },
    },
    orderBy: { answeredAt: "desc" },
    select: { answeredAt: true },
  });
  return row?.answeredAt ?? null;
}
