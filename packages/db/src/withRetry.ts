/**
 * Serializable transactions, retried on conflict — docs/rebuild/08-data-integrity.md §3.
 *
 * "Use SERIALIZABLE only for opname posting and shift close, which read a whole
 * set and decide from it. Serializable transactions must be wrapped in a
 * retry-on-40001 helper — write that helper once, in packages/db."
 *
 * This is that helper. Retrying is only safe because the whole unit of work is
 * inside the callback: a retry re-runs the transaction from the start, so the
 * callback must not have side effects outside the database. That is the same
 * rule as "no network I/O inside a transaction" (§3), seen from the other side.
 */

import { Prisma, type PrismaClient, TXN_TIMEOUTS, type Tx } from "./client.js";

/**
 * SQLSTATEs worth retrying.
 *
 * 40001 serialization_failure — two serializable transactions disagreed.
 * 40P01 deadlock_detected — ordered locking (withUnitLocks) is the real fix,
 *       but a retry keeps an unrelated deadlock from reaching the cashier.
 */
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

/** Prisma collapses both of the above into P2034 for interactive transactions. */
const RETRYABLE_PRISMA_CODES = new Set(["P2034"]);

export function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE_PRISMA_CODES.has(error.code)) return true;
    const meta = error.meta as { code?: unknown } | undefined;
    if (typeof meta?.code === "string" && RETRYABLE_SQLSTATES.has(meta.code)) {
      return true;
    }
  }
  // Raw queries surface the driver's error, which carries the SQLSTATE directly.
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_SQLSTATES.has(code);
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  readonly attempts?: number;
  /** First backoff, doubled each attempt. */
  readonly baseDelayMs?: number;
  /** Backoff ceiling — exponential growth is capped, not unbounded. */
  readonly maxDelayMs?: number;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Injectable so tests are deterministic and do not actually sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` in a transaction, retrying write conflicts with capped exponential
 * backoff plus jitter. Jitter matters: two cashiers retrying in lockstep
 * collide again at exactly the same moment.
 *
 * Anything that is not a conflict is rethrown immediately — a constraint
 * violation is an answer, not a reason to try again.
 */
export async function withRetry<T>(
  client: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 5,
    baseDelayMs = 25,
    maxDelayMs = 500,
    isolationLevel = Prisma.TransactionIsolationLevel.Serializable,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.$transaction(fn, { ...TXN_TIMEOUTS, isolationLevel });
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;

      if (attempt < attempts) {
        const capped = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        await sleep(Math.floor(capped * (0.5 + random() * 0.5)));
      }
    }
  }

  throw lastError;
}
