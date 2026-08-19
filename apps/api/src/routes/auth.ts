/**
 * /api/auth — login, logout, me, sessions.
 *
 * docs/rebuild/01-conventions.md §4 and 08-data-integrity.md §9. Handlers are
 * thin: validate with Zod `safeParse` → call Prisma → return.
 */

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import type { ApiConfig } from "../config.js";
import { ApiError, notFound, unauthenticated } from "../errors.js";
import {
  hashPassword,
  hashSessionToken,
  newSessionToken,
  verifyPassword,
} from "../auth/credentials.js";
import { requireAuth } from "../auth/middleware.js";
import type { LoginLimiter } from "../auth/rateLimit.js";

export interface AuthRouterDeps {
  readonly db: PrismaClient;
  readonly config: ApiConfig;
  readonly logger: Logger;
  readonly limiter: LoginLimiter;
  /** 08 §3, applied to this router's authenticated mutations. */
  readonly idempotent: RequestHandler;
}

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const revokeParams = z.object({ id: z.string().min(1).max(64) });

/**
 * A dummy Argon2 verify target.
 *
 * An unknown username must cost the same as a known one, or the response time
 * itself reveals which accounts exist. Computed once at startup.
 */
let decoyHash: string | undefined;
async function decoy(): Promise<string> {
  decoyHash ??= await hashPassword("tidak-ada-akun-dengan-nama-ini");
  return decoyHash;
}

export function authRouter(deps: AuthRouterDeps): Router {
  const { db, config, logger, limiter, idempotent } = deps;
  const router = Router();

  const clientIp = (ip: string | undefined): string => ip ?? "unknown";

  router.post("/login", (req, res, next) => {
    void (async () => {
      try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
          next(
            new ApiError(
              400,
              "VALIDASI",
              "Nama pengguna dan kata sandi wajib diisi.",
              {
                field: String(parsed.error.issues[0]?.path[0] ?? "username"),
              },
            ),
          );
          return;
        }

        const { username, password } = parsed.data;
        const ip = clientIp(req.ip);

        const decision = limiter.check(username, ip);
        if (!decision.allowed) {
          next(
            new ApiError(
              429,
              "TERLALU_BANYAK",
              `Terlalu banyak percobaan masuk. Coba lagi dalam ${decision.retryAfter} detik.`,
              { retryAfter: decision.retryAfter },
            ),
          );
          return;
        }

        const staff = await db.staff.findUnique({ where: { username } });

        // Always verify something, so an unknown username and a wrong password
        // take the same time.
        const ok =
          staff === null
            ? (await verifyPassword(await decoy(), password), false)
            : await verifyPassword(staff.passwordHash, password);

        if (!ok || staff === null || !staff.active) {
          limiter.recordFailure(username, ip);

          // §9: every failure writes AuditLog(action = LOGIN_GAGAL).
          await db.auditLog.create({
            data: {
              at: new Date(),
              staffId: staff?.id ?? null,
              entity: "Staff",
              entityId: staff?.id ?? username,
              action: "LOGIN_GAGAL",
              requestId: req.get("x-request-id") ?? null,
              ip,
            },
          });

          logger.warn(
            { evt: "auth.login.failed", ctx: { username, ip } },
            "login gagal",
          );

          // One message for every failure mode: never say which half was wrong.
          next(
            new ApiError(
              401,
              "TIDAK_LOGIN",
              "Nama pengguna atau kata sandi salah.",
            ),
          );
          return;
        }

        limiter.recordSuccess(username, ip);

        const raw = newSessionToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + config.sessionTtlMs);

        await db.staffSession.create({
          data: {
            staffId: staff.id,
            tokenHash: hashSessionToken(raw),
            issuedAt: now,
            expiresAt,
            ip,
            userAgent: req.get("user-agent") ?? null,
          },
        });
        await db.staff.update({
          where: { id: staff.id },
          data: { lastLoginAt: now },
        });

        // The raw token exists here and in the cookie. Nowhere else, ever.
        res.cookie(config.cookieName, raw, {
          httpOnly: true,
          sameSite: "lax",
          secure: config.cookieSecure,
          expires: expiresAt,
          path: "/",
        });

        logger.info(
          { evt: "auth.login", ctx: { staffId: staff.id } },
          "login berhasil",
        );

        res.status(200).json({
          staff: {
            id: staff.id,
            username: staff.username,
            name: staff.name,
            role: staff.role,
            canApprove: staff.canApprove,
          },
          expiresAt,
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  // Everything below needs a live session.
  const auth = requireAuth({ db, config });

  router.get("/me", auth, (req, res) => {
    res.json({ staff: req.staff });
  });

  router.post("/logout", auth, idempotent, (req, res, next) => {
    void (async () => {
      try {
        await db.staffSession.update({
          where: { id: req.sessionId },
          data: { revokedAt: new Date() },
        });
        res.clearCookie(config.cookieName, { path: "/" });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get("/sessions", auth, (req, res, next) => {
    void (async () => {
      try {
        const sessions = await db.staffSession.findMany({
          where: { staffId: req.staff?.id, revokedAt: null },
          orderBy: { issuedAt: "desc" },
          // Never the tokenHash: it is not needed to manage a session, and a
          // list endpoint is not a place to hand one out.
          select: {
            id: true,
            issuedAt: true,
            expiresAt: true,
            ip: true,
            userAgent: true,
          },
        });
        res.json({
          sessions: sessions.map((s) => ({
            ...s,
            current: s.id === req.sessionId,
          })),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  /** Revoke one — "log this other device out". */
  router.delete("/sessions/:id", auth, idempotent, (req, res, next) => {
    void (async () => {
      try {
        const parsed = revokeParams.safeParse(req.params);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Id sesi tidak valid.", {
              field: "id",
            }),
          );
          return;
        }

        // Scoped to the caller's own sessions: a staff member cannot revoke
        // someone else's by guessing an id.
        const result = await db.staffSession.updateMany({
          where: {
            id: parsed.data.id,
            staffId: req.staff?.id,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        if (result.count === 0) {
          next(notFound("Sesi"));
          return;
        }
        if (parsed.data.id === req.sessionId)
          res.clearCookie(config.cookieName, { path: "/" });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  });

  /** Revoke all — §9's "real log out everywhere", including this device. */
  router.delete("/sessions", auth, idempotent, (req, res, next) => {
    void (async () => {
      try {
        if (req.staff === undefined) {
          next(unauthenticated());
          return;
        }
        const result = await db.staffSession.updateMany({
          where: { staffId: req.staff.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        res.clearCookie(config.cookieName, { path: "/" });
        res.json({ revoked: result.count });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
