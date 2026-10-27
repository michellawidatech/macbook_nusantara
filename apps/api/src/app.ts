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
import { ApiError, errorHandler, notFoundHandler } from "./errors.js";
import {
  requireAuth,
  requireOwner,
  requirePasswordChanged,
} from "./auth/middleware.js";
import { createLoginLimiter, type LoginLimiter } from "./auth/rateLimit.js";
import { idempotency } from "./middleware/idempotency.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { cors } from "./middleware/cors.js";
import { authRouter } from "./routes/auth.js";
import { katalogRouter } from "./routes/katalog.js";
import { inboundRouter } from "./routes/inbound.js";
import { chatRouter } from "./routes/chat.js";
import { inboxRouter } from "./routes/inbox.js";
import { PICTURE_BODY_LIMIT, PICTURE_PATH } from "./routes/inboxSent.js";
import { reservationsRouter } from "./routes/reservations.js";
import { kontrolRouter } from "./routes/kontrol.js";
import { storeRouter } from "./routes/store.js";
import { staffRouter } from "./routes/staff.js";
import { agentRouter } from "./routes/agent.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import type { AnthropicEnv } from "@nusantara/agent";

/** Four phone photographs as base64, with room to spare. */
const STORE_BODY_LIMIT = "25mb";

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
}

export function createApp(deps: CreateAppDeps): Express {
  const { db, config, logger } = deps;
  const limiter = deps.limiter ?? createLoginLimiter(config.login);

  const app = express();

  // Who is a proxy, so req.ip is the client's address and not the proxy's —
  // the login limiter keys on it. See `ApiConfig.trustProxy`.
  app.set("trust proxy", config.trustProxy);
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

  // A store commit can carry QC photographs (docs/store-on-postgres.md), so it
  // alone gets a large body; every other endpoint keeps the small limit.
  const smallJson = express.json({ limit: config.bodyLimit });
  const storeJson = express.json({ limit: STORE_BODY_LIMIT });
  // A picture sent from staff's own device (2026-10-27) is a 5 MB image as
  // base64 — the one other route that needs room. Over the limit is the
  // reader's 413, not an unhandled 500.
  const pictureJson = express.json({ limit: PICTURE_BODY_LIMIT });
  app.use((req, res, next) => {
    if (req.path === "/api/store/commit") return storeJson(req, res, next);
    if (PICTURE_PATH.test(req.path))
      return pictureJson(req, res, (err?: unknown) =>
        next(
          (err as { type?: string } | undefined)?.type === "entity.too.large"
            ? new ApiError(
                413,
                "VALIDASI",
                "Gambar terlalu besar (maksimal 5 MB).",
                { field: "image" },
              )
            : err,
        ),
      );
    return smallJson(req, res, next);
  });
  app.use(cookieParser());

  const api = Router();

  // Public (01 §4): health and auth. Everything else sits behind requireAuth.
  api.get("/health", (_req, res) => {
    res.json({
      ok: true,
      app: "api",
      env: config.env,
      release: config.release,
    });
  });

  // One instance, used by the auth router's authenticated mutations and by
  // every business route mounted below (08 §10: honoured by EVERY mutating
  // endpoint, not merely available to them).
  const idempotent = idempotency({ db, ttlMs: config.idempotencyTtlMs });

  api.use("/auth", authRouter({ db, config, logger, limiter, idempotent }));

  // The chatbot worker's door into the POS (chatbot v2). Before requireAuth on
  // purpose: its caller holds a per-turn token, not a staff session, and the
  // router refuses everything without one (routes/agent.ts).
  api.use(
    "/agent/v1",
    agentRouter({
      db,
      logger,
      secret: config.agentApiSecret,
      agentStaffId: config.agentStaffId,
    }),
  );

  api.use(requireAuth({ db, config }));
  // A session on a password somebody else chose may do nothing below this line
  // until it has chosen its own (owner ask 2026-09-18). /auth, above, is where
  // it does that.
  api.use(requirePasswordChanged());
  api.use(idempotent);

  // 01 §2: one router per section, longer prefixes first.
  api.use("/katalog", katalogRouter(db));
  api.use(
    "/chat",
    chatRouter({
      db,
      logger,
      anthropic: deps.anthropic ?? {},
      requireOwner: requireOwner(logger),
    }),
  );
  api.use(
    "/inbox",
    inboxRouter(
      db,
      { gateway: config.waGateway, logger },
      // Delete conversation (2026-10-27) is the owner's alone.
      requireOwner(logger),
    ),
  );
  api.use("/reservations", reservationsRouter(db));
  api.use("/inbound", inboundRouter(db));
  api.use("/store", storeRouter(db));

  // Owner-only, and the guard is passed in rather than applied here so the
  // mount keeps saying who may reach it. Wired since S6 for the rejection; the
  // body answered a hardcoded empty list until the router behind it was real.
  api.use(
    "/kontrol",
    kontrolRouter({ db, requireOwner: requireOwner(logger) }),
  );
  api.use(
    "/staff",
    staffRouter({ db, logger, limiter, requireOwner: requireOwner(logger) }),
  );
  // The linked WhatsApp device (2026-10-22), owner-only inside the router.
  api.use(
    "/whatsapp",
    whatsappRouter({
      db,
      logger,
      gateway: config.waGateway,
      requireOwner: requireOwner(logger),
    }),
  );

  app.use("/api", api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
