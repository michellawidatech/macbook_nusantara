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
 */

import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { ApiError } from "../errors.js";
import {
  anthropicClient,
  buildSystemPrompt,
  converse,
  hasCredential,
  usingOAuth,
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
  persona: z.string().trim().min(1).max(4_000),
  turns: z.array(turnSchema).min(1).max(60),
  corrections: z.array(correctionSchema).max(MAX_CORRECTIONS).default([]),
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

      const knowledge = await db.agentKnowledge.findMany({
        where: { active: true },
        select: { question: true, answer: true },
        orderBy: { updatedAt: "desc" },
        take: 40,
      });

      const systemPrompt = buildSystemPrompt({
        persona: parsed.data.persona,
        knowledge,
        corrections: parsed.data.corrections,
        today: new Date(),
      });

      let failure: unknown;
      const result = await converse({
        client,
        db,
        systemPrompt,
        turns: parsed.data.turns,
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
        { event: "agent.reply", tools: result.toolsUsed, steps: result.steps },
        "agent drafted a reply",
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
