/**
 * Nusantara POS — WhatsApp Cloud API webhook service (Express).
 *
 *  GET  /webhook   → verification handshake (hub.mode / hub.verify_token / hub.challenge)
 *  POST /webhook   → inbound events; verifies X-Hub-Signature-256, responds 200
 *                    immediately, then persists + runs the agent pipeline.
 *  GET  /health    → liveness probe.
 *  GET  /          → human-readable status page.
 *
 * Meta delivers webhooks only over public HTTPS:443. In dev, run this on
 * PORT (3001) and expose it with `ngrok http 3001` or a cloudflared tunnel.
 *
 * The Express app lives in app.ts (createApp) so it can be driven by supertest;
 * this file only binds the port and starts the stuck-message sweeper.
 */

import { prisma } from "@nusantara/db";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { startSweeper } from "./persist.js";
import { runConversation } from "./agent/pipeline.js";
import { scheduleConversation } from "./agent/debounce.js";
import { startIgSweeper, processComment } from "./instagram.js";

// Refuse to boot without the secrets that gate the public endpoints — the
// routes now fail closed, so starting up without them just serves 503s.
if (!config.appSecret || !config.verifyToken) {
  const missing = [!config.appSecret && "APP_SECRET", !config.verifyToken && "VERIFY_TOKEN"]
    .filter(Boolean)
    .join(", ");
  console.error(`[webhook] refusing to start: ${missing} not set — /webhook cannot be secured.`);
  process.exit(1);
}

const app = createApp();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.info(`[webhook] WhatsApp webhook listening on http://0.0.0.0:${config.port}`);
  console.info(
    `[webhook] Expose it: ngrok http ${config.port}  → set callback URL https://<public-host>/webhook`,
  );
});

// Graceful shutdown so a deploy doesn't sever an in-flight agent run.
let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[webhook] ${sig} received — draining`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("[webhook] unhandled rejection:", reason);
});

// Retry any sender stuck in BARU (a pipeline that died mid-flight) by re-arming
// its debounce timer, so recovery shares the same per-sender processing lock.
startSweeper((from) => scheduleConversation(from, [{ text: "" }], runConversation));
// Same, for IG comments stuck in NEW (auto-reply that never completed).
startIgSweeper(processComment);
