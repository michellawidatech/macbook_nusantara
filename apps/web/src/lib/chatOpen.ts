/**
 * Which chat /chat opens on by itself (owner, 2026-11-16: *"if the chat is
 * escalated, it should automatically open up to the latest request"*).
 *
 * "Waiting for a person" is the rule the outline and the sidebar count read
 * (`GET /api/inbox/waiting`): a message the bot handed over (PERLU_STAF), or
 * any unanswered message in a chat whose bot is switched off. A BARU message
 * with the bot on is the bot's, and answered in seconds.
 */
import type { InboxThread } from "./inboxApi.js";

/** When this thread's newest message waiting for a PERSON arrived, or null. */
export function waitingForPersonAt(th: InboxThread): string | null {
  const handedOver = th.handoff !== null ? (th.handoff.at ?? th.lastAt) : null;
  const botOff = !th.autoReply && th.pending > 0 ? th.lastAt : null;
  if (handedOver === null) return botOff;
  if (botOff === null) return handedOver;
  return handedOver > botOff ? handedOver : botOff;
}

/** The thread whose waiting message is the newest, or undefined. */
export function newestWaitingThread(
  threads: readonly InboxThread[],
): InboxThread | undefined {
  let best: InboxThread | undefined;
  let bestAt = "";
  for (const th of threads) {
    const at = waitingForPersonAt(th);
    if (at !== null && (best === undefined || at > bestAt)) {
      best = th;
      bestAt = at;
    }
  }
  return best;
}
