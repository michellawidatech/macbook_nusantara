/**
 * apps/wa-gateway entry point (:3002, loopback) — the shop's WhatsApp number
 * as a linked device (owner decision 2026-10-22, docs/whatsapp-baileys.md).
 *
 *     phone ─▶ Baileys ─▶ POST /webhook (signed) ─▶ WaMessage ─▶ worker draft
 *                                                                    │
 *     phone ◀─ Baileys ◀─ POST /graph/…/messages ◀── worker's fetch ◀─ Outbox
 *
 * The only file here that reads `process.env`, binds a port or installs
 * signal handlers (01 §7). A refused configuration exits 78 (EX_CONFIG), as
 * ops/run does, so launchd's log says why in its first line.
 *
 * SIGTERM closes the connection and does NOT unlink: a deploy restarts this
 * process, and a restart that unlinked the shop's number would need a new
 * scan after every release. Unlinking is the owner's button on /chat.
 */

import QRCode from "qrcode";
import { createLogger } from "@nusantara/logging";
import { baileysSocketFactory } from "./baileysSocket.js";
import { loadGatewayConfig, startupProblems } from "./config.js";
import { createGatewayServer } from "./server.js";
import { WhatsAppSession, errInfo } from "./session.js";

function main(): void {
  const config = loadGatewayConfig(process.env);
  const logger = createLogger({
    app: "wa-gateway",
    env: process.env["NODE_ENV"] ?? "development",
    level: process.env["LOG_LEVEL"] === undefined ? "info" : undefined,
  });

  const problems = startupProblems(config);
  if (problems.length > 0) {
    for (const p of problems) {
      logger.error({ evt: "wa-gateway.config.refused" }, p);
    }
    process.exitCode = 78;
    return;
  }

  const session = new WhatsAppSession({
    config,
    logger,
    makeSocket: baileysSocketFactory(logger),
    qrToDataUrl: (qr) => QRCode.toDataURL(qr, { margin: 1, width: 300 }),
  });
  const server = createGatewayServer({
    secret: config.secret,
    session,
    logger,
  });

  server.listen(config.port, config.host, () => {
    logger.info(
      { evt: "wa-gateway.started", ctx: { port: config.port } },
      "wa-gateway listening on loopback",
    );
  });
  session.start().catch((err: unknown) => {
    logger.error(
      { evt: "wa-gateway.resume.failed", err: errInfo(err) },
      "could not resume the linked session",
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ evt: "wa-gateway.stopping", ctx: { signal } }, "stopping");
    session.stop();
    server.close(() => process.exit(0));
    // A keep-alive connection must not hold a deploy up.
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
