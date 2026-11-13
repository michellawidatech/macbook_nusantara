/**
 * Pending change requests (2026-11-13), polled ONCE for the whole app however
 * many places read them — the Approvals nav count, the Approvals page's
 * *To approve* tab, the "Change requested" tags on Transaction History,
 * Inbound and Income & Expense, and (later) the Today page.
 *
 * An approver is answered everybody's pending requests; anybody else their
 * own — which is exactly what a "Change requested" tag on their screen needs.
 * Every 30 seconds while anything is listening and the tab is visible; a
 * failed poll keeps the last answer.
 *
 * ⚠️ Under the test runner nothing polls by itself, because a page test that
 * renders a tag would otherwise send a real request to the dev port. A test
 * that wants requests mocks `lib/changeRequestsApi.js` and calls
 * `__pollChangeRequestsInTests()` first.
 */
import { useEffect, useState } from "react";
import {
  listChangeRequests,
  type ChangeRequest,
  type ChangeRequestTarget,
} from "../lib/changeRequestsApi.js";

export const CHANGE_REQUEST_POLL_MS = 30_000;

let current: readonly ChangeRequest[] = [];
const listeners = new Set<(r: readonly ChangeRequest[]) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let enabled = import.meta.env.MODE !== "test";

async function poll(): Promise<void> {
  if (!enabled) return;
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const next = await listChangeRequests("pending");
    current = next;
    for (const l of listeners) l(current);
  } catch {
    // Keep the last answer.
  }
}

/** Ask again now — after filing or deciding one, so every count follows. */
export function refreshChangeRequests(): Promise<void> {
  return poll();
}

/** Test seam: let the hook ask the (mocked) API. */
export function __pollChangeRequestsInTests(): void {
  enabled = true;
  current = [];
}

export interface PendingChangeRequests {
  readonly requests: readonly ChangeRequest[];
  readonly count: number;
  readonly reload: () => Promise<void>;
}

export function usePendingChangeRequests(): PendingChangeRequests {
  const [requests, setRequests] = useState(current);
  useEffect(() => {
    listeners.add(setRequests);
    if (timer === null) {
      void poll();
      timer = setInterval(() => void poll(), CHANGE_REQUEST_POLL_MS);
    } else {
      setRequests(current);
    }
    return () => {
      listeners.delete(setRequests);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return { requests, count: requests.length, reload: refreshChangeRequests };
}

/** The pending requests about one record. */
export function pendingFor(
  requests: readonly ChangeRequest[],
  target: ChangeRequestTarget,
): ChangeRequest[] {
  return requests.filter(
    (r) =>
      r.status === "PENDING" &&
      ((target.orderId !== undefined && r.target.orderId === target.orderId) ||
        (target.purchaseOrderId !== undefined &&
          r.target.purchaseOrderId === target.purchaseOrderId) ||
        (target.expenseId !== undefined &&
          r.target.expenseId === target.expenseId) ||
        (target.manualIncomeId !== undefined &&
          r.target.manualIncomeId === target.manualIncomeId)),
  );
}
