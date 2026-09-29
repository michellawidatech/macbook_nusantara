/**
 * Authentication and authorisation — docs/rebuild/08-data-integrity.md §9.
 *
 * "Checked **server-side, per endpoint**, from `Role` + `canApprove`. The SPA
 * hiding a button is a UX affordance, never a control."
 */

import type { RequestHandler } from "express";
import type { PrismaClient } from "@nusantara/db";
import { type Logger, setStaffId } from "@nusantara/logging";
import type { ApiConfig } from "../config.js";
import { ApiError, forbidden, unauthenticated } from "../errors.js";
import { hashSessionToken } from "./credentials.js";

export interface AuthenticatedStaff {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: "OWNER" | "STAFF";
  readonly canApprove: boolean;
  /**
   * Still on a password somebody else chose. `requirePasswordChanged` turns
   * every business route away until it is false.
   */
  readonly mustChangePassword: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    staff?: AuthenticatedStaff;
    sessionId?: string;
  }
}

export interface AuthDeps {
  readonly db: PrismaClient;
  readonly config: ApiConfig;
}

/**
 * Resolve the cookie to a live session, or reject.
 *
 * A session is live only if it has not been revoked, has not passed its
 * absolute expiry, and belongs to a staff row that is still active — a
 * deactivated account loses its existing sessions immediately, not at expiry.
 */
export function requireAuth({ db, config }: AuthDeps): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        const raw = (req.cookies as Record<string, unknown> | undefined)?.[
          config.cookieName
        ];
        if (typeof raw !== "string" || raw === "") {
          next(unauthenticated());
          return;
        }

        const session = await db.staffSession.findUnique({
          where: { tokenHash: hashSessionToken(raw) },
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            staff: {
              select: {
                id: true,
                username: true,
                name: true,
                role: true,
                canApprove: true,
                active: true,
                mustChangePassword: true,
              },
            },
          },
        });

        if (
          session === null ||
          session.revokedAt !== null ||
          session.expiresAt <= new Date() ||
          !session.staff.active
        ) {
          next(unauthenticated());
          return;
        }

        req.staff = {
          id: session.staff.id,
          username: session.staff.username,
          name: session.staff.name,
          role: session.staff.role,
          canApprove: session.staff.canApprove,
          mustChangePassword: session.staff.mustChangePassword,
        };
        req.sessionId = session.id;

        // From here every log line in this request carries sid (05 §2).
        setStaffId(session.staff.id);
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/**
 * The first sign-in gate (owner ask 2026-09-18).
 *
 * An account on the shop's initial password — or on one an owner set while
 * resetting it — is known to more people than its owner. Such a session may
 * read who it is and choose a new password (both live on the auth router,
 * mounted before this) and nothing else: every other route answers
 * 403 GANTI_SANDI, which the SPA reads as "show the change-password screen".
 *
 * Server-side, per request, from the row `requireAuth` just read — the SPA
 * showing that screen is a courtesy, never the control (08 §9).
 */
export function requirePasswordChanged(): RequestHandler {
  return (req, _res, next) => {
    if (req.staff?.mustChangePassword === true) {
      next(
        new ApiError(
          403,
          "GANTI_SANDI",
          "Ganti kata sandi Anda dulu sebelum melanjutkan.",
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Owner-only. §9 lists what this guards: price approval, discounts, staff
 * management, reports, opname posting, credential settings, data export.
 *
 * Every denial is logged with the staff id and the target, because "repeated
 * denials are the earliest signal of a compromised or curious account" (§9).
 */
export function requireOwner(logger: Logger): RequestHandler {
  return (req, _res, next) => {
    if (req.staff === undefined) {
      next(unauthenticated());
      return;
    }
    if (req.staff.role !== "OWNER") {
      logger.warn(
        {
          evt: "authz.denied",
          ctx: {
            staffId: req.staff.id,
            role: req.staff.role,
            target: req.originalUrl,
          },
        },
        "akses ditolak",
      );
      next(forbidden());
      return;
    }
    next();
  };
}
