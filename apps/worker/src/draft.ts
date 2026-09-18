/**
 * The draft pass — turning an unanswered burst into one queued reply.
 *
 * `persist.ts` in the webhook says it plainly: "BARU doubles as the work queue:
 * the agent pipeline moves a row to DIJAWAB_AGEN or PERLU_STAF once it exists."
 * This is that pipeline.
 *
 * The shape of one pass:
 *
 *   find senders whose burst has settled long enough
 *     → freeze the batch of messages this reply will answer
 *     → ask the agent (network, OUTSIDE any transaction)
 *     → one transaction: claim the frozen batch, write the answer, queue the send
 *
 * The ordering is the whole point. 08 §5 and CLAUDE.md both forbid network I/O
 * inside a database transaction, so the model call happens first and the
 * transaction opens only once there is something to commit. If the process dies
 * mid-call nothing is lost: the rows are still BARU and the next tick retries.
 *
 * ## Why the batch is frozen before the model call
 *
 * This used to read `status: 'BARU'` again at commit time, which quietly lost
 * messages. A customer sending another line while the model was thinking had it
 * swept into the update and stamped DIJAWAB_AGEN with no `replyText` — answered
 * by nobody. The thread then had zero BARU rows, so this pass never looked at it
 * again, and the inbox counts pending as BARU + PERLU_STAF, so no human saw it
 * either. Silent, unrecoverable loss.
 *
 * Now the ids are captured before the call and every write is scoped to them.
 * Anything arriving mid-call stays BARU and is answered on the next tick.
 *
 * ## Why the claim is a compare-and-swap
 *
 * The claiming `updateMany` runs FIRST inside the transaction and its row count
 * is checked. Under READ COMMITTED a concurrent writer that already moved one of
 * those rows makes the count short, and the whole transaction rolls back — so no
 * Outbox row is written and no duplicate reaches the customer. That also covers
 * the case worth having: a staff member answering through the inbox while the
 * model was thinking. Their reply stands, and the agent's stale draft is thrown
 * away instead of being sent on top of it. The wasted model call is the right
 * price — money, rather than a wrong message.
 */

import {
  DEFAULT_WAITS,
  MAX_CORRECTIONS,
  buildAgentPrompt,
  computeWaitMs,
  converse,
  hasCredential,
  anthropicClient,
  knowledgeBlock,
  loadKnowledgeBase,
  loadStoreFacts,
  matchesFor,
  matchesNote,
  renderStoreFacts,
  routeMessage,
  storeOpenAt,
  type AgentClient,
  type AnthropicEnv,
  type ConverseResult,
  type ConverseTurn,
  type ToolContext,
  type WaitProfile,
} from "@nusantara/agent";
import {
  Prisma,
  TXN_TIMEOUTS,
  enqueueOutbox,
  type PrismaClient,
} from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { isWithinWindow } from "@nusantara/whatsapp";
import { DEFAULT_PERSONA } from "@nusantara/agent";

export interface DraftDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly anthropic: AnthropicEnv;
  /**
   * Injectable so a test can script the model without mocking a module.
   * Falls back to building one from `anthropic`, which stays the dormancy switch.
   */
  readonly client?: AgentClient;
  /**
   * The base quiet window. Kept as its own knob because it is what
   * `WORKER_DEBOUNCE_MS` has always meant — it is now the middle of a range
   * rather than a flat window, and a caller that sets only this still gets
   * sensible adaptive behaviour around it.
   */
  readonly debounceMs?: number;
  readonly waits?: WaitProfile;
  readonly maxDraftsPerTick: number;
  /** Messages one reply may cover. A 60-message backlog becomes two replies. */
  readonly maxBatch?: number;
  /** The reserved agent Staff row, so a booking's UnitEvent is attributable. */
  readonly agentStaffId?: string;
  /** How far a sender's clock may run ahead before we stop believing it. */
  readonly skewToleranceMs?: number;
  /** Injectable so a test can drive the debounce without waiting. */
  readonly now?: () => Date;
}

export interface DraftPassResult {
  /** Threads that produced a queued reply. */
  readonly drafted: number;
  /** Threads handed to a human — the agent failed, or the window had closed. */
  readonly escalated: number;
  /** True when there is no credential and the pass is dormant. */
  readonly dormant: boolean;
}

/** Answered turns shown verbatim. Older ones live in the rolling summary. */
const HISTORY_TURNS = 8;

const DEFAULT_MAX_BATCH = 30;

/** `ts` is the sender's phone clock. Past this much skew, stop trusting it. */
const DEFAULT_SKEW_MS = 120_000;

/** Raised when the batch changed under us. Caught by the pass, never rethrown. */
class BatchRaceError extends Error {
  constructor(
    readonly from: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `batch for ${from} changed: expected ${expected} rows, claimed ${actual}`,
    );
    this.name = "BatchRaceError";
  }
}

interface Candidate {
  readonly from: string;
  readonly pending: number;
  readonly newestPendingAt: Date;
  readonly latestText: string | null;
}

/**
 * Senders with waiting messages, and the text the wait is judged on.
 *
 * Three things to know about this statement:
 *
 * `MAX("ts")` is filtered to BARU. Without that filter an already-answered or
 * escalated *newer* row gates a pending one, and a thread can sit unanswered
 * because of a message that was dealt with hours ago.
 *
 * The cutoff is the SHORTEST wait anyone could need, not the base window. SQL
 * only enforces "nobody is answered faster than the fastest possible wait"; the
 * actual per-sender wait is decided in JS, or the adaptive part would be
 * decorative.
 *
 * The second arm of the HAVING is the skew escape hatch. A sender whose phone
 * clock runs ahead writes a `ts` in the future, which the first arm excludes
 * forever — so without this the thread is never even a candidate and the JS
 * guard below can never fire. Threads implausibly far ahead of our own clock
 * come through here and are judged there.
 *
 * The `::timestamptz AT TIME ZONE 'UTC'` cast is mandatory. Prisma stores
 * `DateTime` as `timestamp` WITHOUT time zone holding UTC but binds a JS `Date`
 * as `timestamptz`, so a bare `::timestamp` renders the cutoff as Jakarta wall
 * clock and shifts it seven hours. Convert the parameter, not the column, so an
 * index still applies (CLAUDE.md).
 *
 * The `NOT EXISTS` is the per-thread bot switch. Staff can hand one customer to
 * a person — `WaThreadMemory.autoReply = false` — and this pass then never sees
 * that thread, while every other thread is answered as before. It is an
 * anti-join rather than a `LEFT JOIN ... IS NOT FALSE` so that a thread with no
 * memory row at all is a candidate, which is the majority of them and the same
 * answer the column's `DEFAULT true` gives.
 *
 * Excluded threads keep their rows at BARU. That is the same choice the
 * dormancy branch below makes and for the same reason: switching the bot back
 * on for this customer should answer the backlog, not find it already stamped
 * as somebody else's problem. The inbox counts BARU as pending, so a muted
 * thread still reads as waiting on a human — which it is.
 *
 * The second `NOT EXISTS` is the hand-over hold (2026-09-18). Once the bot has
 * given a thread to a person — a PERLU_STAF row — it says nothing more to that
 * customer until the person has answered: a staff reply marks every waiting
 * row DIJAWAB_STAF (routes/inbox.ts), and so does "handled" on the Chat page.
 * Without it the customer who asked for Air M1 stock and then wrote "kak?"
 * would get a second holding line from the bot while the colleague was still
 * looking. Derived from the rows rather than written onto the switch above,
 * because that switch is staff-owned and the agent's role cannot write it
 * (migration 20260827090000) — a bot that could turn itself off could also
 * turn itself on.
 */
async function quietCandidates(
  db: PrismaClient,
  floorCutoff: Date,
  skewCeiling: Date,
  limit: number,
): Promise<Candidate[]> {
  return db.$queryRaw<Candidate[]>(Prisma.sql`
    SELECT "from",
           COUNT(*) FILTER (WHERE "status" = 'BARU')::int AS "pending",
           MAX("ts") FILTER (WHERE "status" = 'BARU')     AS "newestPendingAt",
           (array_agg("text" ORDER BY "ts" DESC, "id" DESC)
              FILTER (WHERE "status" = 'BARU' AND "text" IS NOT NULL))[1]
                                                          AS "latestText"
      FROM "WaMessage"
     WHERE "direction" = 'IN'
       AND NOT EXISTS (
             SELECT 1
               FROM "WaThreadMemory" t
              WHERE t."from" = "WaMessage"."from"
                AND t."autoReply" = false
           )
       AND NOT EXISTS (
             SELECT 1
               FROM "WaMessage" h
              WHERE h."from" = "WaMessage"."from"
                AND h."direction" = 'IN'
                AND h."status" = 'PERLU_STAF'
           )
     GROUP BY "from"
    HAVING COUNT(*) FILTER (WHERE "status" = 'BARU') > 0
       AND (MAX("ts") FILTER (WHERE "status" = 'BARU')
              <= (${floorCutoff}::timestamptz AT TIME ZONE 'UTC')
            OR MAX("ts") FILTER (WHERE "status" = 'BARU')
              > (${skewCeiling}::timestamptz AT TIME ZONE 'UTC'))
     ORDER BY MAX("ts") FILTER (WHERE "status" = 'BARU') ASC
     LIMIT ${limit}
  `);
}

/**
 * Has this sender's burst settled?
 *
 * The skew guard is not theoretical. `ts` comes from the sender's device, so a
 * phone whose clock runs fast writes a timestamp in the future, the elapsed time
 * goes negative, and no wait ever elapses — the thread starves forever, and
 * silently. Answering slightly early is recoverable, because anything that
 * arrives afterwards is picked up next tick. Starvation is not.
 */
function ready(
  c: Candidate,
  now: Date,
  waits: WaitProfile,
  skewMs: number,
): { ready: boolean; waitMs: number; skewed: boolean } {
  const elapsed = now.getTime() - c.newestPendingAt.getTime();
  if (-elapsed > skewMs) return { ready: true, waitMs: 0, skewed: true };
  const waitMs = computeWaitMs([{ text: c.latestText }], waits);
  return { ready: elapsed >= waitMs, waitMs, skewed: false };
}

/**
 * The whole burst as one customer turn.
 *
 * Emitting one `user` turn per row would spend tokens telling the model the
 * customer pressed send three times, and would make "how many turns has this
 * thread had" meaningless. A row with no text but a real `msgType` still
 * contributes a marker, so a photo followed by "ini gimana?" is not answered as
 * if the photo never happened.
 */
export function combineBatch(
  rows: ReadonlyArray<{ text: string | null; msgType: string }>,
): string {
  const lines = rows.flatMap((r) => {
    const text = r.text?.trim();
    if (text) return [text];
    return r.msgType && r.msgType !== "text"
      ? [`(the customer sent a ${r.msgType})`]
      : [];
  });
  return lines.join("\n");
}

/** Answered history, oldest first, as alternating turns. */
function toTurns(
  history: ReadonlyArray<{ text: string | null; replyText: string | null }>,
  current: string,
): ConverseTurn[] {
  const turns: ConverseTurn[] = [];
  for (const m of history) {
    const text = m.text?.trim();
    if (text) turns.push({ role: "user", text });
    const reply = m.replyText?.trim();
    if (reply) turns.push({ role: "assistant", text: reply });
  }
  turns.push({ role: "user", text: current });
  return turns;
}

export async function draftPass(deps: DraftDeps): Promise<DraftPassResult> {
  const { db, logger, anthropic } = deps;
  const now = deps.now ?? (() => new Date());
  const waits: WaitProfile = deps.waits ?? {
    ...DEFAULT_WAITS,
    ...(deps.debounceMs ? { baseMs: deps.debounceMs } : {}),
  };
  const maxBatch = deps.maxBatch ?? DEFAULT_MAX_BATCH;
  const skewMs = deps.skewToleranceMs ?? DEFAULT_SKEW_MS;

  // Dormant, not broken. 06 §12: with no credential "the pipeline degrades to
  // persist-only" — messages keep landing and keep showing in the inbox, and a
  // human answers them. Rows are deliberately left at BARU rather than being
  // escalated, so that configuring a key later answers the backlog instead of
  // finding it already marked as somebody else's problem.
  const client =
    deps.client ??
    (hasCredential(anthropic) ? anthropicClient(anthropic) : null);
  if (!client) return { drafted: 0, escalated: 0, dormant: true };

  const at = now();
  const candidates = await quietCandidates(
    db,
    new Date(at.getTime() - waits.minMs),
    new Date(at.getTime() + skewMs),
    deps.maxDraftsPerTick * 3,
  );

  const due: Candidate[] = [];
  for (const c of candidates) {
    const verdict = ready(c, at, waits, skewMs);
    if (verdict.skewed) {
      logger.warn(
        { evt: "worker.draft.clock_skew", ctx: { from: c.from } },
        "the sender's clock runs ahead of ours — answering rather than waiting forever",
      );
    }
    if (!verdict.ready) continue;
    due.push(c);
    if (due.length >= deps.maxDraftsPerTick) break;
  }
  if (due.length === 0) return { drafted: 0, escalated: 0, dormant: false };

  // Read once per pass, not per thread.
  //
  // Both of these used to be unavailable to the worker: the persona lived in
  // the browser's mock store and `corrections` was hard-coded to `[]`, so a
  // staff member editing the shop's voice on the Chat page changed what THEY
  // drafted and not one word of what the bot said at 2am. That gap is what the
  // Persona and AgentCorrection tables close.
  //
  // The knowledge base and the shop facts are the bot's two sources
  // (docs/chatbot-rag.md) — read once, indexed once, and rendered once into
  // the cached half of the prompt, which is then byte-identical for every
  // thread in the pass.
  const [knowledge, storeFacts, persona, corrections] = await Promise.all([
    loadKnowledgeBase(db),
    loadStoreFacts(db).then(renderStoreFacts),
    db.persona.findFirst({
      where: { active: true },
      select: { prompt: true },
    }),
    db.agentCorrection.findMany({
      select: { original: true, corrected: true, note: true },
      orderBy: { createdAt: "desc" },
      take: MAX_CORRECTIONS,
    }),
  ]);
  const knowledgeText = knowledgeBlock(knowledge);

  let drafted = 0;
  let escalated = 0;

  // Sequential on purpose. Answering five customers at once would open five
  // model calls and five transactions against a database this shop runs on one
  // laptop, to save a few seconds on a queue that is almost always empty.
  for (const candidate of due) {
    const from = candidate.from;
    try {
      // The batch this reply will answer, frozen before the model call.
      // `id` breaks the tie because `ts` is Meta's SECONDS and a fast burst
      // ties — without it the anchor row is non-deterministic.
      const batch = await db.waMessage.findMany({
        where: { from, direction: "IN", status: "BARU" },
        orderBy: [{ ts: "asc" }, { id: "asc" }],
        take: maxBatch,
        select: { id: true, ts: true, text: true, msgType: true },
      });
      if (batch.length === 0) continue;
      const batchIds = batch.map((m) => m.id);
      const anchor = batch[batch.length - 1]!;

      // Outside the window a free-form reply cannot be delivered (06 §11), so
      // drafting one would burn a model call to queue a send Graph will reject.
      if (!isWithinWindow(anchor.ts, at)) {
        await escalate(db, batchIds, anchor.id, "window_closed");
        escalated += 1;
        logger.warn(
          { evt: "worker.draft.window_closed", ctx: { from } },
          "the 24-hour window has closed — handing the thread to a person",
        );
        continue;
      }

      const current = combineBatch(batch);
      if (!current) {
        // A sticker with no caption and no type worth naming. There is nothing
        // for the model to read, and guessing is what costs a sale.
        await escalate(db, batchIds, anchor.id, "nothing_to_read");
        escalated += 1;
        continue;
      }

      const history = await db.waMessage.findMany({
        where: { from, direction: "IN", replyText: { not: null } },
        orderBy: [{ answeredAt: "desc" }, { ts: "desc" }],
        take: HISTORY_TURNS,
        select: { text: true, replyText: true },
      });

      const memory = await db.waThreadMemory.findUnique({
        where: { from },
        select: { summary: true, directive: true },
      });

      const prompt = buildAgentPrompt({
        // A fresh database has no persona row, and production never runs the
        // seed, so the compiled-in voice is the fallback rather than an error.
        persona: persona?.prompt ?? DEFAULT_PERSONA,
        storeFacts,
        knowledge: knowledgeText,
        // Newest first out of the database, oldest first into the prompt, so
        // the most recent correction is the last thing the model reads.
        corrections: [...corrections].reverse().map((c) => ({
          original: c.original,
          corrected: c.corrected,
          note: c.note ?? undefined,
        })),
        now: at,
        openNow: storeOpenAt(at),
        summary: memory?.summary ?? null,
        directive: memory?.directive ?? null,
        recentReplies: history
          .map((h) => h.replyText)
          .filter((r): r is string => Boolean(r))
          .slice(0, 3),
        customerText: current,
      });

      // The two reads of the customer's message that do not ask the model:
      // whether it must go to a person whatever the model thinks (policy.ts),
      // and which of the owner's answers it most looks like (retrieval.ts).
      const route = routeMessage(current, {
        hasMedia: batch.some((m) => m.msgType !== "text"),
      });
      const hint = matchesNote(knowledge, matchesFor(knowledge, current));

      const ctx: ToolContext = {
        from,
        now: at,
        writesUsed: new Set<string>(),
        // Fail soft for the customer, never silent for us. A booking that
        // fails on a constraint and one that fails on a dead connection give
        // the customer the same sentence; this is the only place the
        // difference is recorded.
        onError: (tool, err) =>
          logger.error(
            {
              evt: "worker.tool.failed",
              ctx: { from, tool },
              ...(err instanceof Error
                ? { err: { name: err.name, message: err.message } }
                : {}),
            },
            "a grounding tool failed",
          ),
        ...(deps.agentStaffId
          ? { reserve: { write: db, staffId: deps.agentStaffId } }
          : {}),
      };

      let failure: unknown;
      const result = await converse({
        client,
        db,
        ctx,
        prompt,
        turns: toTurns([...history].reverse(), current),
        knowledge,
        storeFacts,
        route,
        hint,
        onError: (err) => {
          failure = err;
        },
      });

      if (!result) {
        // Fail soft, never silent (the converse docblock's own rule): the
        // customer gets a human, and the reason lands in the log where somebody
        // can find out that the token expired.
        logger.warn(
          {
            evt: "worker.draft.no_reply",
            ctx: { from },
            ...(failure instanceof Error
              ? {
                  err: {
                    name: failure.name,
                    message: failure.message,
                    status: (failure as { status?: number }).status,
                  },
                }
              : {}),
          },
          "the agent produced no reply — handing the thread to a person",
        );
        await escalate(db, batchIds, anchor.id, "no_reply");
        escalated += 1;
        continue;
      }

      // One transaction: the answer and the intent to send it commit together,
      // or neither does (08 §5). No HTTP call happens inside it.
      const answeredAt = now();
      const status = result.handoff ? "PERLU_STAF" : "DIJAWAB_AGEN";
      await db.$transaction(async (tx) => {
        // The claim, first, so its row locks are what the race is decided on.
        const { count } = await tx.waMessage.updateMany({
          where: { id: { in: batchIds }, status: "BARU" },
          data: {
            status,
            answeredByAgent: !result.handoff,
            answeredAt,
            intent: intentOf(result),
          },
        });
        if (count !== batchIds.length) {
          throw new BatchRaceError(from, batchIds.length, count);
        }
        await tx.waMessage.update({
          where: { id: anchor.id },
          data: {
            replyText: result.reply,
            // What the inbox shows the colleague picking the thread up: why,
            // and the bot's one-line note. `entities` is the JSON column
            // reserved for what the agent extracts (schema.prisma).
            ...(result.handoff
              ? {
                  entities: {
                    handoff: {
                      topic: result.handoff.topic,
                      summary: result.handoff.summary,
                      ...(result.handoff.forcedBy
                        ? { forcedBy: result.handoff.forcedBy }
                        : {}),
                      at: answeredAt.toISOString(),
                    },
                  },
                }
              : { entities: { sources: result.sources } }),
          },
        });
        await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: { to: from, body: result.reply, inReplyTo: anchor.id },
        });
      }, TXN_TIMEOUTS);

      drafted += 1;
      if (result.handoff) escalated += 1;
      logger.info(
        {
          evt: "worker.draft.queued",
          ctx: {
            from,
            covered: batchIds.length,
            tools: result.toolsUsed,
            steps: result.steps,
            sources: result.sources,
            ...(route ? { routed: route.rule } : {}),
            ...(result.handoff
              ? {
                  handoff: result.handoff.topic,
                  ...(result.handoff.forcedBy
                    ? { forcedBy: result.handoff.forcedBy }
                    : {}),
                }
              : {}),
            ...(result.rawReply !== result.reply ? { sanitised: true } : {}),
          },
        },
        "the agent drafted a reply and queued it for sending",
      );
    } catch (err) {
      if (err instanceof BatchRaceError) {
        // Somebody else answered while the model was thinking — almost always a
        // staff member through the inbox. Their reply stands; ours is dropped
        // without ever reaching the customer.
        logger.warn(
          {
            evt: "worker.draft.raced",
            ctx: { from, expected: err.expected, claimed: err.actual },
          },
          "the thread was answered while the agent was drafting — discarding the draft",
        );
        continue;
      }
      // One bad thread must not stop the pass. The rows stay BARU and the next
      // tick tries again.
      logger.error(
        {
          evt: "worker.draft.failed",
          ctx: { from },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "failed to draft a reply for a thread",
      );
    }
  }

  return { drafted, escalated, dormant: false };
}

/**
 * What this turn was about — a closed vocabulary derived from what the turn
 * DID, never from model free text, so it cannot be talked into a new value.
 * `intent` has been in the schema, unwritten, since the first migration.
 *
 * A hand-over is `staf:<topic>` (policy.ts `HANDOFF_TOPICS`), so the inbox
 * can say why a person is needed without reading `entities`. An answer is named
 * by what it rested on: the owner's answers, the shop facts, the catalogue, or
 * nothing at all (a greeting).
 */
function intentOf(result: ConverseResult): string {
  if (result.handoff) return `staf:${result.handoff.topic}`;
  if (result.sources.some((s) => /^K\d+$/.test(s))) return "jawab:faq";
  if (result.sources.includes("catalog")) return "jawab:katalog";
  if (result.sources.includes("store")) return "jawab:toko";
  return "sapaan";
}

/**
 * Hand a batch to a human, without a reply.
 *
 * Scoped to the frozen ids, exactly like the claim: escalating on the model's
 * failure happens AFTER a network call, so the unbounded predicate would sweep
 * in a message that arrived meanwhile and hide it from everyone.
 *
 * PERLU_STAF is terminal for the agent — this pass only selects BARU rows, and
 * the hold in `quietCandidates` keeps it off the whole thread — so an
 * escalated thread is not retried in a loop. It shows in the inbox as waiting,
 * with the reason on the newest row so the colleague knows why.
 */
async function escalate(
  db: PrismaClient,
  batchIds: string[],
  anchorId: string,
  why: "window_closed" | "nothing_to_read" | "no_reply",
): Promise<number> {
  const summary =
    why === "window_closed"
      ? "Jendela 24 jam WhatsApp sudah tutup — balas dengan template."
      : why === "nothing_to_read"
        ? "Pesan tanpa teks yang bisa dibaca bot."
        : "Bot gagal membalas — cek log worker.";
  return db.$transaction(async (tx) => {
    const { count } = await tx.waMessage.updateMany({
      where: { id: { in: batchIds }, status: "BARU" },
      data: { status: "PERLU_STAF", intent: "staf:other" },
    });
    await tx.waMessage.updateMany({
      where: { id: anchorId, status: "PERLU_STAF" },
      data: {
        entities: {
          handoff: {
            topic: "other",
            summary,
            forcedBy: why,
            at: new Date().toISOString(),
          },
        },
      },
    });
    return count;
  }, TXN_TIMEOUTS);
}
