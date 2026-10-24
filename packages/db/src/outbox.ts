/**
 * Crossing the transaction boundary — docs/rebuild/08-data-integrity.md §5.
 *
 *     txn: write the row + write an Outbox row  --commit-->  worker: claim → send → mark
 *
 * Sending a WhatsApp reply, posting an IG comment or calling Anthropic must not
 * sit inside a database transaction, and must not be lost if the process dies
 * after commit. Nothing in this file performs I/O; it only moves rows between
 * states. The worker (a later session) does the sending.
 */

import { Prisma, type PrismaClient, type Tx } from "./client.js";

export type OutboxKind =
  | "WA_REPLY"
  /** One photograph of a unit (2026-09-21). See the schema's own note. */
  | "WA_IMAGE"
  | "IG_REPLY"
  | "IG_DM"
  | "ALERT";
export type OutboxStatus = "PENDING" | "SENDING" | "SENT" | "FAILED";

export interface OutboxRow {
  readonly id: string;
  readonly kind: OutboxKind;
  readonly payload: unknown;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly lastError: string | null;
  readonly requestId: string | null;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
  /** WhatsApp's id for the sent message (2026-10-23). */
  readonly providerMessageId?: string | null;
  readonly retractedAt?: Date | null;
  readonly editedAt?: Date | null;
}

export interface EnqueueInput {
  readonly kind: OutboxKind;
  readonly payload: Prisma.InputJsonValue;
  readonly requestId?: string | null;
  /** Defaults to now: send as soon as a worker picks it up. */
  readonly nextAttemptAt?: Date;
}

/**
 * Write a send intent inside the caller's transaction.
 *
 * This is the only correct way to trigger an outbound message: if the
 * transaction rolls back, so does the intent, and the customer never receives
 * a reply about an order that does not exist.
 */
export async function enqueueOutbox(
  tx: Tx,
  input: EnqueueInput,
): Promise<{ id: string }> {
  const now = new Date();
  return tx.outbox.create({
    data: {
      kind: input.kind,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: input.nextAttemptAt ?? now,
      lastError: null,
      requestId: input.requestId ?? null,
      createdAt: now,
      sentAt: null,
    },
    select: { id: true },
  });
}

/**
 * Claim one due row for sending.
 *
 * §5: "The worker claims with `UPDATE … SET status='SENDING' WHERE id =
 * (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` — that one
 * statement is the whole concurrency story."
 *
 * SKIP LOCKED is what lets several workers run without coordinating: each
 * takes a different row instead of queueing behind the same one.
 */
export async function claimOutbox(
  client: PrismaClient | Tx,
  now: Date = new Date(),
): Promise<OutboxRow | null> {
  const rows = await client.$queryRaw<OutboxRow[]>(Prisma.sql`
    UPDATE "Outbox"
       SET status = 'SENDING',
           attempts = attempts + 1
     WHERE id = (
             SELECT id
               FROM "Outbox"
              WHERE status = 'PENDING'
                -- Prisma stores DateTime as timestamp WITHOUT time zone holding
                -- UTC, but binds a JS Date as timestamptz. Left alone, a plain
                -- ::timestamp cast renders the parameter as Asia/Jakarta wall
                -- clock and every row looks due seven hours early. Convert the
                -- parameter, not the column, so the index still applies.
                AND "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
              ORDER BY "nextAttemptAt", "createdAt"
                FOR UPDATE SKIP LOCKED
              LIMIT 1
           )
   RETURNING *
  `);
  return rows[0] ?? null;
}

/**
 * Mark a row SENT, keeping the id WhatsApp gave the message (2026-10-23).
 *
 * That id is what an edit or an unsend from the inbox must name, so it is
 * stored rather than logged and thrown away. Null when the transport returned
 * none — such a row simply cannot be edited or unsent later.
 */
export async function markOutboxSent(
  client: PrismaClient | Tx,
  id: string,
  sentAt: Date = new Date(),
  providerMessageId: string | null = null,
): Promise<void> {
  await client.outbox.update({
    where: { id },
    data: { status: "SENT", sentAt, lastError: null, providerMessageId },
  });
}

export interface BackoffOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly random?: () => number;
  readonly now?: Date;
}

/**
 * Record a failed send and decide what happens next.
 *
 * §5: "Retries are exponential with jitter, capped; exhausted rows go to
 * FAILED and raise an alert, they are never silently dropped."
 */
export async function markOutboxFailed(
  client: PrismaClient | Tx,
  row: Pick<OutboxRow, "id" | "attempts">,
  error: string,
  options: BackoffOptions = {},
): Promise<OutboxStatus> {
  const {
    maxAttempts = 6,
    baseDelayMs = 1_000,
    maxDelayMs = 15 * 60_000,
    random = Math.random,
    now = new Date(),
  } = options;

  // The row was already counted up by claimOutbox.
  const exhausted = row.attempts >= maxAttempts;
  const status: OutboxStatus = exhausted ? "FAILED" : "PENDING";

  const capped = Math.min(baseDelayMs * 2 ** (row.attempts - 1), maxDelayMs);
  const delay = Math.floor(capped * (0.5 + random() * 0.5));

  await client.outbox.update({
    where: { id: row.id },
    data: {
      status,
      lastError: error.slice(0, 2_000),
      nextAttemptAt: exhausted ? now : new Date(now.getTime() + delay),
    },
  });

  return status;
}
