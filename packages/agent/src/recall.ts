/**
 * Reading a thread's past for a turn — the database half of turns.ts and
 * memoryRecall.ts (2026-10-22).
 *
 *  - `turnsFor` turns reply rows into whole turns: every inbound line the
 *    reply answered, not only the row it landed on.
 *  - `recentTurns` is the history the prompt shows verbatim.
 *  - `recallEarlier` finds the few older turns worth putting beside it.
 *
 * All of it is scoped by `from`, the thread key, and nothing else: a lane
 * answering one customer never reads another's words.
 */

import type { PrismaClient } from "@nusantara/db";
import { answeredTurns, type AnsweredTurn } from "./turns.js";
import {
  encodeInt8,
  decodeInt8,
  rankRecall,
  type Recalled,
} from "./memoryRecall.js";
import { voyageEmbed, type VoyageOptions } from "./voyage.js";

/**
 * The turns behind some reply rows: those rows plus every inbound line
 * answered in the same instant (turns.ts says why that is the tie). Oldest
 * turn first; a turn whose reply row is not in `replyRows` is dropped.
 */
export async function turnsFor(
  db: PrismaClient,
  from: string,
  replyRows: readonly { id: string; answeredAt: Date | null }[],
): Promise<AnsweredTurn[]> {
  const instants = [
    ...new Set(
      replyRows.flatMap((r) => (r.answeredAt ? [r.answeredAt.getTime()] : [])),
    ),
  ].map((t) => new Date(t));
  if (instants.length === 0) return [];
  const rows = await db.waMessage.findMany({
    where: { from, direction: "IN", answeredAt: { in: instants } },
    select: {
      id: true,
      ts: true,
      answeredAt: true,
      text: true,
      msgType: true,
      replyText: true,
    },
  });
  const wanted = new Set(replyRows.map((r) => r.id));
  return answeredTurns(rows).filter((t) => wanted.has(t.replyId));
}

/**
 * The last `n` answered turns of a thread since its reset point, oldest
 * first — the history the prompt shows verbatim.
 */
export async function recentTurns(
  db: PrismaClient,
  from: string,
  resetAt: Date | null,
  n: number,
): Promise<AnsweredTurn[]> {
  const replies = await db.waMessage.findMany({
    where: {
      from,
      direction: "IN",
      replyText: { not: null },
      ...(resetAt ? { answeredAt: { gt: resetAt } } : {}),
    },
    orderBy: [{ answeredAt: "desc" }, { ts: "desc" }],
    take: n,
    select: { id: true, answeredAt: true },
  });
  const turns = await turnsFor(db, from, replies);
  return turns.slice(-n);
}

/** Chunks recall considers: the newest this many of one thread. */
export const RECALL_SCAN_LIMIT = 300;

/** Recall's deadline for embedding the customer's message. */
export const RECALL_TIMEOUT_MS = 1_500;

export interface RecallInput {
  readonly from: string;
  /** Only turns answered BEFORE this — the oldest turn the prompt shows. */
  readonly before: Date;
  /** And after this — the thread's `/new`, when it had one. */
  readonly after: Date | null;
  /** What the customer just wrote. */
  readonly query: string;
  /** Null without `VOYAGE_API_KEY`: recall is by keywords alone. */
  readonly voyage: VoyageOptions | null;
  readonly timeoutMs?: number;
  /** Told when the vector half failed and keywords answered instead. */
  readonly onError?: (err: unknown) => void;
}

/**
 * The earlier turns worth reminding the model of, or none.
 *
 * Runs only against turns OLDER than the history window (the prompt already
 * has the rest) and after the reset point. Costs one indexed query when the
 * thread has no such turns — most threads — and one embedding call, bounded
 * by `timeoutMs`, when it has; on any failure of that call it ranks the same
 * chunks by keywords, so Voyage can slow a reply by the deadline at most and
 * never stop one.
 */
export async function recallEarlier(
  db: PrismaClient,
  input: RecallInput,
): Promise<Recalled[]> {
  const query = input.query.trim();
  if (!query) return [];
  const rows = await db.chatMemoryChunk.findMany({
    where: {
      from: input.from,
      toMessage: {
        answeredAt: {
          lt: input.before,
          ...(input.after ? { gt: input.after } : {}),
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: RECALL_SCAN_LIMIT,
    select: {
      id: true,
      text: true,
      embedding: true,
      model: true,
      toMessage: { select: { ts: true } },
    },
  });
  if (rows.length === 0) return [];
  const candidates = rows.map((r) => ({
    id: r.id,
    text: r.text,
    at: r.toMessage.ts,
    embedding: r.embedding ? new Uint8Array(r.embedding) : null,
    model: r.model,
  }));

  let vector: { values: Int8Array; model: string } | null = null;
  const voyage = input.voyage;
  if (voyage && candidates.some((c) => c.model === voyage.model)) {
    try {
      const [v] = await voyageEmbed(
        voyage,
        [query],
        "query",
        input.timeoutMs ?? RECALL_TIMEOUT_MS,
      );
      vector = { values: decodeInt8(encodeInt8(v!)), model: voyage.model };
    } catch (err) {
      input.onError?.(err);
    }
  }
  return rankRecall(query, candidates, vector);
}
