/**
 * The API application — docs/rebuild/01-conventions.md §4.
 *
 * `createApp` takes every dependency explicitly: nothing here reads
 * `process.env`, opens a database connection, or listens on a port. That is
 * what lets the tests drive the real app against a real database without a
 * server, and what keeps a fail-closed test from picking up a developer's
 * `.env` (01 §7).
 */

import express, { type Express, Router } from "express";
import cookieParser from "cookie-parser";
import type { PrismaClient } from "@nusantara/db";
import { type Logger, requestLogger } from "@nusantara/logging";
import type { ApiConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { requireAuth, requireOwner } from "./auth/middleware.js";
import {
  auth0LogoutCleanup,
  auth0Middleware,
  type Auth0Config,
} from "./auth/auth0.js";
import { createLoginLimiter, type LoginLimiter } from "./auth/rateLimit.js";
import { idempotency } from "./middleware/idempotency.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { cors } from "./middleware/cors.js";
import { authRouter } from "./routes/auth.js";
import { katalogRouter } from "./routes/katalog.js";
import { chatRouter } from "./routes/chat.js";
import { inboxRouter } from "./routes/inbox.js";
import { reservationsRouter } from "./routes/reservations.js";
import { kontrolRouter } from "./routes/kontrol.js";
import type { AnthropicEnv } from "@nusantara/agent";

export interface CreateAppDeps {
  readonly db: PrismaClient;
  readonly config: ApiConfig;
  readonly logger: Logger;
  /** Injectable so a test can drive the limiter's clock. */
  readonly limiter?: LoginLimiter;
  /**
   * Anthropic credentials for the chat agent. Passed in like everything else
   * (01 §7) so a fail-closed test can prove the agent stays dormant without
   * reading the developer's shell.
   */
  readonly anthropic?: AnthropicEnv;
  /**
   * Auth0 credentials. Absent means the hosted login is not mounted at all and
   * the API behaves exactly as it did before it existed — which is also what
   * every existing test relies on (01 §7: a fail-closed test must not pick up
   * a developer's environment).
   */
  readonly auth0?: Auth0Config;
}

export function createApp(deps: CreateAppDeps): Express {
  const { db, config, logger } = deps;
  const limiter = deps.limiter ?? createLoginLimiter(config.login);

  const app = express();

  // Behind nginx in production: trust one proxy hop so req.ip is the client's
  // address and not the proxy's. Rate limiting per IP depends on it.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // 01 §4: money is BigInt whole rupiah, serialized as a JSON string. One
  // replacer for the whole app, so no route can forget.
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );

  // First, so every response carries them — including the 404 from
  // notFoundHandler and the 500 from errorHandler (08 §9).
  app.use(securityHeaders({ https: config.cookieSecure }));

  app.use(requestLogger({ logger }));

  // Before the body parser: a preflight has no body worth reading, and a
  // rejected cross-origin caller should not get as far as allocating one.
  app.use(cors({ allowedOrigins: config.corsOrigin }));

  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  // Auth0's /auth/login, /auth/logout and /auth/callback — distinct from the
  // hand-rolled /api/auth router, which still serves password login. Mounted
  // only when configured, and with authRequired off, so this guards nothing on
  // its own — see auth/auth0.ts.
  if (deps.auth0 !== undefined) {
    // Before the SDK, so this app's own session is revoked on the way through
    // to Auth0's /logout rather than being left live behind it.
    app.use(
      "/auth/logout",
      auth0LogoutCleanup({ db, logger, cookieName: config.cookieName }),
    );
    app.use(
      auth0Middleware({
        auth0: deps.auth0,
        db,
        logger,
        cookieName: config.cookieName,
        sessionTtlMs: config.sessionTtlMs,
        spaOrigin: config.corsOrigin.split(",")[0]?.trim() ?? "/",
        cookieSecure: config.cookieSecure,
      }),
    );
  }

  const api = Router();

  // Public (01 §4): health and auth. Everything else sits behind requireAuth.
  api.get("/health", (_req, res) => {
    res.json({ ok: true, app: "api", env: config.env });
  });

  // One instance, used by the auth router's authenticated mutations and by
  // every business route mounted below (08 §10: honoured by EVERY mutating
  // endpoint, not merely available to them).
  const idempotent = idempotency({ db, ttlMs: config.idempotencyTtlMs });

  api.use("/auth", authRouter({ db, config, logger, limiter, idempotent }));

  api.use(requireAuth({ db, config }));
  api.use(idempotent);

  // 01 §2: one router per section, longer prefixes first.
  api.use("/katalog", katalogRouter(db));
  api.use("/chat", chatRouter({ db, logger, anthropic: deps.anthropic ?? {} }));
  api.use("/inbox", inboxRouter(db));
  api.use("/reservations", reservationsRouter(db));

  // Owner-only, and the guard is passed in rather than applied here so the
  // mount keeps saying who may reach it. Wired since S6 for the rejection; the
  // body answered a hardcoded empty list until the router behind it was real.
  api.use("/kontrol", kontrolRouter({ db, requireOwner: requireOwner(logger) }));

  app.use("/api", api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
