/**
 * Express app factory for the WhatsApp webhook receiver+processor. Split from
 * server.ts (which binds the port and starts the sweeper) so supertest can drive
 * the routes in-process.
 *
 * The POST route stays thin — verify the HMAC, ack Meta with 200 immediately,
 * then persist + process asynchronously (Meta retries slow/non-2xx deliveries,
 * so we must not block on the pipeline):
 *
 *   verify X-Hub-Signature-256 → 200 → persistInbound() → setImmediate(pipeline)
 */

import { timingSafeEqual } from "node:crypto";
import express, { type Request } from "express";
import { requestLogger } from "@nusantara/logging";
import { config } from "./config.js";
import { verifySignature } from "./signature.js";
import { persistInbound, type WebhookPayload } from "./persist.js";
import { runConversation } from "./agent/pipeline.js";
import { scheduleConversation } from "./agent/debounce.js";
import { persistInboundIg, processComment } from "./instagram.js";
import { hasAnthropicCredential, usingOAuth } from "./agent/anthropic.js";

/**
 * Persist the payload and schedule processing. Routes by Meta object:
 * `instagram` → comment ingest + auto-reply; everything else → the WhatsApp
 * message pipeline. Both paths dedup so a redelivered event re-runs nothing.
 *
 * WhatsApp messages are debounced per sender: instead of answering each line, we
 * (re)arm a content-aware quiet window per phone number, then `runConversation`
 * processes the whole burst once (see ./agent/debounce.ts).
 */
export async function handleInbound(payload: WebhookPayload): Promise<void> {
  try {
    if (payload.object === "instagram") {
      const created = await persistInboundIg(payload);
      for (const comment of created) await processComment(comment);
      return;
    }
    const created = await persistInbound(payload);
    // Group the new rows by sender and (re)arm one debounce timer per sender.
    const bySender = new Map<string, { text: string | null }[]>();
    for (const msg of created) {
      const arr = bySender.get(msg.from) ?? [];
      arr.push({ text: msg.text });
      bySender.set(msg.from, arr);
    }
    for (const [from, recent] of bySender) {
      scheduleConversation(from, recent, runConversation);
    }
  } catch (err) {
    console.error("[webhook] inbound handling failed:", err);
  }
}

/** Constant-time compare for the verification-handshake token. */
function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(): express.Express {
  const app = express();

  // Capture the RAW request bytes (needed for HMAC) while still parsing JSON.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );

  // Structured request logging → HttpLog (redacts the x-hub-signature header).
  app.use(requestLogger("whatsapp-webhook", { skip: (req) => req.path === "/health" }));

  // --- Root: status page ---
  app.get("/", (_req, res) => {
    res.json({
      service: "nusantara-whatsapp-webhook",
      status: "ok",
      port: config.port,
      // Deliberately NOT reporting which secrets are configured: this page is
      // public, and advertising `appSecretSet:false` alongside `canSend:true`
      // hands an attacker a confirmed target.
      endpoints: { verify: "GET /webhook", receive: "POST /webhook", health: "GET /health" },
      note: "Expose publicly on HTTPS:443 via `ngrok http 3001` and register the callback URL in the Meta dashboard.",
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // --- GET /webhook: verification handshake ---
  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // An unset VERIFY_TOKEN must not make `?hub.verify_token=` ("" === "")
    // succeed — that would let anyone register this host as their callback.
    if (!config.verifyToken) {
      console.error("[webhook] VERIFY_TOKEN not set — refusing the verification handshake");
      res.status(503).send("verify token not configured");
      return;
    }
    if (mode === "subscribe" && tokenMatches(token, config.verifyToken)) {
      console.info("[webhook] verified");
      res.status(200).type("text/plain").send(typeof challenge === "string" ? challenge : "");
      return;
    }
    console.warn("[webhook] verification failed", { mode });
    res.status(403).send("Forbidden");
  });

  // --- POST /webhook: inbound events ---
  app.post("/webhook", (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const signature = req.headers["x-hub-signature-256"] as string | undefined;

    // Fail CLOSED. A missing APP_SECRET must not turn a public endpoint that
    // drives the agent and sends messages from the store's verified number into
    // an unauthenticated one.
    if (!config.appSecret) {
      console.error("[webhook] APP_SECRET not set — rejecting inbound event");
      res.status(503).send("app secret not configured");
      return;
    }
    if (!verifySignature(raw, signature, config.appSecret)) {
      console.warn("[webhook] invalid X-Hub-Signature-256 — rejecting");
      res.status(401).send("invalid signature");
      return;
    }

    // Ack Meta immediately, then persist + process out of band.
    res.status(200).send({ status: "ok" });
    setImmediate(() => {
      void handleInbound(req.body as WebhookPayload);
    });
  });

  return app;
}
