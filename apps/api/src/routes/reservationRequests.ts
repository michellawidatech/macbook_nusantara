/**
 * /api/reservations/requests — staff decide what the bot filed (2026-10-27).
 *
 * The list itself reaches the browser through the store (the read-only
 * `reservationRequests` collection), so this router only WRITES: approve and
 * reject, each one transaction in `packages/db` (`approveRequest`,
 * `rejectRequest`). Any signed-in staff member may do either — the same people
 * who answer the chat; the session and `Idempotency-Key` are app.ts's.
 *
 * What it decides that the service cannot: whether a WhatsApp line CAN go.
 * Free text is delivered within 24 hours of the customer's last message, or at
 * any time through the linked device (Baileys) — the rule `followUp.ts`
 * sends by. A line that cannot go is not queued, and the answer says so, so the
 * dialog can tell the person to write to the customer some other way.
 */
import { Router } from "express";
import { z } from "zod";
import {
  approveRequest,
  getRequest,
  MAX_HOLD_SERIALS,
  rejectRequest,
  TXN_TIMEOUTS,
  type PrismaClient,
  type RequestTell,
} from "@nusantara/db";
import {
  approvalMessage,
  DP_SETTING_KEYS,
  dpRuleOf,
  heldUntilOf,
  rejectionMessage,
} from "@nusantara/domain";
import { currentRequestId } from "@nusantara/logging";
import { isWithinWindow } from "@nusantara/whatsapp";
import { ApiError, unauthenticated } from "../errors.js";

const idParam = z.string().trim().min(1).max(64);

const approveBody = z.object({
  serials: z
    .array(z.string().trim().min(1).max(23))
    .max(MAX_HOLD_SERIALS)
    .default([]),
  scheduledFor: z.coerce.date(),
  dp: z
    .object({
      amount: z.string().regex(/^\d{1,12}$/),
      method: z.enum(["TRANSFER", "TUNAI"]),
      paidAt: z.coerce.date(),
    })
    .nullish(),
  tell: z.boolean().default(true),
  message: z.string().trim().max(1000).optional(),
});

const rejectBody = z.object({
  reason: z.string().trim().min(1).max(280),
  tell: z.boolean().default(true),
  message: z.string().trim().max(1000).optional(),
});

function badRequest(field: string, message: string): ApiError {
  return new ApiError(400, "VALIDASI", message, { field });
}

export interface RequestsRouterDeps {
  readonly db: PrismaClient;
  /** True when the worker sends through the linked device (Baileys). */
  readonly linkedDevice: boolean;
}

export function reservationRequestsRouter(deps: RequestsRouterDeps): Router {
  const { db } = deps;
  const router = Router();

  /** Can a free-text line reach this customer now, and what does it answer? */
  async function lineTo(from: string, now: Date) {
    const latest = await db.waMessage.findFirst({
      where: { from, direction: "IN" },
      orderBy: { ts: "desc" },
      select: { id: true, ts: true },
    });
    const open = deps.linkedDevice || isWithinWindow(latest?.ts ?? null, now);
    return { open, inReplyTo: latest?.id ?? null };
  }

  router.post("/:id/approve", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params["id"]);
      if (!id.success) throw badRequest("id", "Permintaan tidak valid.");
      const parsed = approveBody.safeParse(req.body ?? {});
      if (!parsed.success)
        throw badRequest(
          String(parsed.error.issues[0]?.path[0] ?? "serials"),
          "Data persetujuan tidak valid.",
        );
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      const body = parsed.data;
      const now = new Date();

      const request = await getRequest(db, id.data);
      const settings = await db.appSetting.findMany({
        where: { key: { in: [DP_SETTING_KEYS.amount, DP_SETTING_KEYS.days] } },
      });
      const rule = dpRuleOf({
        amount: settings.find((s) => s.key === DP_SETTING_KEYS.amount)?.value,
        days: settings.find((s) => s.key === DP_SETTING_KEYS.days)?.value,
      });
      const dp =
        body.dp && body.serials.length > 0
          ? {
              amount: BigInt(body.dp.amount),
              method: body.dp.method,
              paidAt: body.dp.paidAt,
            }
          : null;
      if (dp !== null && dp.amount <= 0n)
        throw badRequest("dp", "Jumlah DP harus lebih dari nol.");

      const line = await lineTo(request.from, now);
      let tell: RequestTell | null = null;
      if (body.tell && line.open) {
        const units = body.serials.length
          ? await db.unit.findMany({
              where: { serial: { in: body.serials } },
              select: {
                serial: true,
                sku: { select: { name: true, variantLabel: true } },
              },
            })
          : [];
        const unit =
          units
            .map((u) =>
              [u.sku.name, u.sku.variantLabel].filter(Boolean).join(" "),
            )
            .join(", ") || null;
        tell = {
          body:
            body.message ||
            approvalMessage({
              unit,
              when: body.scheduledFor,
              dp: dp
                ? {
                    amount: Number(dp.amount),
                    heldUntil: heldUntilOf(dp.paidAt, rule.days),
                  }
                : null,
            }),
          inReplyTo: line.inReplyTo,
        };
      }

      const done = await db.$transaction(
        (tx) =>
          approveRequest(tx, {
            id: id.data,
            serials: body.serials,
            scheduledFor: body.scheduledFor,
            staffId: staff.id,
            at: now,
            dp,
            rule,
            tell,
            requestId: currentRequestId() ?? null,
            ip: req.ip ?? null,
          }),
        TXN_TIMEOUTS,
      );
      res.status(201).json({
        reservation: { id: done.reservationId, code: done.code },
        heldUntil: done.heldUntil?.toISOString() ?? null,
        serials: done.serials,
        told: done.told,
        windowClosed: body.tell && !line.open,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reject", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params["id"]);
      if (!id.success) throw badRequest("id", "Permintaan tidak valid.");
      const parsed = rejectBody.safeParse(req.body ?? {});
      if (!parsed.success)
        throw badRequest(
          String(parsed.error.issues[0]?.path[0] ?? "reason"),
          "Tulis alasannya.",
        );
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      const body = parsed.data;
      const now = new Date();

      const request = await getRequest(db, id.data);
      const line = await lineTo(request.from, now);
      const tell: RequestTell | null =
        body.tell && line.open
          ? {
              body: body.message || rejectionMessage(body.reason),
              inReplyTo: line.inReplyTo,
            }
          : null;

      const done = await db.$transaction(
        (tx) =>
          rejectRequest(tx, {
            id: id.data,
            reason: body.reason,
            staffId: staff.id,
            at: now,
            tell,
            requestId: currentRequestId() ?? null,
            ip: req.ip ?? null,
          }),
        TXN_TIMEOUTS,
      );
      res.json({ told: done.told, windowClosed: body.tell && !line.open });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
