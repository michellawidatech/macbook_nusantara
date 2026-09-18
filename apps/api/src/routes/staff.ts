/**
 * /api/staff — the owner's account screen (owner ask 2026-09-18: "Ersen can
 * manage all the password account").
 *
 * List, create, edit, deactivate, and reset a password back to the shop's
 * initial one. Owner-only by the guard passed in at the mount (08 §9 puts
 * "staff management" on the owner's list), and server-side per endpoint: the
 * SPA hiding the tab is a courtesy.
 *
 * What this router deliberately cannot do:
 *
 *  - **Delete** an account. A `Staff` row is named by every UnitEvent, sale and
 *    audit row that person ever wrote (CLAUDE.md: nothing is hard-deleted).
 *    Deactivating ends every session at once — `requireAuth` checks `active`
 *    on each request — and keeps the history attributable.
 *  - **See or set anyone's password.** A reset puts the account back on the
 *    shop's initial password with `mustChangePassword`, so the person chooses
 *    their own at the next sign-in. The owner never learns it, and nothing here
 *    ever returns a hash.
 *  - **Touch a service account** (the chat agent, the system row, the B2Soft
 *    import's author). A password on one of those would be a login carrying the
 *    agent's authority; they are not even listed.
 *  - **Lock the shop out of itself.** The last active owner cannot be demoted
 *    or deactivated, and nobody can demote or deactivate themselves — the
 *    classic way a one-owner shop loses its only admin is one mis-tap.
 */

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import {
  isServiceAccount,
  SERVICE_ACCOUNT_USERNAMES,
  UNUSABLE_PASSWORD_HASH,
  type PrismaClient,
} from "@nusantara/db";
import { INITIAL_PASSWORD, USERNAME_PATTERN } from "@nusantara/domain";
import type { Logger } from "@nusantara/logging";
import { ApiError, notFound } from "../errors.js";
import { hashPassword } from "../auth/credentials.js";
import type { AuthenticatedStaff } from "../auth/middleware.js";
import type { LoginLimiter } from "../auth/rateLimit.js";

export interface StaffRouterDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly limiter: LoginLimiter;
  /** Passed in so the mount says who may reach this (see routes/kontrol.ts). */
  readonly requireOwner: RequestHandler;
}

const ROLES = ["OWNER", "STAFF"] as const;

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, "Nama pengguna tidak valid."),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES).default("STAFF"),
  canApprove: z.boolean().optional(),
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.enum(ROLES).optional(),
    canApprove: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, "Tidak ada yang diubah.");

const idParams = z.object({ id: z.string().min(1).max(64) });

/** What the owner's table shows. Never the hash — only whether one is usable. */
const LIST_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  canApprove: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  passwordHash: true,
} as const;

type ListedRow = {
  id: string;
  username: string;
  name: string;
  role: "OWNER" | "STAFF";
  canApprove: boolean;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  passwordHash: string;
};

/**
 * The row as the owner sees it. `hasPassword` is false for an account that has
 * never been given one (the seed's placeholder, or a leftover Auth0-only
 * account): it cannot sign in until the owner resets it.
 */
function present(row: ListedRow) {
  const { passwordHash, ...rest } = row;
  return {
    ...rest,
    hasPassword:
      passwordHash !== UNUSABLE_PASSWORD_HASH &&
      passwordHash.startsWith("$argon2"),
  };
}

export function staffRouter(deps: StaffRouterDeps): Router {
  const { db, logger, limiter, requireOwner } = deps;
  const router = Router();
  router.use(requireOwner);

  const reject = (message: string, field?: string) =>
    new ApiError(400, "VALIDASI", message, field ? { field } : {});

  router.get("/", (_req, res, next) => {
    void (async () => {
      try {
        const rows = await db.staff.findMany({
          where: { username: { notIn: [...SERVICE_ACCOUNT_USERNAMES] } },
          select: LIST_SELECT,
          orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
        });
        res.json({ accounts: rows.map(present) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post("/", (req, res, next) => {
    void (async () => {
      try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          const field = String(parsed.error.issues[0]?.path[0] ?? "username");
          next(
            reject(
              field === "username"
                ? "Nama pengguna 2–32 karakter: huruf kecil, angka, titik, garis bawah atau tanda hubung, diawali huruf atau angka."
                : "Data akun tidak valid.",
              field,
            ),
          );
          return;
        }
        const { username, name, role } = parsed.data;
        if (isServiceAccount(username)) {
          next(reject("Nama pengguna ini dipakai sistem.", "username"));
          return;
        }
        const taken = await db.staff.findUnique({
          where: { username },
          select: { id: true },
        });
        if (taken !== null) {
          next(
            new ApiError(409, "KONFLIK", "Nama pengguna sudah dipakai.", {
              field: "username",
            }),
          );
          return;
        }

        const me = req.staff as AuthenticatedStaff;
        const passwordHash = await hashPassword(INITIAL_PASSWORD);
        const now = new Date();
        const created = await db.$transaction(async (tx) => {
          const row = await tx.staff.create({
            data: {
              username,
              name,
              role,
              // An owner who cannot approve is a contradiction (03 §Settings,
              // and the staff CLI has always forced it the same way).
              canApprove: role === "OWNER" || (parsed.data.canApprove ?? false),
              active: true,
              passwordHash,
              mustChangePassword: true,
              createdAt: now,
            },
            select: LIST_SELECT,
          });
          await tx.auditLog.create({
            data: {
              at: now,
              staffId: me.id,
              entity: "Staff",
              entityId: row.id,
              action: "CREATE",
              after: `${row.username} ${row.role}`,
              requestId: req.get("x-request-id") ?? null,
              ip: req.ip ?? null,
            },
          });
          return row;
        });
        logger.info(
          { evt: "staff.created", ctx: { staffId: created.id, by: me.id } },
          "akun staf dibuat",
        );
        res.status(201).json({ account: present(created) });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.patch("/:id", (req, res, next) => {
    void (async () => {
      try {
        const params = idParams.safeParse(req.params);
        const parsed = patchSchema.safeParse(req.body);
        if (!params.success || !parsed.success) {
          next(reject("Data akun tidak valid."));
          return;
        }
        const me = req.staff as AuthenticatedStaff;
        const id = params.data.id;
        const patch = parsed.data;

        const target = await db.staff.findUnique({
          where: { id },
          select: LIST_SELECT,
        });
        if (target === null || isServiceAccount(target.username)) {
          next(notFound("Akun"));
          return;
        }

        const demotes = patch.role === "STAFF" && target.role === "OWNER";
        const deactivates = patch.active === false && target.active;
        if (id === me.id && (demotes || deactivates)) {
          next(
            reject(
              "Anda tidak bisa menonaktifkan atau menurunkan akun Anda sendiri.",
              demotes ? "role" : "active",
            ),
          );
          return;
        }
        if ((demotes || deactivates) && target.role === "OWNER") {
          const owners = await db.staff.count({
            where: { role: "OWNER", active: true, id: { not: id } },
          });
          if (owners === 0) {
            next(
              reject(
                "Ini satu-satunya pemilik yang aktif. Jadikan orang lain pemilik dulu.",
                demotes ? "role" : "active",
              ),
            );
            return;
          }
        }

        const role = patch.role ?? target.role;
        const data = {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          ...(patch.canApprove !== undefined || patch.role !== undefined
            ? {
                canApprove:
                  role === "OWNER" || (patch.canApprove ?? target.canApprove),
              }
            : {}),
        };

        const now = new Date();
        const updated = await db.$transaction(async (tx) => {
          const row = await tx.staff.update({
            where: { id },
            data,
            select: LIST_SELECT,
          });
          // Deactivated means out now, not at the session's expiry. requireAuth
          // already refuses an inactive account per request; revoking as well
          // keeps the sessions list honest.
          if (deactivates) {
            await tx.staffSession.updateMany({
              where: { staffId: id, revokedAt: null },
              data: { revokedAt: now },
            });
          }
          // One audit row per field that actually moved, with both values —
          // none of these are secrets.
          const moved = (
            [
              ["name", target.name, row.name],
              ["role", target.role, row.role],
              ["canApprove", String(target.canApprove), String(row.canApprove)],
              ["active", String(target.active), String(row.active)],
            ] as const
          ).filter(([, before, after]) => before !== after);
          for (const [field, before, after] of moved) {
            await tx.auditLog.create({
              data: {
                at: now,
                staffId: me.id,
                entity: "Staff",
                entityId: id,
                action:
                  field === "active" && after === "false"
                    ? "ARCHIVE"
                    : "UPDATE",
                field,
                before,
                after,
                requestId: req.get("x-request-id") ?? null,
                ip: req.ip ?? null,
              },
            });
          }
          return row;
        });
        res.json({ account: present(updated) });
      } catch (error) {
        next(error);
      }
    })();
  });

  /**
   * Put an account back on the shop's initial password.
   *
   * Every session of it ends in the same transaction, so whoever was signed in
   * as it — the forgetful owner of the account or somebody else — is out, and
   * the next sign-in has to choose a new password. The login throttle on that
   * username is forgotten too: a person locked out by their own typos should
   * not wait five minutes after the owner has already vouched for them.
   *
   * Not for your own account — that is Change password, which asks for the
   * current one. An owner who has forgotten their own uses the staff CLI on
   * the server, which is the one door that does not need a session.
   */
  router.post("/:id/reset-password", (req, res, next) => {
    void (async () => {
      try {
        const params = idParams.safeParse(req.params);
        if (!params.success) {
          next(reject("Id akun tidak valid."));
          return;
        }
        const me = req.staff as AuthenticatedStaff;
        const id = params.data.id;
        if (id === me.id) {
          next(
            reject("Untuk akun Anda sendiri, pakai Ganti kata sandi.", "id"),
          );
          return;
        }
        const target = await db.staff.findUnique({
          where: { id },
          select: { id: true, username: true },
        });
        if (target === null || isServiceAccount(target.username)) {
          next(notFound("Akun"));
          return;
        }

        const passwordHash = await hashPassword(INITIAL_PASSWORD);
        const now = new Date();
        const updated = await db.$transaction(async (tx) => {
          const row = await tx.staff.update({
            where: { id },
            data: { passwordHash, mustChangePassword: true },
            select: LIST_SELECT,
          });
          await tx.staffSession.updateMany({
            where: { staffId: id, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.auditLog.create({
            data: {
              at: now,
              staffId: me.id,
              entity: "Staff",
              entityId: id,
              action: "UPDATE",
              field: "passwordHash",
              after: "RESET",
              requestId: req.get("x-request-id") ?? null,
              ip: req.ip ?? null,
            },
          });
          return row;
        });
        limiter.clearUser(target.username);
        logger.info(
          { evt: "staff.password.reset", ctx: { staffId: id, by: me.id } },
          "kata sandi akun direset",
        );
        res.json({ account: present(updated) });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
