/**
 * /api/change-requests — edit and delete approvals (owner/user 2026-11-13).
 *
 *   GET  /?status=pending|history   approvers see everybody's, others their own
 *   POST /                          file one (any signed-in staff)
 *   POST /:id/approve               commit its changeset as the approver
 *   POST /:id/reject                { reason? }
 *
 * The rules are `packages/db/src/changeRequests.ts`; this router says who may
 * reach which. Deciding is `Staff.canApprove` — the switch only `widatech` may
 * flip (routes/staff.ts) — checked here per request, never by the menu.
 * `requireAuth` and `idempotency` are app.ts's, so a double-pressed Approve
 * answers the stored response rather than deciding twice.
 *
 * Money is not in any answer: a request's changeset stays on the server, and
 * what the list shows is the label and summary the requester's screen wrote.
 */
import { Router } from "express";
import { z } from "zod";
import {
  ChangeRequestError,
  approveChangeRequest,
  createChangeRequest,
  listChangeRequests,
  rejectChangeRequest,
  type ChangeRequestRow,
  type PrismaClient,
} from "@nusantara/db";
import { ApiError, unauthenticated } from "../errors.js";
import type { AuthenticatedStaff } from "../auth/middleware.js";

const id = z.string().trim().min(1).max(64);

const createBody = z.object({
  kind: z.enum(["EDIT", "DELETE"]),
  target: z
    .object({
      orderId: id.optional(),
      purchaseOrderId: id.optional(),
      expenseId: id.optional(),
      manualIncomeId: id.optional(),
    })
    .strict(),
  label: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(4000).default(""),
  note: z.string().trim().min(1, "Tulis alasannya.").max(1000),
  changeset: z.record(z.string(), z.unknown()),
});

const rejectBody = z.object({
  reason: z.string().trim().max(1000).optional(),
});

/** A request as the browser reads it — ISO dates, no changeset. */
export function presentChangeRequest(r: ChangeRequestRow) {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    status: r.status,
    target: {
      orderId: r.orderId,
      purchaseOrderId: r.purchaseOrderId,
      expenseId: r.expenseId,
      manualIncomeId: r.manualIncomeId,
    },
    label: r.label,
    summary: r.summary,
    note: r.note,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
  };
}

function toApiError(e: unknown): unknown {
  if (e instanceof ChangeRequestError) {
    const status =
      e.code === "NOT_FOUND" ? 404 : e.code === "DECIDED" ? 409 : 400;
    const code =
      e.code === "NOT_FOUND"
        ? "TIDAK_DITEMUKAN"
        : e.code === "DECIDED"
          ? "KONFLIK"
          : "VALIDASI";
    return new ApiError(
      status,
      code,
      e.message,
      e.field === undefined ? {} : { field: e.field },
    );
  }
  return e;
}

function approver(staff: AuthenticatedStaff | undefined): AuthenticatedStaff {
  if (!staff) throw unauthenticated();
  if (!staff.canApprove) {
    throw new ApiError(
      403,
      "AKSES_DITOLAK",
      "Hanya akun yang boleh menyetujui yang bisa memutuskan permintaan.",
    );
  }
  return staff;
}

export function changeRequestsRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      const scope = req.query["status"] === "history" ? "history" : "pending";
      const rows = await listChangeRequests(db, {
        scope,
        ...(staff.canApprove ? {} : { requestedById: staff.id }),
      });
      res.set("Cache-Control", "no-store");
      res.json({ requests: rows.map(presentChangeRequest) });
    } catch (e) {
      next(toApiError(e));
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      const parsed = createBody.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = String(issue?.path[0] ?? "body");
        throw new ApiError(
          400,
          "VALIDASI",
          field === "note"
            ? "Tulis alasannya."
            : "Permintaan perubahan tidak valid.",
          { field },
        );
      }
      const body = parsed.data;
      const row = await createChangeRequest(db, {
        staffId: staff.id,
        kind: body.kind,
        target: body.target,
        label: body.label,
        summary: body.summary,
        note: body.note,
        changeset: body.changeset,
      });
      res.status(201).json({ request: presentChangeRequest(row) });
    } catch (e) {
      next(toApiError(e));
    }
  });

  router.post("/:id/approve", async (req, res, next) => {
    try {
      const staff = approver(req.staff);
      const params = id.safeParse(req.params["id"]);
      if (!params.success) throw new ApiError(400, "VALIDASI", "Id salah.");
      const row = await approveChangeRequest(db, {
        id: params.data,
        staffId: staff.id,
        requestId: req.get("x-request-id") ?? null,
        ip: req.ip ?? null,
      });
      res.json({ request: presentChangeRequest(row) });
    } catch (e) {
      next(toApiError(e));
    }
  });

  router.post("/:id/reject", async (req, res, next) => {
    try {
      const staff = approver(req.staff);
      const params = id.safeParse(req.params["id"]);
      const body = rejectBody.safeParse(req.body ?? {});
      if (!params.success || !body.success)
        throw new ApiError(400, "VALIDASI", "Permintaan tidak valid.");
      const row = await rejectChangeRequest(db, {
        id: params.data,
        staffId: staff.id,
        reason: body.data.reason ?? null,
        requestId: req.get("x-request-id") ?? null,
        ip: req.ip ?? null,
      });
      res.json({ request: presentChangeRequest(row) });
    } catch (e) {
      next(toApiError(e));
    }
  });

  return router;
}
