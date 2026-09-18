/**
 * Changesets and snapshots, converted between the browser and the wire.
 *
 * The browser holds money as whole-rupiah numbers and the wire carries it as
 * decimal strings (CLAUDE.md: never a `number` in JSON). Every conversion goes
 * through the Zod codecs in `schemas.ts`, so a row that does not match its
 * schema fails HERE, in the browser, with the field named — not three layers
 * down in a Prisma error.
 *
 * Also the one comparison both sides use to decide whether a row changed
 * underneath somebody (`comparable`).
 */
import { z } from "zod";
import {
  isCollectionName,
  isSingletonName,
  type CollectionName,
  type SingletonName,
} from "./collections.js";
import type { Changeset, CollectionChange, Row, RowChange } from "./diff.js";
import { browserSchemas, serverSchemas } from "./schemas.js";

type Schemas = typeof browserSchemas | typeof serverSchemas;

function rowSchema(schemas: Schemas, collection: CollectionName): z.ZodType {
  return schemas.rows[collection] as unknown as z.ZodType;
}

function singletonSchema(schemas: Schemas, name: SingletonName): z.ZodType {
  return schemas.singletons[name] as unknown as z.ZodType;
}

/** A browser row on its way out: money to strings, shape checked. */
export function encodeRow(collection: CollectionName, row: Row): Row {
  return z.encode(rowSchema(browserSchemas, collection), row) as Row;
}

/** A wire row arriving in the browser: strings to whole-rupiah numbers. */
export function decodeRow(collection: CollectionName, row: unknown): Row {
  return z.decode(rowSchema(browserSchemas, collection), row) as Row;
}

export function encodeSingleton(name: SingletonName, value: unknown): unknown {
  return z.encode(singletonSchema(browserSchemas, name), value);
}

export function decodeSingleton(name: SingletonName, value: unknown): unknown {
  return z.decode(singletonSchema(browserSchemas, name), value);
}

/** A browser changeset, ready to POST. */
export function encodeChangeset(change: Changeset): Changeset {
  const collections: Partial<Record<CollectionName, CollectionChange>> = {};
  for (const [name, c] of Object.entries(change.collections)) {
    if (!isCollectionName(name) || c === undefined) continue;
    const rows: RowChange[] = c.rows.map((r) => ({
      key: r.key,
      ...(r.base === undefined ? {} : { base: encodeRow(name, r.base) }),
      ...(r.next === undefined ? {} : { next: encodeRow(name, r.next) }),
    }));
    collections[name] =
      c.order === undefined ? { rows } : { rows, order: c.order };
  }
  const singletons: Changeset["singletons"] = {};
  for (const [name, s] of Object.entries(change.singletons)) {
    if (!isSingletonName(name) || s === undefined) continue;
    (singletons as Record<string, unknown>)[name] = {
      base: encodeSingleton(name, s.base),
      next: encodeSingleton(name, s.next),
    };
  }
  return { collections, singletons };
}

/** A whole snapshot arriving in the browser. */
export function decodeStore(wire: unknown): z.output<typeof browserSchemas.db> {
  return z.decode(browserSchemas.db, wire as z.input<typeof browserSchemas.db>);
}

/**
 * A row reduced to what a conflict check should look at.
 *
 * Canonical JSON with the empty values dropped — `false`, `""`, `[]`, `{}` and
 * `undefined`. The pages write optional flags both ways (`noInvoice: false`
 * beside a row that never had the key), and the database cannot tell the two
 * apart, so treating them as different would report a conflict every time a
 * row went through PostgreSQL once. Real changes still show: `active: true`
 * against a dropped `false` is a difference.
 */
export function comparable(value: unknown): string {
  return JSON.stringify(prune(value) ?? null);
}

function prune(value: unknown): unknown {
  if (value === undefined || value === false || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map((v) => prune(v) ?? null);
    return items.length === 0 ? undefined : items;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = prune((value as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}
