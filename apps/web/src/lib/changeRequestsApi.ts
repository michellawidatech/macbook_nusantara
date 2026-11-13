/**
 * Edit and delete approvals, as the SPA sees them — `/api/change-requests`
 * (apps/api/src/routes/changeRequests.ts). 2026-11-13.
 *
 * A person who cannot approve an edit of money files a REQUEST: the changeset
 * the edit would commit (`proposeChange` in mock/store.ts), what it is about,
 * the change in words and why. The approver decides on Financial & Report →
 * Approvals, and Approve commits that changeset on the server as them.
 *
 * Dates cross as ISO strings. No money crosses: the changeset is sent once and
 * never read back, and the list shows the requester's own words.
 */
import type { Changeset } from "@nusantara/store";
import { api } from "./api.js";

export type ChangeRequestKind = "EDIT" | "DELETE";
export type ChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "STALE";

/** What a request is about — exactly one of these is set. */
export interface ChangeRequestTarget {
  readonly orderId?: string;
  readonly purchaseOrderId?: string;
  readonly expenseId?: string;
  readonly manualIncomeId?: string;
}

export interface ChangeRequestPerson {
  readonly id: string;
  readonly name: string;
}

export interface ChangeRequest {
  readonly id: string;
  /** CR-YYYY/MM-NNNNNN. */
  readonly code: string;
  readonly kind: ChangeRequestKind;
  readonly status: ChangeRequestStatus;
  /** Null where the request names something else — or, for an expense or an income, once it was deleted. */
  readonly target: {
    readonly orderId: string | null;
    readonly purchaseOrderId: string | null;
    readonly expenseId: string | null;
    readonly manualIncomeId: string | null;
  };
  /** What it is about, as the requester's screen named it. */
  readonly label: string;
  /** The change in words, before → after, one line each. */
  readonly summary: string;
  /** Why. */
  readonly note: string;
  readonly requestedBy: ChangeRequestPerson;
  readonly requestedAt: string;
  readonly decidedBy: ChangeRequestPerson | null;
  readonly decidedAt: string | null;
  /** A rejection's reason, or why a STALE one could not be applied. */
  readonly decisionNote: string | null;
}

export interface NewChangeRequest {
  readonly kind: ChangeRequestKind;
  readonly target: ChangeRequestTarget;
  readonly label: string;
  readonly summary: string;
  readonly note: string;
  readonly changeset: Changeset;
}

/**
 * Pending requests, or the decided ones. An approver is answered everybody's;
 * anybody else their own.
 */
export async function listChangeRequests(
  status: "pending" | "history",
): Promise<ChangeRequest[]> {
  const { requests } = await api<{ requests: ChangeRequest[] }>(
    `/api/change-requests?status=${status}`,
  );
  return requests;
}

export async function createChangeRequest(
  body: NewChangeRequest,
): Promise<ChangeRequest> {
  const { request } = await api<{ request: ChangeRequest }>(
    "/api/change-requests",
    { method: "POST", body, idempotencyKey: crypto.randomUUID() },
  );
  return request;
}

/** Commit it as the approver. A record that moved since answers STALE, not an error. */
export async function approveChangeRequest(id: string): Promise<ChangeRequest> {
  const { request } = await api<{ request: ChangeRequest }>(
    `/api/change-requests/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: {}, idempotencyKey: crypto.randomUUID() },
  );
  return request;
}

export async function rejectChangeRequest(
  id: string,
  reason?: string,
): Promise<ChangeRequest> {
  const { request } = await api<{ request: ChangeRequest }>(
    `/api/change-requests/${encodeURIComponent(id)}/reject`,
    {
      method: "POST",
      body: reason?.trim() ? { reason: reason.trim() } : {},
      idempotencyKey: crypto.randomUUID(),
    },
  );
  return request;
}
