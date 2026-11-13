/**
 * Edit and delete approvals (owner/user 2026-11-13) — `ChangeRequest`.
 *
 * Money that has already moved must not be quietly rewritten by whoever is at
 * the till. An account without `Staff.canApprove` therefore cannot commit an
 * edit or a delete of a past sale, of a purchase invoice's money, or of a typed
 * Income & Expense adjustment (`apps/api/src/auth/approvalScope.ts` refuses
 * it); it files a REQUEST instead. The request carries the store changeset the
 * edit would have committed — computed in the requester's browser by running
 * the dialog's own mutation on a copy — and the approver's Approve commits
 * exactly that, as the approver, through `commitStore`.
 *
 * Why the changeset and not a description of the edit: the edit is the normal
 * flow (owner: "in the request, they have the normal flow as when they
 * delete/edit it"), and every rule that flow obeys lives in the browser's
 * dialog and in the store's adapters. Re-implementing each edit here would be a
 * second copy of all of it. The changeset's rows carry the versions the
 * requester started from, so a record that changed in between answers 409 and
 * the request becomes STALE — it is never rewritten to fit what is there now.
 *
 * One `AuditLog` row per decision, in the transaction that records it.
 */
import type { Prisma, PrismaClient } from "./client.js";
import { commitStore } from "./store/commit.js";
import { StoreConflictError, StoreValidationError } from "./store/errors.js";

export const CHANGE_REQUEST_KINDS = ["EDIT", "DELETE"] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];
export const CHANGE_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "STALE",
] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/** What a request is about — at most one of these. */
export interface ChangeRequestTarget {
  readonly orderId?: string | null;
  readonly purchaseOrderId?: string | null;
  readonly expenseId?: string | null;
  readonly manualIncomeId?: string | null;
}

/** Why the service refused, for the route to answer in the right status. */
export class ChangeRequestError extends Error {
  override readonly name = "ChangeRequestError";
  constructor(
    readonly code: "NOT_FOUND" | "DECIDED" | "TARGET" | "INVALID",
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** The collection and key each target is in the store changeset. */
const TARGET_COLLECTION = {
  orderId: "orders",
  purchaseOrderId: "pos",
  expenseId: "expenses",
  manualIncomeId: "incomes",
} as const;
type TargetField = keyof typeof TARGET_COLLECTION;
const TARGET_FIELDS = Object.keys(TARGET_COLLECTION) as TargetField[];

const SELECT = {
  id: true,
  code: true,
  kind: true,
  status: true,
  orderId: true,
  purchaseOrderId: true,
  expenseId: true,
  manualIncomeId: true,
  label: true,
  summary: true,
  note: true,
  requestedAt: true,
  decidedAt: true,
  decisionNote: true,
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.ChangeRequestSelect;

export type ChangeRequestRow = Prisma.ChangeRequestGetPayload<{
  select: typeof SELECT;
}>;

export interface CreateChangeRequestInput {
  readonly staffId: string;
  readonly kind: ChangeRequestKind;
  readonly target: ChangeRequestTarget;
  readonly label: string;
  readonly summary: string;
  readonly note: string;
  /** The store changeset in wire form — untrusted. */
  readonly changeset: unknown;
  readonly now?: Date;
}

interface WireRow {
  readonly key?: unknown;
  readonly base?: unknown;
  readonly next?: unknown;
}

function rowsOf(changeset: unknown, collection: string): WireRow[] {
  if (typeof changeset !== "object" || changeset === null) return [];
  const collections = (changeset as { collections?: unknown }).collections;
  if (typeof collections !== "object" || collections === null) return [];
  const change = (collections as Record<string, unknown>)[collection];
  if (typeof change !== "object" || change === null) return [];
  const rows = (change as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as WireRow[]) : [];
}

/** The one target a request names, or undefined when it names none. */
function targetOf(
  target: ChangeRequestTarget,
): { field: TargetField; id: string } | undefined {
  const named = TARGET_FIELDS.flatMap((field) => {
    const id = target[field];
    return typeof id === "string" && id !== "" ? [{ field, id }] : [];
  });
  if (named.length > 1) {
    throw new ChangeRequestError(
      "TARGET",
      "Permintaan hanya boleh tentang satu catatan.",
      "target",
    );
  }
  return named[0];
}

/**
 * File a request. Any signed-in staff member may; the target must exist and
 * the changeset must actually touch it — an edit names the row as changed, a
 * delete names it as removed — so a request cannot say one thing on the
 * approver's screen and carry another.
 */
export async function createChangeRequest(
  db: PrismaClient,
  input: CreateChangeRequestInput,
): Promise<ChangeRequestRow> {
  const changeset = input.changeset;
  if (
    typeof changeset !== "object" ||
    changeset === null ||
    Array.isArray(changeset) ||
    typeof (changeset as { collections?: unknown }).collections !== "object"
  ) {
    throw new ChangeRequestError(
      "INVALID",
      "Perubahan yang diminta tidak terbaca.",
      "changeset",
    );
  }
  const target = targetOf(input.target);
  if (target === undefined) {
    throw new ChangeRequestError(
      "TARGET",
      "Sebutkan catatan yang ingin diubah atau dihapus.",
      "target",
    );
  }

  const exists =
    target.field === "orderId"
      ? await db.order.findUnique({
          where: { id: target.id },
          select: { id: true },
        })
      : target.field === "purchaseOrderId"
        ? await db.purchaseOrder.findUnique({
            where: { id: target.id },
            select: { id: true },
          })
        : target.field === "expenseId"
          ? await db.expense.findUnique({
              where: { id: target.id },
              select: { id: true },
            })
          : await db.manualIncome.findUnique({
              where: { id: target.id },
              select: { id: true },
            });
  if (exists === null) {
    throw new ChangeRequestError(
      "NOT_FOUND",
      "Catatan yang diminta tidak ditemukan.",
      "target",
    );
  }

  const row = rowsOf(changeset, TARGET_COLLECTION[target.field]).find(
    (r) => r.key === target.id,
  );
  const touches =
    row !== undefined &&
    row.base !== undefined &&
    (input.kind === "DELETE" ? row.next === undefined : row.next !== undefined);
  if (!touches) {
    throw new ChangeRequestError(
      "INVALID",
      input.kind === "DELETE"
        ? "Permintaan hapus ini tidak menghapus catatannya."
        : "Permintaan ubah ini tidak mengubah catatannya.",
      "changeset",
    );
  }

  return db.changeRequest.create({
    data: {
      kind: input.kind,
      [target.field]: target.id,
      label: input.label,
      summary: input.summary,
      note: input.note,
      changeset: changeset as Prisma.InputJsonValue,
      requestedById: input.staffId,
      requestedAt: input.now ?? new Date(),
    },
    select: SELECT,
  });
}

export interface ListChangeRequestsInput {
  /** PENDING alone, or every decided one. */
  readonly scope: "pending" | "history";
  /** Only this person's requests — what a non-approver sees. */
  readonly requestedById?: string;
  readonly take?: number;
}

export async function listChangeRequests(
  db: PrismaClient,
  input: ListChangeRequestsInput,
): Promise<ChangeRequestRow[]> {
  return db.changeRequest.findMany({
    where: {
      status:
        input.scope === "pending" ? "PENDING" : { not: "PENDING" as const },
      ...(input.requestedById === undefined
        ? {}
        : { requestedById: input.requestedById }),
    },
    orderBy:
      input.scope === "pending"
        ? [{ requestedAt: "asc" }, { id: "asc" }]
        : [{ decidedAt: "desc" }, { id: "desc" }],
    take: input.take ?? 200,
    select: SELECT,
  });
}

export interface DecideInput {
  readonly id: string;
  /** The approver. */
  readonly staffId: string;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly now?: Date;
}

async function pendingOrThrow(
  db: PrismaClient,
  id: string,
): Promise<{ id: string; code: string; changeset: unknown }> {
  const row = await db.changeRequest.findUnique({
    where: { id },
    select: { id: true, code: true, status: true, changeset: true },
  });
  if (row === null) {
    throw new ChangeRequestError("NOT_FOUND", "Permintaan tidak ditemukan.");
  }
  if (row.status !== "PENDING") {
    throw new ChangeRequestError("DECIDED", "Permintaan ini sudah diputuskan.");
  }
  return row;
}

/**
 * Record a decision — only while the request is still PENDING, so two
 * approvers pressing at once decide it once — with its audit line.
 */
async function decide(
  db: PrismaClient,
  input: DecideInput,
  code: string,
  status: Exclude<ChangeRequestStatus, "PENDING">,
  decisionNote: string | null,
): Promise<ChangeRequestRow> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const moved = await tx.changeRequest.updateMany({
      where: { id: input.id, status: "PENDING" },
      data: {
        status,
        decidedById: input.staffId,
        decidedAt: now,
        decisionNote,
      },
    });
    if (moved.count === 0) {
      throw new ChangeRequestError(
        "DECIDED",
        "Permintaan ini sudah diputuskan.",
      );
    }
    await tx.auditLog.create({
      data: {
        at: now,
        staffId: input.staffId,
        entity: "ChangeRequest",
        entityId: input.id,
        action: "UPDATE",
        field: "status",
        before: "PENDING",
        after:
          decisionNote === null
            ? `${status} ${code}`
            : `${status} ${code}: ${decisionNote}`,
        requestId: input.requestId ?? null,
        ip: input.ip ?? null,
      },
    });
    return tx.changeRequest.findUniqueOrThrow({
      where: { id: input.id },
      select: SELECT,
    });
  });
}

/**
 * Approve: commit the stored changeset as the approver. A commit that refuses
 * — somebody changed the record since (409), or the change no longer fits the
 * store's rules — leaves the request STALE with the reason, which is an
 * answer, not an error.
 */
export async function approveChangeRequest(
  db: PrismaClient,
  input: DecideInput,
): Promise<ChangeRequestRow> {
  const request = await pendingOrThrow(db, input.id);
  try {
    await commitStore(db, {
      staffId: input.staffId,
      changes: request.changeset,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  } catch (e) {
    if (e instanceof StoreConflictError) {
      return decide(
        db,
        input,
        request.code,
        "STALE",
        "Catatan ini sudah berubah sejak permintaan dibuat — minta ulang.",
      );
    }
    if (e instanceof StoreValidationError) {
      return decide(db, input, request.code, "STALE", e.message);
    }
    throw e;
  }
  return decide(db, input, request.code, "APPROVED", null);
}

export async function rejectChangeRequest(
  db: PrismaClient,
  input: DecideInput & { readonly reason?: string | null },
): Promise<ChangeRequestRow> {
  const request = await pendingOrThrow(db, input.id);
  const reason = input.reason?.trim() ?? "";
  return decide(
    db,
    input,
    request.code,
    "REJECTED",
    reason === "" ? null : reason,
  );
}
