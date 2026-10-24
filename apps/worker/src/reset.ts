/**
 * The reset pass — a tester's `/new`, acted on (owner ask 2026-10-14). The
 * rule and its three decisions are packages/agent/src/reset.ts; this is the
 * write.
 *
 * ## Why it is its own pass, ahead of the draft
 *
 * The draft pass never sees the two threads a reset matters most on: one the
 * bot handed to a person (the hold in `quietCandidates`) and one whose
 * `autoReply` staff switched off. A command read there would be a command
 * that works until the first hand-over. So this looks for the row itself,
 * whatever state its thread is in, and needs no model — it runs with no
 * Anthropic credential, like `refreshOffers`.
 *
 * It also does not wait out the debounce. That window exists so three quick
 * messages get one considered answer; a command is not a thought in progress.
 *
 * ## One transaction per thread
 *
 *  1. CLAIM the `/new` row — `BARU` → answered, stamped `RESET_INTENT`. The
 *     claim is what a staff reply races against, exactly as a draft's is; if
 *     somebody answered first, nothing else here happens.
 *  2. Close what was waiting from BEFORE the command: messages nobody had
 *     answered, and the hand-over rows, which is what lifts the hold.
 *     Messages typed after `/new` are left at `BARU` — they are the new
 *     conversation's first words and the draft pass answers them next.
 *  3. Close the thread's open tasks. They describe a conversation that, for
 *     this tester, is over.
 *  4. Drop the summary and move its cursor to now, so the summary pass does
 *     not rebuild the note from the turns that were just left behind.
 *  5. Queue the confirmation.
 *
 * Nothing is deleted and no earlier message's words change: the inbox still
 * shows the whole thread, and `resetPointFor` is how a reader skips it.
 */
import {
  RESET_INTENT,
  RESET_REPLY,
  isResetCommand,
  loadTesters,
} from "@nusantara/agent";
import { enqueueOutbox, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

export interface ResetDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface ResetPassResult {
  /** Threads started over this pass. */
  readonly reset: number;
  /** The numbers the command is honoured from, for the draft pass's guard. */
  readonly testers: readonly string[];
}

export async function resetPass(deps: ResetDeps): Promise<ResetPassResult> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const testers = await loadTesters(db);
  if (testers.length === 0) return { reset: 0, testers };

  // Narrowed in SQL, decided in JS: `contains` finds "/new" inside a longer
  // sentence too, and only the bare command is one.
  const waiting = await db.waMessage.findMany({
    where: {
      direction: "IN",
      status: "BARU",
      from: { in: testers },
      text: { contains: "/new", mode: "insensitive" },
    },
    orderBy: [{ ts: "asc" }, { id: "asc" }],
    select: { id: true, from: true, ts: true, text: true },
  });
  // The LAST command per thread: `/new` typed twice is one reset, and the
  // earlier one is swept up as a message from before it.
  const marks = new Map<string, { id: string; ts: Date }>();
  for (const m of waiting) {
    if (isResetCommand(m.text)) marks.set(m.from, { id: m.id, ts: m.ts });
  }

  let reset = 0;
  for (const [from, mark] of marks) {
    const at = now();
    try {
      const done = await db.$transaction(async (tx) => {
        const { count } = await tx.waMessage.updateMany({
          where: { id: mark.id, status: "BARU" },
          data: {
            status: "DIJAWAB_AGEN",
            answeredByAgent: true,
            answeredAt: at,
            intent: RESET_INTENT,
            replyText: RESET_REPLY,
          },
        });
        if (count !== 1) return false;

        await tx.waMessage.updateMany({
          where: {
            from,
            direction: "IN",
            id: { not: mark.id },
            OR: [
              { status: "PERLU_STAF" },
              {
                status: "BARU",
                // The order the draft pass reads a burst in: `ts` is Meta's
                // whole seconds, so `id` breaks the tie.
                OR: [
                  { ts: { lt: mark.ts } },
                  { ts: mark.ts, id: { lt: mark.id } },
                ],
              },
            ],
          },
          data: {
            status: "DIJAWAB_AGEN",
            answeredByAgent: true,
            answeredAt: at,
            intent: RESET_INTENT,
          },
        });

        await tx.chatAction.updateMany({
          where: { from, status: "OPEN" },
          data: { status: "DONE", resolvedAt: at, updatedAt: at },
        });

        // Only columns the agent's role is granted (memory.ts `saveSummary`).
        await tx.waThreadMemory.upsert({
          where: { from },
          update: {
            summary: null,
            summaryAt: at,
            summaryTurns: 0,
            coveredThroughAt: at,
            coveredThroughId: mark.id,
            updatedAt: at,
          },
          create: {
            from,
            summary: null,
            summaryAt: at,
            summaryTurns: 0,
            coveredThroughAt: at,
            coveredThroughId: mark.id,
            clarifyCount: 0,
            updatedAt: at,
          },
        });

        await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: { to: from, body: RESET_REPLY, inReplyTo: mark.id },
        });
        return true;
      });
      if (done) {
        reset += 1;
        logger.info(
          { evt: "worker.reset", ctx: { from } },
          "a tester started their conversation over",
        );
      }
    } catch (err) {
      // One thread's failure must not stop the draft pass that follows.
      logger.error(
        {
          evt: "worker.reset.failed",
          ctx: { from },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "could not reset a tester's thread",
      );
    }
  }
  return { reset, testers };
}
