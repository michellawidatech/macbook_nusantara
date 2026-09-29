/**
 * /api/reservations — holds, as the POS sees them.
 *
 * Thin on purpose. Every handler does four things and nothing else: parse the
 * request with Zod, take the actor from the session, call one service inside
 * one transaction, and serialise the result. The business rules — availability,
 * locking, the ledger, the header projection, the duplicate guard — all live in
 * `packages/db`'s `createHold` / `releaseHold`, which the WhatsApp agent and the
 * expiry worker also call. That is the point: a rule cannot be true at the
 * counter and false in a conversation.
 *
 * The router declares no middleware of its own. `requireAuth` and `idempotency`
 * are mounted on the `api` router above every business router (app.ts), so all
 * of these need a live session and all three POSTs honour `Idempotency-Key`.
 * Mounting the guard again here would run a second session lookup per write.
 */

import { Router } from "express";
import { z } from "zod";
import {
  createHold,
  getHold,
  HOLD_SORTS,
  listHolds,
  MAX_HOLD_SERIALS,
  MAX_HOLD_PER_PAGE,
  releaseHold,
  TXN_TIMEOUTS,
  type HoldRow,
  type PrismaClient,
} from "@nusantara/db";
import { RESERVATION_STATUSES } from "@nusantara/domain";
import { currentRequestId } from "@nusantara/logging";
import { ApiError, unauthenticated } from "../errors.js";

/** A comma-separated multi-select, as it appears in the URL. */
const csv = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v === ""
      ? []
      : v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
  );

const listQuery = z.object({
  q: z.string().trim().max(64).optional(),
  status: csv,
  customerId: z.string().trim().min(1).optional(),
  sumber: csv,
  sort: z.enum(HOLD_SORTS).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_HOLD_PER_PAGE)
    .default(MAX_HOLD_PER_PAGE),
});

/**
 * A serial is at most 23 characters (the Inbound field — a second-hand
 * serial is taken as read since 2026-09-21), and a hold is capped at
 * `MAX_HOLD_SERIALS` machines — the service holds every unit's row lock across
 * the whole transaction, and that transaction has a ten-second budget.
 */
const createBody = z.object({
  serials: z
    .array(z.string().trim().min(1).max(23))
    .min(1)
    .max(MAX_HOLD_SERIALS),
  customerId: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(4).max(20).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  scheduledFor: z.coerce.date().optional(),
  note: z.string().trim().max(280).optional(),
  reservationSourceId: z.string().trim().min(1).optional(),
});

const releaseBody = z.object({
  serials: z.array(z.string().trim().min(1).max(23)).min(1).optional(),
});

const idParam = z.string().trim().min(1).max(64);

/** Dates go out as ISO strings; money would go out as strings too (01 §4). */
function toJson(r: HoldRow) {
  return {
    ...r,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function badRequest(field: string, message: string): ApiError {
  return new ApiError(400, "VALIDASI", message, { field });
}

export function reservationsRouter(db: PrismaClient): Router {
  const router = Router();

  /** The channel list the create form's "Came from" select is fed from. */
  router.get("/sources", async (_req, res, next) => {
    try {
      const sources = await db.reservationSource.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      });
      res.json({ sources });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success)
        throw badRequest(
          String(parsed.error.issues[0]?.path[0] ?? "q"),
          "Filter reservasi tidak valid.",
        );
      const { q, status, customerId, sumber, sort, dir, page, perPage } =
        parsed.data;

      // An unknown status in the URL is a bad request, not an empty result —
      // silently returning nothing would read as "no holds".
      for (const s of status) {
        if (!(RESERVATION_STATUSES as readonly string[]).includes(s))
          throw badRequest("status", "Status reservasi tidak dikenal.");
      }

      const result = await listHolds(db, {
        q,
        status: status as never,
        customerId,
        reservationSourceId: sumber,
        sort,
        dir,
        page,
        perPage,
      });
      res.json({ ...result, rows: result.rows.map(toJson) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params["id"]);
      if (!id.success) throw badRequest("id", "Nomor reservasi tidak valid.");
      res.json({ reservation: toJson(await getHold(db, id.data)) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success)
        throw badRequest(
          String(parsed.error.issues[0]?.path[0] ?? "serials"),
          "Data reservasi tidak valid.",
        );
      const staff = req.staff;
      if (!staff) throw unauthenticated();

      const { customerId, phone, name, ...rest } = parsed.data;
      // Exactly one way of naming the customer. A body carrying both is a
      // client bug, and guessing which one was meant is how a hold ends up
      // against the wrong person.
      if ((customerId === undefined) === (phone === undefined))
        throw badRequest(
          "customerId",
          "Sebutkan pelanggan yang sudah ada, atau nomor dan nama pelanggan baru.",
        );
      if (phone !== undefined && (name === undefined || name === ""))
        throw badRequest("name", "Nama pelanggan baru wajib diisi.");

      const hold = await db.$transaction(
        (tx) =>
          createHold(tx, {
            serials: rest.serials,
            scheduledFor: rest.scheduledFor ?? null,
            note: rest.note ?? null,
            reservationSourceId: rest.reservationSourceId ?? null,
            customer:
              customerId !== undefined
                ? { customerId }
                : { phone: phone as string, name: name as string },
            // Never from the body: a client must not be able to attribute a
            // hold to somebody else, or forge the audit correlation.
            staffId: staff.id,
            requestId: currentRequestId() ?? null,
            source: "STAF",
            at: new Date(),
          }),
        TXN_TIMEOUTS,
      );

      res.status(201).json({ reservation: toJson(await getHold(db, hold.id)) });
    } catch (err) {
      next(err);
    }
  });

  /** Let some of a hold's machines go. The rest stay held. */
  router.post("/:id/release", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params["id"]);
      if (!id.success) throw badRequest("id", "Nomor reservasi tidak valid.");
      const parsed = releaseBody.safeParse(req.body ?? {});
      if (!parsed.success)
        throw badRequest("serials", "Daftar unit tidak valid.");
      const staff = req.staff;
      if (!staff) throw unauthenticated();

      await db.$transaction(
        (tx) =>
          releaseHold(tx, {
            target: { reservationId: id.data },
            serials: parsed.data.serials,
            staffId: staff.id,
            requestId: currentRequestId() ?? null,
            at: new Date(),
          }),
        TXN_TIMEOUTS,
      );

      res.json({ reservation: toJson(await getHold(db, id.data)) });
    } catch (err) {
      next(err);
    }
  });

  /** Let the whole hold go. Every machine still on it goes back to stock. */
  router.post("/:id/cancel", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params["id"]);
      if (!id.success) throw badRequest("id", "Nomor reservasi tidak valid.");
      const staff = req.staff;
      if (!staff) throw unauthenticated();

      // `serials` omitted means every machine still held — the service works
      // that out under its own locks, so a cancel and a full release are the
      // same operation with a different argument.
      await db.$transaction(
        (tx) =>
          releaseHold(tx, {
            target: { reservationId: id.data },
            staffId: staff.id,
            requestId: currentRequestId() ?? null,
            at: new Date(),
          }),
        TXN_TIMEOUTS,
      );

      res.json({ reservation: toJson(await getHold(db, id.data)) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
