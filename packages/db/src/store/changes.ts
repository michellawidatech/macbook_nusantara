/**
 * What moved since a cursor — `GET /api/store/changes`.
 *
 * Every writer records `(collection, key)` in `StoreChange` in the transaction
 * that changed the row. A browser polls with the newest id it has seen and gets
 * the current version of each row named since, or the key alone when the row
 * no longer projects (removed, archived, cancelled).
 */
import {
  isCollectionName,
  isSingletonName,
  type CollectionName,
  type SingletonName,
} from "@nusantara/store";
import type { PrismaClient } from "../client.js";
import type { ProjectContext } from "./context.js";
import { StoreValidationError } from "./errors.js";
import { projectDelta, type StoreDelta } from "./project.js";

/**
 * The delta since `after`, or `"RESET"` when the browser must reload: its
 * cursor predates what the feed still keeps, or is ahead of it (a restored
 * database).
 */
export async function storeChangesSince(
  db: PrismaClient,
  ctx: ProjectContext,
  after: string,
): Promise<StoreDelta | "RESET"> {
  if (!/^\d+$/.test(after)) throw new StoreValidationError("Kursor perubahan tidak valid.");
  const afterId = BigInt(after);
  return db.$transaction(
    async (tx) => {
      const bounds = await tx.storeChange.aggregate({ _min: { id: true }, _max: { id: true } });
      const max = bounds._max.id ?? 0n;
      if (afterId > max) return "RESET" as const;
      if (bounds._min.id !== null && afterId < bounds._min.id - 1n) return "RESET" as const;
      if (afterId === max) {
        return { cursor: max.toString(), rows: {}, removed: {}, order: {}, singletons: {} };
      }
      const changes = await tx.storeChange.findMany({
        where: { id: { gt: afterId, lte: max } },
        select: { collection: true, rowKey: true },
      });
      const touched = new Map<CollectionName, Set<string>>();
      const singletons = new Set<SingletonName>();
      for (const c of changes) {
        if (isCollectionName(c.collection)) {
          const keys = touched.get(c.collection) ?? new Set<string>();
          keys.add(c.rowKey);
          touched.set(c.collection, keys);
        } else if (isSingletonName(c.collection)) {
          // Somebody else's default warehouse is none of this browser's business.
          if (c.collection !== "myWarehouseId" || c.rowKey === ctx.staffId) {
            singletons.add(c.collection);
          }
        }
      }
      const delta = await projectDelta(tx, ctx, touched, singletons);
      return { ...delta, cursor: max.toString() };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 60_000 },
  );
}

/** A stored photograph's bytes, for `GET /api/store/photos/:id`. */
export async function storePhoto(
  db: PrismaClient,
  id: string,
): Promise<{ data: Uint8Array; contentType: string } | null> {
  const row = await db.unitNotePhoto.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (row === null || row.data === null) return null;
  return { data: row.data, contentType: row.contentType ?? "application/octet-stream" };
}
