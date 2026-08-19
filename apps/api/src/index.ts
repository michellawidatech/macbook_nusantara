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
import { readAnthropicEnv, hasCredential } from "@nusantara/agent";
import { defaultSecretsFile, loadApiSecrets } from "./secretsFile.js";
import { readAuth0Env } from "./auth/auth0.js";

export { createApp } from "./app.js";
export { loadConfig, type ApiConfig } from "./config.js";
export { createLoginLimiter, type LoginLimiter } from "./auth/rateLimit.js";
export { hashPassword, verifyPassword } from "./auth/credentials.js";
export {
  API_ENV_KEYS,
  loadApiSecrets,
  defaultSecretsFile,
} from "./secretsFile.js";
export {
  readAuth0Env,
  AUTH0_ENV_KEYS,
  type Auth0Config,
} from "./auth/auth0.js";

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
  const auth0 = readAuth0Env(secrets);

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

  // Same reasoning as the credential line above: "Auth0 was never configured"
  // and "Auth0 is configured and the redirect is broken" look identical from a
  // browser, and only one of them is fixed by editing the dashboard.
  logger.info(
    {
      evt: "api.auth0.credential",
      ctx: { configured: auth0 !== undefined, baseUrl: auth0?.baseUrl },
    },
    auth0 === undefined
      ? "no Auth0 credentials — hosted login is not mounted"
      : "Auth0 hosted login is mounted at /login",
  );

  const client = prisma();
  const server = createApp({
    db: client,
    config,
    logger,
    anthropic,
    auth0,
  }).listen(config.port, () => {
    logger.info({ evt: "api.started", ctx: { port: config.port } }, "API siap");
  });

  const shutdown = (signal: string) => {
    logger.info({ evt: "api.stopping", ctx: { signal } }, "API berhenti");
    server.close(() => {
      void disconnect().then(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
