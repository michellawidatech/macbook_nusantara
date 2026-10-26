/**
 * The memory pass — answered turns into `ChatMemoryChunk`, then embedded
 * (owner, 2026-10-22).
 *
 * Runs after the summary pass, so like it the customer never waits on it, and
 * like it it fails independently: a Voyage outage leaves chunks un-embedded
 * and every reply goes out as before.
 *
 * Two halves, both small and both bounded per tick:
 *
 *  1. **Chunk.** Every answered turn not yet chunked becomes one row: every
 *     inbound line of the burst and the reply (packages/agent turns.ts), as
 *     "customer: …" / "shop: …" text. A turn is found by its reply row, and
 *     "not yet chunked" is "no chunk names it as `toMessageId`" — so the pass
 *     is its own cursor and a missed tick only means later. Reset commands
 *     (`/new`) are not turns, and nor is anything answered before a staff
 *     *Clear chat* (`WaThreadMemory.clearedAt`).
 *  2. **Embed.** Without `VOYAGE_API_KEY` this half does nothing: chunks stay
 *     text and recall ranks them by keywords. With one, the oldest pending
 *     chunks go to Voyage in ONE call (input_type "document"), each vector is
 *     written as int8 bytes. Never inside a transaction: the call is network,
 *     and each row's update is its own statement afterwards.
 *
 * Runs as nusantara_agent: INSERT on the table and UPDATE on the four
 * embedding columns are all it holds (migration 20261022120000), so this
 * pass cannot rewrite a chunk's words even by mistake.
 *
 * Two workers racing could chunk the same turn twice. Harmless — recall
 * returns at most three lines and a duplicate is one wasted line — and not
 * worth a unique index the owner did not ask for.
 */

import {
  RESET_INTENT,
  VOYAGE_DIMENSIONS,
  chunkText,
  encodeInt8,
  turnsFor,
  voyageEmbed,
  type VoyageOptions,
} from "@nusantara/agent";
import { Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

export interface MemoryDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** Null without `VOYAGE_API_KEY`: chunk, never embed. */
  readonly voyage: VoyageOptions | null;
  /** Answered turns chunked per tick. */
  readonly maxTurns: number;
  /** Chunks embedded per tick (one Voyage call). */
  readonly maxEmbeds: number;
  /** The embedding call's deadline. */
  readonly timeoutMs?: number;
}

export interface MemoryPassResult {
  readonly chunked: number;
  readonly embedded: number;
}

/** A background call: generous, but never long enough to stall the loop. */
const EMBED_TIMEOUT_MS = 10_000;

/**
 * Reply rows with no chunk yet, oldest first. `NOT EXISTS` on the FK column
 * the chunk carries; the reset command's own row is not a turn.
 */
async function unchunkedReplies(
  db: PrismaClient,
  limit: number,
): Promise<Array<{ id: string; from: string; answeredAt: Date }>> {
  return db.$queryRaw(Prisma.sql`
    SELECT m."id", m."from", m."answeredAt"
      FROM "WaMessage" m
      LEFT JOIN "WaThreadMemory" t ON t."from" = m."from"
     WHERE m."direction" = 'IN'
       AND m."replyText" IS NOT NULL
       AND m."answeredAt" IS NOT NULL
       AND m."intent" IS DISTINCT FROM ${RESET_INTENT}
       -- A cleared chat is forgotten (2026-10-27): a turn answered before the
       -- clear is never chunked — and after a delete, the turns a rating kept
       -- are not chunked again either.
       AND (t."clearedAt" IS NULL OR m."answeredAt" > t."clearedAt")
       AND NOT EXISTS (
             SELECT 1 FROM "ChatMemoryChunk" c WHERE c."toMessageId" = m."id"
           )
     ORDER BY m."answeredAt" ASC, m."id" ASC
     LIMIT ${limit}
  `);
}

export async function memoryPass(deps: MemoryDeps): Promise<MemoryPassResult> {
  const { db, logger } = deps;
  let chunked = 0;
  let embedded = 0;

  // 1. Chunk.
  try {
    const replies = await unchunkedReplies(db, deps.maxTurns);
    const byThread = new Map<string, typeof replies>();
    for (const r of replies) {
      const list = byThread.get(r.from);
      if (list) list.push(r);
      else byThread.set(r.from, [r]);
    }
    for (const [from, rows] of byThread) {
      const turns = await turnsFor(db, from, rows);
      if (turns.length === 0) continue;
      const { count } = await db.chatMemoryChunk.createMany({
        data: turns.map((t) => ({
          from,
          fromMessageId: t.firstId,
          toMessageId: t.replyId,
          text: chunkText(t),
        })),
      });
      chunked += count;
    }
  } catch (err) {
    logger.error(
      {
        evt: "worker.memory.chunk_failed",
        ...(err instanceof Error
          ? { err: { name: err.name, message: err.message } }
          : {}),
      },
      "could not write chat memory chunks — retrying next tick",
    );
  }

  // 2. Embed.
  const voyage = deps.voyage;
  if (!voyage) return { chunked, embedded };
  try {
    const pending = await db.chatMemoryChunk.findMany({
      where: { embedding: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: deps.maxEmbeds,
      select: { id: true, text: true },
    });
    if (pending.length > 0) {
      const vectors = await voyageEmbed(
        voyage,
        pending.map((p) => p.text),
        "document",
        deps.timeoutMs ?? EMBED_TIMEOUT_MS,
      );
      const at = new Date();
      for (const [i, p] of pending.entries()) {
        // Only the four embedding columns — all the role may update.
        await db.chatMemoryChunk.update({
          where: { id: p.id },
          data: {
            embedding: Buffer.from(encodeInt8(vectors[i]!)),
            model: voyage.model,
            dims: VOYAGE_DIMENSIONS,
            embeddedAt: at,
          },
          select: { id: true },
        });
        embedded += 1;
      }
    }
  } catch (err) {
    // The status only (VoyageError never carries the key or the body).
    logger.warn(
      {
        evt: "worker.memory.embed_failed",
        ...(err instanceof Error
          ? {
              err: {
                name: err.name,
                message: err.message,
                status: (err as { status?: number }).status,
              },
            }
          : {}),
      },
      "could not embed chat memory — keyword recall still works; retrying next tick",
    );
  }
  return { chunked, embedded };
}
