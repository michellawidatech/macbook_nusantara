/**
 * /api/chat — the shop's AI agent, drafting replies for the WhatsApp inbox.
 *
 * Two endpoints, both behind the normal session guard:
 *
 *  - `GET /status` — is the agent configured, and with which kind of
 *    credential. The chat page calls this on load so it can say "the bot is
 *    off because no key is set" instead of failing at the moment a person
 *    presses Draft.
 *  - `POST /reply` — draft one reply for one thread.
 *
 * The persona and the corrections arrive in the request body rather than from
 * the database, and that is on purpose: `schema.prisma` has no `Persona` or
 * `Correction` table, and this build never invents schema (CLAUDE.md). They
 * live in the web app for now. Making them survive a server restart is a
 * migration and an owner decision, not a column added quietly here.
 *
 * The knowledge base IS persisted — `AgentKnowledge` is in the schema for
 * exactly this — so it is read here rather than trusted from the client.
 *
 * Since 2026-09-18 a draft is made exactly the way the unattended worker
 * makes a reply (docs/chatbot-rag.md): the owner's approved answers and the
 * shop's facts as the only sources, the same routing of stock and price
 * questions to a person, the same check of what a reply cites. A draft that
 * would have been a hand-over comes back as one — `handoff` set, and the
 * holding line as the text — so staff see what the bot would have done.
 */

import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { ApiError } from "../errors.js";
import {
  agentCapabilities,
  anthropicClient,
  buildAgentPrompt,
  converse,
  hasCredential,
  knowledgeBlock,
  loadKnowledgeBase,
  loadStoreFacts,
  matchesFor,
  matchesNote,
  renderStoreFacts,
  routeMessage,
  storeOpenAt,
  usingOAuth,
  DEFAULT_PERSONA,
  MAX_CORRECTIONS,
  type AnthropicEnv,
} from "@nusantara/agent";

/**
 * A turn as the inbox sees it.
 *
 * `assistant` covers both what the bot said and what a human sent, because from
 * the model's point of view they are the same thing: words this shop has
 * already put in front of this customer.
 */
const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(4_000),
});

const correctionSchema = z.object({
  original: z.string().trim().min(1).max(4_000),
  corrected: z.string().trim().min(1).max(4_000),
  note: z.string().trim().max(500).optional(),
});

const replySchema = z.object({
  // A persona is free text a staff member wrote, so it is length-capped rather
  // than validated: there is no such thing as a wrong voice, only a long one.
  // Optional now that personas are persisted: the Chat page sends one only
  // when a staff member is previewing an edit they have not saved.
  persona: z.string().trim().min(1).max(4_000).optional(),
  turns: z.array(turnSchema).min(1).max(60),
  corrections: z.array(correctionSchema).max(MAX_CORRECTIONS).default([]),
  // Which thread this draft is for, so the grounding tools can look the
  // customer up. Optional: a persona preview with no thread still works, and
  // simply finds no customer rather than finding the wrong one.
  waId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/)
    .optional(),
});

const personaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  blurb: z.string().trim().max(200).optional(),
  // Free text a staff member wrote. Length-capped rather than validated:
  // there is no such thing as a wrong voice, only a long one.
  prompt: z.string().trim().min(1).max(4_000),
});

const correctionSaveSchema = z.object({
  messageId: z.string().trim().min(1).max(40).optional(),
  original: z.string().trim().min(1).max(4_000),
  corrected: z.string().trim().min(1).max(4_000),
  note: z.string().trim().max(500).optional(),
});

export interface ChatRouterDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** Injected, never read from `process.env` here — 01 §7. */
  readonly anthropic: AnthropicEnv;
}

export function chatRouter({ db, logger, anthropic }: ChatRouterDeps): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json({
      enabled: hasCredential(anthropic),
      mode: !hasCredential(anthropic)
        ? "none"
        : usingOAuth(anthropic)
          ? "oauth"
          : "api-key",
    });
  });

  router.post("/reply", async (req, res, next) => {
    try {
      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "VALIDASI",
          "The draft request was not understood.",
        );
      }
      const client = anthropicClient(anthropic);
      if (!client) {
        // 503, not 500: nothing is broken, the feature is simply not switched
        // on, and the page can say so precisely.
        // `ErrorCode` is a closed union in errors.ts and part of the API
        // contract (01 §4), so this reuses the nearest existing code rather
        // than widening it; the 503 status is what tells the client the
        // difference between "off" and "broken".
        throw new ApiError(
          503,
          "KESALAHAN_SERVER",
          "No Anthropic credential is configured, so the agent is switched off.",
        );
      }

      const [knowledge, storeFacts, persona, stored] = await Promise.all([
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

      const now = new Date();
      /*
       * The same capability the worker runs under (2026-09-21), read from the
       * same variable — a Draft that answers differently from the bot is a
       * Draft nobody can use to see what the bot would have said.
       *
       * The RESERVE capability is still withheld below, and the two are not
       * the same thing: what the bot may KNOW is a shop policy, and what a
       * button press may WRITE is a property of this endpoint.
       */
      const capabilities = agentCapabilities(process.env);
      const turns = parsed.data.turns;
      const last = turns[turns.length - 1];
      const customerText = last?.role === "user" ? last.text : "";
      const prompt = buildAgentPrompt({
        // Body first so an unsaved edit can be previewed, then the stored
        // voice, then the compiled-in one. The same order the worker uses,
        // minus the preview it has no way to receive.
        persona: parsed.data.persona ?? persona?.prompt ?? DEFAULT_PERSONA,
        storeFacts,
        knowledge: knowledgeBlock(knowledge),
        corrections: parsed.data.corrections.length
          ? parsed.data.corrections
          : [...stored].reverse().map((c) => ({
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
      const result = await converse({
        client,
        db,
        // No `reserve` capability, deliberately. Pressing Draft should propose
        // a sentence for a staff member to send, not book a reservation and
        // hold a unit — they have the POS for that.
        ctx: {
          from: parsed.data.waId ?? "",
          now,
        },
        prompt,
        turns,
        knowledge,
        storeFacts,
        capabilities,
        // The same two reads the worker makes of the customer's latest words.
        route: customerText
          ? routeMessage(customerText, { capabilities })
          : null,
        hint: customerText
          ? matchesNote(knowledge, matchesFor(knowledge, customerText))
          : undefined,
        onError: (err) => {
          failure = err;
        },
      });

      if (!result) {
        // The status and message are logged, never the credential. An
        // Anthropic APIError carries both; anything else is stringified.
        const detail =
          failure instanceof Error
            ? {
                name: failure.name,
                message: failure.message,
                status: (failure as { status?: number }).status,
              }
            : failure === undefined
              ? { message: "the model returned an empty reply" }
              : { message: String(failure) };
        logger.warn(
          {
            event: "agent.no_reply",
            mode: usingOAuth(anthropic) ? "oauth" : "api-key",
            ...detail,
          },
          "the agent produced no reply",
        );
        throw new ApiError(
          502,
          "KESALAHAN_SERVER",
          "The agent could not draft a reply. Answer by hand, or try again.",
        );
      }

      logger.info(
        {
          event: "agent.reply",
          tools: result.toolsUsed,
          steps: result.steps,
          sources: result.sources,
          ...(result.handoff ? { handoff: result.handoff.topic } : {}),
        },
        "agent drafted a reply",
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * The voices the shop can wear.
   *
   * Personas were browser-only until now, which meant editing one changed what
   * a staff member drafted and not one word of what the bot said unattended.
   * Reading them from here is what closes that.
   */
  router.get("/personas", async (_req, res, next) => {
    try {
      const personas = await db.persona.findMany({
        select: {
          id: true,
          name: true,
          blurb: true,
          prompt: true,
          active: true,
          builtIn: true,
          updatedAt: true,
        },
        orderBy: [{ builtIn: "desc" }, { name: "asc" }],
      });
      res.json({ personas });
    } catch (err) {
      next(err);
    }
  });

  router.post("/personas", async (req, res, next) => {
    try {
      const parsed = personaSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, "VALIDASI", "The persona was not understood.");
      }
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      const now = new Date();
      const persona = await db.persona.create({
        data: {
          name: parsed.data.name,
          blurb: parsed.data.blurb ?? null,
          prompt: parsed.data.prompt,
          // Never active on creation. Making a new voice live is a separate,
          // deliberate act, so writing one cannot silently change what the
          // bot is saying to customers right now.
          active: false,
          builtIn: false,
          createdById: staff.id,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true, name: true, active: true },
      });
      res.status(201).json({ persona });
    } catch (err) {
      next(err);
    }
  });

  router.put("/personas/:id", async (req, res, next) => {
    try {
      const parsed = personaSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, "VALIDASI", "The persona was not understood.");
      }
      const id = String(req.params["id"]);
      const existing = await db.persona.findUnique({
        where: { id },
        select: { builtIn: true },
      });
      if (!existing) {
        throw new ApiError(404, "TIDAK_DITEMUKAN", "Persona tidak ditemukan.");
      }
      // The shop's default voice is read-only, and this is the guard the
      // `builtIn` column exists for. Without it the row could be overwritten
      // and there would be nothing left to fall back to — a persona is the
      // one setting in this app with no compiled-in copy in the database.
      // Copy it and edit the copy; `POST /personas` is one call away.
      if (existing.builtIn) {
        throw new ApiError(
          409,
          "KONFLIK",
          "Persona bawaan tidak bisa diubah. Salin dulu, lalu ubah salinannya.",
        );
      }

      const persona = await db.persona.update({
        where: { id },
        data: {
          name: parsed.data.name,
          blurb: parsed.data.blurb ?? null,
          prompt: parsed.data.prompt,
          updatedAt: new Date(),
        },
        select: { id: true, name: true, active: true },
      });
      res.json({ persona });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Make one persona the live voice.
   *
   * The order inside the transaction is load-bearing. A partial unique index
   * (`Persona_active_key ON ("active") WHERE "active"`) permits exactly one
   * active row, so activating before deactivating trips it. Deactivate first,
   * then activate, and the constraint is what guarantees the shop can never
   * end up with two voices and no way to say which is real.
   */
  router.post("/personas/:id/activate", async (req, res, next) => {
    try {
      const id = String(req.params["id"]);
      const target = await db.persona.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!target) {
        throw new ApiError(404, "TIDAK_DITEMUKAN", "Persona tidak ditemukan.");
      }

      const now = new Date();
      await db.$transaction(async (tx) => {
        await tx.persona.updateMany({
          where: { active: true },
          data: { active: false, updatedAt: now },
        });
        await tx.persona.update({
          where: { id },
          data: { active: true, updatedAt: now },
        });
      });

      res.json({ status: "ACTIVE", id });
    } catch (err) {
      next(err);
    }
  });

  /**
   * File a staff rewrite of something the agent sent.
   *
   * This is the learning loop, and it is cheap on purpose: nothing is
   * fine-tuned, the model simply reads its own past mistakes before it writes
   * the next line, so one correction costs one correction.
   */
  router.get("/corrections", async (_req, res, next) => {
    try {
      const corrections = await db.agentCorrection.findMany({
        select: {
          id: true,
          messageId: true,
          original: true,
          corrected: true,
          note: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: MAX_CORRECTIONS,
      });
      res.json({ corrections });
    } catch (err) {
      next(err);
    }
  });

  router.post("/corrections", async (req, res, next) => {
    try {
      const parsed = correctionSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "VALIDASI",
          "The correction was not understood.",
        );
      }
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      // A rewrite identical to the original teaches nothing and would still
      // occupy one of the twelve slots the prompt has room for.
      if (parsed.data.corrected.trim() === parsed.data.original.trim()) {
        throw new ApiError(
          400,
          "VALIDASI",
          "The rewrite is the same as what was sent.",
        );
      }

      const correction = await db.agentCorrection.create({
        data: {
          messageId: parsed.data.messageId ?? null,
          original: parsed.data.original,
          corrected: parsed.data.corrected,
          note: parsed.data.note ?? null,
          createdById: staff.id,
          createdAt: new Date(),
        },
        select: { id: true },
      });
      res.status(201).json({ correction });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
