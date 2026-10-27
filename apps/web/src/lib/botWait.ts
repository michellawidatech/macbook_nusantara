/**
 * Why a customer message is still waiting, in words /chat can show under it
 * (2026-10-27, owner: *"improve the chatbot to not get stuck"*). The bot used
 * to fall silent with nothing on the screen to say why; every reason it can
 * stay out of a chat is now one of these, read from what GET
 * /api/inbox/:phone already carries (`botWait`, `autoReply`, the row's
 * status and hand-over note).
 */

import type { Handoff, InboxMessage } from "./inboxApi.js";

/** GET /api/inbox/:phone `botWait`. */
export interface BotWait {
  /** A colleague TYPED a reply here; the bot stays out until `until`. */
  staffActive: { by: string | null; at: string; until: string } | null;
  /** A turn holds the thread right now. */
  writing: boolean;
  /** Past this a message the bot could answer is late. */
  staleAfterMs: number;
}

export type WaitReason =
  /** The bot handed it to a person, on purpose. */
  | { kind: "handed_over"; topic: string | null }
  /** The bot could not answer (the model failed, a turn timed out, the watchdog). */
  | { kind: "bot_failed" }
  /** Staff switched the bot off for this chat. */
  | { kind: "bot_off" }
  /** A colleague typed a reply a few minutes ago; the bot is holding off. */
  | { kind: "staff_active"; by: string | null; minutes: number }
  /** The bot should have answered by now and has not. */
  | { kind: "bot_late"; minutes: number };

/** `forcedBy` values the worker writes when the bot itself gave up. */
const BOT_GAVE_UP = new Set(["no_reply", "failed", "deadline", "stale"]);

/** Three minutes, as the worker's watchdog: what an older reply means. */
export const DEFAULT_STALE_MS = 3 * 60_000;

/**
 * Null when nothing is waiting on a person: an answered row, or a fresh one
 * the bot answers in seconds (outlining that would flicker).
 */
export function waitReason(
  m: Pick<InboxMessage, "direction" | "status" | "at"> & {
    handoff: Pick<Handoff, "topic" | "forcedBy"> | null;
  },
  conversation: {
    autoReply: { enabled: boolean };
    botWait?: BotWait | null;
  },
  nowMs: number,
): WaitReason | null {
  if (m.direction !== "IN") return null;
  if (m.status === "PERLU_STAF") {
    return m.handoff?.forcedBy && BOT_GAVE_UP.has(m.handoff.forcedBy)
      ? { kind: "bot_failed" }
      : { kind: "handed_over", topic: m.handoff?.topic ?? null };
  }
  if (m.status !== "BARU") return null;
  if (!conversation.autoReply.enabled) return { kind: "bot_off" };
  const wait = conversation.botWait;
  const minutesSince = (iso: string) =>
    Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
  if (wait?.staffActive && new Date(wait.staffActive.until).getTime() > nowMs)
    return {
      kind: "staff_active",
      by: wait.staffActive.by,
      minutes: minutesSince(wait.staffActive.at),
    };
  const late = wait?.staleAfterMs ?? DEFAULT_STALE_MS;
  if (!wait?.writing && nowMs - new Date(m.at).getTime() >= late)
    return { kind: "bot_late", minutes: minutesSince(m.at) };
  return null;
}
