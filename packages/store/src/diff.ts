/**
 * A mutation, as rows — the changeset the browser commits.
 *
 * `mutate(fn)` in the browser runs `fn` against a copy-on-write draft of the
 * store. What reaches the server is not the function but its effect: for each
 * collection, the rows it inserted, changed or removed, each carried with the
 * version the browser STARTED from (`base`). The server compares that base with
 * the row as it stands in PostgreSQL and refuses the commit when they differ,
 * which is how two tills editing one hold find out about each other.
 *
 * Identity first, content second. With a copy-on-write draft an untouched row
 * keeps its object identity, so the common case costs a pointer comparison per
 * row; rows whose identity changed are compared by value, so a draft that
 * assigned the same number it already held is not a change.
 *
 * Pure: no React, no Prisma, no I/O.
 */
import {
  COLLECTION_NAMES,
  COLLECTIONS,
  SINGLETON_NAMES,
  type CollectionName,
  type SingletonName,
} from "./collections.js";

export type Row = Readonly<Record<string, unknown>>;

export interface RowChange {
  readonly key: string;
  /** The row as the browser last saw it. Absent on an insert. */
  readonly base?: Row;
  /** The row as the mutation left it. Absent on a removal. */
  readonly next?: Row;
  /**
   * Where an inserted row sits in its list. Only the browser reads it: a page
   * that `unshift`s the newest order expects to find it first, and laying a
   * queued change back over a fresh copy must not move it to the end.
   */
  readonly index?: number;
}

export interface CollectionChange {
  readonly rows: readonly RowChange[];
  /**
   * Every key, in the new order — present only for an ordered collection whose
   * order the mutation changed.
   */
  readonly order?: readonly string[];
}

export interface SingletonChange {
  readonly base: unknown;
  readonly next: unknown;
}

export interface Changeset {
  readonly collections: Partial<Record<CollectionName, CollectionChange>>;
  readonly singletons: Partial<Record<SingletonName, SingletonChange>>;
}

/** Anything shaped like the store: named lists plus named singletons. */
export type StoreShape = Readonly<Record<string, unknown>>;

export function keyOf(collection: CollectionName, row: Row): string {
  const field = COLLECTIONS[collection].key;
  const key = row[field];
  if (typeof key !== "string" || key === "") {
    throw new Error(`store: a ${collection} row has no ${field}`);
  }
  return key;
}

/**
 * Structural equality with JSON's idea of absence: `{ a: undefined }` equals
 * `{}`, because that is what the two look like on the wire and after a reload.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], other[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const av = ao[k];
    const bv = bo[k];
    if (av === undefined && bv === undefined) continue;
    if (!deepEqual(av, bv)) return false;
  }
  return true;
}

/**
 * A value as canonical JSON: keys sorted, `undefined` dropped. Two rows that
 * are `deepEqual` produce the same string, which is what the server compares a
 * base against.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

function rowsOf(store: StoreShape, collection: CollectionName): readonly Row[] {
  const list = store[collection];
  return Array.isArray(list) ? (list as Row[]) : [];
}

/** The rows a mutation changed, collection by collection. */
export function diffStore(before: StoreShape, after: StoreShape): Changeset {
  const collections: Partial<Record<CollectionName, CollectionChange>> = {};
  for (const name of COLLECTION_NAMES) {
    if (before[name] === after[name]) continue;
    const change = diffCollection(
      name,
      rowsOf(before, name),
      rowsOf(after, name),
    );
    if (change !== undefined) collections[name] = change;
  }

  const singletons: Partial<Record<SingletonName, SingletonChange>> = {};
  for (const name of SINGLETON_NAMES) {
    const base = before[name];
    const next = after[name];
    if (base === next || deepEqual(base, next)) continue;
    singletons[name] = { base, next };
  }
  return { collections, singletons };
}

function diffCollection(
  name: CollectionName,
  before: readonly Row[],
  after: readonly Row[],
): CollectionChange | undefined {
  const old = new Map<string, Row>();
  for (const row of before) old.set(keyOf(name, row), row);

  const rows: RowChange[] = [];
  const seen = new Set<string>();
  for (const [index, row] of after.entries()) {
    const key = keyOf(name, row);
    if (seen.has(key)) {
      throw new Error(`store: two ${name} rows share the key ${key}`);
    }
    seen.add(key);
    const base = old.get(key);
    if (base === undefined) {
      rows.push({ key, next: row, index });
    } else if (base !== row && !deepEqual(base, row)) {
      rows.push({ key, base, next: row });
    }
  }
  for (const [key, base] of old) {
    if (!seen.has(key)) rows.push({ key, base });
  }

  let order: string[] | undefined;
  if (COLLECTIONS[name].ordered) {
    const was = before.map((r) => keyOf(name, r));
    const now = after.map((r) => keyOf(name, r));
    if (!deepEqual(was, now)) order = now;
  }

  if (rows.length === 0 && order === undefined) return undefined;
  return order === undefined ? { rows } : { rows, order };
}

export function isEmptyChangeset(change: Changeset): boolean {
  return (
    Object.keys(change.collections).length === 0 &&
    Object.keys(change.singletons).length === 0
  );
}

/**
 * Put canonical rows back into a list: replace by key where the row exists,
 * append where it does not, and drop the removed keys. Returns a new array;
 * the list passed in is not touched.
 */
export function applyRows(
  collection: CollectionName,
  list: readonly Row[],
  upserts: readonly Row[],
  removed: readonly string[] = [],
): Row[] {
  const gone = new Set(removed);
  const incoming = new Map<string, Row>();
  for (const row of upserts) incoming.set(keyOf(collection, row), row);

  const out: Row[] = [];
  for (const row of list) {
    const key = keyOf(collection, row);
    if (gone.has(key)) continue;
    const replacement = incoming.get(key);
    if (replacement !== undefined) {
      out.push(replacement);
      incoming.delete(key);
    } else {
      out.push(row);
    }
  }
  for (const row of incoming.values()) out.push(row);
  return out;
}

/**
 * Every string inside `value` with each `from` replaced by its `to`.
 *
 * Used for the provisional document codes: the browser writes
 * `SI-2026/09-T4k9x2a` wherever the code belongs — the order, the events'
 * `refCode`, the ledger note that quotes it — and the server's real code has
 * to replace it in all of those places, not only in `code`.
 */
export function replaceStrings<T>(
  value: T,
  map: Readonly<Record<string, string>>,
): T {
  const pairs = Object.entries(map);
  if (pairs.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let s = v;
      for (const [from, to] of pairs) {
        if (s.includes(from)) s = s.split(from).join(to);
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(inner);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * A provisional document code — what the browser writes until the server has
 * numbered the document. `T` and seven lower-case characters where the six
 * digits go, so it can never be mistaken for a real number and never collides
 * with one.
 */
export const PROVISIONAL_CODE = /^([A-Z]{2,4})-(\d{4})\/(\d{2})-T[a-z0-9]{7}$/;

export function isProvisionalCode(code: string): boolean {
  return PROVISIONAL_CODE.test(code);
}

/** Every provisional code mentioned anywhere inside `value`. */
export function provisionalCodesIn(value: unknown): Set<string> {
  const found = new Set<string>();
  const pattern = /\b[A-Z]{2,4}-\d{4}\/\d{2}-T[a-z0-9]{7}\b/g;
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(pattern)) found.add(m[0]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v !== null && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  return found;
}
