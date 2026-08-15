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

export { createApp } from "./app.js";
export { loadConfig, type ApiConfig } from "./config.js";
export { createLoginLimiter, type LoginLimiter } from "./auth/rateLimit.js";
export { hashPassword, verifyPassword } from "./auth/credentials.js";

export function main(): void {
  const config = loadConfig(process.env);
  const logger = createLogger({
    app: "api",
    env: config.env,
    level: process.env["LOG_LEVEL"] === undefined ? "info" : undefined,
  });

  const client = prisma();
  const server = createApp({ db: client, config, logger }).listen(
    config.port,
    () => {
      logger.info(
        { evt: "api.started", ctx: { port: config.port } },
        "API siap",
      );
    },
  );

  const shutdown = (signal: string) => {
    logger.info({ evt: "api.stopping", ctx: { signal } }, "API berhenti");
    server.close(() => {
      void disconnect().then(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
