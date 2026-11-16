/**
 * Which channel a chat thread is on — WhatsApp or Instagram (2026-11-16,
 * docs/superpowers/specs/2026-11-16-instagram-design.md). Pure.
 *
 * ## The thread key IS the discriminator
 *
 * Every chat table keys a conversation by one string, `from`: `WaMessage`,
 * `WaThreadMemory`, `ChatAction`, `CustomerProfile`, `AgentRun`,
 * `ChatMemoryChunk`, `StockWatch`, `ReservationProposal`, `ChatMedia` — and
 * the outbox addresses a reply by `payload.to`. For WhatsApp that string is the
 * wa_id (digits). An Instagram DM thread is `ig:<IGSID>`. The prefix is what
 * lets the bot pipeline, the inbox, the tasks and the profile serve both
 * channels through one set of tables without any reader confusing an
 * Instagram sender with a phone number: no wa_id contains a colon, so no
 * query keyed on one can ever match the other.
 *
 * ⚠️ An Instagram key is NOT a phone. Anything that looks a customer up by
 * phone (`phoneForms`) must answer "nobody" for it.
 */

export type ChatChannel = "WHATSAPP" | "INSTAGRAM";

export const IG_THREAD_PREFIX = "ig:";

/** An Instagram-scoped user id (IGSID): digits. */
const IGSID = /^\d{5,32}$/;
/** What a route may take as a thread: a wa_id, or an Instagram thread key. */
const THREAD_KEY = /^(\d{6,20}|ig:\d{5,32})$/;

/** The thread key for an Instagram sender. Throws on anything but digits. */
export function igThreadKey(igsid: string): string {
  if (!IGSID.test(igsid)) throw new Error("an IGSID is digits only");
  return `${IG_THREAD_PREFIX}${igsid}`;
}

/** The IGSID inside an Instagram thread key; null for any other key. */
export function igsidOf(key: string): string | null {
  return key.startsWith(IG_THREAD_PREFIX)
    ? key.slice(IG_THREAD_PREFIX.length)
    : null;
}

export const isIgThread = (key: string): boolean =>
  key.startsWith(IG_THREAD_PREFIX);

export const channelOf = (key: string): ChatChannel =>
  isIgThread(key) ? "INSTAGRAM" : "WHATSAPP";

/** A wa_id (digits) or `ig:` + an IGSID — what `/api/inbox/:phone` accepts. */
export const isThreadKey = (key: string): boolean => THREAD_KEY.test(key);

// --- the outbox -------------------------------------------------------------

/** Every reply kind, both channels — what a reader of "sent to X" filters on. */
export const REPLY_KINDS = ["WA_REPLY", "IG_DM"] as const;
/** Every picture kind, both channels. */
export const IMAGE_KINDS = ["WA_IMAGE", "IG_IMAGE"] as const;

/**
 * The kind a send intent is stored as, given who it is addressed to.
 *
 * Every writer in the codebase queues a reply as `WA_REPLY` / `WA_IMAGE` with
 * `payload.to` = the thread key. Rather than teach fifteen call sites a second
 * kind, `enqueueOutbox` asks this: a reply addressed to an Instagram thread is
 * an `IG_DM`, a picture an `IG_IMAGE`, and the worker's Instagram send pass is
 * the only one that claims them. Nothing else changes.
 */
export function outboxKindFor<K extends string>(
  kind: K,
  to: string | undefined,
): K | "IG_DM" | "IG_IMAGE" {
  if (to === undefined || !isIgThread(to)) return kind;
  if (kind === "WA_REPLY") return "IG_DM";
  if (kind === "WA_IMAGE") return "IG_IMAGE";
  return kind;
}

// --- Instagram's messaging window ------------------------------------------

/** A free reply — the bot's or a person's — within 24 h of their last message. */
export const IG_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A person's reply, sent with the HUMAN_AGENT tag, up to 7 days after it. */
export const IG_HUMAN_AGENT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What may be sent to an Instagram thread now.
 *
 * `RESPONSE` — anything, by anybody. `HUMAN_AGENT` — only a staff member's
 * reply, tagged as one; the bot sends nothing. `CLOSED` — nothing at all
 * until the customer writes again.
 */
export type IgReplyMode = "RESPONSE" | "HUMAN_AGENT" | "CLOSED";

export function igReplyMode(
  lastInboundAt: Date | null,
  now: Date,
): IgReplyMode {
  if (!lastInboundAt) return "CLOSED";
  const age = Math.max(0, now.getTime() - lastInboundAt.getTime());
  if (age < IG_WINDOW_MS) return "RESPONSE";
  if (age < IG_HUMAN_AGENT_MS) return "HUMAN_AGENT";
  return "CLOSED";
}

/** When the given mode ends; null when it is already closed. */
export function igReplyModeClosesAt(
  lastInboundAt: Date | null,
  mode: IgReplyMode,
): Date | null {
  if (!lastInboundAt || mode === "CLOSED") return null;
  return new Date(
    lastInboundAt.getTime() +
      (mode === "RESPONSE" ? IG_WINDOW_MS : IG_HUMAN_AGENT_MS),
  );
}

// --- comments ---------------------------------------------------------------

/** A private reply to a comment: one, within 7 days of the comment. */
export const IG_PRIVATE_REPLY_MS = 7 * 24 * 60 * 60 * 1000;

export function igPrivateReplyOpen(
  commentAt: Date,
  dmSentAt: Date | null,
  now: Date,
): boolean {
  return (
    dmSentAt === null &&
    now.getTime() - commentAt.getTime() < IG_PRIVATE_REPLY_MS
  );
}

/**
 * The status a hidden comment goes back to when it is shown again: what was
 * done to it, the DM first. `DONE` is not remembered — a comment somebody had
 * dismissed and then hid and unhid is worth a second look.
 */
export function commentStatusAfterUnhide(c: {
  readonly replyText: string | null;
  readonly dmSentAt: Date | null;
}): "NEW" | "REPLIED" | "DMED" {
  if (c.dmSentAt) return "DMED";
  if (c.replyText) return "REPLIED";
  return "NEW";
}

// --- message length ---------------------------------------------------------

/**
 * Instagram's ceiling on one text message. Meta documents it as 1000 — the
 * splitter counts UTF-8 BYTES, which is the stricter reading and is the same
 * number for the plain Indonesian text the bot writes.
 */
export const IG_TEXT_MAX_BYTES = 1000;

const encoder = new TextEncoder();
export const utf8Length = (s: string): number => encoder.encode(s).length;

/**
 * A reply cut into messages Instagram will take, at the most natural break
 * that fits: a blank line, a line, a sentence, a word, and only then mid-run.
 * Never inside a character (an emoji is four bytes). Empty in, empty out.
 */
export function splitForInstagram(
  text: string,
  maxBytes: number = IG_TEXT_MAX_BYTES,
): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest !== "") {
    if (utf8Length(rest) <= maxBytes) {
      out.push(rest);
      break;
    }
    const head = fitting(rest, maxBytes);
    const cut = breakIn(head);
    const piece = rest.slice(0, cut).trim();
    out.push(piece);
    rest = rest.slice(cut).trim();
  }
  return out;
}

/** The longest prefix of whole characters within `maxBytes`. */
function fitting(s: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of s) {
    const n = utf8Length(ch);
    if (bytes + n > maxBytes) break;
    bytes += n;
    end += ch.length;
  }
  return s.slice(0, end);
}

/** Where to cut `head`: the last good break in its second half, else its end. */
function breakIn(head: string): number {
  const floor = Math.floor(head.length / 2);
  for (const sep of ["\n\n", "\n"]) {
    const at = head.lastIndexOf(sep);
    if (at >= floor) return at;
  }
  const sentence = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (sentence >= floor) return sentence + 1;
  const word = head.lastIndexOf(" ");
  if (word >= floor) return word;
  return head.length;
}
