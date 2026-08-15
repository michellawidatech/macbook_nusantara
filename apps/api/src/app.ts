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
import { createLoginLimiter, type LoginLimiter } from "./auth/rateLimit.js";
import { idempotency } from "./middleware/idempotency.js";
import { authRouter } from "./routes/auth.js";

export interface CreateAppDeps {
  readonly db: PrismaClient;
  readonly config: ApiConfig;
  readonly logger: Logger;
  /** Injectable so a test can drive the limiter's clock. */
  readonly limiter?: LoginLimiter;
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

  app.use(requestLogger({ logger }));
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

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

  // Business routers mount here in later increments. The owner-only guard is
  // wired now so S6's tests can prove it rejects a STAFF token.
  api.get("/kontrol/audit", requireOwner(logger), (_req, res) => {
    res.json({ entries: [] });
  });

  app.use("/api", api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
