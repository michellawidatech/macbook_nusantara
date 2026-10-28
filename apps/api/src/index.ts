/**
 * apps/api entry point (:4000).
 *
 * The only place in this app that reads `process.env`, opens a database
 * connection or binds a port. Everything else takes its dependencies as
 * arguments, which is what makes the app testable without a server.
 */

import { db as prisma, disconnect } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startChatHealthMonitor } from "./chatHealth.js";
import { readAnthropicEnv, hasCredential } from "@nusantara/agent";
import { defaultSecretsFile, loadApiSecrets } from "./secretsFile.js";

export { createApp } from "./app.js";
export { loadConfig, type ApiConfig } from "./config.js";
export { createLoginLimiter, type LoginLimiter } from "./auth/rateLimit.js";
export { hashPassword, verifyPassword } from "./auth/credentials.js";
export {
  API_ENV_KEYS,
  loadApiSecrets,
  defaultSecretsFile,
} from "./secretsFile.js";

export function main(): void {
  const config = loadConfig(process.env);
  const logger = createLogger({
    app: "api",
    env: config.env,
    level: process.env["LOG_LEVEL"] === undefined ? "info" : undefined,
  });

  // Shell wins over the file, so one value can be overridden for one run. The
  // loader is key-filtered to the Anthropic credential — see secretsFile.ts.
  const secretsFile = process.env["API_ENV_FILE"] ?? defaultSecretsFile();
  const secrets = { ...loadApiSecrets(secretsFile), ...process.env };
  const anthropic = readAnthropicEnv(secrets);

  // Said once, at startup, where somebody will see it. The Chat page reports
  // the same fact to staff, but "nobody gave it a token" and "the token is
  // there and this process cannot see it" look identical from the browser.
  logger.info(
    {
      evt: "api.agent.credential",
      ctx: { secretsFile, configured: hasCredential(anthropic) },
    },
    hasCredential(anthropic)
      ? "the chat agent has a credential"
      : "no Anthropic credential — the chat agent will stay switched off",
  );

  const client = prisma();
  const server = createApp({
    db: client,
    config,
    logger,
    anthropic,
  }).listen(config.port, () => {
    logger.info({ evt: "api.started", ctx: { port: config.port } }, "API siap");
  });

  const shutdown = (signal: string) => {
    logger.info({ evt: "api.stopping", ctx: { signal } }, "API berhenti");
    server.close(() => {
      void disconnect().then(() => process.exit(0));
    });
  };

  // Is the chatbot working? Checked every 2 minutes on the shop's own API
  // only — staging holds a copy of the shop and must never message staff.
  if (process.env["APP_ENV"] === "prod" && config.waGateway) {
    startChatHealthMonitor(client, { gateway: config.waGateway, logger });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
