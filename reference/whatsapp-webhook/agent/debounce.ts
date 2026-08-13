/**
 * Adaptive per-sender debounce for the WhatsApp agent.
 *
 * WhatsApp customers type in bursts — several short lines rather than one tidy
 * message. Answering each line separately is robotic and burns an agent call per
 * line. Instead, every inbound message (re)arms ONE timer per sender; when the
 * sender goes quiet for the computed wait, the whole burst is processed as a
 * single turn (see `runConversation` in ./pipeline.ts).
 *
 * The wait is CONTENT-AWARE, not a fixed window — it reads the latest message:
 *  - a direct question ("stok air m2?") is answered soonest;
 *  - a "hold on, I'll get back to you" ("nanti saya kabarin ya") waits longest;
 *  - filler / thinking ("hmm", "bentar", "...") waits longer (still composing);
 *  - anything else waits the base window.
 *
 * `computeWaitMs` is pure and unit-tested. The timer map + processing lock are
 * process-local — a single-instance assumption that matches the existing sweeper
 * (persist.ts). The heuristic can later be swapped for a cheap LLM classifier
 * without changing any caller.
 */

/** Fastest we reply after the last message (a direct question). */
export const MIN_WAIT_MS = 4_000;
/** Default quiet window before we treat a burst as finished. Env-overridable. */
export const BASE_WAIT_MS = Number(process.env.WA_DEBOUNCE_MS ?? 10_000);
/** Longest we hold off (customer explicitly paused the conversation). */
export const MAX_WAIT_MS = 45_000;

/** Customer signalled they'll come back later — hold off the longest. */
const LATER_RE =
  /\b(nanti|ntar|kabar(?:in|i)|besok|lusa|pikir dulu|mikir dulu|cek dulu|tanya dulu|konfirmasi dulu|diskusi dulu|balik lagi|balik lg|nyusul|kabarin ya)\b/;

/**
 * Short filler / acknowledgements that mean "I'm still typing". Matched after
 * collapsing repeated letters ("hmmm" → "hm", "okee" → "oke", "sipp" → "sip").
 */
const FILLER = new Set([
  "hm",
  "em",
  "eh",
  "oh",
  "ah",
  "ok",
  "oke",
  "okay",
  "sip",
  "sep",
  "siap",
  "y",
  "ya",
  "iya",
  "yoi",
  "he",
  "bentar",
  "sebentar",
  "sbentar",
  "bntr",
  "tunggu",
  "wait",
  "loading",
  "cek",
]);

/** Collapse runs of the same character so "hmmm"/"hmm" both fold to "hm". */
const collapse = (s: string): string => s.replace(/(.)\1+/g, "$1");

/** Decide the quiet window for a single (latest) message. */
function classify(text: string): number {
  const t = text.trim().toLowerCase();
  if (!t) return BASE_WAIT_MS;

  // A direct question wins — answer it promptly even if other signals are present.
  if (t.endsWith("?")) return MIN_WAIT_MS;

  // "I'll let you know later" — the customer paused the chat; wait the longest.
  if (LATER_RE.test(t)) return MAX_WAIT_MS;

  // Trailing ellipsis or a lone filler word — they're mid-thought.
  const stripped = t.replace(/[.!…]+$/u, "");
  const isFiller = collapse(stripped).split(/\s+/).every((w) => FILLER.has(w));
  if (t.endsWith("...") || t.endsWith("…") || (stripped && isFiller)) {
    return Math.round(BASE_WAIT_MS * 1.8);
  }

  return BASE_WAIT_MS;
}

/**
 * Compute the adaptive quiet window (ms) from the recent messages of one sender
 * (oldest→newest). The classification keys off the latest non-empty message.
 * Pure — no timers, no I/O.
 */
export function computeWaitMs(recent: { text: string | null }[]): number {
  const last = [...recent].reverse().find((m) => m.text && m.text.trim());
  return classify(last?.text ?? "");
}

// ---------- Timer scheduling (process-local) ----------

/** One pending timer per sender; the latest message re-arms it. */
const timers = new Map<string, NodeJS.Timeout>();
/** Senders whose conversation is being processed right now (re-entrancy guard). */
const processing = new Set<string>();

/** The batch processor `scheduleConversation` will invoke when the sender goes quiet. */
export type ConversationRunner = (from: string) => Promise<void>;

/**
 * (Re)arm the debounce timer for `from`. Each call clears the previous timer and
 * sets a fresh one for the freshly-computed wait, so a burst of messages only
 * fires `run` once — after the sender stops for the quiet window.
 */
export function scheduleConversation(
  from: string,
  recent: { text: string | null }[],
  run: ConversationRunner,
): void {
  const existing = timers.get(from);
  if (existing) clearTimeout(existing);

  const wait = computeWaitMs(recent);
  // The callback is async and awaits `fire` so its work is a tracked promise
  // (lets fake-timer test helpers flush it); at runtime setTimeout still doesn't
  // block, so this is fire-and-forget as intended.
  const handle = setTimeout(async () => {
    timers.delete(from);
    await fire(from, run);
  }, wait);
  handle.unref?.();
  timers.set(from, handle);
}

/** Run the batch for `from`, guarding against concurrent runs for the same sender. */
async function fire(from: string, run: ConversationRunner): Promise<void> {
  if (processing.has(from)) {
    // A run is already in flight; re-arm so any messages that arrived meanwhile
    // are picked up right after it finishes (runConversation re-reads all BARU).
    scheduleConversation(from, [{ text: "" }], run);
    return;
  }
  processing.add(from);
  try {
    await run(from);
  } catch (err) {
    console.error(`[webhook] conversation run failed for ${from}:`, err);
  } finally {
    processing.delete(from);
  }
}

/** Test hook: clear all pending timers and locks. */
export function _resetDebounce(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  processing.clear();
}
