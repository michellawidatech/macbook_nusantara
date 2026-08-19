/**
 * The draft pass — turning an unanswered message into a queued reply.
 *
 * `persist.ts` in the webhook says it plainly: "BARU doubles as the work queue:
 * the agent pipeline moves a row to DIJAWAB_AGEN or PERLU_STAF once it exists."
 * This is that pipeline. Before it, every inbound message sat at BARU forever —
 * stored, visible to nobody, answered by nothing.
 *
 * The shape of one pass:
 *
 *   find quiet threads with waiting messages
 *     → read the thread
 *     → ask the agent (network, OUTSIDE any transaction)
 *     → one transaction: write the answer onto the row AND enqueue the send
 *
 * The ordering is the whole point. 08 §5 and CLAUDE.md both forbid network I/O
 * inside a database transaction, so the model call happens first and the
 * transaction is opened only once there is something to commit. If the process
 * dies mid-model-call nothing is lost: the row is still BARU and the next tick
 * picks it up again.
 */

import {
  buildSystemPrompt,
  converse,
  DEFAULT_PERSONA,
  hasCredential,
  anthropicClient,
  type AnthropicEnv,
  type ConverseTurn,
} from "@nusantara/agent";
import { Prisma, enqueueOutbox, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { isWithinWindow } from "@nusantara/whatsapp";

export interface DraftDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly anthropic: AnthropicEnv;
  readonly debounceMs: number;
  readonly maxDraftsPerTick: number;
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

/** How much of a thread the model is shown. Older turns stop being relevant. */
const THREAD_TURNS = 20;

/** Staff-approved answers pulled into the prompt. Mirrors the API's cap. */
const KNOWLEDGE_LIMIT = 40;

/**
 * Senders with waiting messages who have been quiet long enough to answer.
 *
 * The `nextAttemptAt`-style timestamp trap applies here too: Prisma stores
 * `DateTime` as `timestamp` WITHOUT time zone holding UTC but binds a JS `Date`
 * as `timestamptz`, so a bare `::timestamp` cast would render the cutoff as
 * Asia/Jakarta wall clock and shift it seven hours. Convert the parameter, not
 * the column, so the index still applies (CLAUDE.md).
 */
async function quietThreads(
  db: PrismaClient,
  cutoff: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ from: string }>>(Prisma.sql`
    SELECT "from"
      FROM "WaMessage"
     WHERE "direction" = 'IN'
     GROUP BY "from"
    HAVING COUNT(*) FILTER (WHERE "status" = 'BARU') > 0
       AND MAX("ts") <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
     ORDER BY MAX("ts") ASC
     LIMIT ${limit}
  `);
  return rows.map((r) => r.from);
}

/**
 * Render a thread as alternating turns.
 *
 * A stored `replyText` becomes an `assistant` turn whether a human or the bot
 * wrote it, because from the model's side they are the same thing: words this
 * shop has already put in front of this customer.
 */
function toTurns(
  messages: ReadonlyArray<{ text: string | null; replyText: string | null }>,
): ConverseTurn[] {
  const turns: ConverseTurn[] = [];
  for (const m of messages) {
    const text = m.text?.trim();
    if (text) turns.push({ role: "user", text });
    const reply = m.replyText?.trim();
    if (reply) turns.push({ role: "assistant", text: reply });
  }
  return turns;
}

export async function draftPass(deps: DraftDeps): Promise<DraftPassResult> {
  const { db, logger, anthropic } = deps;
  const now = deps.now ?? (() => new Date());

  // Dormant, not broken. 06 §12: with no credential "the pipeline degrades to
  // persist-only" — messages keep landing and keep showing in the inbox, and a
  // human answers them. Rows are deliberately left at BARU rather than being
  // escalated, so that configuring a key later answers the backlog instead of
  // finding it already marked as somebody else's problem.
  if (!hasCredential(anthropic)) {
    return { drafted: 0, escalated: 0, dormant: true };
  }
  const client = anthropicClient(anthropic);
  if (!client) return { drafted: 0, escalated: 0, dormant: true };

  const at = now();
  const senders = await quietThreads(
    db,
    new Date(at.getTime() - deps.debounceMs),
    deps.maxDraftsPerTick,
  );
  if (senders.length === 0) return { drafted: 0, escalated: 0, dormant: false };

  const knowledge = await db.agentKnowledge.findMany({
    where: { active: true },
    select: { question: true, answer: true },
    orderBy: { updatedAt: "desc" },
    take: KNOWLEDGE_LIMIT,
  });

  const systemPrompt = buildSystemPrompt({
    persona: DEFAULT_PERSONA,
    knowledge,
    // No `Correction` table exists, so the unattended path cannot replay staff
    // rewrites the way the Chat page can. See the note on DEFAULT_PERSONA:
    // closing that gap is a migration and an owner's decision, not a column
    // added quietly here.
    corrections: [],
    today: at,
  });

  let drafted = 0;
  let escalated = 0;

  // Sequential on purpose. Answering five customers at once would open five
  // model calls and five transactions against a database this shop runs on one
  // laptop, to save a few seconds on a queue that is almost always empty.
  for (const from of senders) {
    try {
      const messages = await db.waMessage.findMany({
        where: { from, direction: "IN" },
        orderBy: { ts: "desc" },
        take: THREAD_TURNS,
        select: {
          id: true,
          ts: true,
          text: true,
          replyText: true,
          status: true,
        },
      });
      if (messages.length === 0) continue;
      const thread = [...messages].reverse();
      const latest = thread[thread.length - 1]!;

      // Outside the window a free-form reply cannot be delivered (06 §11), so
      // drafting one would burn a model call to queue a send Graph will reject.
      // A person with an approved template is the only way to reach them.
      if (!isWithinWindow(latest.ts, at)) {
        const n = await escalate(db, from);
        escalated += n > 0 ? 1 : 0;
        logger.warn(
          { evt: "worker.draft.window_closed", ctx: { from } },
          "the 24-hour window has closed — handing the thread to a person",
        );
        continue;
      }

      const turns = toTurns(thread);
      if (turns.length === 0) {
        // An image or a sticker with no caption. There is nothing for the model
        // to read, and guessing at it is exactly the behaviour that costs a sale.
        await escalate(db, from);
        escalated += 1;
        continue;
      }

      let failure: unknown;
      const result = await converse({
        client,
        db,
        systemPrompt,
        turns,
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
        await escalate(db, from);
        escalated += 1;
        continue;
      }

      // One transaction: the answer and the intent to send it commit together,
      // or neither does (08 §5). No HTTP call happens inside it.
      const answeredAt = now();
      await db.$transaction(async (tx) => {
        await tx.waMessage.update({
          where: { id: latest.id },
          data: {
            replyText: result.reply,
            status: "DIJAWAB_AGEN",
            answeredByAgent: true,
            answeredAt,
          },
        });
        // The earlier fragments this one answer covers.
        await tx.waMessage.updateMany({
          where: {
            from,
            direction: "IN",
            status: "BARU",
            id: { not: latest.id },
          },
          data: { status: "DIJAWAB_AGEN", answeredByAgent: true, answeredAt },
        });
        await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: { to: from, body: result.reply, inReplyTo: latest.id },
        });
      });

      drafted += 1;
      logger.info(
        {
          evt: "worker.draft.queued",
          ctx: { from, tools: result.toolsUsed, steps: result.steps },
        },
        "the agent drafted a reply and queued it for sending",
      );
    } catch (err) {
      // One bad thread must not stop the pass. The row stays BARU and the next
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
 * Hand a thread to a human.
 *
 * PERLU_STAF is a terminal state for the agent: the draft pass only looks at
 * BARU, so an escalated thread is not retried in a loop. It shows in the inbox
 * as waiting, which is the honest description of what it is.
 */
async function escalate(db: PrismaClient, from: string): Promise<number> {
  const { count } = await db.waMessage.updateMany({
    where: { from, direction: "IN", status: "BARU" },
    data: { status: "PERLU_STAF" },
  });
  return count;
}
