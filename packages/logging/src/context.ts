/**
 * Request correlation — docs/rebuild/05-logging.md §3.
 *
 * "One id, generated once, carried everywhere." AsyncLocalStorage carries it
 * through the whole handler, so a log line five calls deep does not need it
 * threaded through as an argument.
 *
 * The same `rid` is written to the durable rows (`UnitEvent.requestId`,
 * `AuditLog.requestId`). That is the bridge: from a disputed stock movement you
 * can reach the exact HTTP request that caused it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  /** ULID, so it sorts by time. The join key across every app. */
  readonly rid: string;
  /** Staff id, once the request is authenticated. */
  sid?: string;
  /** The rid the SPA saw on its previous request (§3.3). */
  readonly cid?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Run `fn` with this context bound to the whole async call tree. */
export function runWithContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): LogContext | undefined {
  return storage.getStore();
}

/** The current request id, or undefined outside a request (worker, script). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.rid;
}

/**
 * Attach the staff id once authentication has resolved it.
 *
 * A no-op outside a request rather than an error: logging must never throw
 * into the request path (§2).
 */
export function setStaffId(sid: string): void {
  const store = storage.getStore();
  if (store !== undefined) store.sid = sid;
}
