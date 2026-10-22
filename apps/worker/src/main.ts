/**
 * apps/worker entry point — no port.
 *
 * The only file in this app that reads `process.env`, opens a database
 * connection or installs signal handlers. Same shape as apps/api and
 * apps/whatsapp-webhook, and for the same reason: every pass takes its
 * dependencies as arguments, which is what lets a test drive them with no
 * credentials in sight (01 §7).
 *
 * Credentials come from the process environment, optionally topped up from the
 * webhook's env file. That loader is key-filtered and is reused rather than
 * reimplemented — its docblock explains the `DATABASE_URL` trap it exists to
 * prevent, and a second loader here would be a second chance to fall into it.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db as prisma, disconnect } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { hasCredential } from "@nusantara/agent";
import { canSend } from "@nusantara/whatsapp";
import { loadEnvFile, loadWorkerConfig, sendFetchFor } from "./config.js";
import { run } from "./loop.js";
import { checkDatabaseRole } from "./role.js";

/** Resolved from this file, not from `process.cwd()` — see server.ts in the webhook. */
function defaultEnvFile(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // apps/worker/src
  return join(here, "..", "..", "..", "secrets", "webhook-credentials.env");
}

export function main(): void {
  const envFile = process.env["WORKER_ENV_FILE"] ?? defaultEnvFile();
  // Shell wins over the file, so one value can be overridden for one run.
  const env = { ...loadEnvFile(envFile), ...process.env };
  const config = loadWorkerConfig(env);

  const logger = createLogger({
    app: "worker",
    env: process.env["NODE_ENV"] ?? "development",
    level: process.env["LOG_LEVEL"] === undefined ? "info" : undefined,
  });

  // Said once, at startup, where somebody will see it. Both halves can be
  // dormant independently, and the two failures look identical from the
  // outside — "the bot never answered" — so they are reported separately.
  const canDraft = hasCredential(config.anthropic);
  const canDeliver = canSend(config.whatsapp);
  if (!canDraft) {
    logger.warn(
      { evt: "worker.config.no_anthropic" },
      "no Anthropic credential — the agent will not draft replies, staff must answer by hand",
    );
  }
  if (!canDeliver) {
    logger.warn(
      { evt: "worker.config.no_whatsapp" },
      config.transport.kind === "baileys"
        ? "WHATSAPP_TRANSPORT=baileys without WA_GATEWAY_URL and WA_GATEWAY_SECRET — replies will be queued in the outbox but not sent"
        : "no WhatsApp token — replies will be queued in the outbox but not sent",
    );
  }
  logger.info(
    {
      evt: "worker.config.loaded",
      ctx: {
        envFile,
        transport: config.transport.kind,
        graphVersion: config.whatsapp.graphVersion,
        canDraft,
        canDeliver,
        debounceMs: config.debounceMs,
        idlePollMs: config.idlePollMs,
      },
    },
    "configuration loaded",
  );

  const db = prisma();
  let requestStop: () => void = () => {};
  const stop = new Promise<void>((resolve) => {
    requestStop = resolve;
  });

  // Before the first pass, so a worker on the wrong role writes nothing at
  // all rather than everything but the columns its passes depend on — and
  // `run` is never entered, not even for one tick.
  void checkDatabaseRole(db, process.env["APP_ENV"] ?? "dev", logger)
    .then(async (ok) => {
      if (!ok) {
        process.exitCode = 78; // EX_CONFIG, as ops/run uses for bad config
        return;
      }
      logger.info({ evt: "worker.started" }, "worker started");
      // Baileys mode: the same Graph requests, to the gateway on loopback.
      const fetchImpl = sendFetchFor(config.transport);
      await run({
        db,
        logger,
        config,
        stop,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
    })
    .catch((err: unknown) => {
      logger.error(
        {
          evt: "worker.crashed",
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "the worker loop stopped unexpectedly",
      );
      process.exitCode = 1;
    })
    .finally(() => {
      void disconnect().then(() => process.exit(process.exitCode ?? 0));
    });

  const shutdown = (signal: string) => {
    logger.info({ evt: "worker.stopping", ctx: { signal } }, "worker stopping");
    // Resolves the stop promise; the loop finishes its current tick and the
    // `finally` above disconnects. An in-flight send is allowed to complete
    // rather than being abandoned half-way through a customer's reply.
    requestStop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
