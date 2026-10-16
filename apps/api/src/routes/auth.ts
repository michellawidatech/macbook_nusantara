/**
 * /api/auth — sign in, sign out, who am I, change my password, my sessions.
 *
 * docs/rebuild/01-conventions.md §4 and 08-data-integrity.md §9. Handlers are
 * thin: validate with Zod `safeParse` → call Prisma → return.
 *
 * Since 2026-09-18 this router is the ONLY way in: Auth0 was retired for the
 * app's own login (owner ask). Every account starts on the shop's initial
 * password with `mustChangePassword` set, and `POST /password` is the one
 * mutation such a session may make — `requirePasswordChanged` in app.ts turns
 * everything mounted after this router away until it has.
 */

import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import type { PrismaClient, Tx } from "@nusantara/db";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  type PasswordProblem,
} from "@nusantara/domain";
import type { Logger } from "@nusantara/logging";
import type { ApiConfig } from "../config.js";
import { ApiError, notFound, unauthenticated } from "../errors.js";
import {
  hashPassword,
  hashSessionToken,
  newSessionToken,
  verifyPassword,
} from "../auth/credentials.js";
import { requireAuth, type AuthenticatedStaff } from "../auth/middleware.js";
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
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * The bounds here are only what the parser needs to stay cheap; what a new
 * password may BE is `passwordProblem`, the same function the SPA's form runs.
 */
const changeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z
    .string()
    .min(1)
    .max(PASSWORD_MAX_LENGTH * 4),
});

const revokeParams = z.object({ id: z.string().min(1).max(64) });

/** The shape every endpoint here answers with. Never the hash. */
export const STAFF_PUBLIC_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  canApprove: true,
  canViewFinance: true,
  mustChangePassword: true,
} as const;

/**
 * Why a new password was refused, for the cashier's screen. The SPA shows its
 * own bilingual copy from the same `passwordProblem`; this is what an older
 * client, or anybody calling the API directly, reads.
 */
export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  TOO_SHORT: `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`,
  TOO_LONG: `Kata sandi maksimal ${PASSWORD_MAX_LENGTH} karakter.`,
  INITIAL:
    "Kata sandi awal toko tidak boleh dipakai lagi. Pilih kata sandi baru.",
  HAS_USERNAME: "Kata sandi tidak boleh memuat nama pengguna.",
  TOO_COMMON: "Kata sandi ini terlalu mudah ditebak. Pilih yang lain.",
};

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

/**
 * Open a session for `staffId` inside `tx`. The raw token is returned to be put
 * in the cookie and nowhere else, ever; the database keeps its SHA-256.
 */
async function openSession(
  tx: Tx,
  config: ApiConfig,
  staffId: string,
  req: Request,
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = newSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlMs);
  await tx.staffSession.create({
    data: {
      staffId,
      tokenHash: hashSessionToken(raw),
      issuedAt: now,
      expiresAt,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    },
  });
  return { raw, expiresAt };
}

function setSessionCookie(
  res: Response,
  config: ApiConfig,
  raw: string,
  expiresAt: Date,
): void {
  res.cookie(config.cookieName, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    expires: expiresAt,
    path: "/",
  });
}

/**
 * Find the account a sign-in names.
 *
 * Exact first. Then, only if that misses, the lower-cased form: a phone
 * keyboard capitalises the first letter of a field, and "Ersen" failing to
 * sign in as `ersen` is a support call rather than a security property —
 * usernames the app issues are lower-case (`USERNAME_PATTERN`), and the
 * lower-cased spelling is still one exact, unique lookup.
 */
async function findForLogin(db: PrismaClient, username: string) {
  const exact = await db.staff.findUnique({ where: { username } });
  if (exact !== null) return exact;
  const folded = username.toLowerCase();
  return folded === username
    ? null
    : db.staff.findUnique({ where: { username: folded } });
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

        // The limiter's map is tiny (three staff, a handful of addresses), but
        // nothing else ever empties it.
        limiter.sweep();
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

        const staff = await findForLogin(db, username);

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

        const now = new Date();
        const session = await db.$transaction(async (tx) => {
          const opened = await openSession(tx, config, staff.id, req);
          await tx.staff.update({
            where: { id: staff.id },
            data: { lastLoginAt: now },
          });
          // A success is audited too: "who signed in as the owner at 23:40" is
          // the first question after anything goes missing.
          await tx.auditLog.create({
            data: {
              at: now,
              staffId: staff.id,
              entity: "Staff",
              entityId: staff.id,
              action: "LOGIN",
              requestId: req.get("x-request-id") ?? null,
              ip,
            },
          });
          return opened;
        });

        setSessionCookie(res, config, session.raw, session.expiresAt);

        logger.info(
          {
            evt: "auth.login",
            ctx: {
              staffId: staff.id,
              mustChangePassword: staff.mustChangePassword,
            },
          },
          "login berhasil",
        );

        res.status(200).json({
          staff: {
            id: staff.id,
            username: staff.username,
            name: staff.name,
            role: staff.role,
            canApprove: staff.canApprove,
            canViewFinance: staff.canViewFinance,
            mustChangePassword: staff.mustChangePassword,
          },
          expiresAt: session.expiresAt,
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

  /**
   * Choose a new password — the one thing a first sign-in may do.
   *
   * Asks for the current password even on a fresh session: a session is a
   * cookie on a shared shop PC, and a cookie alone must not be enough to lock
   * its owner out. A wrong one is throttled exactly like a wrong sign-in.
   *
   * On success every session of the account is revoked, this one included, and
   * a new one is issued in the same transaction — 08 §9's "rotate the token on
   * privilege change". Whoever else knew the old password is signed out
   * everywhere; the person who changed it carries on without noticing.
   */
  router.post("/password", auth, (req, res, next) => {
    void (async () => {
      try {
        const me = req.staff as AuthenticatedStaff;
        const parsed = changeSchema.safeParse(req.body);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Kata sandi wajib diisi.", {
              field: String(
                parsed.error.issues[0]?.path[0] ?? "currentPassword",
              ),
            }),
          );
          return;
        }
        const { currentPassword, newPassword } = parsed.data;
        const ip = clientIp(req.ip);

        const decision = limiter.check(me.username, ip);
        if (!decision.allowed) {
          next(
            new ApiError(
              429,
              "TERLALU_BANYAK",
              `Terlalu banyak percobaan. Coba lagi dalam ${decision.retryAfter} detik.`,
              { retryAfter: decision.retryAfter },
            ),
          );
          return;
        }

        const row = await db.staff.findUnique({
          where: { id: me.id },
          select: { passwordHash: true },
        });
        if (row === null) {
          next(unauthenticated());
          return;
        }

        if (!(await verifyPassword(row.passwordHash, currentPassword))) {
          limiter.recordFailure(me.username, ip);
          await db.auditLog.create({
            data: {
              at: new Date(),
              staffId: me.id,
              entity: "Staff",
              entityId: me.id,
              action: "LOGIN_GAGAL",
              field: "passwordHash",
              requestId: req.get("x-request-id") ?? null,
              ip,
            },
          });
          // 400, not 401: the session is fine, and a 401 would send the SPA
          // back to the sign-in screen mid-sentence.
          next(
            new ApiError(400, "VALIDASI", "Kata sandi sekarang salah.", {
              field: "currentPassword",
            }),
          );
          return;
        }

        const problem = passwordProblem(newPassword, me.username);
        if (problem !== null) {
          next(
            new ApiError(400, "VALIDASI", PASSWORD_PROBLEM_MESSAGE[problem], {
              field: "newPassword",
            }),
          );
          return;
        }
        if (newPassword === currentPassword) {
          next(
            new ApiError(
              400,
              "VALIDASI",
              "Kata sandi baru harus berbeda dari yang sekarang.",
              { field: "newPassword" },
            ),
          );
          return;
        }

        // Outside the transaction: Argon2id is deliberate work and has no
        // business holding a row lock.
        const passwordHash = await hashPassword(newPassword);
        const now = new Date();

        const { staff, session } = await db.$transaction(async (tx) => {
          const staff = await tx.staff.update({
            where: { id: me.id },
            data: { passwordHash, mustChangePassword: false },
            select: STAFF_PUBLIC_SELECT,
          });
          await tx.staffSession.updateMany({
            where: { staffId: me.id, revokedAt: null },
            data: { revokedAt: now },
          });
          const session = await openSession(tx, config, me.id, req);
          // Never the hash, before or after: the audit log says THAT it
          // changed and who did it, which is all anybody needs from it.
          await tx.auditLog.create({
            data: {
              at: now,
              staffId: me.id,
              entity: "Staff",
              entityId: me.id,
              action: "UPDATE",
              field: "passwordHash",
              requestId: req.get("x-request-id") ?? null,
              ip,
            },
          });
          return { staff, session };
        });

        limiter.recordSuccess(me.username, ip);
        setSessionCookie(res, config, session.raw, session.expiresAt);
        logger.info(
          { evt: "auth.password.changed", ctx: { staffId: me.id } },
          "kata sandi diganti",
        );
        res.json({ staff, expiresAt: session.expiresAt });
      } catch (error) {
        next(error);
      }
    })();
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
