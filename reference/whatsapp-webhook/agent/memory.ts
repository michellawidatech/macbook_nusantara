/**
 * Per-thread agent memory: every read and write of `WaThreadMemory`.
 *
 * Two writers share the row and neither may touch the other's columns:
 *  - this module (the webhook) owns the summary columns and the clarify streak;
 *  - staff, through apps/api, own `directive*`.
 * The payloads below name only their own columns, which is what makes "the agent
 * can never overwrite a staff note" a structural property rather than a promise.
 * `saveSummary` omitting `directive*` is asserted in memory.test.ts.
 *
 * Nothing here throws. A thread with no row, a row the migration has not created
 * yet, or a database that is briefly down all degrade to EMPTY memory, so the
 * worst case is an agent with no long-term context — never an agent that stops
 * replying and leaves every message stuck in BARU for the sweeper to retry.
 */

import { prisma } from "@nusantara/db";

/** What the pipeline needs from a thread's memory row. */
export interface ThreadMemory {
  summary: string | null;
  directive: string | null;
  /** Consecutive clarification attempts, already expired by {@link freshClarifyCount}. */
  clarifyCount: number;
  /** `answeredAt` of the newest turn the summary covers; null when never summarized. */
  coveredThroughAt: Date | null;
}

/** A thread with no memory row yet, and the fallback for any read failure. */
const EMPTY: ThreadMemory = {
  summary: null,
  directive: null,
  clarifyCount: 0,
  coveredThroughAt: null,
};

/**
 * How long a clarification streak stays live. A customer who confused the agent
 * yesterday and opens a fresh, perfectly clear question today must start from
 * zero — otherwise one stale strike escalates an unrelated conversation.
 */
export const CLARIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Prisma's unique-constraint violation — two processes raced the same `create`. */
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * The clarify streak as of `now`: a streak whose last strike is older than
 * {@link CLARIFY_TTL_MS} reads as zero. Pure, so the expiry rule is testable
 * without a clock or a database.
 */
export function freshClarifyCount(count: number, at: Date | null, now: Date = new Date()): number {
  if (count <= 0 || !at) return 0;
  return now.getTime() - at.getTime() > CLARIFY_TTL_MS ? 0 : count;
}

/** This thread's memory, or empty memory. Never throws. */
export async function loadMemory(from: string, now: Date = new Date()): Promise<ThreadMemory> {
  try {
    const row = await prisma.waThreadMemory.findUnique({ where: { from } });
    if (!row) return EMPTY;
    return {
      summary: row.summary ?? null,
      directive: row.directive ?? null,
      clarifyCount: freshClarifyCount(row.clarifyCount, row.clarifyAt ?? null, now),
      coveredThroughAt: row.coveredThroughAt ?? null,
    };
  } catch (err) {
    console.error(`[webhook] loadMemory failed for ${from}:`, err);
    return EMPTY;
  }
}

/**
 * Upsert that survives losing the `create` race to the other process. The
 * webhook and apps/api are separate processes, so the per-sender lock in
 * ./debounce.ts does not serialise a staff edit against a summary write.
 */
async function upsertMemory(from: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.waThreadMemory.upsert({
      where: { from },
      create: { from, ...data },
      update: data,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The row appeared between our read and our create — it exists now, so the
    // update branch is correct on the retry.
    await prisma.waThreadMemory.update({ where: { from }, data });
  }
}

/** Record the clarify streak. Never throws — a lost counter is not worth a failed reply. */
export async function saveClarify(from: string, count: number): Promise<void> {
  try {
    await upsertMemory(from, { clarifyCount: count, clarifyAt: new Date() });
  } catch (err) {
    console.error(`[webhook] saveClarify failed for ${from}:`, err);
  }
}

/** What one summary refresh writes. */
export interface SummaryUpdate {
  /** null when the model found nothing worth remembering yet. */
  summary: string | null;
  /** How many answered turns it folds in. */
  turns: number;
  /** `answeredAt` of the newest turn covered — the cursor the next refresh counts from. */
  coveredThroughAt: Date;
  /** `WaMessage.id` of that turn. */
  coveredThroughId: string;
}

/**
 * Store a refreshed summary. The payload names no `directive*` column, so a
 * staff note can never be clobbered by a refresh — including through the
 * `create` branch, which is the easy way to get this wrong. Never throws.
 */
export async function saveSummary(from: string, s: SummaryUpdate): Promise<void> {
  try {
    await upsertMemory(from, {
      summary: s.summary,
      summaryAt: new Date(),
      summaryTurns: s.turns,
      coveredThroughAt: s.coveredThroughAt,
      coveredThroughId: s.coveredThroughId,
    });
  } catch (err) {
    console.error(`[webhook] saveSummary failed for ${from}:`, err);
  }
}
