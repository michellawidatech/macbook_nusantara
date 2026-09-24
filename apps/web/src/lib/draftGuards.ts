/**
 * What a draft may bring back from this device's storage.
 *
 * Since the in-app tab strip went (owner ask 2026-09-21), work in progress is
 * kept in `localStorage` (`hooks/usePersistentState.ts`) — and what comes back
 * was written by whichever build this browser last ran. A basket line from a
 * build with a different shape must not reach a page that cannot render it,
 * so every draft is read through one of these: a value that does not fit is
 * dropped and the page starts clean, which is what it did before drafts
 * existed.
 *
 * Deliberately shallow. They check the shape a page RENDERS from, not whether
 * the serial still exists — that is the page's question, asked against the
 * store once it is loaded (the till takes a sold unit off a restored basket).
 *
 * Pure: no React, no store.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isOptString = (v: unknown) => v === undefined || typeof v === "string";
const isOptNumber = (v: unknown) =>
  v === undefined || (typeof v === "number" && Number.isFinite(v));
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Kinds a field may be, for `hasShape`. `?` is "or absent". */
export const FIELD = {
  string: (v: unknown) => typeof v === "string",
  optString: isOptString,
  number: isNumber,
  optNumber: isOptNumber,
  boolean: (v: unknown) => typeof v === "boolean",
} as const;

/** Is this an object whose named fields are all of the kinds given? */
export function hasShape(
  v: unknown,
  spec: Readonly<Record<string, (field: unknown) => boolean>>,
): v is Record<string, unknown> {
  return isRecord(v) && Object.entries(spec).every(([name, ok]) => ok(v[name]));
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** One of a fixed set of words — a step, a channel. */
export function asOneOf<T extends string>(
  values: readonly T[],
): (v: unknown) => T | undefined {
  return (v) =>
    typeof v === "string" && (values as readonly string[]).includes(v)
      ? (v as T)
      : undefined;
}

/**
 * A list, keeping only the items that fit. A list is never refused whole for
 * one bad item: losing one line of a half-built sale is better than losing
 * the sale.
 */
export function asListOf<T>(
  item: (v: unknown) => v is T,
): (v: unknown) => T[] | undefined {
  return (v) => (Array.isArray(v) ? v.filter(item) : undefined);
}

/** An object of the given shape, or nothing. */
export function asShape<T>(
  spec: Readonly<Record<string, (field: unknown) => boolean>>,
): (v: unknown) => T | undefined {
  return (v) => (hasShape(v, spec) ? (v as T) : undefined);
}
