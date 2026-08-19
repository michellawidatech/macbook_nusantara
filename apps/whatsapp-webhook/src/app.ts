/**
 * The Meta webhook receiver — 06 §9.
 *
 * Four properties, in the order 06 says not to reorder:
 *
 *  1. **Fail closed.** No `APP_SECRET` → 503. Bad signature → 401. This
 *     endpoint drives an agent that sends messages from the shop's verified
 *     number; an unauthenticated version of it is a free megaphone, so there is
 *     no "skip verification in development" branch and there must never be one.
 *  2. **Verify over the raw bytes.** `express.json`'s `verify` hook keeps the
 *     buffer before parsing, because a re-serialised body never matches.
 *  3. **Ack fast, process later.** 200 goes out before any database or model
 *     work. Meta retries anything slow, and a retry means the customer gets the
 *     same answer twice.
 *  4. **Deduplicate.** In `persist.ts`, on a unique constraint.
 *
 * `createApp` takes every dependency explicitly and reads no environment, so a
 * fail-closed test can construct a server with no secret and prove it rejects
 * traffic (01 §7 — this repo has been bitten by an implicit `.env` before).
 */

import express, { type Express, type Request } from "express";
import type { PrismaClient } from "@nusantara/db";
import { type Logger, requestLogger } from "@nusantara/logging";
import type { WebhookConfig } from "./config.js";
import { verifySignature, tokenMatches } from "./signature.js";
import {
  persistInbound,
  persistInboundIg,
  type WebhookPayload,
} from "./persist.js";

/** Express does not type the buffer we stash, so we do. */
type RawRequest = Request & { rawBody?: Buffer };

export interface CreateAppDeps {
  readonly config: WebhookConfig;
  readonly db: PrismaClient;
  readonly logger: Logger;
  /**
   * Called after an event has been persisted, with the rows that were new.
   *
   * The agent pipeline is not built yet. This hook is where it lands, and it
   * exists now so the seam is visible rather than being discovered later inside
   * the route — and so a test can assert the route reaches it exactly once per
   * distinct delivery.
   */
  readonly onInbound?: (
    created: readonly { from: string; text: string | null }[],
  ) => void;
}

export function createApp(deps: CreateAppDeps): Express {
  const { config, db, logger } = deps;
  const app = express();

  app.disable("x-powered-by");
  // Behind ngrok or nginx: one proxy hop, so req.ip is the caller's address.
  app.set("trust proxy", 1);

  // Keep the RAW bytes for the HMAC while still parsing JSON (06 §9.2).
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as RawRequest).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(requestLogger({ logger }));

  /**
   * Public status page.
   *
   * Deliberately does NOT report which secrets are set. Advertising
   * `appSecretSet: false` beside `canSend: true` on a public URL hands an
   * attacker a confirmed target (06 §9.1).
   */
  app.get("/", (_req, res) => {
    res.json({
      service: "nusantara-whatsapp-webhook",
      status: "ok",
      endpoints: {
        verify: "GET /webhook",
        receive: "POST /webhook",
        health: "GET /health",
      },
      note: "Expose over HTTPS (`ngrok http 3001`) and register the callback URL in the Meta dashboard.",
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // --- GET /webhook — the one-time verification handshake -------------------
  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // 503 rather than 403 when the token is unset, and the distinction matters:
    // an empty configured token would otherwise match an empty supplied one and
    // let anyone register this host as their callback.
    if (!config.verifyToken) {
      logger.error(
        { evt: "webhook.verify.unconfigured" },
        "VERIFY_TOKEN is not set — refusing the handshake",
      );
      res.status(503).type("text/plain").send("verify token not configured");
      return;
    }

    if (mode === "subscribe" && tokenMatches(token, config.verifyToken)) {
      logger.info(
        { evt: "webhook.verified" },
        "webhook verification handshake succeeded",
      );
      // Echoed verbatim as text/plain — Meta compares the body byte for byte.
      res
        .status(200)
        .type("text/plain")
        .send(typeof challenge === "string" ? challenge : "");
      return;
    }

    logger.warn(
      { evt: "webhook.verify.failed", ctx: { mode: String(mode) } },
      "handshake rejected",
    );
    res.status(403).type("text/plain").send("Forbidden");
  });

  // --- POST /webhook — inbound events ---------------------------------------
  app.post("/webhook", (req, res) => {
    const raw = (req as RawRequest).rawBody ?? Buffer.alloc(0);
    const signature = req.headers["x-hub-signature-256"];

    if (!config.appSecret) {
      logger.error(
        { evt: "webhook.inbound.unconfigured" },
        "APP_SECRET is not set — rejecting inbound event",
      );
      res.status(503).type("text/plain").send("app secret not configured");
      return;
    }

    if (
      !verifySignature(
        raw,
        typeof signature === "string" ? signature : undefined,
        config.appSecret,
      )
    ) {
      // Worth an alert in production (05 §9): a burst of these is either a
      // rotated secret or somebody probing the endpoint.
      logger.warn(
        { evt: "webhook.signature.invalid" },
        "rejected an event with a bad signature",
      );
      res.status(401).type("text/plain").send("invalid signature");
      return;
    }

    // Ack BEFORE any work. Everything below this line is out of band (06 §9.3).
    res.status(200).json({ status: "ok" });

    const payload = (req.body ?? {}) as WebhookPayload;
    setImmediate(() => {
      void handleInbound(
        {
          config,
          db,
          logger,
          ...(deps.onInbound ? { onInbound: deps.onInbound } : {}),
        },
        payload,
      );
    });
  });

  return app;
}

/**
 * Persist a verified delivery and hand the new rows on.
 *
 * Never throws: it runs detached from the request, after the 200 has already
 * gone out, so an unhandled rejection here would take the process down and cost
 * every message in flight. Failures are logged and the raw event is already on
 * disk to be replayed.
 */
export async function handleInbound(
  deps: CreateAppDeps,
  payload: WebhookPayload,
): Promise<void> {
  const { db, logger, onInbound } = deps;
  try {
    if (payload.object === "instagram") {
      const comments = await persistInboundIg(db, payload);
      logger.info(
        { evt: "webhook.ig.received", ctx: { comments } },
        "stored an Instagram event (raw only — comment ingest is not built yet)",
      );
      return;
    }

    const created = await persistInbound(db, payload);
    logger.info(
      { evt: "webhook.wa.received", ctx: { created: created.length } },
      created.length > 0
        ? `stored ${created.length} new WhatsApp message(s)`
        : "duplicate delivery — nothing new to store",
    );
    if (created.length > 0) {
      onInbound?.(created.map((m) => ({ from: m.from, text: m.text })));
    }
  } catch (err) {
    logger.error(
      {
        evt: "webhook.inbound.failed",
        ...(err instanceof Error
          ? { err: { name: err.name, message: err.message } }
          : {}),
      },
      "failed to handle an inbound event",
    );
  }
}
