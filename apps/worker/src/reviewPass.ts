/**
 * The chatbot audit's nightly review (2026-11-18,
 * docs/superpowers/specs/2026-11-18-chatbot-audit-design.md).
 *
 * Between 01:00 and 05:00 WIB, a few chats a tick, an AI reviewer (the
 * model picked on /audit — Sonnet 5.5 unless somebody chose another,
 * reviewModel.ts — on the shop's own token) reads every WhatsApp chat with bot replies it
 * has not read yet and writes what it flags. Nothing it does reaches a
 * customer: it only reads the chat tables and writes the three
 * `ChatReview*` tables, as nusantara_agent.
 *
 * The live bot comes first. A tick is sequential, so the pass reads at most
 * `maxChats` chats per tick and never starts while a customer line is
 * waiting or a thread is under lease; ten minutes of that and it gives up
 * for the night. A 429 or an overload stops the night; a token that cannot
 * use the model fails it, and no other model is tried behind anybody's
 * back: a weaker reviewer is a choice a person makes on /audit, where the
 * model the run used is shown beside its flags.
 *
 * Network is never inside a transaction: the model call comes first, and
 * the chat's thread row, its flags and the run's totals are one write after.
 */

import {
  REVIEW_MAX_TOKENS,
  REVIEW_SCHEMA,
  anthropicClient,
  buildReviewPrompt,
  costMicros,
  guardClient,
  hasCredential,
  loadReviewModel,
  loadTesters,
  pendingReviewRequest,
  modelErrorReason,
  readReview,
  reviewEffort,
  usageOf,
  type AgentClient,
  type AnthropicEnv,
  type ReviewLine,
  type ReviewUnit,
} from "@nusantara/agent";
import { formatRupiah } from "@nusantara/domain";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

/** The window, in Jakarta hours: [start, end). */
export const REVIEW_WINDOW = { startHour: 1, endHour: 5 } as const;
/** How far back a thread never reviewed is read. */
export const REVIEW_BACKFILL_DAYS = 30;
/** At most this many chats a night. */
export const REVIEW_NIGHTLY_CAP = 300;
/** Chats per tick, so a tick never holds a customer's reply for long. */
export const REVIEW_PER_TICK = 2;
/** Customers waiting this long in a row ends the night. */
export const REVIEW_BUSY_GIVE_UP_MS = 10 * 60_000;
/** A window longer than this many answered lines is read in parts. */
export const REVIEW_MAX_LINES = 200;
/** One review call's limit — a long chat thinks for a while. */
export const REVIEW_CALL_TIMEOUT_MS = 120_000;

export interface ReviewDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly anthropic: AnthropicEnv;
  /** A scripted client in tests; the shop's token otherwise. */
  readonly client?: AgentClient | null;
  readonly now?: () => Date;
  /** The CLI's run: any hour, and a fresh run if tonight's has ended. */
  readonly ignoreWindow?: boolean;
  readonly backfillDays?: number;
  readonly maxChats?: number;
  readonly nightlyCap?: number;
  readonly busyGiveUpMs?: number;
}

export type ReviewPassStatus =
  "outside" | "ended" | "busy" | "working" | "done" | "stopped" | "failed";

export interface ReviewPassResult {
  readonly status: ReviewPassStatus;
  readonly reviewed: number;
  readonly flags: number;
  readonly runId?: string;
}

/** The hour of the day in Jakarta (UTC+7, no daylight saving). */
const jakartaHour = (d: Date) => (d.getUTCHours() + 7) % 24;

/** 01:00 WIB of the Jakarta day `d` falls on. */
function nightStart(d: Date): Date {
  const local = new Date(d.getTime() + 7 * 3_600_000);
  const day = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(day + (REVIEW_WINDOW.startHour - 7) * 3_600_000);
}

export function inReviewWindow(d: Date): boolean {
  const h = jakartaHour(d);
  return h >= REVIEW_WINDOW.startHour && h < REVIEW_WINDOW.endHour;
}

/** When the pass first found the bot busy, per run (this process only). */
const busySince = new Map<string, number>();

/** The guarded client, built once per credential. */
const clients = new WeakMap<AnthropicEnv, AgentClient | null>();
function clientFor(env: AnthropicEnv): AgentClient | null {
  if (!clients.has(env)) {
    const base = hasCredential(env) ? anthropicClient(env) : null;
    clients.set(
      env,
      base
        ? guardClient(base, { timeoutMs: REVIEW_CALL_TIMEOUT_MS, retries: 1 })
        : null,
    );
  }
  return clients.get(env) ?? null;
}

const statusOf = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
};

/** What a refused call means for the night: fail it, or stop it. */
function verdictOf(
  err: unknown,
  firstCall: boolean,
  model: string,
): { status: "FAILED" | "STOPPED"; reason: string } {
  const code = statusOf(err);
  const why = modelErrorReason(err);
  if (code === 401 || code === 403 || code === 404)
    return {
      status: "FAILED",
      reason: `The Anthropic token was refused for ${model} (${code}). Pick another reviewer model on the audit page.`,
    };
  if (code === 429 && firstCall)
    return {
      status: "FAILED",
      reason: `The Anthropic token was refused for ${model} on its first call (429) — it may not be allowed this model, or its limit is used up. Pick another reviewer model on the audit page.`,
    };
  if (code === 429)
    return {
      status: "STOPPED",
      reason:
        "Anthropic's rate limit was reached (429); the rest waits for the next night.",
    };
  return {
    status: "STOPPED",
    reason: `The reviewer could not reach the model (${why}); the rest waits for the next night.`,
  };
}

async function finish(
  db: PrismaClient,
  runId: string,
  status: "DONE" | "STOPPED" | "FAILED",
  at: Date,
  reason: string | null,
) {
  await db.chatReviewRun.update({
    where: { id: runId },
    data: { status, finishedAt: at, reason },
  });
  busySince.delete(runId);
}

/** Threads with bot replies the reviewer has not read, oldest first. */
async function candidates(
  db: PrismaClient,
  since: Date,
  until: Date,
): Promise<Array<{ from: string; cursor: Date | null }>> {
  const answered = await db.waMessage.groupBy({
    by: ["from"],
    where: {
      direction: "IN",
      answeredByAgent: true,
      answeredAt: { gte: since, lte: until },
      NOT: { from: { startsWith: "ig:" } },
    },
    _max: { answeredAt: true },
  });
  if (answered.length === 0) return [];
  const reviewed = await db.chatReviewThread.groupBy({
    by: ["from"],
    where: { from: { in: answered.map((a) => a.from) } },
    _max: { reviewedTo: true },
  });
  const cursor = new Map(reviewed.map((r) => [r.from, r._max.reviewedTo]));
  return answered
    .filter((a) => {
      const c = cursor.get(a.from);
      return a._max.answeredAt && (!c || a._max.answeredAt > c);
    })
    .sort(
      (a, b) =>
        (a._max.answeredAt?.getTime() ?? 0) -
        (b._max.answeredAt?.getTime() ?? 0),
    )
    .map((a) => ({ from: a.from, cursor: cursor.get(a.from) ?? null }));
}

const BATTERY_KEYS = ["baterai", "siklus", "kapasitas"];

/** The units the window's bot replies named, as their records read now. */
async function unitsNamed(
  db: PrismaClient,
  serials: readonly string[],
): Promise<ReviewUnit[]> {
  if (serials.length === 0) return [];
  const rows = await db.unit.findMany({
    where: { serial: { in: [...new Set(serials)] } },
    select: {
      serial: true,
      grade: true,
      price: true,
      status: true,
      description: true,
      sku: { select: { name: true, variantLabel: true } },
      attributes: {
        where: { attribute: { key: { in: BATTERY_KEYS } } },
        select: { value: true, attribute: { select: { key: true } } },
      },
    },
  });
  return rows.map((u) => {
    const attr = (k: string) =>
      u.attributes.find((a) => a.attribute.key === k)?.value;
    const battery = attr("baterai")
      ? `${attr("baterai")}%`
      : attr("siklus")
        ? `${attr("siklus")} cycles`
        : null;
    return {
      serial: u.serial,
      label: [u.sku.name, u.sku.variantLabel].filter(Boolean).join(" "),
      grade: u.grade,
      price: u.price !== null && u.price > 0n ? formatRupiah(u.price) : null,
      status: u.status,
      battery,
      condition: u.description,
    };
  });
}

const serialsOf = (entities: unknown): string[] => {
  const units = (entities as { units?: unknown } | null)?.units;
  return Array.isArray(units)
    ? units.filter((s): s is string => typeof s === "string")
    : [];
};

export async function reviewPass(deps: ReviewDeps): Promise<ReviewPassResult> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const at = now();
  const idle = (
    status: ReviewPassStatus,
    runId?: string,
  ): ReviewPassResult => ({
    status,
    reviewed: 0,
    flags: 0,
    ...(runId ? { runId } : {}),
  });

  if (!deps.ignoreWindow && !inReviewWindow(at)) return idle("outside");

  // Tonight's run: carried on while RUNNING; once ended, nothing more tonight
  // (the CLI may start another).
  const since = deps.ignoreWindow
    ? new Date(at.getTime() - 12 * 3_600_000)
    : nightStart(at);
  let run = await db.chatReviewRun.findFirst({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
  });
  if (run && run.status !== "RUNNING") {
    if (!deps.ignoreWindow) return idle("ended", run.id);
    run = null;
  }
  const client =
    deps.client === undefined ? clientFor(deps.anthropic) : deps.client;
  // A run keeps the model it started with; a new one takes the choice made
  // on /audit (reviewModel.ts), Sonnet 5.5 when nobody chose.
  const model = run ? run.model : await loadReviewModel(db);
  if (!run) {
    run = await db.chatReviewRun.create({
      data: {
        startedAt: at,
        model,
        status: client ? "RUNNING" : "FAILED",
        ...(client
          ? {}
          : {
              finishedAt: at,
              reason: "The worker has no Anthropic credential.",
            }),
      },
    });
    logger.info(
      { evt: "worker.review.run_started", ctx: { runId: run.id } },
      "the chatbot review started",
    );
    if (!client) return idle("failed", run.id);
  }
  if (!client) {
    await finish(
      db,
      run.id,
      "FAILED",
      at,
      "The worker has no Anthropic credential.",
    );
    return idle("failed", run.id);
  }

  // The live bot first: a customer waiting, or a thread being answered.
  const [waiting, leased] = await Promise.all([
    db.waMessage.count({ where: { direction: "IN", status: "BARU" } }),
    db.waThreadMemory.count({ where: { leaseUntil: { gt: at } } }),
  ]);
  if (waiting > 0 || leased > 0) {
    const first = busySince.get(run.id) ?? at.getTime();
    busySince.set(run.id, first);
    if (at.getTime() - first >= (deps.busyGiveUpMs ?? REVIEW_BUSY_GIVE_UP_MS)) {
      await finish(
        db,
        run.id,
        "STOPPED",
        at,
        "Customers kept the bot busy for ten minutes; the rest waits for the next night.",
      );
      logger.info(
        {
          evt: "worker.review.stopped",
          ctx: { runId: run.id, reason: "busy" },
        },
        "the chatbot review gave way to customers for the night",
      );
      return idle("stopped", run.id);
    }
    return idle("busy", run.id);
  }
  busySince.delete(run.id);

  const cap = deps.nightlyCap ?? REVIEW_NIGHTLY_CAP;
  if (run.chats >= cap) {
    await finish(
      db,
      run.id,
      "DONE",
      at,
      `Reached the nightly limit of ${cap} chats.`,
    );
    return idle("done", run.id);
  }

  const backfill = new Date(
    at.getTime() - (deps.backfillDays ?? REVIEW_BACKFILL_DAYS) * 86_400_000,
  );
  const todo = await candidates(db, backfill, at);
  if (todo.length === 0) {
    await finish(db, run.id, "DONE", at, null);
    logger.info(
      {
        evt: "worker.review.done",
        ctx: { runId: run.id, chats: run.chats, flags: run.flags },
      },
      "the chatbot review finished",
    );
    return idle("done", run.id);
  }

  const testers = new Set(await loadTesters(db).catch(() => [] as string[]));
  const perTick = Math.min(deps.maxChats ?? REVIEW_PER_TICK, cap - run.chats);
  let reviewed = 0;
  let flagged = 0;
  let firstCall = run.chats === 0;

  for (const { from, cursor } of todo.slice(0, perTick)) {
    const lower = cursor && cursor > backfill ? cursor : backfill;
    const rows = await db.waMessage.findMany({
      where: {
        from,
        direction: "IN",
        answeredAt: cursor ? { gt: lower, lte: at } : { gte: lower, lte: at },
      },
      orderBy: [{ answeredAt: "asc" }, { ts: "asc" }, { id: "asc" }],
      take: REVIEW_MAX_LINES,
      select: {
        id: true,
        text: true,
        msgType: true,
        ts: true,
        replyText: true,
        answeredAt: true,
        answeredByAgent: true,
        entities: true,
      },
    });
    if (rows.length === 0) continue;
    const reviewedFrom = rows[0]!.answeredAt!;
    const reviewedTo = rows[rows.length - 1]!.answeredAt!;

    const lines: ReviewLine[] = [];
    const serials: string[] = [];
    for (const r of rows) {
      lines.push({
        messageId: r.id,
        at: r.ts,
        who: "customer",
        text: r.text?.trim() || `[${r.msgType}]`,
      });
      if (r.replyText?.trim()) {
        lines.push({
          messageId: r.id,
          at: r.answeredAt ?? r.ts,
          who: r.answeredByAgent ? "bot" : "staff",
          text: r.replyText,
        });
        if (r.answeredByAgent) serials.push(...serialsOf(r.entities));
      }
    }
    const memory = cursor
      ? await db.waThreadMemory.findUnique({
          where: { from },
          select: { summary: true },
        })
      : null;
    const prompt = buildReviewPrompt({
      lines,
      units: await unitsNamed(db, serials),
      earlier: memory?.summary?.slice(0, 1_200) ?? null,
      tester: testers.has(from),
    });

    const t0 = Date.now();
    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: REVIEW_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: prompt.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt.user }],
        output_config: {
          ...reviewEffort(model),
          format: {
            type: "json_schema",
            schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      });
    } catch (err) {
      const v = verdictOf(err, firstCall, model);
      await finish(db, run.id, v.status, now(), v.reason);
      logger.warn(
        {
          evt:
            v.status === "FAILED"
              ? "worker.review.failed"
              : "worker.review.stopped",
          ctx: { runId: run.id, reason: modelErrorReason(err) },
        },
        v.reason,
      );
      return {
        status: v.status === "FAILED" ? "failed" : "stopped",
        reviewed,
        flags: flagged,
        runId: run.id,
      };
    }
    firstCall = false;
    const usage = usageOf(model, Date.now() - t0, response.usage);
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const refused =
      (response as { stop_reason?: string }).stop_reason === "refusal";
    const parsed = refused ? null : readReview(text, prompt.handles);
    const flags = parsed ?? [];
    if (parsed === null)
      logger.warn(
        {
          evt: "worker.review.unreadable",
          ctx: { runId: run.id, from, refused },
        },
        "the reviewer's answer for one chat could not be read — it is recorded with no flags",
      );

    const writtenAt = now();
    await db.$transaction(async (tx) => {
      await tx.chatReviewThread.create({
        data: {
          runId: run.id,
          from,
          reviewedFrom,
          reviewedTo,
          flagCount: flags.length,
          createdAt: writtenAt,
          flags: {
            create: flags.map((f) => ({
              messageId: f.messageId,
              category: f.category,
              severity: f.severity,
              quote: f.quote,
              suggestion: f.suggestion,
              createdAt: writtenAt,
            })),
          },
        },
      });
      await tx.chatReviewRun.update({
        where: { id: run.id },
        data: {
          chats: { increment: 1 },
          flags: { increment: flags.length },
          inputTokens: {
            increment:
              usage.inputTokens + usage.cachedTokens + usage.cacheWriteTokens,
          },
          outputTokens: { increment: usage.outputTokens },
          costMicros: { increment: BigInt(costMicros(usage)) },
        },
      });
    });
    reviewed += 1;
    flagged += flags.length;
  }

  logger.info(
    {
      evt: "worker.review.progress",
      ctx: { runId: run.id, reviewed, flags: flagged },
    },
    "the chatbot review read some chats",
  );
  return { status: "working", reviewed, flags: flagged, runId: run.id };
}

/**
 * One tick of the review, as the worker loop runs it. A "Run the review
 * now" pressed on /audit (`pendingReviewRequest`) runs the pass outside the
 * night window, reading back the days asked for, until a run that started
 * after the request has ended; otherwise the pass keeps its night window.
 */
export async function reviewTick(deps: ReviewDeps): Promise<ReviewPassResult> {
  const req = await pendingReviewRequest(deps.db);
  return reviewPass(
    req ? { ...deps, ignoreWindow: true, backfillDays: req.days } : deps,
  );
}
