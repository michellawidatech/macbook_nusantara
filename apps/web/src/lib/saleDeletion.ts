/**
 * Deleting a sale from Transaction History (owner ask 2026-10-22).
 *
 * > *"Add a button to delete a transaction (add a close transaction monthly so
 * > before that all the transaction can be deleted)."*
 *
 * Asked what a deleted sale leaves behind, the owner answered **gone
 * completely**: it leaves every list, its money stops counting, and its units
 * go back on the shelf as they were before the sale — the sold row comes off
 * each unit's history, the way a unit swapped off a sale already does
 * (`removeLastEvent`). On PostgreSQL the row is cancelled rather than deleted
 * (`cancelSale` in packages/db's documents adapter), which is what a deleted
 * inbound invoice has always been; no screen can tell the difference.
 *
 * ## What it refuses
 *
 * Each because undoing it would have to guess rather than because it is
 * risky. The server asks the same questions and has the last word — a
 * marketplace payout or an Income & Expense line is in a collection some
 * staff are not sent (`financeScope`), so this side can only see what it can.
 *
 * - `BOOKS_CLOSED` — the month is closed (`lib/bookClose.ts`).
 * - `RETURNED` — something came back: an adjustment, a refund, a returned
 *   counted piece, or a return document naming one of its units. Take the
 *   return back first (Returns → Delete).
 * - `TRADE_IN` — a unit came IN on it and is in stock now.
 * - `UNIT_MOVED` — one of its units has a newer event than the sale: it was
 *   moved, reserved, or sold again since.
 * - `LINKED_MONEY` — an Income & Expense line names it. (A marketplace payout
 *   no longer refuses it, 2026-10-22 — everything is recoverable.)
 *
 * Pure apart from `deleteSale`, which is a mutation body for `mutate`.
 * `test/saleDeletion.test.ts` is the spec.
 */
import type { MockDb, Order } from "../mock/seed.js";
import { isSaleLocked } from "./bookClose.js";

export type SaleDeletionBlock =
  "BOOKS_CLOSED" | "RETURNED" | "TRADE_IN" | "UNIT_MOVED" | "LINKED_MONEY";

/** Why `order` cannot be deleted, or undefined when it can. */
export function saleDeletionBlock(
  db: Pick<
    MockDb,
    | "events"
    | "returns"
    | "settlements"
    | "expenses"
    | "incomes"
    | "settings"
    | "stockMoves"
  >,
  order: Order,
): SaleDeletionBlock | undefined {
  if (isSaleLocked(order, db.settings)) return "BOOKS_CLOSED";
  const serials = new Set(order.serials);
  if (
    (order.adjustments?.length ?? 0) > 0 ||
    (order.refunds?.length ?? 0) > 0 ||
    (order.lines ?? []).some((l) => (l.returnedQty ?? 0) > 0) ||
    db.returns.some(
      (r) =>
        r.kind === "CUSTOMER" &&
        r.status !== "CANCELLED" &&
        serials.has(r.serial) &&
        r.date >= order.ts,
    )
  )
    return "RETURNED";
  if ((order.tradeIns?.length ?? 0) > 0) return "TRADE_IN";
  for (const serial of order.serials) {
    if (saleRowsOf(db.events, serial, order.code) === null) return "UNIT_MOVED";
  }
  if (
    db.expenses.some((e) => e.orderId === order.id) ||
    db.incomes.some((i) => i.orderId === order.id)
  )
    return "LINKED_MONEY";
  return undefined;
}

/**
 * The rows of a unit's history that belong to this sale — its sold row and
 * anything written under the sale's code after it (a payout's note) — or
 * null when the unit has moved on since: a row from any OTHER document after
 * the sold row (a return, a reservation, another sale). Owner report
 * 2026-10-23: deleting a sale must always put its unit back, and a payout
 * note after the sale used to make it look "moved".
 */
export function saleRowsOf(
  events: MockDb["events"],
  serial: string,
  code: string,
): MockDb["events"] | null {
  const mine = events
    .filter((e) => e.serial === serial)
    .sort((a, b) => a.seq - b.seq);
  let sold = -1;
  for (let i = mine.length - 1; i >= 0; i -= 1) {
    const e = mine[i]!;
    if (
      e.type === "TERJUAL" &&
      (e.refCode === undefined || e.refCode === code)
    ) {
      sold = i;
      break;
    }
  }
  if (sold < 0) return null;
  if (mine.slice(sold + 1).some((e) => e.refCode !== code)) return null;
  return mine.filter((e, i) => i === sold || (i > sold && e.refCode === code));
}

/**
 * Delete the sale inside a `mutate`. Returns false (and changes nothing) when
 * `saleDeletionBlock` refuses — the draft may have moved on since the button
 * was drawn.
 *
 * In one mutation, because it is one decision: the order goes, each unit's
 * sold row comes off its history and the unit takes the status and place the
 * row before it records, a counted piece goes back on its shelf by an
 * opposite KOREKSI move (that ledger is append-only, so the TERJUAL move
 * stays and is cancelled out), and a discount it redeemed is free again.
 */
export function deleteSale(
  draft: MockDb,
  orderId: string,
  opts: { staff: string; now: string; nextMoveId: () => string },
): boolean {
  const order = draft.orders.find((o) => o.id === orderId);
  if (order === undefined || saleDeletionBlock(draft, order) !== undefined)
    return false;

  for (const serial of order.serials) {
    const gone = new Set(
      (saleRowsOf(draft.events, serial, order.code) ?? []).map((e) => e.id),
    );
    const left = draft.events
      .filter((e) => e.serial === serial && !gone.has(e.id))
      .sort((a, b) => a.seq - b.seq);
    // A unit always keeps one row; the server holds the same line.
    if (gone.size === 0 || left.length === 0) continue;
    draft.events = draft.events.filter((e) => !gone.has(e.id));
    const now = left[left.length - 1]!;
    const unit = draft.units.find((u) => u.serial === serial);
    if (unit) {
      unit.status = now.toStatus as typeof unit.status;
      unit.locationId = now.locationId;
    }
  }

  for (const m of draft.stockMoves.filter(
    (x) => x.orderId === orderId && x.type === "TERJUAL",
  )) {
    draft.stockMoves.push({
      id: opts.nextMoveId(),
      skuId: m.skuId,
      locationId: m.locationId,
      qty: -m.qty,
      cost: m.cost,
      type: "KOREKSI",
      at: opts.now,
      refCode: order.code,
      note: `Transaction ${order.code} deleted — ${opts.staff}`,
      staff: opts.staff,
    });
  }

  if (order.discountId !== undefined) {
    const d = draft.discounts.find((x) => x.id === order.discountId);
    if (d && d.used > 0) d.used -= 1;
  }

  draft.orders = draft.orders.filter((o) => o.id !== orderId);
  return true;
}

export type HistoryRowBlock = "ONLY_ROW" | "LIVE_SALE";

/**
 * Why one row of a unit's history cannot be deleted (owner ask 2026-10-22:
 * *"delete the serial [history] per unit … the user have to press like 3 dot
 * button to delete it, the reason is that some of the history is
 * irrelevant"*), or undefined when it can.
 *
 * - `ONLY_ROW` — a unit always keeps one row: a unit with no history is a
 *   unit whose status nothing explains, and the store refuses one.
 * - `LIVE_SALE` — the sold row of a sale that still has the unit on it. That
 *   one goes by deleting the transaction, or the unit would be on a receipt
 *   and on the shelf at once and could be sold twice (owner answer).
 *
 * The server holds the same two lines (`removeEvents`, packages/db).
 */
export function historyRowBlock(
  db: Pick<MockDb, "events" | "orders">,
  event: MockDb["events"][number],
): HistoryRowBlock | undefined {
  const rows = db.events.filter((e) => e.serial === event.serial).length;
  if (rows < 2) return "ONLY_ROW";
  if (event.type === "TERJUAL") {
    const sale = db.orders.find(
      (o) =>
        (event.refCode === undefined || o.code === event.refCode) &&
        o.serials.includes(event.serial),
    );
    if (sale !== undefined) {
      // Still on THIS sale only if no later row brought it back.
      const later = db.events.some(
        (e) =>
          e.serial === event.serial &&
          e.seq > event.seq &&
          e.type === "RETUR_PELANGGAN",
      );
      if (!later) return "LIVE_SALE";
    }
  }
  return undefined;
}
