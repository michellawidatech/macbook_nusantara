/**
 * /api/kontrol — the owner's read-only window onto the audit log.
 *
 * This replaces a stub. The route existed since S6 and answered
 * `{ entries: [] }` unconditionally, which made the owner-only guard provable
 * (a non-owner got a 403) while the body itself was a lie: three call sites
 * have been writing `AuditLog` rows all along — password login
 * (routes/auth.ts), Auth0 login (auth/auth0.ts) and the staff CLI
 * (cli/upsert-staff.ts) — and none of them could be read back.
 *
 * `AuditLog` is append-only for the app role by privilege, not by convention
 * (invariant 14, migration 20260815060658: INSERT and SELECT, with UPDATE and
 * DELETE revoked). So this router is a reader and there is deliberately no
 * sibling that writes, edits or prunes.
 *
 * `entity`/`entityId` are untyped by design — an audit row must outlive the
 * table it points at, so it is the one link in the schema that is not an FK.
 * That means this cannot join the subject in, and does not pretend to: it
 * returns the pair and lets the caller resolve it.
 */

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@nusantara/db";
import { ApiError } from "../errors.js";

/** Every member of `AuditAction`. Kept as a literal so an unknown value 400s. */
const ACTIONS = [
  "CREATE",
  "UPDATE",
  "ARCHIVE",
  "LOGIN",
  "LOGIN_GAGAL",
  "EKSPOR",
] as const;

/** A comma-separated multi-select, as it appears in the URL. */
const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === ""
        ? []
        : v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)));

const querySchema = z.object({
  /** Free text over entity, entityId and requestId — the three ids a reader has. */
  q: z.string().trim().max(64).optional(),
  entity: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  action: csv(ACTIONS),
  staffId: z.string().trim().max(64).optional(),
  /** ISO instants. Half-open [from, to) so consecutive days do not overlap. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

export interface AuditEntry {
  readonly id: string;
  /** ISO. */
  readonly at: string;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly field: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly requestId: string | null;
  readonly ip: string | null;
  /** Null for a row written before any staff existed, or by a deleted account. */
  readonly staff: {
    readonly id: string;
    readonly name: string;
    readonly username: string;
  } | null;
}

export interface KontrolDeps {
  readonly db: PrismaClient;
  /**
   * The owner-only guard, injected rather than built here so app.ts keeps
   * deciding who may reach this — the route's authorization is a property of
   * the mount, and a router that guarded itself would hide that.
   */
  readonly requireOwner: RequestHandler;
}

export function kontrolRouter({ db, requireOwner }: KontrolDeps): Router {
  const router = Router();

  router.get("/audit", requireOwner, (req, res, next) => {
    void (async () => {
      try {
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Filter tidak valid.", {
              field: String(parsed.error.issues[0]?.path[0] ?? "q"),
            }),
          );
          return;
        }
        const { q, entity, entityId, action, staffId, from, to, page, perPage } =
          parsed.data;

        if (from !== undefined && to !== undefined && from >= to) {
          next(
            new ApiError(
              400,
              "VALIDASI",
              "Rentang tanggal terbalik: 'from' harus sebelum 'to'.",
              { field: "from" },
            ),
          );
          return;
        }

        const where: Prisma.AuditLogWhereInput = {
          ...(entity !== undefined && entity !== "" ? { entity } : {}),
          ...(entityId !== undefined && entityId !== "" ? { entityId } : {}),
          ...(action.length > 0 ? { action: { in: action } } : {}),
          ...(staffId !== undefined && staffId !== "" ? { staffId } : {}),
          // Half-open: `to` is exclusive, so "1st to 2nd" and "2nd to 3rd"
          // cannot both claim a row written at midnight on the 2nd.
          ...(from !== undefined || to !== undefined
            ? {
                at: {
                  ...(from !== undefined ? { gte: from } : {}),
                  ...(to !== undefined ? { lt: to } : {}),
                },
              }
            : {}),
          ...(q !== undefined && q !== ""
            ? {
                OR: [
                  { entity: { contains: q, mode: "insensitive" } },
                  { entityId: { contains: q, mode: "insensitive" } },
                  { requestId: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        };

        const [rows, total] = await Promise.all([
          db.auditLog.findMany({
            where,
            // Newest first, with `id` breaking ties: `at` is set by the writer
            // and two rows in one transaction share it exactly, which would
            // otherwise let a row drift between pages.
            orderBy: [{ at: "desc" }, { id: "desc" }],
            skip: (page - 1) * perPage,
            take: perPage,
            select: {
              id: true,
              at: true,
              action: true,
              entity: true,
              entityId: true,
              field: true,
              before: true,
              after: true,
              requestId: true,
              ip: true,
              staff: { select: { id: true, name: true, username: true } },
            },
          }),
          db.auditLog.count({ where }),
        ]);

        const entries: AuditEntry[] = rows.map((r) => ({
          ...r,
          at: r.at.toISOString(),
        }));

        res.json({ entries, page, perPage, total });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
