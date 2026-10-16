/**
 * Financial & Report is for the people the owner named (2026-10-16: "only
 * Ersen and Dina") — `Staff.canViewFinance`, checked HERE rather than only by
 * the menu, because the store sends the whole shop to every browser and a
 * hidden page whose rows are still in the browser is not hidden.
 *
 * For an account without it, the collections in `FINANCE_COLLECTIONS` are:
 *
 *  - projected as empty lists in the snapshot,
 *  - left out of every change-feed answer and every commit's answer,
 *  - and accepted in a commit only as NEW rows. The return desk writes a
 *    refund `Expense` and the customer drawer a `paymentLog` line, so both
 *    must still work for everybody; an edit or a removal names a row the
 *    person was never sent, so it can only be a forged request.
 *
 * Pure: no Prisma, no Express.
 */
import { FINANCE_COLLECTIONS, type CollectionName } from "@nusantara/store";
import { ApiError } from "../errors.js";

export interface FinanceViewer {
  readonly canViewFinance: boolean;
}

/** The snapshot's `db`, with the money emptied for a viewer without access. */
export function scopeSnapshot<T extends Record<string, unknown>>(
  viewer: FinanceViewer,
  db: T,
): T {
  if (viewer.canViewFinance) return db;
  const out: Record<string, unknown> = { ...db };
  for (const name of FINANCE_COLLECTIONS) {
    if (name in out) out[name] = [];
  }
  return out as T;
}

interface DeltaShape {
  readonly rows: Partial<Record<CollectionName, unknown[]>>;
  readonly removed: Partial<Record<CollectionName, string[]>>;
  readonly order: Partial<Record<CollectionName, string[]>>;
}

/** A change-feed or commit answer, without the money for a viewer without access. */
export function scopeDelta<T extends DeltaShape>(
  viewer: FinanceViewer,
  delta: T,
): T {
  if (viewer.canViewFinance) return delta;
  const strip = <V>(
    m: Partial<Record<CollectionName, V>>,
  ): Partial<Record<CollectionName, V>> => {
    const out = { ...m };
    for (const name of FINANCE_COLLECTIONS) delete out[name];
    return out;
  };
  return {
    ...delta,
    rows: strip(delta.rows),
    removed: strip(delta.removed),
    order: strip(delta.order),
  };
}

/**
 * Refuse a changeset that edits, removes or reorders a finance row on behalf of
 * a viewer without access. Inserts pass. The body is not validated here —
 * `commitStore` does that — so anything not shaped like a changeset passes
 * through to be refused there in the usual words.
 */
export function assertFinanceWritable(
  viewer: FinanceViewer,
  changes: unknown,
): void {
  if (viewer.canViewFinance) return;
  if (typeof changes !== "object" || changes === null) return;
  const collections = (changes as { collections?: unknown }).collections;
  if (typeof collections !== "object" || collections === null) return;
  for (const name of FINANCE_COLLECTIONS) {
    const change = (collections as Record<string, unknown>)[name];
    if (typeof change !== "object" || change === null) continue;
    const { rows, order } = change as { rows?: unknown; order?: unknown };
    const touchesExisting =
      order !== undefined ||
      (Array.isArray(rows) &&
        rows.some(
          (r) =>
            typeof r !== "object" ||
            r === null ||
            (r as { base?: unknown }).base !== undefined ||
            (r as { next?: unknown }).next === undefined,
        ));
    if (touchesExisting) {
      throw new ApiError(
        403,
        "AKSES_DITOLAK",
        "Data keuangan hanya untuk akun yang diberi akses keuangan.",
        { field: name },
      );
    }
  }
}
