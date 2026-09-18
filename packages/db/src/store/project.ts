/**
 * Reading the store out of PostgreSQL, in the wire form the browser decodes:
 * the whole shop for `GET /api/store`, and chosen rows for a commit's answer
 * and for `GET /api/store/changes`.
 */
import { z } from "zod";
import {
  COLLECTION_NAMES,
  COLLECTIONS,
  SINGLETON_NAMES,
  keyOf,
  serverSchemas,
  type CollectionName,
  type Row,
  type SingletonName,
} from "@nusantara/store";
import type { PrismaClient, Tx } from "../client.js";
import { adapterOf } from "./adapters/index.js";
import {
  projectActivePersona,
  projectAppleDbHidden,
  projectMyWarehouse,
  projectSettings,
} from "./adapters/singletons.js";
import type { ProjectContext } from "./context.js";

/** Rows that changed, in wire form. `removed` are keys whose row no longer projects. */
export interface StoreDelta {
  readonly cursor: string;
  readonly rows: Partial<Record<CollectionName, unknown[]>>;
  readonly removed: Partial<Record<CollectionName, string[]>>;
  /** The full key order of each ordered collection that changed. */
  readonly order: Partial<Record<CollectionName, string[]>>;
  readonly singletons: Partial<Record<SingletonName, unknown>>;
}

export function encodeRow(name: CollectionName, row: unknown): unknown {
  return z.encode(serverSchemas.rows[name] as unknown as z.ZodType, row);
}

/** The newest change-feed id, as a string — what a browser polls from. */
export async function currentCursor(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<{ c: string }[]>`
    SELECT COALESCE(MAX(id), 0)::text AS c FROM "StoreChange"`;
  return row?.c ?? "0";
}

export async function projectSingleton(
  tx: Tx,
  ctx: ProjectContext,
  name: SingletonName,
): Promise<unknown> {
  switch (name) {
    case "settings":
      return z.encode(
        serverSchemas.singletons.settings,
        await projectSettings(tx),
      );
    case "appleDbHidden":
      return projectAppleDbHidden(tx);
    case "myWarehouseId":
      return projectMyWarehouse(tx, ctx);
    case "activePersonaId":
      return projectActivePersona(tx);
  }
}

/** The rows behind these keys, plus the order of any ordered collection touched. */
export async function projectDelta(
  tx: Tx,
  ctx: ProjectContext,
  touched: ReadonlyMap<CollectionName, ReadonlySet<string>>,
  singletons: ReadonlySet<SingletonName>,
): Promise<Omit<StoreDelta, "cursor">> {
  const rows: Partial<Record<CollectionName, unknown[]>> = {};
  const removed: Partial<Record<CollectionName, string[]>> = {};
  const order: Partial<Record<CollectionName, string[]>> = {};
  for (const name of COLLECTION_NAMES) {
    const keys = touched.get(name);
    if (keys === undefined || keys.size === 0) continue;
    const adapter = adapterOf(name);
    const found = await adapter.project(tx, ctx, [...keys]);
    const present = new Set(found.map((r) => keyOf(name, r as unknown as Row)));
    rows[name] = found.map((r) => encodeRow(name, r));
    const gone = [...keys].filter((k) => !present.has(k));
    if (gone.length > 0) removed[name] = gone;
    if (COLLECTIONS[name].ordered) {
      order[name] = (await adapter.project(tx, ctx)).map((r) =>
        keyOf(name, r as unknown as Row),
      );
    }
  }
  const single: Partial<Record<SingletonName, unknown>> = {};
  for (const name of singletons)
    single[name] = await projectSingleton(tx, ctx, name);
  return { rows, removed, order, singletons: single };
}

/** The whole shop, as of one consistent moment. */
export async function snapshotStore(
  db: PrismaClient,
  ctx: ProjectContext,
): Promise<{ cursor: string; db: Record<string, unknown> }> {
  return db.$transaction(
    async (tx) => {
      // The cursor BEFORE reading: a change committed while this runs is sent
      // again by the next poll, which is harmless, rather than never.
      const cursor = await currentCursor(tx);
      const out: Record<string, unknown> = {};
      for (const name of COLLECTION_NAMES) {
        const rows = await adapterOf(name).project(tx, ctx);
        out[name] = rows.map((r) => encodeRow(name, r));
      }
      for (const name of SINGLETON_NAMES) {
        out[name] = await projectSingleton(tx, ctx, name);
      }
      return { cursor, db: out };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 180_000 },
  );
}
