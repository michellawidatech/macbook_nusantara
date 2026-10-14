/**
 * The chat endpoints chatbot v2 adds (2026-10-15): evaluations of the bot's
 * replies, the three agents' personas, the pipeline settings, and the
 * simulator. Registered on the chat router, behind the staff session.
 *
 * The contract is `.context/chatbot-v2-api-contract.md`.
 */

import { type RequestHandler, type Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import {
  AGENT_DEFINITIONS,
  AGENT_ROLES,
  DEFAULT_PERSONA,
  LEAD_THRESHOLD_SETTING_KEY,
  MAX_CORRECTIONS,
  PIPELINE_SETTING_KEY,
  agentCapabilities,
  anthropicClient,
  buildAgentPrompt,
  knowledgeBlock,
  loadAgentPersonas,
  loadCapabilities,
  loadChatbotSettings,
  loadKnowledgeBase,
  loadStoreFacts,
  matchesFor,
  matchesNote,
  personaFor,
  renderStoreFacts,
  routeMessage,
  runPipeline,
  storeOpenAt,
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
  })
  .strict();

const settingsBody = z
  .object({
    pipeline: z.enum(["v1", "v2"]),
    leadThreshold: z.number().int().min(0).max(100),
  })
  .partial()
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

export function registerChatV2(router: Router, deps: ChatV2Deps): void {
  const { db, logger, anthropic, ownerOnly } = deps;

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
      const row = (await db.agentEvaluation.create({
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

  router.get("/settings", async (_req, res, next) => {
    try {
      res.json(await loadChatbotSettings(db));
    } catch (err) {
      next(err);
    }
  });

  router.put("/settings", ownerOnly, async (req, res, next) => {
    try {
      const body = settingsBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Pengaturan tidak valid.");
      const now = new Date();
      const writes: Array<[string, string]> = [];
      if (body.data.pipeline !== undefined)
        writes.push([PIPELINE_SETTING_KEY, body.data.pipeline]);
      if (body.data.leadThreshold !== undefined)
        writes.push([
          LEAD_THRESHOLD_SETTING_KEY,
          String(body.data.leadThreshold),
        ]);
      await db.$transaction(
        writes.map(([key, value]) =>
          db.appSetting.upsert({
            where: { key },
            update: { value, updatedAt: now },
            create: { key, value, updatedAt: now },
          }),
        ),
      );
      const saved = await loadChatbotSettings(db);
      logger.info(
        {
          evt: "chat.settings.changed",
          ctx: { staffId: req.staff?.id, ...saved },
        },
        "the chatbot's settings changed",
      );
      res.json(saved);
    } catch (err) {
      next(err);
    }
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
      if (!client)
        throw new ApiError(
          503,
          "KESALAHAN_SERVER",
          "No Anthropic credential is configured, so the bot is switched off.",
        );

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
        loadChatbotSettings(db),
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
      const out = await runPipeline({
        client,
        db,
        // Nobody's number: lookups of "me" find nobody, writes are not offered.
        ctx: { from: "simulator", now },
        prompt,
        turns,
        knowledge,
        storeFacts,
        route: routeMessage(customerText, { capabilities }),
        hint: matchesNote(knowledge, matchesFor(knowledge, customerText)),
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
      });
    } catch (err) {
      next(err);
    }
  });
}
