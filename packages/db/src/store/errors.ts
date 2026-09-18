/**
 * Why a store commit was refused.
 *
 * Two kinds, and the route answers them differently: a VALIDATION failure is
 * the browser asking for something the rules forbid (400, and the change is
 * taken back off the screen), a CONFLICT is somebody else having changed a row
 * first (409, and the browser redoes the change on their version).
 *
 * Messages are Indonesian, like every other refusal from `packages/db`
 * (errors.ts): they reach the person at the till through the toast.
 */
import type { CollectionName } from "@nusantara/store";

export class StoreValidationError extends Error {
  override readonly name = "StoreValidationError";
  constructor(
    message: string,
    readonly collection?: CollectionName,
    readonly key?: string,
  ) {
    super(message);
  }
}

export class StoreConflictError extends Error {
  override readonly name = "StoreConflictError";
  constructor(
    /** A collection, or `settings`, or `store` when the database said so. */
    readonly collection: CollectionName | "settings" | "store",
    readonly key: string,
  ) {
    super(
      `Data ${collection} "${key}" sudah diubah di perangkat lain. Muat ulang lalu ulangi.`,
    );
  }
}
