/**
 * The chat endpoints chatbot v2 adds (2026-10-15): evaluations of the bot's
 * replies, the agents' personas, the (read-only) bot settings, and the
 * simulator. Registered on the chat router, behind the staff session.
 *
 * The contract is `.context/chatbot-v2-api-contract.md`.
 */

import { type RequestHandler, type Router } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import {
  AGENT_DEFINITIONS,
  AGENT_ROLES,
  DEFAULT_PERSONA,
  MAX_CORRECTIONS,
  agentCapabilities,
  anthropicClient,
  buildAgentPrompt,
  knowledgeBlock,
  loadAgentPersonas,
  loadCapabilities,
  chatbotSettings,
  leadScoreOf,
  loadKnowledgeBase,
  loadStoreFacts,
  loadTesters,
  matchesFor,
  matchesNote,
  personaFor,
  renderStoreFacts,
  routeMessage,
  runPipeline,
  runRules,
  understand,
  converse,
  costMicros,
  storeOpenAt,
  type CallUsage,
  type PipelineResult,
  type RulesResult,
  type AgentRole,
  type AnthropicEnv,
} from "@nusantara/agent";
import { ApiError, notFound } from "../errors.js";

const REASONS = [
  "WRONG_FACT",
  "WRONG_TONE",
  "TOO_LONG",
  "MISSED_QUESTION",
  "SHOULD_ESCALATE",
  "SHOULD_NOT_ESCALATE",
  "OTHER",
] as const;

const evaluationBody = z
  .object({
    messageId: z.string().trim().min(1).max(40),
    rating: z.enum(["GOOD", "BAD"]),
    reason: z.enum(REASONS).optional(),
    agent: z.enum(["ROUTER", "ADVISOR", "OPERATIONS"]).optional(),
    note: z.string().trim().max(500).optional(),
    corrected: z.string().trim().max(4_000).optional(),
    /**
     * The rating this one replaces — 👍 pressed where 👎 stood (2026-10-27).
     * Withdrawn and replaced in one transaction, under the withdraw rules.
     */
    replaces: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const simulateBody = z
  .object({
    turns: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().trim().min(1).max(4_000),
        }),
      )
      .min(1)
      .max(40),
    /** What the simulator's last bot reply showed, for "yang kedua". */
    lastShown: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  })
  .strict();

const EVALUATION_SELECT = {
  id: true,
  rating: true,
  reason: true,
  agent: true,
  note: true,
  corrected: true,
  status: true,
  createdAt: true,
  reviewedAt: true,
  messageId: true,
  createdBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  message: { select: { from: true, text: true, replyText: true } },
} as const;

type EvaluationRow = {
  id: string;
  rating: "GOOD" | "BAD";
  reason: (typeof REASONS)[number] | null;
  agent: AgentRole | null;
  note: string | null;
  corrected: string | null;
  status: "OPEN" | "APPLIED" | "DISMISSED";
  createdAt: Date;
  reviewedAt: Date | null;
  messageId: string;
  createdBy: { name: string };
  reviewedBy: { name: string } | null;
  message: { from: string; text: string | null; replyText: string | null };
};

const evaluationJson = (e: EvaluationRow) => ({
  id: e.id,
  rating: e.rating,
  reason: e.reason,
  agent: e.agent,
  note: e.note,
  corrected: e.corrected,
  status: e.status,
  createdAt: e.createdAt.toISOString(),
  createdBy: e.createdBy.name,
  reviewedAt: e.reviewedAt?.toISOString() ?? null,
  reviewedBy: e.reviewedBy?.name ?? null,
  phone: e.message.from,
  customerText: e.message.text,
  reply: e.message.replyText,
  messageId: e.messageId,
});

const roleParam = (raw: unknown): AgentRole => {
  const r = String(raw ?? "").toUpperCase();
  if (!(AGENT_ROLES as readonly string[]).includes(r))
    throw new ApiError(404, "TIDAK_DITEMUKAN", "Agen tidak ditemukan.");
  return r as AgentRole;
};

export interface ChatV2Deps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly anthropic: AnthropicEnv;
  readonly ownerOnly: RequestHandler;
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Take a 👍/👎 back (owner ask 2026-10-27) — a real DELETE, and audited.
 *
 * Only while it is OPEN: an APPLIED one became an `AgentCorrection` the bot
 * now reads (removing it is the Knowledge Base's job), and a DISMISSED one
 * was decided by somebody. Its author may withdraw it, and so may an owner.
 * Nothing references `AgentEvaluation`, so the delete orphans nothing;
 * `deleteMany` on (id, OPEN) is what loses a race to an Apply.
 */
async function withdrawEvaluation(
  tx: Tx,
  id: string,
  staff: { id: string; role: "OWNER" | "STAFF" },
  meta: {
    requestId: string | null;
    ip: string | null;
    messageId?: string;
    /**
     * Deleting a row from the Evaluation list (owner ask 2026-10-27), not
     * taking a thumb back: any status goes. An APPLIED one's Knowledge Base
     * answer is a separate row (`AgentCorrection`) and stays — only the
     * review record leaves.
     */
    anyStatus?: boolean;
  },
): Promise<void> {
  const e = await tx.agentEvaluation.findUnique({
    where: { id },
    select: { status: true, createdById: true, messageId: true, rating: true },
  });
  if (!e || (meta.messageId !== undefined && e.messageId !== meta.messageId))
    throw notFound("Penilaian");
  if (!meta.anyStatus && e.status === "APPLIED")
    throw new ApiError(
      409,
      "KONFLIK",
      "Penilaian ini sudah menjadi jawaban di Knowledge Base — hapus di sana.",
    );
  if (!meta.anyStatus && e.status !== "OPEN")
    throw new ApiError(409, "KONFLIK", "Penilaian ini sudah diproses.");
  if (e.createdById !== staff.id && staff.role !== "OWNER")
    throw new ApiError(
      403,
      "AKSES_DITOLAK",
      "Hanya yang memberi penilaian ini, atau pemilik, yang bisa menariknya.",
    );
  const { count } = await tx.agentEvaluation.deleteMany({
    where: meta.anyStatus ? { id, status: e.status } : { id, status: "OPEN" },
  });
  if (count !== 1)
    throw new ApiError(409, "KONFLIK", "Penilaian ini sudah diproses.");
  await tx.auditLog.create({
    data: {
      at: new Date(),
      staffId: staff.id,
      entity: "AgentEvaluation",
      entityId: id,
      action: "DELETE",
      field: null,
      before: JSON.stringify({
        messageId: e.messageId,
        rating: e.rating,
        status: e.status,
      }),
      after: null,
      requestId: meta.requestId,
      ip: meta.ip,
    },
  });
}

/** The funnel's windows, in days (owner ask 2026-10-27). */
export const FUNNEL_WINDOWS = [7, 30] as const;

/** How long after a thread's first message a sale is credited to it. */
export const FUNNEL_SALE_DAYS = 30;

export interface FunnelStage {
  readonly days: number;
  readonly since: string;
  /** Threads with an inbound message in the window. */
  readonly chats: number;
  /** Threads the bot marked a 🔥 lead in the window (`leadAt`). */
  readonly leads: number;
  /** Visits the bot booked in the window: AGEN reservations with no units. */
  readonly visits: number;
  /** Closing tasks raised in the window. */
  readonly closing: number;
  /**
   * Sales to those chats: orders (not cancelled) whose customer's number is
   * a thread's, made within 30 days of that thread's FIRST message in the
   * window. Counts only — the funnel is finance-free.
   */
  readonly sales: number;
}

/**
 * The chatbot's funnel for one window — chats → leads → visits → closing
 * tasks → sales (owner, 2026-10-27: "convert the casual chatter to a lead and
 * even customer"). Read-only, counts only.
 *
 * Every stage counts only the threads in the Chats row (`threads` below), so
 * the stages are one funnel rather than five unrelated counts. Two kinds of
 * thread are left out (owner, 2026-10-27: *"if it is a test number can we not
 * include it … if I remove the chat, it will get removed as well"*):
 * - a tester's number (`chatbot.testers`), passed in as `exclude`;
 * - what came before a *Clear chat* (`WaThreadMemory.clearedAt`) — a deleted
 *   conversation has no messages left, so it drops out by itself.
 *
 * A thread is a wa_id (`62812…`) and a customer is an E.164 number
 * (`+62812…`), so a sale or a visit matches either form. Dates are bound as
 * timestamptz and converted to UTC before comparing with the `timestamp`
 * columns (CLAUDE.md).
 */
export async function funnelFor(
  db: PrismaClient,
  days: number,
  now: Date,
  exclude: readonly string[] = [],
): Promise<FunnelStage> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const at = Prisma.sql`(${since}::timestamptz AT TIME ZONE 'UTC')`;
  const saleMs = FUNNEL_SALE_DAYS * 86_400_000;
  const testers = [...exclude];
  const [row] = await db.$queryRaw<
    Array<{
      chats: number;
      leads: number;
      visits: number;
      closing: number;
      sales: number;
    }>
  >(Prisma.sql`
    WITH threads AS (
      SELECT m."from",
             MIN(m."ts") AS first_at,
             MAX(t."clearedAt") AS cleared_at
        FROM "WaMessage" m
        LEFT JOIN "WaThreadMemory" t ON t."from" = m."from"
       WHERE m."direction" = 'IN'
         AND m."ts" >= ${at}
         AND m."from" <> ALL(${testers}::text[])
         AND (t."clearedAt" IS NULL OR m."ts" > t."clearedAt")
       GROUP BY m."from"
    )
    SELECT
      (SELECT COUNT(*) FROM threads)::int AS chats,
      (SELECT COUNT(*) FROM "WaThreadMemory" t
         JOIN threads f ON f."from" = t."from"
        WHERE t."leadAt" >= ${at}
          AND (f.cleared_at IS NULL OR t."leadAt" > f.cleared_at))::int AS leads,
      (SELECT COUNT(DISTINCT r."id") FROM "Reservation" r
         JOIN threads f ON r."phone" IN (f."from", '+' || f."from")
        WHERE r."source" = 'AGEN' AND r."createdAt" >= ${at}
          AND (f.cleared_at IS NULL OR r."createdAt" > f.cleared_at)
          AND NOT EXISTS (SELECT 1 FROM "ReservationItem" i
                           WHERE i."reservationId" = r."id"))::int AS visits,
      (SELECT COUNT(*) FROM "ChatAction" a
         JOIN threads f ON f."from" = a."from"
        WHERE a."kind" = 'CLOSING' AND a."createdAt" >= ${at}
          AND (f.cleared_at IS NULL OR a."createdAt" > f.cleared_at))::int
        AS closing,
      (SELECT COUNT(DISTINCT o."id") FROM threads f
         JOIN "Order" o
           ON o."ts" >= f.first_at
          AND o."ts" <= f.first_at + (${saleMs}::bigint * interval '1 millisecond')
          AND o."status" <> 'BATAL'
         LEFT JOIN "Customer" c ON c."id" = o."customerId"
        WHERE c."phone" IN (f."from", '+' || f."from")
           OR o."phone" IN (f."from", '+' || f."from"))::int AS sales
  `);
  return {
    days,
    since: since.toISOString(),
    chats: row?.chats ?? 0,
    leads: row?.leads ?? 0,
    visits: row?.visits ?? 0,
    closing: row?.closing ?? 0,
    sales: row?.sales ?? 0,
  };
}

export function registerChatV2(router: Router, deps: ChatV2Deps): void {
  const { db, logger, anthropic, ownerOnly } = deps;

  // --- the funnel -------------------------------------------------------------

  /**
   * GET /api/chat/funnel — chats → leads → visits → closing → sales for the
   * last 7 and 30 days. Any signed-in staff: counts only, no money.
   */
  router.get("/funnel", async (_req, res, next) => {
    try {
      const now = new Date();
      const testers = await loadTesters(db);
      const windows = await Promise.all(
        FUNNEL_WINDOWS.map((d) => funnelFor(db, d, now, testers)),
      );
      res.json({ windows });
    } catch (err) {
      next(err);
    }
  });

  // --- evaluations ----------------------------------------------------------

  router.get("/evaluations", async (req, res, next) => {
    try {
      const status = String(req.query["status"] ?? "ALL").toUpperCase();
      const rating = String(req.query["rating"] ?? "").toUpperCase();
      const rows = (await db.agentEvaluation.findMany({
        where: {
          ...(["OPEN", "APPLIED", "DISMISSED"].includes(status)
            ? { status: status as "OPEN" | "APPLIED" | "DISMISSED" }
            : {}),
          ...(rating === "GOOD" || rating === "BAD" ? { rating } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: EVALUATION_SELECT,
      })) as EvaluationRow[];
      res.json({ evaluations: rows.map(evaluationJson) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/evaluations", async (req, res, next) => {
    try {
      const body = evaluationBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Penilaian tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const message = await db.waMessage.findUnique({
        where: { id: body.data.messageId },
        select: { id: true, replyText: true, answeredByAgent: true },
      });
      if (!message || !message.replyText || !message.answeredByAgent)
        throw new ApiError(
          400,
          "VALIDASI",
          "Hanya balasan bot yang bisa dinilai.",
        );
      const run = await db.agentRun.findFirst({
        where: { messageId: message.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const replaces = body.data.replaces;
      const row = (await db.$transaction(async (tx) => {
        if (replaces)
          await withdrawEvaluation(tx, replaces, staff, {
            requestId: req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
            messageId: message.id,
          });
        return tx.agentEvaluation.create({
          data: {
            messageId: message.id,
            ...(run ? { runId: run.id } : {}),
            rating: body.data.rating,
            reason: body.data.reason ?? null,
            agent: body.data.agent ?? null,
            note: body.data.note || null,
            corrected: body.data.corrected || null,
            createdById: staff.id,
            createdAt: new Date(),
          },
          select: EVALUATION_SELECT,
        });
      })) as EvaluationRow;
      res.status(201).json({ evaluation: evaluationJson(row) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Apply: the better answer becomes an `AgentCorrection`, which the bot
   * reads on its next pass (owner: a 👎 reaches the bot only on Apply).
   */
  router.post("/evaluations/:id/apply", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const override = z
        .object({ corrected: z.string().trim().min(1).max(4_000) })
        .partial()
        .strict()
        .safeParse(req.body ?? {});
      if (!override.success)
        throw new ApiError(400, "VALIDASI", "Jawaban tidak valid.");
      const id = String(req.params["id"]);
      const e = await db.agentEvaluation.findUnique({
        where: { id },
        select: {
          status: true,
          corrected: true,
          note: true,
          messageId: true,
          message: { select: { replyText: true } },
        },
      });
      if (!e) throw notFound("Penilaian");
      if (e.status !== "OPEN")
        throw new ApiError(409, "KONFLIK", "Penilaian ini sudah diproses.");
      const corrected = override.data.corrected ?? e.corrected ?? "";
      const original = e.message.replyText ?? "";
      if (!corrected || corrected.trim() === original.trim())
        throw new ApiError(
          400,
          "VALIDASI",
          "Tulis jawaban yang lebih baik dulu.",
        );
      const now = new Date();
      const row = (await db.$transaction(async (tx) => {
        const correction = await tx.agentCorrection.create({
          data: {
            messageId: e.messageId,
            original,
            corrected,
            note: e.note,
            createdById: staff.id,
            createdAt: now,
          },
          select: { id: true },
        });
        return tx.agentEvaluation.update({
          where: { id },
          data: {
            status: "APPLIED",
            corrected,
            correctionId: correction.id,
            reviewedById: staff.id,
            reviewedAt: now,
          },
          select: EVALUATION_SELECT,
        });
      })) as EvaluationRow;
      res.json({ evaluation: evaluationJson(row) });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/chat/evaluations/:id — the same thumb pressed again. */
  router.delete("/evaluations/:id", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const id = String(req.params["id"]);
      const anyStatus = req.query["any"] === "1";
      await db.$transaction((tx) =>
        withdrawEvaluation(tx, id, staff, {
          requestId: req.get("x-request-id") ?? null,
          ip: req.ip ?? null,
          anyStatus,
        }),
      );
      res.json({ withdrawn: id });
    } catch (err) {
      next(err);
    }
  });

  router.post("/evaluations/:id/dismiss", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const id = String(req.params["id"]);
      const { count } = await db.agentEvaluation.updateMany({
        where: { id, status: "OPEN" },
        data: {
          status: "DISMISSED",
          reviewedById: staff.id,
          reviewedAt: new Date(),
        },
      });
      if (count === 0) {
        const exists = await db.agentEvaluation.count({ where: { id } });
        if (!exists) throw notFound("Penilaian");
        throw new ApiError(409, "KONFLIK", "Penilaian ini sudah diproses.");
      }
      const row = (await db.agentEvaluation.findUniqueOrThrow({
        where: { id },
        select: EVALUATION_SELECT,
      })) as EvaluationRow;
      res.json({ evaluation: evaluationJson(row) });
    } catch (err) {
      next(err);
    }
  });

  // --- the three agents ------------------------------------------------------

  const agentsJson = async () => {
    const [rows, active] = await Promise.all([
      db.persona.findMany({
        where: { agent: { not: null } },
        select: { agent: true, prompt: true, updatedAt: true },
      }),
      db.persona.findFirst({
        where: { active: true },
        select: { prompt: true },
      }),
    ]);
    const v1 = active?.prompt ?? DEFAULT_PERSONA;
    return AGENT_ROLES.map((agent) => {
      const def = AGENT_DEFINITIONS[agent];
      const row = rows.find((r) => r.agent === agent);
      return {
        agent,
        name: def.name,
        task: def.task,
        /** What this seat does when the rules-first pipeline is selected. */
        inRules: def.inRules,
        model: def.model,
        prompt: row?.prompt ?? (agent === "ADVISOR" ? v1 : def.defaultPrompt),
        isDefault: !row,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  };

  router.get("/agents", async (_req, res, next) => {
    try {
      res.json({ agents: await agentsJson() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * One persona per agent (owner, 2026-10-14). The row is the agent's
   * (`Persona.agent`, unique); a persona of the same name left by a reset is
   * taken back rather than duplicated, because names are unique too.
   */
  router.put("/agents/:agent", ownerOnly, async (req, res, next) => {
    try {
      const agent = roleParam(req.params["agent"]);
      const body = z
        .object({ prompt: z.string().trim().min(1).max(8_000) })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Persona tidak valid.");
      const staff = req.staff;
      const now = new Date();
      const name = `${AGENT_DEFINITIONS[agent].name} (chatbot v2)`;
      await db.$transaction(async (tx) => {
        const own = await tx.persona.findUnique({
          where: { agent },
          select: { id: true },
        });
        if (own) {
          await tx.persona.update({
            where: { id: own.id },
            data: { prompt: body.data.prompt, updatedAt: now },
          });
          return;
        }
        const named = await tx.persona.findUnique({
          where: { name },
          select: { id: true },
        });
        if (named) {
          await tx.persona.update({
            where: { id: named.id },
            data: { agent, prompt: body.data.prompt, updatedAt: now },
          });
          return;
        }
        await tx.persona.create({
          data: {
            name,
            prompt: body.data.prompt,
            agent,
            active: false,
            builtIn: false,
            createdById: staff?.id ?? null,
            createdAt: now,
            updatedAt: now,
          },
        });
      });
      logger.info(
        { evt: "chat.agent.persona", ctx: { agent, staffId: staff?.id } },
        "an agent's persona changed",
      );
      res.json({
        agent: (await agentsJson()).find((a) => a.agent === agent),
      });
    } catch (err) {
      next(err);
    }
  });

  /** Back to the default: the row lets go of the agent and stays as history. */
  router.post("/agents/:agent/reset", ownerOnly, async (req, res, next) => {
    try {
      const agent = roleParam(req.params["agent"]);
      await db.persona.updateMany({
        where: { agent },
        data: { agent: null, updatedAt: new Date() },
      });
      res.json({
        agent: (await agentsJson()).find((a) => a.agent === agent),
      });
    } catch (err) {
      next(err);
    }
  });

  // --- settings ---------------------------------------------------------------

  /*
   * Read-only since 2026-10-21 (owner: "keep it a single agent … the user
   * cannot choose / determine the lead"). What answers follows the credential
   * and the lead threshold is fixed — see `chatbotSettings`. The PUT that set
   * both is gone.
   */
  router.get("/settings", (_req, res) => {
    res.json(chatbotSettings(anthropicClient(anthropic) !== null));
  });

  // --- the simulator ------------------------------------------------------------

  /**
   * POST /api/chat/simulate — the three agents on a made-up conversation.
   * A dry run: it reads the POS like the bot does, and books nothing, sends
   * nothing and writes nothing — no `reserve`, no `profile`, no run row.
   */
  router.post("/simulate", async (req, res, next) => {
    try {
      const body = simulateBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Percakapan tidak valid.");
      const turns = body.data.turns;
      if (turns[turns.length - 1]?.role !== "user")
        throw new ApiError(
          400,
          "VALIDASI",
          "Pesan terakhir harus dari pelanggan.",
        );
      const client = anthropicClient(anthropic);

      const [
        knowledge,
        storeFacts,
        active,
        corrections,
        capabilities,
        settings,
        personas,
      ] = await Promise.all([
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
        loadCapabilities(db, agentCapabilities(process.env)),
        // What the live bot would be: the one agent, or the rules without a
        // credential.
        chatbotSettings(client !== null),
        loadAgentPersonas(db),
      ]);
      const v1 = active?.prompt ?? DEFAULT_PERSONA;
      const now = new Date();
      const customerText = turns[turns.length - 1]!.text;
      const prompt = buildAgentPrompt({
        persona: personaFor("ADVISOR", personas, v1),
        storeFacts,
        knowledge: knowledgeBlock(knowledge),
        corrections: [...corrections].reverse().map((c) => ({
          original: c.original,
          corrected: c.corrected,
          note: c.note ?? undefined,
        })),
        now,
        openNow: storeOpenAt(now),
        customerText,
        capabilities,
      });
      let failure: unknown;
      const ctx = { from: "simulator", now, capabilities };
      const route = routeMessage(customerText, { capabilities });
      const hint = matchesNote(knowledge, matchesFor(knowledge, customerText));
      const singleAgent = async () => {
        const calls: CallUsage[] = [];
        const result = await converse({
          client: client!,
          // CHATBOT_MODEL: the simulator tries what the worker would run.
          ...(anthropic.model ? { model: anthropic.model } : {}),
          db,
          ctx,
          prompt,
          turns,
          knowledge,
          storeFacts,
          route,
          hint,
          capabilities,
          onCall: (u) => calls.push(u),
          onError: (err) => {
            failure = err;
          },
        });
        return { result, calls };
      };
      let out: PipelineResult | RulesResult | null;
      if (settings.pipeline === "rules") {
        out = await runRules({
          db,
          // Nobody's number and no writes: a dry run books nothing.
          ctx,
          text: customerText,
          knowledge,
          capabilities,
          route,
          // The simulator keeps no profile, so what the customer said earlier
          // in this made-up conversation stands in for one — the bot stops
          // asking once it has been told, as the real one does.
          known: (() => {
            const earlier = turns
              .slice(0, -1)
              .filter((x) => x.role === "user")
              .map((x) =>
                understand(x.text, now, { proposalOpen: false, lastShown: [] }),
              );
            return {
              name: earlier.find((e) => e.name)?.name ?? null,
              usage: earlier.some((e) => e.usage.length > 0),
              preferences: earlier.some((e) => e.preferences.length > 0),
              budget: earlier.some(
                (e) => e.budgetMin !== null || e.budgetMax !== null,
              ),
              apps: earlier.some((e) => e.apps.length > 0),
            };
          })(),
          lastReply:
            [...turns].reverse().find((x) => x.role === "assistant")?.text ??
            null,
          proposalOpen: false,
          lastShown: body.data.lastShown ?? [],
          leadThreshold: settings.leadThreshold,
          ...(client ? { ai: singleAgent } : {}),
        });
      } else if (settings.pipeline === "v1") {
        const started = Date.now();
        const { result, calls } = await singleAgent();
        out = result
          ? {
              ...result,
              verdict: {
                language: "id",
                tone: "casual",
                intent: "other",
                // Scored the way the worker scores a single-agent turn.
                leadScore: leadScoreOf(
                  understand(customerText, now, {
                    proposalOpen: false,
                    lastShown: [],
                  }),
                ),
                needsOperations: result.toolsUsed.length > 1,
                operationsBrief: "",
                escalate: result.handoff?.topic ?? null,
              },
              trace: calls.map((c) => ({
                agent: "ADVISOR" as const,
                model: c.model,
                tool: null,
                ok: true,
                ms: c.ms,
                inputTokens:
                  c.inputTokens + c.cachedTokens + c.cacheWriteTokens,
                cachedTokens: c.cachedTokens,
                outputTokens: c.outputTokens,
              })),
              costMicros: calls.reduce((n, c) => n + costMicros(c), 0),
              latencyMs: Date.now() - started,
            }
          : null;
      } else {
        out = await runPipeline({
          client: client!,
          db,
          // Nobody's number: lookups of "me" find nobody, writes are not offered.
          ctx: { from: "simulator", now },
          prompt,
          turns,
          knowledge,
          storeFacts,
          route,
          hint,
          capabilities,
          personas: {
            router: personaFor("ROUTER", personas, v1),
            operations: personaFor("OPERATIONS", personas, v1),
          },
          leadThreshold: settings.leadThreshold,
          onError: (err) => {
            failure = err;
          },
        });
      }
      if (!out) {
        logger.warn(
          {
            evt: "chat.simulate.failed",
            ...(failure instanceof Error
              ? { err: { name: failure.name, message: failure.message } }
              : {}),
          },
          "the simulator produced no reply",
        );
        throw new ApiError(
          502,
          "KESALAHAN_SERVER",
          "The agents could not answer. Check the credential and try again.",
        );
      }
      res.json({
        reply: out.reply,
        handoff: out.handoff
          ? { topic: out.handoff.topic, summary: out.handoff.summary }
          : null,
        photos: out.photos ?? [],
        router: {
          language: out.verdict.language,
          tone: out.verdict.tone,
          intent: out.verdict.intent,
          leadScore: out.verdict.leadScore,
          escalate: out.verdict.escalate,
        },
        steps: out.trace.map((s) => ({
          agent: s.agent,
          model: s.model,
          tool: s.tool,
          ok: s.ok,
          ms: s.ms,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
        })),
        costMicros: out.costMicros,
        latencyMs: out.latencyMs,
        pipeline: settings.pipeline,
        /** Serials this reply showed — send back as `lastShown` next turn. */
        shown: "shown" in out && out.shown ? [...out.shown] : [],
        /** Whether a model answered (false: rules and templates only). */
        usedAi:
          "usedAi" in out
            ? out.usedAi
            : out.trace.some(
                (t) =>
                  t.model !== "" &&
                  t.model !== "rules" &&
                  t.model !== "template",
              ),
      });
    } catch (err) {
      next(err);
    }
  });
}
