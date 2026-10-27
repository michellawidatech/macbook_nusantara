/**
 * The store's collections, and the three facts about each that both ends of
 * the wire have to agree on.
 *
 * The browser reads one object — `MockDb` in `apps/web/src/mock/seed.ts` — and
 * every page and every tested function in `apps/web/src/lib` is written
 * against its shape. Since 2026-09-13 that object is a projection of
 * PostgreSQL rather than an in-memory seed (docs/store-on-postgres.md), so the
 * server and the browser need one answer to:
 *
 * - **which field identifies a row** — a unit is its serial, everything else
 *   its id;
 * - **whether the ORDER of the list is data** — grading rules are evaluated
 *   top to bottom and staff reorder the reason list on purpose, so moving a
 *   row is a change even when no row changed;
 * - **whether the browser may write it here at all** — the chat inbox,
 *   personas and corrections have their own API under `/api/chat` and
 *   `/api/inbox`, and are carried read-only.
 *
 * Pure: no Prisma, no React, no I/O.
 */

export interface CollectionSpec {
  /** The field that identifies a row. */
  readonly key: "id" | "serial" | "phone";
  /** True when array order is meaningful and must survive a reload. */
  readonly ordered: boolean;
  /** False for collections this endpoint projects but never accepts. */
  readonly writable: boolean;
}

const spec = (
  key: CollectionSpec["key"],
  ordered = false,
  writable = true,
): CollectionSpec => ({ key, ordered, writable });

/**
 * Every list in the store. The order of THIS object is also the order a
 * commit applies collections in, and it is chosen so a row is written after
 * everything it points at: reference lists, then the catalogue, then units,
 * then the documents that name units, then the ledger that names documents.
 */
export const COLLECTIONS = {
  paymentMethods: spec("id", true),
  warehouses: spec("id", true),
  racks: spec("id", true),
  suppliers: spec("id"),
  reasons: spec("id", true),
  qcDescriptions: spec("id", true),
  reservationSources: spec("id", true),
  // Not ordered: `ReferralSource` has no sortOrder, and Settings lists them as
  // they were added.
  referralSources: spec("id"),
  salesmen: spec("id", true),
  // Ordered: `Category.sortOrder` is what Settings reorders, and a model's
  // category picker lists them in that order.
  categories: spec("id", true),
  models: spec("id"),
  gradingCriteria: spec("id", true),
  gradingRules: spec("id", true),
  skus: spec("id"),
  customers: spec("id"),
  discounts: spec("id"),
  knowledge: spec("id"),
  // A deposit before the invoice whose payment is allocated out of it, and the
  // invoice before the machine that came in on it.
  deposits: spec("id"),
  pos: spec("id"),
  units: spec("serial"),
  reservations: spec("id"),
  orders: spec("id"),
  returns: spec("id"),
  opnames: spec("id"),
  services: spec("id"),
  settlements: spec("id"),
  events: spec("id"),
  // The counted products' ledger (2026-09-19) — after the orders, invoices
  // and stock takes it names, beside the units' ledger.
  stockMoves: spec("id"),
  unitNotes: spec("id"),
  stockIns: spec("id"),
  adjustments: spec("id"),
  expenses: spec("id"),
  incomes: spec("id"),
  paymentLog: spec("id"),
  settlementLog: spec("id"),
  // Reconciliation (2026-10-27): after every money row it names — payments
  // (on orders, invoices, customers), deposits, expenses and incomes — and
  // the statement's lines after the month they belong to.
  reconciliations: spec("id"),
  statementLines: spec("id"),
  chats: spec("phone", false, false),
  corrections: spec("id", false, false),
  personas: spec("id", false, false),
} as const satisfies Record<string, CollectionSpec>;

export type CollectionName = keyof typeof COLLECTIONS;

export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

/**
 * The parts of the store that are not lists.
 *
 * `settings` is key/value rows in `AppSetting`; `appleDbHidden` is the set of
 * hidden AppleDB keys; `myWarehouseId` is the signed-in person's default
 * location; `activePersonaId` is read-only, like the persona list itself.
 */
export const SINGLETONS = {
  settings: { writable: true },
  appleDbHidden: { writable: true },
  myWarehouseId: { writable: true },
  activePersonaId: { writable: false },
} as const;

export type SingletonName = keyof typeof SINGLETONS;

export const SINGLETON_NAMES = Object.keys(SINGLETONS) as SingletonName[];

export function isCollectionName(name: string): name is CollectionName {
  return Object.prototype.hasOwnProperty.call(COLLECTIONS, name);
}

export function isSingletonName(name: string): name is SingletonName {
  return Object.prototype.hasOwnProperty.call(SINGLETONS, name);
}

/**
 * The money only Financial & Report reads (owner ask 2026-10-16: "only Ersen
 * and Dina"). For an account without `Staff.canViewFinance` the API projects
 * these as empty lists, leaves them out of every change it sends, and accepts
 * nothing for them but a NEW row — a refund written by the return desk, a
 * payment-log line written by the customer drawer — because a person who
 * cannot read a row cannot have based an edit on it.
 *
 * Sale payments are NOT here: they live on the order, and the till and the
 * return desk cannot work without them.
 */
export const FINANCE_COLLECTIONS: ReadonlySet<CollectionName> =
  new Set<CollectionName>([
    "expenses",
    "incomes",
    "settlements",
    "settlementLog",
    "paymentLog",
    "reconciliations",
    "statementLines",
  ]);
