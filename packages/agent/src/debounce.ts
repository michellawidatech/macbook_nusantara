/**
 * How long the agent waits before deciding a customer has finished typing.
 *
 * WhatsApp customers write in bursts. "halo", then "mau tanya", then "ada
 * macbook air m2?" — three rows in eight seconds, one question. Answering each
 * one is robotic, costs a model call per fragment, and sends three replies to
 * one thought. So the draft pass collapses a burst into a single turn, and the
 * only real question is when to stop waiting.
 *
 * A flat window gets that wrong in both directions. It makes someone who asked
 * a plain question wait for nothing, and it cuts off someone who is visibly
 * mid-sentence. So the wait is read off the LATEST message, which is the one
 * that says whether more is coming:
 *
 *   - a direct question ("stok air m2?") is finished — answer soonest;
 *   - "nanti saya kabarin" means the customer left — wait longest;
 *   - filler ("hmm", "bentar", "...") means they are still typing — wait longer;
 *   - anything else waits the base window.
 *
 * ## Two deliberate differences from the previous build
 *
 * `reference/whatsapp-webhook/src/agent/debounce.ts` is the donor for the
 * classification, and it got the hard part right. Two things do not come across:
 *
 * 1. **It read `process.env.WA_DEBOUNCE_MS` at module scope.** 01 §7 forbids
 *    that here, and it is why that module could not be tested without a
 *    developer's shell. The windows are a parameter with exported defaults.
 * 2. **It kept a process-local `Map` of timers.** A restart mid-burst lost
 *    every pending reply and nothing re-armed them — the rows sat `BARU` with
 *    no scheduler. This build polls the database instead, so the schedule
 *    survives a crash. `computeWaitMs` is pure: it returns a number, and the
 *    caller compares it against a timestamp that is already durable.
 */

/*
 * Shortened 2026-10-14 for chatbot v2 (owner: a reply within about ten
 * seconds is fine). Was 4 s / 10 s / 45 s. A question is answered after 3 s,
 * an ordinary line after 6, filler after ~11, and "nanti saya kabarin" after
 * 20 — still long enough not to answer a customer who said they would come
 * back, short enough that one who comes back at once is not kept waiting.
 */

/** Fastest we answer after the last message — a direct question. */
export const MIN_WAIT_MS = 3_000;

/** The ordinary quiet window before a burst counts as finished. */
export const BASE_WAIT_MS = 6_000;

/** Longest we hold off, when the customer has explicitly paused the chat. */
export const MAX_WAIT_MS = 20_000;

/** Filler stretches the base window by this much. Still typing, not done. */
export const FILLER_FACTOR = 1.8;

export interface WaitProfile {
  readonly minMs: number;
  readonly baseMs: number;
  readonly maxMs: number;
}

export const DEFAULT_WAITS: WaitProfile = {
  minMs: MIN_WAIT_MS,
  baseMs: BASE_WAIT_MS,
  maxMs: MAX_WAIT_MS,
};

/** Why a thread is being held. Carried into the log so a wait is explicable. */
export type WaitReason = "question" | "later" | "filler" | "base" | "empty";

export interface WaitDecision {
  readonly waitMs: number;
  readonly reason: WaitReason;
}

/**
 * "I will get back to you." Indonesian first, since that is what the shop
 * mostly gets, and the common English equivalents after it — a customer who
 * writes "let me check first" has paused the conversation just as firmly.
 */
const LATER =
  /\b(nanti|ntar|kabar(?:in|i)|besok|lusa|pikir dulu|mikir dulu|cek dulu|tanya dulu|konfirmasi dulu|diskusi dulu|balik lagi|balik lg|nyusul|let me (?:check|think)|i'?ll (?:get back|let you know)|think about it|get back to you)\b/;

/**
 * Short acknowledgements that mean "still typing". Matched after collapsing
 * repeated letters, so "hmmm" folds to "hm" and "okeee" to "oke".
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
  "hold",
  "loading",
  "cek",
  "eh bentar",
  "oh ya",
]);

/** Collapse runs of one character, so "hmmm" and "hmm" fold together. */
const collapse = (s: string): string => s.replace(/(.)\1+/g, "$1");

/**
 * A question mark inside a URL is a query string, not a question. Without this
 * a customer pasting a product link gets answered in four seconds, mid-thought.
 */
const withoutLinks = (s: string): string => s.replace(/https?:\/\/\S+/g, " ");

/** Decide the window for one message. Exported so a log can name the reason. */
export function classifyWait(
  text: string | null,
  waits: WaitProfile = DEFAULT_WAITS,
): WaitDecision {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return { waitMs: waits.baseMs, reason: "empty" };

  const t = withoutLinks(raw).trim();
  if (!t) return { waitMs: waits.baseMs, reason: "base" };

  // A question wins outright, even when the sentence also hedges. "nanti aja
  // ya, tapi harganya berapa?" is a customer waiting on a number right now.
  if (t.endsWith("?")) return { waitMs: waits.minMs, reason: "question" };

  if (LATER.test(t)) return { waitMs: waits.maxMs, reason: "later" };

  const stripped = t.replace(/[.!…]+$/u, "").trim();
  const isFiller =
    stripped.length > 0 &&
    collapse(stripped)
      .split(/\s+/)
      .every((w) => FILLER.has(w));

  if (t.endsWith("...") || t.endsWith("…") || isFiller) {
    // Capped, so a caller's ceiling still means something.
    return {
      waitMs: Math.min(Math.round(waits.baseMs * FILLER_FACTOR), waits.maxMs),
      reason: "filler",
    };
  }

  return { waitMs: waits.baseMs, reason: "base" };
}

/**
 * The quiet window for one sender's burst, oldest message first.
 *
 * Keys off the latest message that actually has text: a photo carries nothing
 * to read, and treating it as silence would answer the question before it.
 */
export function computeWaitMs(
  recent: readonly { readonly text: string | null }[],
  waits: WaitProfile = DEFAULT_WAITS,
): number {
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const text = recent[i]?.text;
    if (text && text.trim()) return classifyWait(text, waits).waitMs;
  }
  return waits.baseMs;
}
