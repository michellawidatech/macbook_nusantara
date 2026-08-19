/**
 * Auth0 — the hosted identity provider.
 *
 * The Auth0 application is a **Regular Web Application**: a confidential
 * client, holding a secret, doing the Authorization Code exchange server-side.
 * In this repo that role belongs to the API, not the SPA — the browser never
 * sees the client secret, and the session stays a server-side cookie exactly
 * as it is today (08 §9).
 *
 * The browser only ever sees the SPA's origin (`:3000`): Vite proxies
 * `/auth/*` here in development, and one nginx does the same in production, so
 * the Auth0 **Callback URL is `:3000/auth/callback`** and the session cookie is
 * same-origin exactly as it already is for `/api`.
 *
 * Auth0 answers "which Auth0 user is this". It does not answer "which `Staff`
 * row is this", which is what `role`, `canApprove` and every `UnitEvent.staffId`
 * are attributed to. `resolveStaff` below is that bridge, and `startSession`
 * turns the result into the app's own session cookie — so `requireAuth`, the
 * session list, "log out everywhere" and audit attribution all keep working
 * without knowing Auth0 exists.
 *
 * Nothing here reads `process.env` (01 §7) — `index.ts` passes the values in.
 */

import { auth } from "express-openid-connect";
import type { RequestHandler } from "express";
import type { Prisma, PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { hashSessionToken, newSessionToken } from "./credentials.js";

/**
 * The keys the API accepts for Auth0, in one place so `secretsFile.ts` and
 * `.env.example` cannot drift apart from each other.
 *
 * `AUTH0_BASE_URL` is deliberately **not** the quickstart's `APP_BASE_URL`:
 * that name reads as "where the app lives", and here the answer differs
 * between the SPA (:3000) and the client doing the OIDC exchange (:4000).
 * Registering :3000 as the callback is the single most likely way to get a
 * callback mismatch, so the name says which one it means.
 */
export const AUTH0_ENV_KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "AUTH0_BASE_URL",
] as const;

export interface Auth0Config {
  /** Tenant domain, e.g. `dev-xxxx.us.auth0.com` — no scheme. */
  readonly domain: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Encrypts the session cookie. 32+ bytes; `openssl rand -hex 32`. */
  readonly secret: string;
  /** This API's public origin. Must match the Auth0 Callback URL. */
  readonly baseUrl: string;
}

/**
 * Read the Auth0 credentials, or report that they are absent.
 *
 * Fail-closed and all-or-nothing: a half-configured client is worse than an
 * unconfigured one, because it fails at the redirect — after the staff member
 * has already been sent to Auth0 — instead of at startup where somebody sees
 * it. `undefined` means "do not mount Auth0 at all", and the API keeps
 * behaving exactly as it did before.
 */
export function readAuth0Env(
  env: Record<string, string | undefined>,
): Auth0Config | undefined {
  const value = (key: (typeof AUTH0_ENV_KEYS)[number]): string | undefined => {
    const raw = env[key];
    return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
  };

  const domain = value("AUTH0_DOMAIN");
  const clientId = value("AUTH0_CLIENT_ID");
  const clientSecret = value("AUTH0_CLIENT_SECRET");
  const secret = value("AUTH0_SECRET");
  const baseUrl = value("AUTH0_BASE_URL");

  if (
    domain === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    secret === undefined ||
    baseUrl === undefined
  ) {
    return undefined;
  }

  // Tolerate a pasted `https://dev-xxx.us.auth0.com/`: the dashboard shows the
  // domain with a scheme in some places and without it in others.
  return {
    domain: domain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    clientId,
    clientSecret,
    secret,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
}

export interface Auth0MiddlewareDeps {
  readonly auth0: Auth0Config;
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** 01 §4 names the cookie; the same one `requireAuth` reads. */
  readonly cookieName: string;
  /** 08 §9's absolute session lifetime, mirrored onto the Auth0 session. */
  readonly sessionTtlMs: number;
  /**
   * The SPA's origin — where the browser belongs before and after.
   *
   * Both ends of the round trip need it. The SDK's built-in `/login` defaults
   * `returnTo` to its own `baseURL`, which here is the API: without this, a
   * staff member finishing login lands on :4000 looking at a JSON 404 instead
   * of back in the app.
   */
  readonly spaOrigin: string;
  readonly cookieSecure: boolean;
}

/**
 * The SDK's middleware, mounted app-wide.
 *
 * It serves `/login`, `/logout` and `/callback`, and populates `req.oidc` on
 * every other request. It does **not** guard anything: `authRequired` is off,
 * so mounting this changes no existing route's behaviour. The API's own
 * `requireAuth` remains the only thing standing in front of `/api`.
 */
export function auth0Middleware(deps: Auth0MiddlewareDeps): RequestHandler {
  const {
    auth0,
    db,
    logger,
    cookieName,
    sessionTtlMs,
    spaOrigin,
    cookieSecure,
  } = deps;

  return auth({
    issuerBaseURL: `https://${auth0.domain}`,
    baseURL: auth0.baseUrl,
    clientID: auth0.clientId,
    clientSecret: auth0.clientSecret,
    secret: auth0.secret,

    // The application is configured for `client_secret_post`. The SDK defaults
    // to `client_secret_basic`, and the mismatch surfaces as a 401 from the
    // token endpoint *after* a successful login — the most confusing possible
    // place. Set explicitly so the two cannot drift.
    clientAuthMethod: "client_secret_post",

    // A confidential client can use the code flow with a secret; this asks
    // Auth0 for an ID token via the back channel rather than the URL.
    authorizationParams: {
      response_type: "code",
      scope: "openid profile email",
    },

    // Off, deliberately. This middleware is mounted app-wide so `req.oidc` is
    // available everywhere; turning it on would put a login redirect in front
    // of every existing route, including /api/health and the whole SPA-facing
    // API, which is precisely the disruption this integration must avoid.
    authRequired: false,

    // 08 §9: "sessions expire absolutely, not on idle." The SDK's default is a
    // rolling 1-day idle window inside a 7-day cap; both are wrong here, and
    // the 12-hour absolute lifetime is a settled decision.
    session: {
      rolling: false,
      absoluteDuration: Math.floor(sessionTtlMs / 1000),
      cookie: {
        httpOnly: true,
        sameSite: "Lax",
        secure: cookieSecure,
      },
    },

    // Ends the Auth0 session too, not just this app's cookie. The shop runs
    // ~3 staff on shared hardware: without this, "log out" leaves the tenant's
    // SSO cookie behind and the next person to click Login is silently signed
    // straight back in as whoever used the terminal last.
    idpLogout: true,

    // Auth0 has vouched for the identity; turn that into a staff member and a
    // session this app already knows how to check. Throwing here fails the
    // login closed — a deactivated account gets an error, never a cookie.
    afterCallback: async (req, res, session) => {
      const claims = decodeIdToken(session.id_token);
      const staff = await resolveStaff({ db, logger }, claims);
      await startSession(
        { db, logger, cookieName, sessionTtlMs, cookieSecure },
        staff,
        req,
        res,
      );
      logger.info(
        { evt: "auth.login", ctx: { staffId: staff.id, via: "auth0" } },
        "login berhasil",
      );
      return session;
    },

    // Send the browser back to the SPA, not to this API. The value is composed
    // here rather than taken from the request, so it is not an open redirect:
    // it travels in the signed transaction state, and nothing a caller sends
    // can influence it.
    getLoginState: (_req, options) => ({
      returnTo: options.returnTo ?? spaOrigin,
    }),

    routes: {
      // Namespaced, and matching the Next.js SDK's names. `/login` alone would
      // collide with the SPA's own login route once Vite proxies these through
      // (apps/web/vite.config.ts), and `/api/auth/*` is the hand-rolled
      // router that still serves password login.
      login: "/auth/login",
      logout: "/auth/logout",
      callback: "/auth/callback",
      // Register this exact value as an Allowed Logout URL in Auth0.
      postLogoutRedirect: spaOrigin,
    },
  });
}

/**
 * A password that can never be verified.
 *
 * An Auth0-linked account has no local password, and the column is not
 * nullable. `verifyPassword` returns false on a malformed hash rather than
 * throwing (auth/credentials.ts), so this fails every password login closed
 * while staying obvious to anyone reading the table.
 */
const NO_LOCAL_PASSWORD = "auth0:no-local-password";

/**
 * A `Staff` row. Derived rather than imported: `@nusantara/db` re-exports the
 * client and the `Prisma` namespace, not the generated model types.
 */
type Staff = Prisma.StaffGetPayload<object>;

/** The ID token claims this app uses. Everything else is ignored. */
interface Auth0Claims {
  readonly sub: string;
  readonly email?: string;
  readonly name?: string;
}

/**
 * Read the claims out of an ID token.
 *
 * Safe to decode without verifying: the SDK has already validated the
 * signature, issuer, audience and nonce before `afterCallback` runs, and this
 * is called from nowhere else.
 */
function decodeIdToken(idToken: string): Auth0Claims {
  const payload = idToken.split(".")[1];
  if (payload === undefined) throw new Error("ID token tanpa payload");
  const json: unknown = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );
  if (typeof json !== "object" || json === null)
    throw new Error("ID token payload bukan objek");

  const claims = json as Record<string, unknown>;
  const sub = claims["sub"];
  if (typeof sub !== "string" || sub === "")
    throw new Error("ID token tanpa sub");

  return {
    sub,
    email: typeof claims["email"] === "string" ? claims["email"] : undefined,
    name: typeof claims["name"] === "string" ? claims["name"] : undefined,
  };
}

export interface ResolveStaffDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
}

/**
 * Find the `Staff` row behind an Auth0 identity, creating one if this is a
 * first login.
 *
 * Three steps, in order:
 *
 * 1. **Already linked** — `auth0Sub` matches. The normal path.
 * 2. **Adopt by username** — an existing account whose `username` is this
 *    email gets linked to it. This is how a pre-Auth0 account keeps its id,
 *    its role and every row already attributed to it, instead of being
 *    shadowed by a duplicate.
 * 3. **Provision** — a new `STAFF` account, per the owner's instruction that
 *    the default is Staff and it can do everything.
 *
 * A deactivated account is refused rather than reactivated: `active = false`
 * is how this shop revokes access, and a successful Auth0 login must not undo
 * it. `requireAuth` enforces the same rule on every later request.
 */
export async function resolveStaff(
  deps: ResolveStaffDeps,
  claims: Auth0Claims,
): Promise<Staff> {
  const { db, logger } = deps;

  const linked = await db.staff.findUnique({
    where: { auth0Sub: claims.sub },
  });
  if (linked !== null) {
    if (!linked.active) throw new Error("akun dinonaktifkan");
    return linked;
  }

  if (claims.email !== undefined) {
    const existing = await db.staff.findUnique({
      where: { username: claims.email },
    });
    if (existing !== null) {
      if (!existing.active) throw new Error("akun dinonaktifkan");
      logger.info(
        {
          evt: "auth0.staff.linked",
          ctx: { staffId: existing.id, sub: claims.sub },
        },
        "akun staf lama ditautkan ke Auth0",
      );
      return db.staff.update({
        where: { id: existing.id },
        data: { auth0Sub: claims.sub },
      });
    }
  }

  // The username still has to be unique and non-empty; the sub is the only
  // claim guaranteed to be both.
  const username = claims.email ?? claims.sub;
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    const staff = await tx.staff.create({
      data: {
        username,
        name: claims.name ?? username,
        role: "STAFF",
        canApprove: true,
        active: true,
        passwordHash: NO_LOCAL_PASSWORD,
        auth0Sub: claims.sub,
        createdAt: now,
      },
    });

    // 08 §9: an account coming into existence is auditable. `staffId` is the
    // new row itself — nobody else acted, and leaving it null would lose the
    // only fact worth recording.
    await tx.auditLog.create({
      data: {
        at: now,
        staffId: staff.id,
        entity: "Staff",
        entityId: staff.id,
        action: "CREATE",
        field: "auth0Sub",
      },
    });

    return staff;
  });

  logger.warn(
    {
      evt: "auth0.staff.provisioned",
      ctx: { staffId: created.id, username, sub: claims.sub },
    },
    "akun staf baru dibuat dari login Auth0",
  );
  return created;
}

export interface StartSessionDeps extends ResolveStaffDeps {
  readonly cookieName: string;
  readonly sessionTtlMs: number;
  readonly cookieSecure: boolean;
}

/**
 * Issue the app's own session for a staff member Auth0 has just vouched for.
 *
 * Deliberately the *same* `StaffSession` row and the *same* cookie that
 * `/api/auth/login` writes. Auth0 replaces the question "is this really them";
 * it does not replace this app's session, so `requireAuth`, `GET /sessions`,
 * "log out everywhere" and every audit trail keep working untouched.
 */
async function startSession(
  deps: StartSessionDeps,
  staff: Staff,
  req: { ip?: string; get(header: string): string | undefined },
  res: { cookie(name: string, value: string, options: object): unknown },
): Promise<void> {
  const { db, cookieName, sessionTtlMs, cookieSecure } = deps;

  const raw = newSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs);

  await db.$transaction([
    db.staffSession.create({
      data: {
        staffId: staff.id,
        tokenHash: hashSessionToken(raw),
        issuedAt: now,
        expiresAt,
        ip: req.ip ?? "unknown",
        userAgent: req.get("user-agent") ?? null,
      },
    }),
    db.staff.update({
      where: { id: staff.id },
      data: { lastLoginAt: now },
    }),
  ]);

  // The raw token exists here and in the cookie. Nowhere else, ever.
  res.cookie(cookieName, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    expires: expiresAt,
    path: "/",
  });
}

/**
 * Revoke this app's session on the way into Auth0's `/logout`.
 *
 * Mounted *before* the SDK so it runs first and then falls through: the SDK
 * ends the Auth0 session and redirects, and without this the `StaffSession`
 * row would stay live and its cookie would still open the API. Failing to
 * revoke must not block the logout, so an error here is logged and swallowed —
 * the cookie is cleared either way.
 */
export function auth0LogoutCleanup(deps: {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly cookieName: string;
}): RequestHandler {
  const { db, logger, cookieName } = deps;

  return (req, res, next) => {
    void (async () => {
      const raw = (req.cookies as Record<string, unknown> | undefined)?.[
        cookieName
      ];
      if (typeof raw === "string" && raw !== "") {
        try {
          await db.staffSession.updateMany({
            where: { tokenHash: hashSessionToken(raw), revokedAt: null },
            data: { revokedAt: new Date() },
          });
        } catch (error) {
          logger.error(
            { evt: "auth0.logout.revokeFailed", err: error },
            "sesi lokal gagal dicabut saat logout",
          );
        }
      }
      res.clearCookie(cookieName, { path: "/" });
      next();
    })();
  };
}
