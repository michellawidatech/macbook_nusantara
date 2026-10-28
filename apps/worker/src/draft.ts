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
 * Anything arriving mid-call stays BARU — and, since 2026-10-27, the draft is
 * DROPPED (see "Why a draft is dropped" below), so the next tick answers the
 * old lines and the new one as one turn.
 *
 * ## Why a draft is dropped when the customer kept typing
 *
 * Owner report 2026-10-27: "Hmmm kemahalan", then "ada yg 15 jutaan gak ya"
 * a few seconds later — and two replies a minute after, one per line. The
 * second line landed while the model was writing the first reply, so the
 * first reply answered half a thought and the second line got a reply of its
 * own. So the commit now asks one more question, last thing before COMMIT:
 * has a BARU line arrived from this customer since the batch was frozen? If
 * so the transaction is rolled back — no claim, no Outbox row, every row still
 * BARU — and the next pass, once the burst has settled again, answers it all.
 *
 * Race-safety: the check is a COUNT inside the commit transaction, issued
 * after every other write. Under READ COMMITTED a statement sees every row
 * committed before it starts, and the webhook commits each message in its own
 * transaction. So a line is either committed before the count — seen, and the
 * draft is dropped — or committed after it, in which case it reached the
 * database after this reply was decided, exactly like a line sent a second
 * after the reply went out, and the next tick answers it as its own turn. The
 * window between the two is the COMMIT itself. Locking out the webhook (an
 * advisory lock it would also have to take) would move that boundary, not
 * remove it, and put a lock on the ingest path; the lease already keeps a
 * second lane or worker off the thread meanwhile.
 *
 * "Arrived since the freeze" is by id, not by `ts`: the rows BARU when the
 * batch was frozen (the batch, plus anything a full batch left over) are
 * remembered, and any other BARU row is new. `ts` is the sender's phone
 * clock, and a 60-message backlog split over two replies must not read its
 * own second half as "the customer is still typing".
 *
 * A customer who never stops typing must still be answered: a thread's draft
 * is dropped at most `MAX_SUPERSEDES` times in a row (an in-process count —
 * a restart forgets it, which costs one more drop at worst), and never once
 * the oldest line of the batch is `SUPERSEDE_MAX_AGE_MS` old. Nor is a draft
 * dropped when its turn booked, moved or cancelled a visit or proposed one
 * (`ANNOUNCED_WRITES`): that write has already committed on its own and the
 * reply is the only thing that tells the customer.
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
  isResetCommand,
  resetPointFor,
  summarySince,
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
  effectiveCapabilities,
  keepRequestNote,
  loadCapabilities,
  SHOP_CAPABILITIES,
  TASK_REASON,
  isHandoffTopic,
  saidColleagueWillReply,
  taskNote,
  type AgentCapabilities,
  type WaitingTask,
  type AgentApiOptions,
  type AgentStep,
  type CallUsage,
  type PipelineResult,
  type RulesResult,
  agentApiDispatch,
  lastShownUnits,
  lastWatchOffer,
  phoneForms,
  profileKnown,
  runRules,
  visitReplyTurn,
  type RemindedVisit,
  costMicros,
  dispatchTool,
  isLead,
  loadAgentPersonas,
  chatbotSettings,
  leadScoreOf,
  understand,
  answersOwnQuestion,
  openProposalLine,
  personaFor,
  profileLine,
  recallEarlier,
  recentTurns,
  runPipeline,
  storeOpenAt,
  type AgentClient,
  type AnthropicEnv,
  type ConverseResult,
  type ConverseTurn,
  type ToolContext,
  type VoyageOptions,
  type WaitProfile,
  CALL_RETRIES,
  CALL_TIMEOUT_MS,
  STAFF_ACTIVE_MS,
  TURN_DEADLINE_MS,
  guardClient,
  holdingMessage,
  modelErrorReason,
  staffTypedReply,
  type CallGuard,
} from "@nusantara/agent";
import {
  Prisma,
  TXN_TIMEOUTS,
  enqueueOutbox,
  type PrismaClient,
} from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { isWithinWindow } from "@nusantara/whatsapp";
import { DEFAULT_PERSONA, loadNotifyNumbers } from "@nusantara/agent";
import { refreshOffers, upsertChatAction } from "./actions.js";
import { resetPass } from "./reset.js";
import { claimThread, inPool, leaseHolder, releaseThread } from "./lease.js";

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
  /**
   * Threads answered at once (chatbot v2). Absent is 1 — sequential — so a
   * caller that never asked for parallelism keeps the old behaviour; the
   * worker's config passes `WORKER_DRAFT_CONCURRENCY` (default 8).
   */
  readonly concurrency?: number;
  /**
   * The POS's agent API. Present, the POS tools go over HTTP with a token for
   * this turn and this customer (packages/agent agentApi.ts); absent, they
   * run here against `db`.
   */
  readonly agentApi?: AgentApiOptions;
  /** This process's name on a thread lease. Injectable so a test can be two workers. */
  readonly leaseHolder?: string;
  /**
   * How long a staff reply by hand keeps the bot out of that thread.
   * Defaults to `STAFF_ACTIVE_MS`.
   */
  readonly staffActiveMs?: number;
  /** Messages one reply may cover. A 60-message backlog becomes two replies. */
  readonly maxBatch?: number;
  /** The reserved agent Staff row, so a booking's UnitEvent is attributable. */
  readonly agentStaffId?: string;
  /**
   * What the bot may do for itself when a switch on /chat was never pressed
   * (packages/agent `policy.ts`). Absent is `SHOP_CAPABILITIES` since
   * 2026-10-27 — the POS is the source of truth: stock, prices, photos and
   * visits on (a bot booking holds no unit since the same day's sales work).
   */
  readonly capabilities?: AgentCapabilities;
  /**
   * How long after a missed appointment a bot booking is released (the
   * expiry pass's grace), so a booking can tell the customer until when.
   */
  readonly reservationGraceMs?: number;
  /** How far a sender's clock may run ahead before we stop believing it. */
  readonly skewToleranceMs?: number;
  /**
   * Drafts dropped per thread because the customer kept typing. Absent is
   * this process's own; a test passes a fresh one.
   */
  readonly superseded?: SupersedeLedger;
  /**
   * The bot never goes silent (2026-10-27): one model call's limit and its
   * retries, and the whole turn's deadline — past which the customer gets the
   * holding line and a colleague a task, whatever the turn was doing.
   */
  readonly callTimeoutMs?: number;
  readonly callRetries?: number;
  readonly turnDeadlineMs?: number;
  /** A test's backoff (sleep, jitter); production uses the guard's own. */
  readonly callGuard?: Pick<
    CallGuard,
    "sleep" | "random" | "baseDelayMs" | "maxDelayMs"
  >;
  /**
   * Turns that threw, per thread. Absent is this process's own; a test
   * passes a fresh one. The watchdog (stale.ts) reads it for its reason.
   */
  readonly failures?: FailureLedger;
  /** Injectable so a test can drive the debounce without waiting. */
  readonly now?: () => Date;
  /**
   * Recall of turns older than the history window (2026-10-22). `voyage`
   * null is keyword recall; absent altogether is the same. `timeoutMs` bounds
   * the one embedding call a turn may make.
   */
  readonly recall?: {
    readonly voyage: VoyageOptions | null;
    readonly timeoutMs?: number;
  };
}

export interface DraftPassResult {
  /** Threads that produced a queued reply. */
  readonly drafted: number;
  /** Threads handed to a human — the agent failed, or the window had closed. */
  readonly escalated: number;
  /** True when there is no credential and the pass is dormant. */
  readonly dormant: boolean;
}

/**
 * How long a staff member's own reply keeps the bot out of a thread — in
 * packages/agent (liveness.ts) since 2026-10-27, so /chat's caption reads the
 * same number the worker holds to.
 */
export { STAFF_ACTIVE_MS };

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

/**
 * A line arrived while the reply was being written. Thrown inside the commit
 * transaction so it rolls back; caught by the pass, never rethrown.
 */
class SupersededError extends Error {
  constructor(
    readonly from: string,
    readonly arrived: number,
  ) {
    super(`${arrived} newer message(s) from ${from} arrived while drafting`);
    this.name = "SupersededError";
  }
}

/** Drafts dropped in a row before one is committed anyway. */
export const MAX_SUPERSEDES = 2;

/** Past this, the batch's oldest line has waited long enough: commit. */
export const SUPERSEDE_MAX_AGE_MS = 60_000;

/** A count of drops older than this is forgotten. */
const SUPERSEDE_TTL_MS = 10 * 60_000;

/**
 * Tools whose write the reply announces. A turn that used one is committed
 * even if a line arrived meanwhile: the booking is already in the database,
 * and a dropped reply would leave the customer without its code or time.
 */
const ANNOUNCED_WRITES: ReadonlySet<string> = new Set([
  "book_visit",
  "reschedule_reservation",
  "cancel_reservation",
  "confirm_reservation",
  "propose_reservation",
]);

/** Per thread: drafts dropped in a row, and when the last one was. */
export type SupersedeLedger = Map<string, { count: number; at: number }>;

const processLedger: SupersedeLedger = new Map();

/** Drops this thread has had in a row, within the TTL. */
function dropsSoFar(ledger: SupersedeLedger, from: string, now: Date): number {
  const entry = ledger.get(from);
  if (!entry) return 0;
  if (now.getTime() - entry.at > SUPERSEDE_TTL_MS) {
    ledger.delete(from);
    return 0;
  }
  return entry.count;
}

function noteDrop(ledger: SupersedeLedger, from: string, now: Date): number {
  const count = dropsSoFar(ledger, from, now) + 1;
  ledger.set(from, { count, at: now.getTime() });
  // Bounded: a long-running worker meets thousands of customers.
  if (ledger.size > 5_000) {
    for (const [k, v] of ledger)
      if (now.getTime() - v.at > SUPERSEDE_TTL_MS) ledger.delete(k);
  }
  return count;
}

/**
 * Turns that THREW for a thread, in a row (2026-10-27). A throw used to leave
 * the rows BARU for the next tick to try again — every two seconds, for ever,
 * a model call each time, and the customer answered by nobody. After
 * `MAX_DRAFT_FAILURES` the thread gets the holding line and a colleague a
 * task instead (`holdTheLine`). In-process like the supersede count; the
 * watchdog (stale.ts) catches what a restart forgets.
 */
export type FailureLedger = Map<string, { count: number; at: number }>;

const processFailures: FailureLedger = new Map();

/** This process's failure ledger — the watchdog's default. */
export function processFailureLedger(): FailureLedger {
  return processFailures;
}

/** Throws in a row before the thread is handed over with the holding line. */
export const MAX_DRAFT_FAILURES = 3;

/** Failures this thread has had in a row, within the TTL. */
export function failuresSoFar(
  ledger: FailureLedger,
  from: string,
  now: Date,
): number {
  return dropsSoFar(ledger, from, now);
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
 * There is NO hand-over hold any more (owner, 2026-10-27, reversing
 * 2026-09-18): *"even if the user asks something and it should escalate, if
 * the user asks something else that should not be escalated, the system
 * should still answer it rather than stop immediately."* A message that needed
 * a person stays PERLU_STAF — outlined on /chat, its task open — and is never
 * drafted again, because this pass only reads BARU rows; but the customer's
 * NEWER messages are answered as usual, with the waiting questions named in
 * the prompt so the bot neither answers nor contradicts them
 * (`waitingTasks`).
 *
 * The second `NOT EXISTS` is what replaced it: a person actively chatting.
 * A staff reply by hand (`replyText` written by a Staff, routes/inbox.ts)
 * within `staffActiveMs` keeps the bot out of the thread, so it does not talk
 * over a colleague mid-conversation; their newer messages stay BARU, which
 * the inbox shows as waiting. Mark handled writes no `replyText` and does not
 * count — nobody is typing there. Once the colleague has been quiet for the
 * window, the bot answers what is still waiting. Derived from the rows rather
 * than written onto the switch above, because that switch is staff-owned and
 * the agent's role cannot write it (migration 20260827090000).
 */
async function quietCandidates(
  db: PrismaClient,
  floorCutoff: Date,
  skewCeiling: Date,
  staffActiveSince: Date,
  limit: number,
): Promise<Candidate[]> {
  const paused = [
    ...(await staffActiveThreads(db, staffActiveSince)).keys(),
    // Staff alert numbers (2026-10-28): a colleague answering an alert with
    // "ok" is not a customer, and the bot never answers them.
    ...(await loadNotifyNumbers(db)),
  ];
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
       AND NOT ("from" = ANY(${paused}::text[]))
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
 * Threads a colleague is chatting in right now: a reply a PERSON typed
 * (`staffTypedReply`) since `since`, and no Clear chat after it. Keyed by
 * thread, with the newest such reply.
 *
 * In JS rather than in the candidate query (2026-10-27 audit): the SQL read
 * any row with a staff id, a reply and a recent `answeredAt` — and a
 * hand-over row a colleague closed with Mark handled or Clear chat is exactly
 * that, the bot's holding line under a staff id stamped a second ago. So
 * pressing Mark handled silenced the bot for fifteen minutes.
 */
export async function staffActiveThreads(
  db: PrismaClient,
  since: Date,
  froms?: readonly string[],
): Promise<Map<string, { at: Date; byId: string }>> {
  const rows = await db.waMessage.findMany({
    where: {
      direction: "IN",
      answeredByAgent: false,
      answeredById: { not: null },
      replyText: { not: null },
      answeredAt: { gt: since },
      ...(froms ? { from: { in: [...froms] } } : {}),
    },
    select: {
      from: true,
      replyText: true,
      answeredByAgent: true,
      answeredById: true,
      answeredAt: true,
      entities: true,
    },
  });
  const typed = rows.filter((r) => staffTypedReply(r));
  if (typed.length === 0) return new Map();
  const cleared = new Map(
    (
      await db.waThreadMemory.findMany({
        where: {
          from: { in: [...new Set(typed.map((r) => r.from))] },
          clearedAt: { not: null },
        },
        select: { from: true, clearedAt: true },
      })
    ).map((m) => [m.from, m.clearedAt!]),
  );
  const out = new Map<string, { at: Date; byId: string }>();
  for (const r of typed) {
    const at = r.answeredAt!;
    // A Clear chat after the reply: the colleague is done here.
    const c = cleared.get(r.from);
    if (c && c >= at) continue;
    const prev = out.get(r.from);
    if (!prev || prev.at < at) out.set(r.from, { at, byId: r.answeredById! });
  }
  return out;
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

/**
 * Answered history, oldest first, as alternating turns. Each history turn is
 * the WHOLE burst it answered (packages/agent turns.ts) — every line, not
 * only the row the reply landed on.
 */
export function toTurns(
  history: ReadonlyArray<{ customer: string; reply: string }>,
  current: string,
): ConverseTurn[] {
  const turns: ConverseTurn[] = [];
  for (const m of history) {
    const text = m.customer.trim();
    if (text) turns.push({ role: "user", text });
    const reply = m.reply.trim();
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

  // A tester's `/new` (reset.ts), before anything reads the thread: it closes
  // the tasks `refreshOffers` would otherwise refresh and that the draft
  // would otherwise name as still waiting for a colleague.
  const { testers } = await resetPass({ db, logger, now });

  // Code only, no model, so it runs with or without a credential: a customer
  // who changes their offer while a colleague is still looking moves the
  // figure on the task that colleague has open.
  await refreshOffers(db, logger, now());

  // No credential is no longer a dormant bot (2026-10-21): the rules answer
  // what they can and hand the rest to a person — see `chatbotSettings`.
  const client =
    deps.client ??
    (hasCredential(anthropic) ? anthropicClient(anthropic) : null);
  // One agent (owner, 2026-10-21): the single AI agent with a credential.
  // Without one the rules answer everything a rule can and hand the rest to a
  // person, so a missing key degrades the bot rather than silencing it.
  const earlySettings = chatbotSettings(client !== null);

  const at = now();
  const candidates = await quietCandidates(
    db,
    new Date(at.getTime() - waits.minMs),
    new Date(at.getTime() + skewMs),
    new Date(at.getTime() - (deps.staffActiveMs ?? STAFF_ACTIVE_MS)),
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
  const [
    knowledge,
    facts,
    persona,
    corrections,
    capabilities,
    settings,
    agentPersonas,
  ] = await Promise.all([
    loadKnowledgeBase(db),
    loadStoreFacts(db),
    db.persona.findFirst({
      where: { active: true },
      select: { prompt: true },
    }),
    db.agentCorrection.findMany({
      select: { original: true, corrected: true, note: true },
      orderBy: { createdAt: "desc" },
      take: MAX_CORRECTIONS,
    }),
    // The four switches on /chat (owner ask 2026-09-29), read each pass so a
    // switch pressed on the Chat page applies to the next message. The
    // environment's `AGENT_CAPABILITIES` answers for a switch never pressed.
    loadCapabilities(db, deps.capabilities ?? SHOP_CAPABILITIES),
    // Chatbot v2: which pipeline answers (Settings, v1 until the owner
    // switches), the lead threshold, and the three agents' personas.
    Promise.resolve(earlySettings),
    loadAgentPersonas(db),
  ]);
  const knowledgeText = knowledgeBlock(knowledge);
  const storeFacts = renderStoreFacts(facts);
  // The DP rule from Settings (2026-10-27): what a keep is told.
  const dp = facts.dp;
  const v2 = settings.pipeline === "v2";
  // The v1 voice is the Advisor's until somebody edits the Advisor.
  const v1Persona = persona?.prompt ?? DEFAULT_PERSONA;
  const advisorPersona = personaFor("ADVISOR", agentPersonas, v1Persona);

  let drafted = 0;
  let escalated = 0;

  // In parallel since chatbot v2 (2026-10-14: "around 50 customers a day,
  // 10–25 at once"). It used to be sequential, five threads a tick, which left
  // the twenty-fifth customer waiting minutes behind the other twenty-four.
  // Each thread is answered under its LEASE (lease.ts), so a thread is never
  // answered twice whether by two lanes here or by two worker processes; and
  // everything a turn reads is read by `from`, so two lanes never see each
  // other's customer. `concurrency` is the number of lanes, each of which
  // holds at most one database connection at a time.
  const holder = deps.leaseHolder ?? leaseHolder();
  const ledger = deps.superseded ?? processLedger;
  const failures = deps.failures ?? processFailures;
  const concurrency = Math.max(1, deps.concurrency ?? 1);
  const turnDeadlineMs = deps.turnDeadlineMs ?? TURN_DEADLINE_MS;

  /** The holding line and a task, logged — every "the bot gave up" path. */
  const giveUp = async (
    from: string,
    why: "failed" | "deadline",
    extra: Record<string, unknown>,
  ): Promise<void> => {
    try {
      const outcome = await holdTheLine(db, from, why, {
        now: now(),
        maxBatch,
      });
      if (outcome !== "nothing") escalated += 1;
      logger.warn(
        { evt: "worker.draft.gave_up", ctx: { from, why, outcome, ...extra } },
        "the bot could not answer — the customer got the holding line and a colleague a task",
      );
    } catch (err) {
      logger.error(
        {
          evt: "worker.draft.give_up_failed",
          ctx: { from, why },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "could not even send the holding line — the watchdog will try again",
      );
    }
  };

  const answer = async (candidate: Candidate): Promise<void> => {
    const from = candidate.from;
    let claimed = false;
    try {
      claimed = await claimThread(db, from, holder, now());
    } catch (err) {
      logger.error(
        {
          evt: "worker.lease.failed",
          ctx: { from },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "could not claim the thread — leaving it for the next pass",
      );
      return;
    }
    if (!claimed) {
      // Another lane or another worker is answering this customer right now.
      logger.info(
        { evt: "worker.lease.held", ctx: { from } },
        "the thread is being answered elsewhere — skipping it",
      );
      return;
    }
    try {
      // Thrown too often: stop trying, tell the customer someone is on it.
      const failed = failuresSoFar(failures, from, now());
      if (failed >= MAX_DRAFT_FAILURES) {
        failures.delete(from);
        await giveUp(from, "failed", { failures: failed });
        return;
      }
      // The turn's own deadline, as a backstop to the model's (guardClient):
      // a tool, a lookup or the database hanging must not hold this thread —
      // or, before 2026-10-27, the whole tick and every send behind it.
      const turn = { abandoned: false };
      const work = answerThread(candidate, turn);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = await Promise.race([
        // answerThread catches its own errors; one escaping anyway (a throw
        // inside a catch) must not reject the pool and stop the pass.
        work.then(
          () => false,
          (err: unknown) => {
            noteDrop(failures, from, now());
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
            return false;
          },
        ),
        new Promise<true>((resolve) => {
          timer = setTimeout(() => resolve(true), turnDeadlineMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (late) {
        // The turn may still finish: it checks this before committing, and
        // the compare-and-swap refuses it once the holding line has claimed
        // the rows.
        turn.abandoned = true;
        void work.catch(() => {});
        await giveUp(from, "deadline", { deadlineMs: turnDeadlineMs });
      }
    } finally {
      await releaseThread(db, from, holder).catch((err: unknown) =>
        logger.warn(
          {
            evt: "worker.lease.release_failed",
            ctx: { from },
            ...(err instanceof Error
              ? { err: { name: err.name, message: err.message } }
              : {}),
          },
          "could not release the thread — it frees itself when the lease expires",
        ),
      );
    }
  };

  const answerThread = async (
    candidate: Candidate,
    turn: { abandoned: boolean },
  ): Promise<void> => {
    const from = candidate.from;
    // Every model call of this turn: a per-call limit, bounded retries with
    // jitter, and nothing started past the turn's deadline — less a margin
    // for the rules fallback and the commit (2026-10-27).
    const turnStarted = Date.now();
    const turnClient = client
      ? guardClient(client, {
          timeoutMs: deps.callTimeoutMs ?? CALL_TIMEOUT_MS,
          retries: deps.callRetries ?? CALL_RETRIES,
          deadline: turnStarted + Math.max(5_000, turnDeadlineMs - 15_000),
          ...deps.callGuard,
          onRetry: (info) =>
            logger.warn(
              { evt: "worker.model.retry", ctx: { from, ...info } },
              "the model call failed — trying again",
            ),
        })
      : null;
    // Outside the try, so the race handler below can see what was booked.
    let outcome: ConverseResult | null = null;
    let anchorId: string | null = null;
    let covered = 0;
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
      if (batch.length === 0) return;
      // A `/new` that landed after this pass's reset ran. It is a command,
      // not a question: leave the thread for the next pass, which resets it
      // first, rather than hand the model "/new" to answer.
      if (testers.includes(from) && batch.some((m) => isResetCommand(m.text)))
        return;
      const batchIds = batch.map((m) => m.id);
      const anchor = batch[batch.length - 1]!;
      anchorId = anchor.id;
      covered = batchIds.length;
      // Every row BARU at the freeze, so the commit can tell a line that
      // arrived while drafting from one a full batch left for the next reply.
      const frozenIds =
        batch.length < maxBatch
          ? batchIds
          : [
              ...batchIds,
              ...(
                await db.waMessage.findMany({
                  where: {
                    from,
                    direction: "IN",
                    status: "BARU",
                    id: { notIn: batchIds },
                  },
                  select: { id: true },
                })
              ).map((m) => m.id),
            ];

      // Outside the window a free-form reply cannot be delivered (06 §11), so
      // drafting one would burn a model call to queue a send Graph will reject.
      if (!isWithinWindow(anchor.ts, at)) {
        await escalate(db, batchIds, anchor.id, "window_closed");
        escalated += 1;
        logger.warn(
          { evt: "worker.draft.window_closed", ctx: { from } },
          "the 24-hour window has closed — handing the thread to a person",
        );
        return;
      }

      const current = combineBatch(batch);
      if (!current) {
        // A sticker with no caption and no type worth naming. There is nothing
        // for the model to read, and guessing is what costs a sale.
        await escalate(db, batchIds, anchor.id, "nothing_to_read");
        escalated += 1;
        return;
      }

      // Since a `/new` or a staff *Clear chat*, the later of the two, when
      // this thread has had one: the turns before it are still in the
      // database and are not this conversation's.
      const resetAt = await resetPointFor(db, from);
      // Oldest first; each turn is every line of its burst with the reply.
      const history = await recentTurns(db, from, resetAt, HISTORY_TURNS);
      // Newest first, for "what did the bot just say".
      const newestFirst = [...history].reverse();

      const [
        memory,
        profile,
        openProposal,
        waiting,
        known,
        reminded,
        visitBooked,
        lastShown,
      ] = await Promise.all([
        db.waThreadMemory.findUnique({
          where: { from },
          select: { summary: true, coveredThroughAt: true, directive: true },
        }),
        // What the customer has told the shop, and a booking proposal still
        // open — so the single agent stops asking what the profile says
        // (2026-10-22: only v2 read either before).
        profileLine(db, from, resetAt),
        openProposalLine(db, from, at),
        // What is waiting for a colleague (2026-10-27): the bot answers the
        // newer messages and must neither answer nor contradict these.
        waitingTasks(db, from),
        profileKnown(db, from, resetAt),
        // A visit the worker reminded them of, not answered since (followUp.ts).
        remindedVisitFor(db, from),
        hasOpenVisit(db, from),
        // The units the bot's last reply showed: "bisa nego?" and "mau ambil
        // yang M2" are about those, and go to a person (routeMessage).
        lastShownUnits(db, from, resetAt),
      ]);

      // Turns older than the window, when the window is full: the few that
      // look related to what the customer just wrote (recall.ts). Bounded —
      // one embedding call with a deadline, keyword ranking on any failure —
      // and skipped outright while the window still holds the whole thread.
      const recall =
        history.length >= HISTORY_TURNS
          ? await recallEarlier(db, {
              from,
              before: history[0]!.answeredAt,
              after: resetAt,
              query: current,
              voyage: deps.recall?.voyage ?? null,
              ...(deps.recall?.timeoutMs !== undefined
                ? { timeoutMs: deps.recall.timeoutMs }
                : {}),
              onError: (err) =>
                logger.warn(
                  {
                    evt: "worker.recall.vector_failed",
                    ctx: { from },
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
                  "could not embed the message for recall — ranked by keywords instead",
                ),
            }).catch((err: unknown) => {
              logger.warn(
                {
                  evt: "worker.recall.failed",
                  ctx: { from },
                  ...(err instanceof Error
                    ? { err: { name: err.name, message: err.message } }
                    : {}),
                },
                "recall failed — answering without it",
              );
              return [];
            })
          : [];

      // Whether the bot's last reply already told the customer a colleague
      // will answer what is waiting, so a fixed hand-over line does not say
      // it again (2026-10-27).
      const alreadyTold =
        waiting.length > 0 && saidColleagueWillReply(newestFirst[0]?.reply);

      const prompt = buildAgentPrompt({
        // The one agent's persona is the one Settings edits (the Advisor's
        // seat); unedited it is the active persona, and a fresh database with
        // neither gets the compiled-in voice rather than an error.
        persona: advisorPersona,
        storeFacts,
        knowledge: knowledgeText,
        capabilities,
        // Newest first out of the database, oldest first into the prompt, so
        // the most recent correction is the last thing the model reads.
        corrections: [...corrections].reverse().map((c) => ({
          original: c.original,
          corrected: c.corrected,
          note: c.note ?? undefined,
        })),
        now: at,
        openNow: storeOpenAt(at),
        summary: summarySince(memory, resetAt),
        directive: memory?.directive ?? null,
        recentReplies: newestFirst.map((h) => h.reply).slice(0, 3),
        customerText: current,
        // v2 hands the profile and the proposal to its own agents.
        ...(v2 ? {} : { profile, openProposal }),
        recall: recall.map((r) => ({ text: r.text, at: r.at })),
        waiting,
      });

      // The two reads of the customer's message that do not ask the model:
      // whether it must go to a person whatever the model thinks (policy.ts),
      // and which of the owner's answers it most looks like (retrieval.ts).
      const route = routeMessage(current, {
        hasMedia: batch.some((m) => m.msgType !== "text"),
        capabilities,
        shown: lastShown.length > 0,
      });
      const hint = matchesNote(knowledge, matchesFor(knowledge, current));
      // "Keep it for me" with bookings on is a reservation REQUEST the bot
      // files and a person approves (2026-10-27), not a closing hand-over.
      // The rules bot reads the keep off `route` itself; the AI is told.
      const keepAsRequest =
        route?.rule === "keep" &&
        effectiveCapabilities(capabilities).reserve &&
        deps.agentStaffId !== undefined;
      const aiRoute = keepAsRequest ? null : route;
      const aiHint = keepAsRequest
        ? [hint, keepRequestNote(dp)].filter(Boolean).join("\n\n")
        : hint;
      // Only telling the bot about themselves, in answer to its own question
      // ("Buat nyatet aja sih", "Kuliah"): saved and answered, never handed
      // over (owner report 2026-10-27).
      const lastReply = newestFirst[0]?.reply ?? null;
      const selfAnswer = !route && answersOwnQuestion(current, at, lastReply);

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
          ? {
              reserve: {
                write: db,
                staffId: deps.agentStaffId,
                ...(deps.reservationGraceMs !== undefined
                  ? { graceMs: deps.reservationGraceMs }
                  : {}),
              },
            }
          : {}),
        // What the customer says about themselves (remember_customer).
        profile: { write: db },
      };

      let failure: unknown;
      const dispatch = deps.agentApi
        ? agentApiDispatch(
            deps.agentApi,
            (name, input, c) => dispatchTool(db, name, input, c),
            // The anchor row is unique to this batch: one turn, one id.
            { id: anchor.id, now: at },
          )
        : undefined;
      const turns = toTurns(history, current);
      // CHATBOT_MODEL, when the owner moved the bot without a release.
      const agentModel = anthropic.model;
      const v1Calls: CallUsage[] = [];
      let result: ConverseResult | PipelineResult | RulesResult | null = null;
      /**
       * The rules bot for this turn — with the AI as its fallback, or (when
       * the AI itself failed) without it: it needs no model, so a timed-out
       * or rate-limited call still leaves the customer an answer or, where
       * no rule fits, the holding line and a task (2026-10-27).
       */
      const rules = async (withAi: boolean): Promise<RulesResult> =>
        runRules({
          db,
          ctx,
          text: current,
          knowledge,
          capabilities,
          ...(dispatch ? { dispatch } : {}),
          route,
          known,
          watchOffer: await lastWatchOffer(db, from, resetAt),
          visitBooked,
          // Newest first out of the database: the bot's previous reply.
          lastReply: newestFirst[0]?.reply ?? null,
          proposalOpen: openProposal !== null,
          lastShown,
          waiting,
          leadThreshold: settings.leadThreshold,
          dp,
          ...(withAi && turnClient
            ? {
                ai: async () => {
                  const calls: CallUsage[] = [];
                  const r = await converse({
                    client: turnClient,
                    ...(agentModel ? { model: agentModel } : {}),
                    db,
                    ctx,
                    prompt,
                    turns,
                    knowledge,
                    storeFacts,
                    dp,
                    route: null,
                    hint,
                    capabilities,
                    alreadyTold,
                    selfAnswer,
                    lastReply,
                    onError: (err) => {
                      failure = err;
                    },
                    onCall: (u) => calls.push(u),
                    ...(dispatch ? { dispatch } : {}),
                  });
                  return { result: r, calls };
                },
              }
            : {}),
        });
      /** Set when the AI failed and the rules answered in its place. */
      let fellBack = false;
      // The customer's answer to a visit reminder is read by code first,
      // whichever bot answers (2026-10-27): yes keeps it, no closes it, a new
      // time moves it. Anything else falls through to the ordinary turn.
      if (reminded && !route)
        result = await visitReplyTurn({
          db,
          ctx,
          text: current,
          capabilities,
          ...(dispatch ? { dispatch } : {}),
          reminded,
          name: known.name,
        });
      if (result) {
        // Answered above.
      } else if (settings.pipeline === "rules") {
        // Rules and templates first; the single agent only for what no rule
        // answers, and only when there is a credential (rules/run.ts).
        result = await rules(true);
      } else if (v2) {
        // Chatbot v2: Router → Operations → Sales Advisor (pipeline.ts).
        result = await runPipeline({
          client: turnClient!,
          db,
          ctx,
          prompt,
          turns,
          knowledge,
          storeFacts,
          route,
          ...(hint ? { hint } : {}),
          capabilities,
          ...(dispatch ? { dispatch } : {}),
          personas: {
            router: personaFor("ROUTER", agentPersonas, v1Persona),
            operations: personaFor("OPERATIONS", agentPersonas, v1Persona),
          },
          summary: summarySince(memory, resetAt),
          profile,
          openProposal,
          leadThreshold: settings.leadThreshold,
          onError: (err) => {
            failure = err;
          },
        });
      } else {
        result = await converse({
          client: turnClient!,
          ...(agentModel ? { model: agentModel } : {}),
          db,
          ctx,
          prompt,
          turns,
          knowledge,
          storeFacts,
          dp,
          route: aiRoute,
          hint: aiHint,
          capabilities,
          alreadyTold,
          selfAnswer,
          lastReply,
          onError: (err) => {
            failure = err;
          },
          onCall: (u) => v1Calls.push(u),
          ...(dispatch ? { dispatch } : {}),
        });
      }

      if (!result && settings.pipeline !== "rules") {
        // The AI failed — a timeout, a 429 past its retries, an expired
        // token. Never silent (2026-10-27): the rules answer this turn
        // without it, and where no rule fits they hand over with the holding
        // line, so the customer always hears back.
        logger.warn(
          {
            evt: "worker.draft.ai_failed",
            ctx: { from, reason: modelErrorReason(failure), fallback: "rules" },
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
          "the model could not answer — the rules answer this turn instead",
        );
        result = await rules(false).catch((err: unknown) => {
          failure = err;
          return null;
        });
        fellBack = result !== null;
      }

      outcome = result;
      if (turn.abandoned) return;
      if (!result) {
        // Not even the rules: the holding line and a task, and the reason in
        // the log where somebody can find out that the token expired.
        logger.warn(
          {
            evt: "worker.draft.no_reply",
            ctx: { from, reason: modelErrorReason(failure) },
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
          "the agent produced no reply — the holding line goes out and the thread to a person",
        );
        await escalate(
          db,
          batchIds,
          anchor.id,
          "no_reply",
          holdingMessage("other", storeOpenAt(now())),
        );
        escalated += 1;
        failures.delete(from);
        return;
      }

      // The bot's lead score. The rules and the three agents score as they
      // answer; the single agent does not, so its turn is scored the way the
      // rules score one — from what the customer said, by code, no model
      // (owner, 2026-10-21: the bot decides the lead, nobody else).
      const leadScore =
        "verdict" in result
          ? result.verdict.leadScore
          : leadScoreOf(
              understand(current, at, { proposalOpen: false, lastShown: [] }),
            );

      // One transaction: the answer and the intent to send it commit together,
      // or neither does (08 §5). No HTTP call happens inside it.
      const answeredAt = now();
      const status = result.handoff ? "PERLU_STAF" : "DIJAWAB_AGEN";
      // May this draft still be dropped for a newer line? Not a third time
      // in a row, not once the burst's first line has waited a minute, and
      // not when the reply announces a booking already written.
      const drops = dropsSoFar(ledger, from, answeredAt);
      const announces =
        (result.bookings?.length ?? 0) > 0 ||
        result.toolsUsed.some((t) => ANNOUNCED_WRITES.has(t));
      const keepAnyway: "drops" | "age" | "booking" | null =
        drops >= MAX_SUPERSEDES
          ? "drops"
          : answeredAt.getTime() - batch[0]!.ts.getTime() >=
              SUPERSEDE_MAX_AGE_MS
            ? "age"
            : announces
              ? "booking"
              : null;
      let arrivedMeanwhile = 0;
      // Past the deadline the holding line has gone out instead; the claim
      // below would fail anyway, this saves the transaction.
      if (turn.abandoned) return;
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
                      // The line the BOT sent with it, so /chat labels it Bot
                      // even after a colleague closes the row (2026-10-27).
                      reply: result.reply,
                    },
                  },
                }
              : {
                  entities: {
                    sources: result.sources,
                    // What this reply showed, for the next message's "yang
                    // kedua" (rules/run.ts, v2context `lastShownUnits`).
                    ...("shown" in result &&
                    result.shown &&
                    result.shown.length > 0
                      ? { units: [...result.shown] }
                      : {}),
                    // "Mau saya kabari kalau sudah ready?" — what the
                    // customer's yes will watch for (v2context
                    // `lastWatchOffer`).
                    ...("watch" in result && result.watch
                      ? { watch: { ...result.watch } }
                      : {}),
                  },
                }),
          },
        });
        await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: { to: from, body: result.reply, inReplyTo: anchor.id },
        });
        // The task the hand-over leaves, in the same transaction as the
        // hand-over itself, so the inbox never shows one without the other.
        if (result.handoff) {
          await upsertChatAction(tx, {
            from,
            topic: result.handoff.topic,
            summary: result.handoff.summary,
            customerText: current,
            ...(result.handoff.serial ? { serial: result.handoff.serial } : {}),
            messageId: anchor.id,
            now: answeredAt,
          });
        }
        // A job for a colleague that is not a hand-over — the bot answered,
        // and somebody still has to be at the door ("Perlu sambut").
        if ("task" in result && result.task) {
          await upsertChatAction(tx, {
            from,
            topic: result.task.topic,
            kind: result.task.kind,
            summary: result.task.summary,
            customerText: current,
            messageId: anchor.id,
            now: answeredAt,
          });
        }
        /*
         * The photographs the answer offered, one row each, queued AFTER the
         * reply (owner ask 2026-09-21). Order matters and is cheap to get
         * right: the outbox is drained in insertion order, so the words arrive
         * first and the pictures follow, which is how a person would send them.
         *
         * Still inside the one transaction. A reply that promised photos and a
         * queue that never got them is the split this boundary exists to
         * prevent.
         */
        for (const photoId of result.photos ?? []) {
          await enqueueOutbox(tx, {
            kind: "WA_IMAGE",
            payload: { to: from, photoId, inReplyTo: anchor.id },
          });
        }
        // The turn's trace (Evaluation and Settings read it), and the bot's
        // half of the 🔥 lead — in the transaction that commits the reply,
        // so a reply never exists without the record of how it was made.
        await recordRun(tx, {
          from,
          messageId: anchor.id,
          pipeline: fellBack ? "rules" : settings.pipeline,
          result,
          v1Calls,
          leadScore,
          latencyMs: Date.now() - turnStarted,
          at: answeredAt,
        });
        const mem = await tx.waThreadMemory.findUnique({
          where: { from },
          select: { leadAt: true, leadStaffAt: true, leadClearedAt: true },
        });
        await tx.waThreadMemory.updateMany({
          where: { from },
          data: {
            leadScore,
            // A lead marked before a /new or a Clear chat belongs to the
            // conversation left behind (2026-10-27): mark it again.
            ...(leadScore >= settings.leadThreshold && !isLead(mem, resetAt)
              ? { leadAt: answeredAt }
              : {}),
          },
        });
        // LAST, so the only moment a line can slip past it is the COMMIT
        // (header, "Why a draft is dropped"). A rollback here leaves every
        // row BARU and queues nothing.
        arrivedMeanwhile = await tx.waMessage.count({
          where: {
            from,
            direction: "IN",
            status: "BARU",
            id: { notIn: frozenIds },
          },
        });
        if (arrivedMeanwhile > 0 && keepAnyway === null) {
          throw new SupersededError(from, arrivedMeanwhile);
        }
      }, TXN_TIMEOUTS);

      ledger.delete(from);
      failures.delete(from);
      if (arrivedMeanwhile > 0) {
        logger.info(
          {
            evt: "worker.draft.superseded_kept",
            ctx: {
              from,
              covered: batchIds.length,
              arrived: arrivedMeanwhile,
              drops,
              why: keepAnyway,
            },
          },
          "a newer line arrived while drafting, but this reply is sent anyway — the next tick answers it",
        );
      }

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
      if (err instanceof SupersededError) {
        // The customer kept typing. Nothing was written; the next pass
        // answers the whole burst once it has settled.
        const count = noteDrop(ledger, from, now());
        logger.info(
          {
            evt: "worker.draft.superseded",
            ctx: {
              from,
              covered,
              arrived: err.arrived,
              drops: count,
            },
          },
          "the customer wrote again while the reply was being drafted — dropping it to answer the whole burst at once",
        );
        return;
      }
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
        // The draft is dropped, but a booking made while drafting is not: it
        // was its own transaction. Nobody will tell the customer unless a
        // person is told to (audit 2026-09-29).
        const booked = outcome?.bookings ?? [];
        if (booked.length > 0 && anchorId) {
          // A request has no code to give: it is "noted", not booked.
          const codes = booked
            .map((b) =>
              b.tool === "propose_reservation"
                ? "permintaan reservasi"
                : b.code,
            )
            .join(", ");
          await db
            .$transaction((tx) =>
              upsertChatAction(tx, {
                from,
                topic: "reservation",
                // Staff replied first, so the customer never heard the code.
                summary: taskNote(
                  "tellBooking",
                  `${codes}, ${TASK_REASON.notTold}`,
                ),
                customerText: "",
                messageId: anchorId!,
                now: now(),
              }),
            )
            .catch((e: unknown) =>
              logger.error(
                {
                  evt: "worker.action.failed",
                  ctx: { from },
                  ...(e instanceof Error
                    ? { err: { name: e.name, message: e.message } }
                    : {}),
                },
                "could not record the unannounced booking",
              ),
            );
        }
        return;
      }
      // One bad thread must not stop the pass. The rows stay BARU and the next
      // tick tries again — `MAX_DRAFT_FAILURES` times, then the holding line.
      const count = turn.abandoned ? 0 : noteDrop(failures, from, now());
      logger.error(
        {
          evt: "worker.draft.failed",
          ctx: { from, failures: count },
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "failed to draft a reply for a thread",
      );
    }
  };

  await inPool(due, concurrency, answer);

  return { drafted, escalated, dormant: false };
}

/**
 * The questions this thread handed to a person that nobody has dealt with
 * yet — its OPEN `ChatAction`s, one per kind, oldest first. A staff reply,
 * Mark handled and Clear chat each close them (apps/api routes/inbox.ts), so
 * an open one is exactly a question still waiting on a colleague.
 */
async function waitingTasks(
  db: PrismaClient,
  from: string,
): Promise<WaitingTask[]> {
  const rows = await db.chatAction.findMany({
    where: { from, status: "OPEN" },
    orderBy: { createdAt: "asc" },
    select: { topic: true, customerText: true },
    take: 6,
  });
  return rows.flatMap((r) =>
    isHandoffTopic(r.topic)
      ? [{ topic: r.topic, text: r.customerText?.trim() || null }]
      : [],
  );
}

/**
 * The visit the worker reminded this customer of (followUp.ts), when nothing
 * of theirs has been answered since the reminder — so their next words are
 * read as the answer to it. Null otherwise, and for a visit no longer open.
 */
async function remindedVisitFor(
  db: PrismaClient,
  from: string,
): Promise<RemindedVisit | null> {
  const sent = await db.outbox.findFirst({
    where: {
      kind: "WA_REPLY",
      AND: [
        { payload: { path: ["to"], equals: from } },
        { payload: { path: ["followUp"], equals: "visit_reminder" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, payload: true },
  });
  if (!sent) return null;
  const reservationId = (sent.payload as { reservationId?: unknown })
    .reservationId;
  if (typeof reservationId !== "string") return null;
  const answered = await db.waMessage.findFirst({
    where: { from, direction: "IN", answeredAt: { gt: sent.createdAt } },
    select: { id: true },
  });
  if (answered) return null;
  const visit = await db.reservation.findUnique({
    where: { id: reservationId },
    select: {
      code: true,
      status: true,
      scheduledFor: true,
      custName: true,
      proposal: {
        select: {
          items: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              unit: {
                select: { sku: { select: { name: true, variantLabel: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!visit || visit.status !== "TERJADWAL" || !visit.scheduledFor)
    return null;
  const sku = visit.proposal?.items[0]?.unit.sku;
  return {
    code: visit.code,
    scheduledFor: visit.scheduledFor,
    unit: sku ? [sku.name, sku.variantLabel].filter(Boolean).join(" ") : null,
    // A visit booked with no name carries the phone; that is not a name.
    custName:
      visit.custName && !visit.custName.startsWith("+") ? visit.custName : null,
  };
}

/** Whether this customer already has a visit (or an older booking) open. */
async function hasOpenVisit(db: PrismaClient, from: string): Promise<boolean> {
  const open = await db.reservation.findFirst({
    where: { phone: { in: phoneForms(from) }, status: "TERJADWAL" },
    select: { id: true },
  });
  return open !== null;
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
 * One `AgentRun` and its steps for a committed turn (chatbot v2). A v1 turn
 * is one agent, the Advisor's seat, one step per model call.
 */
async function recordRun(
  tx: Prisma.TransactionClient,
  r: {
    from: string;
    messageId: string;
    pipeline: "rules" | "v1" | "v2";
    result: ConverseResult | PipelineResult;
    v1Calls: readonly CallUsage[];
    /** The turn's lead score, however it was reached. */
    leadScore: number;
    latencyMs: number;
    at: Date;
  },
): Promise<void> {
  const v2 = "verdict" in r.result ? r.result : null;
  const steps: AgentStep[] = v2
    ? [...v2.trace]
    : r.v1Calls.map((u) => ({
        agent: "ADVISOR" as const,
        model: u.model,
        tool: null,
        ok: true,
        ms: u.ms,
        inputTokens: u.inputTokens + u.cachedTokens + u.cacheWriteTokens,
        cachedTokens: u.cachedTokens,
        outputTokens: u.outputTokens,
      }));
  const sum = (k: "inputTokens" | "cachedTokens" | "outputTokens") =>
    steps.reduce((n, s) => n + s[k], 0);
  const cost = v2
    ? v2.costMicros
    : r.v1Calls.reduce((n, u) => n + costMicros(u), 0);
  await tx.agentRun.create({
    data: {
      from: r.from,
      messageId: r.messageId,
      pipeline: r.pipeline,
      ...(v2
        ? {
            language: v2.verdict.language,
            tone: v2.verdict.tone,
            intent: v2.verdict.intent,
            escalateTopic: v2.verdict.escalate,
          }
        : {}),
      leadScore: r.leadScore,
      outcome: r.result.handoff ? "HANDOFF" : "REPLIED",
      inputTokens: sum("inputTokens"),
      cachedTokens: sum("cachedTokens"),
      outputTokens: sum("outputTokens"),
      costMicros: BigInt(cost),
      latencyMs: v2 ? v2.latencyMs : r.latencyMs,
      createdAt: r.at,
      steps: {
        create: steps.map((s, i) => ({
          sortOrder: i,
          agent: s.agent,
          model: s.model,
          tool: s.tool,
          ok: s.ok,
          ms: s.ms,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
        })),
      },
    },
  });
}

/**
 * Hand a batch to a human, without a reply.
 *
 * Scoped to the frozen ids, exactly like the claim: escalating on the model's
 * failure happens AFTER a network call, so the unbounded predicate would sweep
 * in a message that arrived meanwhile and hide it from everyone.
 *
 * PERLU_STAF is terminal for the agent — this pass only selects BARU rows —
 * so an escalated batch is not retried in a loop; the customer's newer
 * messages are answered as usual (2026-10-27). It shows in the inbox as waiting,
 * with the reason on the newest row so the colleague knows why.
 */
async function escalate(
  db: PrismaClient,
  batchIds: string[],
  anchorId: string,
  why:
    | "window_closed"
    | "nothing_to_read"
    | "no_reply"
    | "failed"
    | "deadline"
    | "stale",
  /**
   * The holding line, when the customer must hear back (2026-10-27: a
   * failed turn used to hand over in silence). Queued in this transaction.
   */
  reply?: string,
): Promise<number> {
  // One short action item (owner, 2026-10-27), like every hand-over's.
  const summary =
    why === "window_closed"
      ? taskNote("template", TASK_REASON.windowClosed)
      : why === "nothing_to_read"
        ? taskNote("reply", TASK_REASON.noText)
        : taskNote("reply", TASK_REASON.botFailed);
  const at = new Date();
  return db.$transaction(async (tx) => {
    const { count } = await tx.waMessage.updateMany({
      where: { id: { in: batchIds }, status: "BARU" },
      data: {
        status: "PERLU_STAF",
        intent: "staf:other",
        ...(reply ? { answeredByAgent: false, answeredAt: at } : {}),
      },
    });
    if (count > 0 && reply) {
      const anchor = await tx.waMessage.findUnique({
        where: { id: anchorId },
        select: { from: true },
      });
      await tx.waMessage.update({
        where: { id: anchorId },
        data: { replyText: reply },
      });
      await enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: anchor!.from, body: reply, inReplyTo: anchorId },
      });
    }
    if (count > 0) {
      const rows = await tx.waMessage.findMany({
        where: { id: { in: batchIds } },
        orderBy: [{ ts: "asc" }, { id: "asc" }],
        select: { from: true, text: true },
      });
      await upsertChatAction(tx, {
        from: rows[0]!.from,
        topic: "other",
        summary,
        customerText: rows
          .map((r) => r.text ?? "")
          .filter(Boolean)
          .join("\n"),
        messageId: anchorId,
        now: new Date(),
      });
    }
    await tx.waMessage.updateMany({
      where: { id: anchorId, status: "PERLU_STAF" },
      data: {
        entities: {
          handoff: {
            topic: "other",
            summary,
            forcedBy: why,
            at: at.toISOString(),
            // The line the BOT sent, so /chat labels it Bot even after a
            // colleague closes the row.
            ...(reply ? { reply } : {}),
          },
        },
      },
    });
    return count;
  }, TXN_TIMEOUTS);
}

/**
 * The holding line and a task for whatever of this thread is still waiting —
 * what every "the bot could not answer" path ends in (2026-10-27): a turn
 * that kept throwing, one past its deadline, and a message the watchdog
 * (stale.ts) found left behind. The customer hears "Bentar ya kak, aku cek
 * dulu 🙏"; a colleague gets the thread outlined and a task.
 *
 * Reads the waiting rows itself, so it needs nothing the turn had built, and
 * claims them by the same compare-and-swap a reply does: a turn still running
 * in the background can no longer commit over it. Outside the 24-hour window
 * nothing can be sent, and the thread is handed over silently, as before.
 */
export async function holdTheLine(
  db: PrismaClient,
  from: string,
  why: "failed" | "deadline" | "stale",
  opts: { now: Date; maxBatch?: number },
): Promise<"sent" | "window_closed" | "nothing"> {
  const batch = await db.waMessage.findMany({
    where: { from, direction: "IN", status: "BARU" },
    orderBy: [{ ts: "asc" }, { id: "asc" }],
    take: opts.maxBatch ?? DEFAULT_MAX_BATCH,
    select: { id: true, ts: true },
  });
  if (batch.length === 0) return "nothing";
  const ids = batch.map((m) => m.id);
  const anchor = batch[batch.length - 1]!;
  if (!isWithinWindow(anchor.ts, opts.now)) {
    await escalate(db, ids, anchor.id, "window_closed");
    return "window_closed";
  }
  const claimed = await escalate(
    db,
    ids,
    anchor.id,
    why,
    holdingMessage("other", storeOpenAt(opts.now)),
  );
  return claimed > 0 ? "sent" : "nothing";
}
