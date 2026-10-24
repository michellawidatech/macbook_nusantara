/**
 * Who changed what — one `AuditLog` row per row a till saved (owner ask
 * 2026-10-22: *"add an activity tab that reveals all the activity"*, answered
 * "everything, from now on", visible to the owner in Settings).
 *
 * Until this the store recorded WHO only where a collection happened to carry
 * a staff name (the unit ledger, stock moves, payments); a price edit, a
 * product edit or a settings change named nobody. `commitStore` now writes
 * these rows in the SAME transaction as the change, so a save that is refused
 * leaves no activity and a save that lands cannot lose its line.
 *
 * Pure: the rows are built from the changeset's wire form (money as strings,
 * which is what a reader wants to see) and nothing here touches a database.
 *
 * What a row says:
 * - `entity` is the store collection (`orders`, `units`, `settings`…), and
 *   `entityId` the row's key — a serial, an order id, `*` for a singleton.
 * - `action`: CREATE, UPDATE or DELETE.
 * - UPDATE: `field` lists the fields that changed, and `before` / `after` hold
 *   just those fields as JSON. CREATE: `after` is a short summary of what the
 *   row IS (its code, serial, name, amount…). DELETE: the same, in `before`.
 * - Every value is cut short. A QC photo travels as a data URL of hundreds of
 *   kilobytes, and nobody reading an activity list wants it.
 *
 * Skipped in import mode: the B2Soft history is thousands of rows committed
 * by a migration account, and "migrasi-b2soft created 4,511 stock moves" is
 * not activity anybody asked to read.
 */
import type { Prisma } from "../client.js";

/** A value as the activity list shows it: short, and never a whole photo. */
const VALUE_MAX = 80;
/** The JSON a column holds. `before` / `after` are text, but nobody reads 50 kB. */
const COLUMN_MAX = 2000;
/** Fields worth naming when a whole row is added or removed. */
const SUMMARY_FIELDS = [
  "code",
  "serial",
  "name",
  "label",
  "variantLabel",
  "title",
  "type",
  "kind",
  "status",
  "skuId",
  "qty",
  "amount",
  "total",
  "price",
  "reason",
] as const;

export interface ActivityRow {
  readonly collection: string;
  readonly key: string;
  /** Wire form, or undefined for an insert. */
  readonly base: unknown;
  /** Wire form, or undefined for a removal. */
  readonly next: unknown;
}

export interface ActivityContext {
  readonly staffId: string;
  readonly at: Date;
  readonly requestId?: string | null;
  readonly ip?: string | null;
}

function brief(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "[file]";
    return value.length > VALUE_MAX
      ? `${value.slice(0, VALUE_MAX - 1)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  // An array or an object: its size, or a short rendering of it.
  const text = JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint"
      ? v.toString()
      : typeof v === "string" && v.startsWith("data:")
        ? "[file]"
        : v,
  );
  if (text.length <= VALUE_MAX) return JSON.parse(text) as unknown;
  return Array.isArray(value) ? `[${value.length} items]` : "{…}";
}

/** A row's fields — or, for a singleton that is one value or a list, `value`. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function json(value: Record<string, unknown>): string | null {
  if (Object.keys(value).length === 0) return null;
  const text = JSON.stringify(value);
  return text.length > COLUMN_MAX ? `${text.slice(0, COLUMN_MAX - 1)}…` : text;
}

/** What a row is, in a few fields. */
export function summaryOf(row: unknown): Record<string, unknown> {
  const r = asRecord(row);
  const out: Record<string, unknown> = {};
  for (const f of SUMMARY_FIELDS) {
    if (r[f] !== undefined && r[f] !== null && r[f] !== "")
      out[f] = brief(r[f]);
  }
  return out;
}

/** The top-level fields whose value differs, in the row's own order. */
export function changedFields(base: unknown, next: unknown): string[] {
  const a = asRecord(base);
  const b = asRecord(next);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** The `AuditLog` rows for one commit. An unchanged row writes nothing. */
export function activityRows(
  rows: readonly ActivityRow[],
  ctx: ActivityContext,
): Prisma.AuditLogCreateManyInput[] {
  const out: Prisma.AuditLogCreateManyInput[] = [];
  for (const r of rows) {
    const common = {
      at: ctx.at,
      staffId: ctx.staffId,
      entity: r.collection,
      entityId: r.key,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
    };
    if (r.base === undefined && r.next !== undefined) {
      out.push({
        ...common,
        action: "CREATE",
        after: json(summaryOf(r.next)),
      });
      continue;
    }
    if (r.next === undefined && r.base !== undefined) {
      out.push({
        ...common,
        action: "DELETE",
        before: json(summaryOf(r.base)),
      });
      continue;
    }
    const fields = changedFields(r.base, r.next);
    if (fields.length === 0) continue;
    const a = asRecord(r.base);
    const b = asRecord(r.next);
    out.push({
      ...common,
      action: "UPDATE",
      field: fields.join(", ").slice(0, 500),
      before: json(Object.fromEntries(fields.map((f) => [f, brief(a[f])]))),
      after: json(Object.fromEntries(fields.map((f) => [f, brief(b[f])]))),
    });
  }
  return out;
}
