/**
 * The bot never goes silent (owner ask 2026-10-27: *"improve the chatbot to
 * not get stuck"*). The same morning the bot simply stopped replying in the
 * shop, with nothing in front of anybody to say why. Three things here are
 * shared between the worker (which must recover by itself) and the API (which
 * must say on /chat why a message is still waiting):
 *
 *  - `guardClient` — every model call has a deadline and a bounded number of
 *    retries with jitter. The SDK's own timeout is a backstop; this is the one
 *    a test can drive with a fake, and the one that knows the TURN's deadline,
 *    so four steps × two tries can never add up past the thread's lease.
 *  - `staffTypedReply` — what "a colleague is chatting here" means, read the
 *    same way by the worker's hold and the caption that explains it.
 *  - the timings both sides agree on.
 */

import type { AgentClient, CreateArgs } from "./converse.js";
import { isHoldingLine } from "./policy.js";

/**
 * How long a staff member's own reply keeps the bot out of a thread
 * (2026-10-27). Long enough for a colleague mid-conversation to read the
 * customer's answer and type theirs; short enough that a customer whose
 * colleague walked away is answered within a quarter of an hour.
 */
export const STAFF_ACTIVE_MS = 15 * 60_000;

/**
 * A customer message the bot could answer that has waited this long is
 * stuck: the worker's watchdog answers it, and /chat says why it waited.
 * The longest debounce is ~20 s and a turn's deadline 90 s, so three
 * minutes is never an ordinary reply that is merely slow.
 */
export const BOT_STALE_MS = 3 * 60_000;

/** One model call, at most. Overridable by `CHATBOT_CALL_TIMEOUT_MS`. */
export const CALL_TIMEOUT_MS = 25_000;

/** Retries after the first try, for a 429, a 5xx, overload or a timeout. */
export const CALL_RETRIES = 2;

/**
 * A whole turn — the model calls, the tools, the commit. Under the lease
 * (`LEASE_MS`, 120 s) so a turn can never outlive its claim on the thread.
 */
export const TURN_DEADLINE_MS = 90_000;

/** The model call did not answer within its time. */
export class ModelTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`the model did not answer within ${ms} ms`);
    this.name = "ModelTimeoutError";
  }
}

/** The turn ran out of time before this call could start. */
export class ModelDeadlineError extends Error {
  constructor() {
    super("the turn's deadline passed before the model could be asked");
    this.name = "ModelDeadlineError";
  }
}

const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

/**
 * Worth asking again: rate limited, overloaded, a server error, a dropped
 * connection or our own timeout. A 400 or a 401 is not — the same request
 * fails the same way, and every retry is a customer waiting longer.
 */
export function isRetryableModelError(err: unknown): boolean {
  if (err instanceof ModelTimeoutError) return true;
  if (err instanceof ModelDeadlineError) return false;
  const status = statusOf(err);
  if (status !== undefined) return RETRY_STATUS.has(status);
  const name = (err as { name?: unknown } | null)?.name;
  const type = (err as { type?: unknown } | null)?.type;
  return (
    name === "APIConnectionError" ||
    name === "APIConnectionTimeoutError" ||
    type === "overloaded_error" ||
    type === "rate_limit_error"
  );
}

/** A short reason for a log line: `429`, `timeout`, `connection`… */
export function modelErrorReason(err: unknown): string {
  if (err instanceof ModelTimeoutError) return "timeout";
  if (err instanceof ModelDeadlineError) return "deadline";
  const status = statusOf(err);
  if (status !== undefined) return String(status);
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError")
    return "connection";
  return typeof name === "string" ? name : "error";
}

/** `retry-after` / `retry-after-ms`, in ms, when the server sent one. */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: unknown } | null)?.headers;
  const get = (k: string): string | null => {
    if (!headers || typeof headers !== "object") return null;
    if (typeof (headers as Headers).get === "function")
      return (headers as Headers).get(k);
    const v = (headers as Record<string, unknown>)[k];
    return typeof v === "string" ? v : null;
  };
  const ms = Number(get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = Number(get("retry-after"));
  if (Number.isFinite(s) && s > 0) return s * 1000;
  return null;
}

export interface CallGuard {
  /** One call's limit. */
  readonly timeoutMs?: number;
  /** Retries after the first try. */
  readonly retries?: number;
  /** Epoch ms after which no call starts and none outlives. */
  readonly deadline?: number;
  /** The first backoff; doubles per retry, with jitter. */
  readonly baseDelayMs?: number;
  /** No single wait is longer than this, whatever `retry-after` says. */
  readonly maxDelayMs?: number;
  /** Injectable for tests. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** Told before each retry — the worker logs it. */
  readonly onRetry?: (info: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly reason: string;
  }) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The same client, with a deadline on every call and bounded retries.
 *
 * The timeout is enforced twice: an `AbortSignal` (and `timeout`) handed to
 * the SDK, which actually cancels the request, and a race here, which is what
 * holds for a client that ignores both — a fake, or an SDK that hangs inside
 * its own retry loop. A request the race abandoned is aborted, never awaited.
 */
export function guardClient(
  client: AgentClient,
  guard: CallGuard = {},
): AgentClient {
  const timeoutMs = guard.timeoutMs ?? CALL_TIMEOUT_MS;
  const retries = Math.max(0, guard.retries ?? CALL_RETRIES);
  const base = guard.baseDelayMs ?? 1_000;
  const maxDelay = guard.maxDelayMs ?? 8_000;
  const now = guard.now ?? Date.now;
  const sleep = guard.sleep ?? defaultSleep;
  const random = guard.random ?? Math.random;

  const once = async (args: CreateArgs) => {
    const left =
      guard.deadline === undefined ? timeoutMs : guard.deadline - now();
    if (left <= 0) throw new ModelDeadlineError();
    const ms = Math.min(timeoutMs, left);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ModelTimeoutError(ms));
      }, ms);
    });
    try {
      return await Promise.race([
        client.messages.create(args, {
          signal: abort.signal,
          timeout: ms,
          maxRetries: 0,
        }),
        expired,
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    messages: {
      async create(args: CreateArgs) {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await once(args);
          } catch (err) {
            if (attempt >= retries || !isRetryableModelError(err)) throw err;
            // Full jitter on an exponential step, or the server's own
            // retry-after when it gave one — capped either way.
            const step = Math.min(maxDelay, base * 2 ** attempt);
            const delayMs = Math.min(
              maxDelay,
              retryAfterMs(err) ?? Math.round(step / 2 + random() * (step / 2)),
            );
            // Never sleep past the turn's deadline only to be refused.
            if (
              guard.deadline !== undefined &&
              now() + delayMs >= guard.deadline
            )
              throw err;
            guard.onRetry?.({
              attempt: attempt + 1,
              delayMs,
              reason: modelErrorReason(err),
            });
            await sleep(delayMs);
          }
        }
      },
    },
  };
}

/** The row fields `staffTypedReply` reads. */
export interface ReplyRow {
  readonly replyText: string | null;
  readonly answeredByAgent: boolean;
  readonly answeredById: string | null;
  readonly entities?: unknown;
}

/**
 * Did a PERSON type this reply in the chat? Only that holds the bot off a
 * thread (`STAFF_ACTIVE_MS`).
 *
 * Not Mark handled or Clear chat — they write no `replyText`. And not a
 * hand-over row a colleague later closed (2026-10-27 audit): the bot's own
 * holding line sits in `replyText`, and the close stamps a staff id and a
 * fresh `answeredAt` on it — which read as "a colleague just replied" and
 * kept the bot silent for a quarter of an hour after somebody pressed Mark
 * handled. The line the worker recorded with the hand-over, and the bot's
 * fixed holding lines, are the bot's however the row was closed.
 */
export function staffTypedReply(m: ReplyRow): boolean {
  const text = m.replyText?.trim();
  if (!text || m.answeredByAgent || !m.answeredById) return false;
  const h =
    m.entities && typeof m.entities === "object"
      ? (m.entities as { handoff?: { reply?: unknown } }).handoff
      : undefined;
  if (h && typeof h === "object" && h.reply === m.replyText) return false;
  return !isHoldingLine(m.replyText);
}
