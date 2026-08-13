/**
 * Handing the conversation to a human — pure, no I/O.
 *
 * Telling a customer "aku sambungkan ke tim" is a promise, and the agent has two
 * ways to break it, both of which this module makes impossible:
 *
 *  - it SAYS a human is taking over but never calls `escalate_to_staff` → the
 *    burst is stamped DIJAWAB_AGEN and nobody ever picks the thread up. So
 *    {@link promisesHandoff} reads the outgoing reply, and the pipeline treats a
 *    promise as an escalation whether or not the tool was called.
 *  - it calls the tool but the reply never mentions it → the customer is queued
 *    and doesn't know. So the pipeline appends {@link handoffLine}.
 *
 * The wording obeys the same rule the agent does: never claim what we don't know.
 * We have no idea how fast staff answer, so we never promise "segera" or a
 * number of minutes — only the store's opening hours, which we do know.
 */

import { STORE } from "@nusantara/domain";
import { staffWindow } from "./clock.js";

/** Words for the people we hand off to. */
const HUMAN = "(?:tim|staf{1,2}|admin|rekan|owner|pemilik)";

/** Verbs that mean "they take it from here" (Indonesian prefixes/suffixes vary). */
const HANDS_OVER = "(?:sambung|hubung|terus|alih|serah|panggil|tanya|cek|konfirmasi|tangan|proses)";

/**
 * Does this reply tell the customer a human is taking over? Matches the verb and
 * the person in either order, within one clause — "aku sambungkan ke tim",
 * "biar tim kami yang cek", "nanti admin kami hubungi kakak".
 *
 * Deliberately loose: a false positive only queues a thread a human then closes,
 * while a false negative leaves a customer waiting on a promise nobody received.
 */
export function promisesHandoff(text: string): boolean {
  const re = new RegExp(
    `${HANDS_OVER}\\w*[^.!?\\n]{0,30}\\b${HUMAN}\\b` +
      `|\\b${HUMAN}\\b[^.!?\\n]{0,30}${HANDS_OVER}\\w*`,
    "iu",
  );
  return re.test(text);
}

/**
 * When the customer can expect a person — store hours only, never an invented
 * response time. Plain text (no emoji) so it can be appended to a reply that has
 * already been emoji-capped.
 */
export function handoffTiming(now: Date = new Date()): string {
  const { open, opensText } = staffWindow(now);
  if (open) return "Mohon ditunggu sebentar ya kak.";
  if (!opensText) return `Tim balas di jam operasional toko, ${STORE.hours} ya kak.`;
  return `Sekarang di luar jam operasional, jadi tim balas lagi ${opensText} ya kak.`;
}

/**
 * Appended to an agent reply that escalated without telling the customer, so the
 * handoff is never silent.
 */
export function handoffLine(now: Date = new Date()): string {
  return `Aku teruskan ke tim kami ya kak. ${handoffTiming(now)}`;
}

/**
 * Escalation reason for a thread the agent asked about and still could not
 * disambiguate. Shared by the pipeline and the persona, which spells it
 * literally so the model can produce the same value itself.
 */
export const AMBIGUOUS = "ambiguous";

/** Ways the agent admits it did not understand, rather than merely asking more. */
const NOT_UNDERSTOOD =
  "(?:maksudnya|maksud kakak|maksud kak\\b|(?:kurang|belum|tidak|nggak|ga|gak) (?:paham|jelas|ngerti|nangkep)|bingung)";

/**
 * Does this reply ask the customer to clarify, rather than answer them?
 *
 * The same problem {@link promisesHandoff} solves, for the other tool: the model
 * often asks "maksudnya yang mana ya kak" in prose without calling
 * `ask_clarification`, and a streak counted only from tool calls then resets on
 * the very turn that should have tripped it — so the agent asks forever and the
 * thread never reaches a human. Observed on live traffic, not hypothetical.
 *
 * Deliberately NARROW, unlike promisesHandoff. A false positive here sends a
 * healthy conversation to staff, and the persona actively tells the agent to ask
 * "kakak lebih sreg yang mana" as a normal sales question. So it requires both a
 * question mark and an explicit admission of not understanding: wanting more
 * detail is not the same as being lost.
 */
export function asksClarification(text: string): boolean {
  if (!text.includes("?")) return false;
  return new RegExp(NOT_UNDERSTOOD, "iu").test(text);
}

/**
 * Sent INSTEAD of a second clarifying question, once the agent has already asked
 * and got nowhere. Asking "which did you mean?" and "a human will take over" in
 * the same breath reads worse than simply handing over, so the model's question
 * is dropped rather than appended to.
 */
export function ambiguousHandoff(now: Date = new Date()): string {
  return (
    `Maaf kak, aku masih belum nangkep maksudnya. ` +
    `Aku teruskan ke tim kami ya biar dibantu langsung. ${handoffTiming(now)}`
  );
}

/**
 * The full ack we send when the agent itself never ran (non-text message, no
 * credential, agent error) and the burst goes straight to staff.
 */
export function handoffAck(now: Date = new Date()): string {
  return (
    `Halo kakk, makasih sudah chat ${STORE.name}. Pesannya aku teruskan ke tim dulu ya. ` +
    `${handoffTiming(now)} 🙏`
  );
}
