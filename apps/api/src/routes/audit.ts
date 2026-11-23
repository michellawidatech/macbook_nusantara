/**
 * /api/audit — the chatbot audit's dashboard (2026-11-18,
 * docs/superpowers/specs/2026-11-18-chatbot-audit-design.md). Widatech only:
 * every route is behind `requireAuditor` (Staff.canViewAudit).
 *
 * A reader of what the worker's nightly review wrote, with three writes: a flag
 * can be dismissed (and un-dismissed) — the app role holds UPDATE on those
 * two columns of "ChatReviewFlag" and nothing else — and the reviewer's
 * model can be picked (2026-11-20, `AppSetting chatbot.reviewModel`, read by
 * the worker at the start of each run) — and the review can be asked to
 * run now (`chatbot.reviewRequest`, the button form of `ops/run
 * chat-review`; the worker picks it up on its next tick).
 */

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@nusantara/db";
import {
  REVIEW_MODEL,
  REVIEW_MODELS,
  REVIEW_MODEL_SETTING_KEY,
  REVIEW_REQUEST_MAX_DAYS,
  REVIEW_REQUEST_SETTING_KEY,
  formatReviewRequest,
  loadReviewModel,
  pendingReviewRequest,
  reviewScore,
  loadTesters,
  reviewModelOf,
} from "@nusantara/agent";
import { ApiError, notFound } from "../errors.js";

const CATEGORIES = [
  "WRONG_FACT",
  "UNANSWERED",
  "HANDOVER",
  "RULE_BROKEN",
  "TONE",
  "MISSED_SALE",
  "OTHER",
] as const;
const SEVERITIES = ["BAD", "IMPROVE"] as const;

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(values)));

const flagQuery = z.object({
  category: csv(CATEGORIES),
  severity: csv(SEVERITIES),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  dismissed: z.enum(["all", "yes", "no"]).default("all"),
  thread: z.string().trim().max(64).optional(),
  cursor: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const idParam = z.object({ id: z.string().min(1).max(64) });

const bad = (message: string) => new ApiError(400, "VALIDASI", message);

/** A run as the dashboard reads it — money as a string, never a number. */
const runOut = (r: {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  model: string;
  status: string;
  reason: string | null;
  chats: number;
  flags: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: bigint;
}) => ({ ...r, costMicros: r.costMicros.toString() });

export function auditRouter(deps: {
  readonly db: PrismaClient;
  readonly requireAuditor: RequestHandler;
}): Router {
  const { db } = deps;
  const router = Router();
  router.use(deps.requireAuditor);

  // The last 30 nights, newest first, with each night's flags by category and
  // severity for the trend.
  router.get("/runs", async (_req, res, next) => {
    try {
      const since = new Date(Date.now() - 31 * 86_400_000);
      const runs = await db.chatReviewRun.findMany({
        where: { startedAt: { gte: since } },
        orderBy: { startedAt: "desc" },
        take: 60,
      });
      const counts = runs.length
        ? await db.chatReviewFlag.groupBy({
            by: ["threadId", "category", "severity"],
            where: { thread: { runId: { in: runs.map((r) => r.id) } } },
            _count: { _all: true },
          })
        : [];
      const threads = counts.length
        ? await db.chatReviewThread.findMany({
            where: { id: { in: [...new Set(counts.map((c) => c.threadId))] } },
            select: { id: true, runId: true },
          })
        : [];
      const runOf = new Map(threads.map((t) => [t.id, t.runId]));
      const byRun = new Map<string, Record<string, number>>();
      const badChats = new Map<string, Set<string>>();
      for (const c of counts) {
        const runId = runOf.get(c.threadId)!;
        const m = byRun.get(runId) ?? {};
        m[c.category] = (m[c.category] ?? 0) + c._count._all;
        m[c.severity] = (m[c.severity] ?? 0) + c._count._all;
        byRun.set(runId, m);
        if (c.severity === "BAD") {
          const s = badChats.get(runId) ?? new Set<string>();
          s.add(c.threadId);
          badChats.set(runId, s);
        }
      }
      res.json({
        runs: runs.map((r) => ({
          ...runOut(r),
          byCategory: byRun.get(r.id) ?? {},
          chatsWithBad: badChats.get(r.id)?.size ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/flags", async (req, res, next) => {
    try {
      const q = flagQuery.safeParse(req.query);
      if (!q.success) return next(bad("Filter tidak valid."));
      const f = q.data;
      const where: Prisma.ChatReviewFlagWhereInput = {
        ...(f.category.length ? { category: { in: f.category } } : {}),
        ...(f.severity.length ? { severity: { in: f.severity } } : {}),
        ...(f.from || f.to
          ? {
              createdAt: {
                ...(f.from ? { gte: f.from } : {}),
                ...(f.to ? { lte: f.to } : {}),
              },
            }
          : {}),
        ...(f.dismissed === "yes"
          ? { dismissedAt: { not: null } }
          : f.dismissed === "no"
            ? { dismissedAt: null }
            : {}),
        ...(f.thread ? { threadId: f.thread } : {}),
      };
      const rows = await db.chatReviewFlag.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: f.limit + 1,
        ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
        include: {
          thread: {
            select: {
              id: true,
              from: true,
              reviewedFrom: true,
              reviewedTo: true,
            },
          },
          dismissedBy: { select: { name: true } },
        },
      });
      const testers = new Set(
        await loadTesters(db).catch(() => [] as string[]),
      );
      const more = rows.length > f.limit;
      const page = rows.slice(0, f.limit);
      res.json({
        flags: page.map((r) => ({
          id: r.id,
          threadId: r.threadId,
          from: r.thread.from,
          tester: testers.has(r.thread.from),
          messageId: r.messageId,
          category: r.category,
          severity: r.severity,
          quote: r.quote,
          suggestion: r.suggestion,
          createdAt: r.createdAt,
          dismissedAt: r.dismissedAt,
          dismissedBy: r.dismissedBy?.name ?? null,
        })),
        nextCursor: more ? page[page.length - 1]!.id : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // The chat window a review read, line by line, with its flags.
  router.get("/threads/:id", async (req, res, next) => {
    try {
      const p = idParam.safeParse(req.params);
      if (!p.success) return next(bad("Id tidak valid."));
      const t = await db.chatReviewThread.findUnique({
        where: { id: p.data.id },
        include: { flags: { orderBy: { createdAt: "asc" } } },
      });
      if (!t) return next(notFound("Percakapan"));
      const rows = await db.waMessage.findMany({
        where: {
          from: t.from,
          direction: "IN",
          answeredAt: { gte: t.reviewedFrom, lte: t.reviewedTo },
        },
        orderBy: [{ answeredAt: "asc" }, { ts: "asc" }, { id: "asc" }],
        take: 400,
        select: {
          id: true,
          ts: true,
          text: true,
          msgType: true,
          replyText: true,
          answeredAt: true,
          answeredByAgent: true,
        },
      });
      res.json({
        thread: {
          id: t.id,
          from: t.from,
          reviewedFrom: t.reviewedFrom,
          reviewedTo: t.reviewedTo,
        },
        lines: rows.flatMap((r) => [
          {
            messageId: r.id,
            at: r.ts,
            who: "customer" as const,
            text: r.text?.trim() || `[${r.msgType}]`,
          },
          ...(r.replyText?.trim()
            ? [
                {
                  messageId: r.id,
                  at: r.answeredAt ?? r.ts,
                  who: r.answeredByAgent
                    ? ("bot" as const)
                    : ("staff" as const),
                  text: r.replyText,
                },
              ]
            : []),
        ]),
        flags: t.flags.map((f) => ({
          id: f.id,
          messageId: f.messageId,
          category: f.category,
          severity: f.severity,
          quote: f.quote,
          suggestion: f.suggestion,
          dismissedAt: f.dismissedAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  const setDismissed =
    (dismiss: boolean): RequestHandler =>
    async (req, res, next) => {
      try {
        const p = idParam.safeParse(req.params);
        if (!p.success) return next(bad("Id tidak valid."));
        const found = await db.chatReviewFlag.findUnique({
          where: { id: p.data.id },
          select: { id: true },
        });
        if (!found) return next(notFound("Catatan"));
        const flag = await db.chatReviewFlag.update({
          where: { id: p.data.id },
          data: dismiss
            ? { dismissedAt: new Date(), dismissedById: req.staff!.id }
            : { dismissedAt: null, dismissedById: null },
          select: { id: true, dismissedAt: true },
        });
        res.json({ flag });
      } catch (err) {
        next(err);
      }
    };
  router.post("/flags/:id/dismiss", setDismissed(true));
  router.post("/flags/:id/undismiss", setDismissed(false));

  // GET / PUT /api/audit/model — which model reviews the chats. The shop's
  // setup token is refused Sonnet 5.5, so the review could never run on it;
  // the list holds only models that take the reviewer's JSON format.
  const modelOut = async () => ({
    model: await loadReviewModel(db),
    defaultModel: REVIEW_MODEL,
    models: REVIEW_MODELS,
  });
  router.get("/model", async (_req, res, next) => {
    try {
      res.json(await modelOut());
    } catch (err) {
      next(err);
    }
  });
  router.put("/model", async (req, res, next) => {
    try {
      const body = z
        .object({ model: z.string().trim().max(60) })
        .strict()
        .safeParse(req.body);
      const model = body.success ? reviewModelOf(body.data.model) : null;
      if (!model) throw bad("Model tidak dikenal.");
      const before = await loadReviewModel(db);
      const now = new Date();
      await db.$transaction([
        db.appSetting.upsert({
          where: { key: REVIEW_MODEL_SETTING_KEY },
          update: { value: model, updatedAt: now },
          create: {
            key: REVIEW_MODEL_SETTING_KEY,
            value: model,
            updatedAt: now,
          },
        }),
        db.auditLog.create({
          data: {
            at: now,
            staffId: req.staff?.id ?? null,
            entity: "AppSetting",
            entityId: REVIEW_MODEL_SETTING_KEY,
            action: "UPDATE",
            field: "value",
            before,
            after: model,
            requestId: req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        }),
      ]);
      res.json(await modelOut());
    } catch (err) {
      next(err);
    }
  });

  // GET /api/audit/score?days=7|30 — how good the bot was (owner,
  // 2026-11-23: "how many percent we get good, break it down"). Every window
  // reviewed in the period, its OPEN flags (a dismissed one was a person
  // saying the reviewer was wrong) and how many bot replies it held — those
  // in one query, not one per window. `reviewScore` does the arithmetic.
  router.get("/score", async (req, res, next) => {
    try {
      const q = z
        .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
        .safeParse(req.query);
      if (!q.success) throw bad("Jumlah hari tidak valid.");
      const since = new Date(Date.now() - q.data.days * 86_400_000);
      const threads = await db.chatReviewThread.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          flags: {
            where: { dismissedAt: null },
            select: { category: true, severity: true, messageId: true },
          },
        },
      });
      const counts = await db.$queryRaw<{ id: string; n: bigint }[]>`
        SELECT t."id", count(m."id") AS n
          FROM "ChatReviewThread" t
          JOIN "WaMessage" m
            ON m."from" = t."from"
           AND m."answeredByAgent"
           AND m."replyText" IS NOT NULL
           AND m."answeredAt" BETWEEN t."reviewedFrom" AND t."reviewedTo"
         WHERE t."createdAt" >= (${since}::timestamptz AT TIME ZONE 'UTC')
         GROUP BY t."id"`;
      const replies = new Map(counts.map((c) => [c.id, Number(c.n)]));
      res.json({
        days: q.data.days,
        ...reviewScore(
          threads.map((t) => ({
            flags: t.flags,
            botReplies: replies.get(t.id) ?? 0,
          })),
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET / POST /api/audit/run — "Run the review now". The API cannot run
  // the review itself: the review tables are the worker's (nusantara_agent),
  // so this files a request the worker answers on its next tick, outside
  // the night window. One at a time: a second press while one waits is 409.
  const requestOut = async () => {
    const req = await pendingReviewRequest(db);
    return {
      pending: req ? { days: req.days, at: req.at.toISOString() } : null,
    };
  };
  router.get("/run", async (_req, res, next) => {
    try {
      res.json(await requestOut());
    } catch (err) {
      next(err);
    }
  });
  router.post("/run", async (req, res, next) => {
    try {
      const body = z
        .object({
          days: z.number().int().min(1).max(REVIEW_REQUEST_MAX_DAYS),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success) throw bad("Jumlah hari tidak valid.");
      if (await pendingReviewRequest(db))
        throw new ApiError(
          409,
          "KONFLIK",
          "Tinjauan sudah diminta dan sedang menunggu.",
        );
      const now = new Date();
      const value = formatReviewRequest({ days: body.data.days, at: now });
      await db.$transaction([
        db.appSetting.upsert({
          where: { key: REVIEW_REQUEST_SETTING_KEY },
          update: { value, updatedAt: now },
          create: { key: REVIEW_REQUEST_SETTING_KEY, value, updatedAt: now },
        }),
        db.auditLog.create({
          data: {
            at: now,
            staffId: req.staff?.id ?? null,
            entity: "AppSetting",
            entityId: REVIEW_REQUEST_SETTING_KEY,
            action: "UPDATE",
            field: "value",
            before: null,
            after: value,
            requestId: req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        }),
      ]);
      res.json(await requestOut());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
