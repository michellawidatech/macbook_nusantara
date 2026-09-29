/**
 * apps/whatsapp-webhook entry point (:3001).
 *
 * The only file in this app that reads `process.env`, opens a database
 * connection or binds a port — same shape as apps/api, and for the same reason:
 * everything else takes its dependencies as arguments, which is what lets the
 * fail-closed tests run without a `.env` in sight.
 *
 * Credentials come from the process environment, optionally topped up from an
 * env file named by `WEBHOOK_ENV_FILE`. That loader is key-filtered — see the
 * docblock in config.ts for the `DATABASE_URL` trap it exists to prevent.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db as prisma, disconnect } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "./app.js";
import {
  canSendInstagram,
  canSendWhatsApp,
  loadConfig,
  loadEnvFile,
} from "./config.js";

/**
 * Where the credentials live when nobody says otherwise.
 *
 * Resolved from this file's own location, not from `process.cwd()`: `pnpm
 * --filter` runs with the cwd set to the app directory, so a relative path in
 * the environment silently resolves to `apps/whatsapp-webhook/secrets/...`,
 * finds nothing, and the server comes up rejecting every request while
 * cheerfully reporting that it loaded a config file. That exact mistake cost an
 * afternoon; resolving from `import.meta.url` makes it unrepeatable.
 */
function defaultEnvFile(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // apps/whatsapp-webhook/src
  return join(here, "..", "..", "..", "secrets", "webhook-credentials.env");
}

export function main(): void {
  const envFile = process.env["WEBHOOK_ENV_FILE"] ?? defaultEnvFile();
  // Shell wins over the file: an operator overriding one value for one run
  // should not have to edit a secrets file to do it.
  const env = { ...(envFile ? loadEnvFile(envFile) : {}), ...process.env };
  const config = loadConfig(env);

  const logger = createLogger({
    app: "whatsapp-webhook",
    env: process.env["NODE_ENV"] ?? "development",
    level: process.env["LOG_LEVEL"] === undefined ? "info" : undefined,
  });

  // Said once, at startup, where somebody will see it. 06 §12's first
  // troubleshooting move is "is it even configured" — this answers it without
  // exposing anything on the public status page.
  if (!config.appSecret) {
    logger.error(
      { evt: "webhook.config.no_app_secret" },
      "APP_SECRET is not set — every inbound event will be rejected with 503",
    );
  }
  if (!config.verifyToken) {
    logger.error(
      { evt: "webhook.config.no_verify_token" },
      "VERIFY_TOKEN is not set — the Meta dashboard handshake will fail with 503",
    );
  }
  logger.info(
    {
      evt: "webhook.config.loaded",
      ctx: {
        envFile: envFile ?? null,
        graphVersion: config.graphVersion,
        canSendWhatsApp: canSendWhatsApp(config),
        canSendInstagram: canSendInstagram(config),
      },
    },
    "configuration loaded",
  );

  const client = prisma();
  const server = createApp({ config, db: client, logger }).listen(
    config.port,
    () => {
      logger.info(
        { evt: "webhook.started", ctx: { port: config.port } },
        `webhook listening on :${config.port}`,
      );
    },
  );

  const shutdown = (signal: string) => {
    logger.info(
      { evt: "webhook.stopping", ctx: { signal } },
      "webhook stopping",
    );
    server.close(() => {
      void disconnect().then(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
