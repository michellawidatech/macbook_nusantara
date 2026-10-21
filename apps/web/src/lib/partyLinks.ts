/**
 * Whether a supplier or a customer can be deleted outright (owner decision
 * 2026-10-21: *"hard delete it as long as there are no transaction linked"*).
 *
 * A party no document names is an address-book entry typed by mistake, so
 * removing it loses no history. One an invoice, sale, hold, return, deposit
 * or old-debt figure names stays — the database refuses it besides
 * (`onDelete: Restrict` on every link), and the store adapter asks the
 * database again rather than trusting this copy.
 */
import type { MockDb } from "../mock/seed.js";

export function supplierInUse(db: MockDb, id: string): boolean {
  return (
    db.pos.some((p) => p.supplierId === id) ||
    db.deposits.some((d) => d.supplierId === id) ||
    db.returns.some((r) => r.supplierId === id)
  );
}

export function customerInUse(db: MockDb, id: string): boolean {
  const c = db.customers.find((x) => x.id === id);
  return (
    db.orders.some((o) => o.customerId === id) ||
    db.reservations.some((r) => r.customerId === id) ||
    (c?.openingBalance ?? 0) !== 0 ||
    (c?.openingPayments?.length ?? 0) > 0
  );
}

/**
 * Whether a PRODUCT can be deleted (owner ask 2026-10-21: "allow delete
 * product if the stock is 0"). Stricter than "nothing on the shelf": every
 * past receipt, invoice and stock movement names its variant, and a deleted
 * variant would leave those rows naming nothing. So it is deletable while no
 * unit, counted movement, invoice line, sale line or trade-in has ever been
 * recorded against any of its variants — which is every product made by
 * mistake, and none that has traded.
 */
export function productInUse(db: MockDb, modelId: string): boolean {
  return db.skus
    .filter((s) => s.modelId === modelId)
    .some((s) => variantInUse(db, s.id));
}

/** The same rule for one variant — what the Variants dialog's bin asks. */
export function variantInUse(db: MockDb, skuId: string): boolean {
  return (
    db.units.some((u) => u.skuId === skuId) ||
    db.stockMoves.some((m) => m.skuId === skuId) ||
    db.stockIns.some((r) => r.skuId === skuId) ||
    db.pos.some((p) => p.items.some((i) => i.skuId === skuId)) ||
    db.orders.some(
      (o) =>
        (o.lines ?? []).some((l) => l.skuId === skuId) ||
        (o.tradeIns ?? []).some((r) => r.skuId === skuId),
    )
  );
}
