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
