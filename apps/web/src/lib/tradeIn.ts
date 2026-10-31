/**
 * A trade-in, recorded the same way every time (owner 2026-10-31).
 *
 * > *"Yes every trade-ins should be recorded the same way."*
 *
 * Until then a trade-in worth less than the bill came OFF it (a 12,5jt sale
 * with a 2jt trade-in was a 10,5jt sale) and one worth more was bought
 * outright. The switch between the two is what broke Edit transaction: a bill
 * edited past the trade-in's value flipped the sale from one rule to the
 * other. Now a sale with a trade-in is recorded GROSS (`Order.tradeInGross`):
 *
 * - `Order.total` is the whole bill — 12,5jt is income, always;
 * - one payment of method TUKAR_TAMBAH, not in the balance, is what the
 *   trade-in paid of the bill (`tradeInPaid`);
 * - money the shop handed the customer back, when the trade-in was worth more,
 *   is an `Expense` of kind TUKAR_TAMBAH naming the sale (a payout) — real
 *   money, reconciled against the bank like any other;
 * - Income & Expense lists the trade-in's offset as an expense beside the
 *   payment (`cashflowRows`), so the trade-in is 2jt (or 27jt) of expense and
 *   the pot moves by what the customer handed over, less any payout.
 *
 * The invariant every writer keeps: **trade-in paid = credit − payouts**. It
 * is kept INCREMENTALLY — a change of credit or of a payout moves the payment
 * by the same amount — never re-derived from the expenses, because a till
 * without finance access is sent no expenses at all.
 *
 * `bookTradeIn` is the one place a traded unit enters stock: the till, Edit
 * transaction and Inbound → Trade-in's purchase from a customer all call it.
 *
 * Pure apart from the callbacks it is handed: no React, no store.
 */
import type { MockDb, Order } from "../mock/seed.js";
import type { SalePayment } from "./salePayments.js";
import type { TradeInLine } from "./pos.js";
import { gradeForCondition } from "./condition.js";
import { qcReady, splitDescription } from "./inboundQc.js";
import { skuTracksSerial } from "./serialTracking.js";

/** The `PaymentMethod` code a trade-in pays part of a bill with. */
export const TRADE_IN_METHOD = "TUKAR_TAMBAH";
/** The `ExpenseKind` of buying a customer's unit. */
export const TRADE_IN_EXPENSE = "TUKAR_TAMBAH";

/** Is this payment the trade-in's share of the bill, not money? */
export const isTradeInPayment = (p: { readonly method: string }): boolean =>
  p.method === TRADE_IN_METHOD;

/** Σ a sale's trade-in values — what the customer was allowed. */
export function tradeInCredit(order: {
  readonly tradeIns?: readonly { readonly value: number }[];
}): number {
  return (order.tradeIns ?? []).reduce((n, x) => n + Math.max(0, x.value), 0);
}

/** What the trade-in paid of the bill: Σ the TUKAR_TAMBAH payments. */
export function tradeInPaid(order: {
  readonly payments?: readonly SalePayment[];
}): number {
  return (order.payments ?? [])
    .filter(isTradeInPayment)
    .reduce((n, p) => n + p.amount, 0);
}

/** The payouts naming a sale — money handed back for its trade-in. */
export function payoutsOf(
  db: Pick<MockDb, "expenses">,
  orderId: string,
): MockDb["expenses"] {
  return db.expenses.filter(
    (e) => e.kind === TRADE_IN_EXPENSE && e.orderId === orderId,
  );
}

/**
 * How a bill and a trade-in meet at the till.
 *
 * `billLeft` is the bill less any DP already paid. The trade-in pays as much
 * of that as it covers (`paid`); the customer hands over the rest in money
 * (`collect`); a trade-in worth more leaves the shop owing the difference
 * (`payout`). Exactly one of `collect` and `payout` can be above zero.
 */
export function tradeInSplit(input: {
  readonly billLeft: number;
  readonly credit: number;
}): {
  readonly paid: number;
  readonly collect: number;
  readonly payout: number;
} {
  const billLeft = Math.max(0, input.billLeft);
  const credit = Math.max(0, input.credit);
  const paid = Math.min(credit, billLeft);
  return { paid, collect: billLeft - paid, payout: credit - paid };
}

/**
 * The sale's payments with its trade-in payment set to `amount` — replaced
 * where there was one, added where there was none, dropped at zero. The rest
 * of the list is untouched, so a customer's money never moves with it.
 */
export function withTradeInPaid(
  payments: readonly SalePayment[],
  amount: number,
  make: () => SalePayment,
): SalePayment[] {
  const rest = payments.filter((p) => !isTradeInPayment(p));
  const current = payments.find(isTradeInPayment);
  if (amount <= 0) return rest;
  const row = current ?? make();
  return [{ ...row, amount, state: "SETTLED", inBalance: false }, ...rest];
}

/** A fresh trade-in payment, before its amount is set. */
export function newTradeInPayment(id: string, at: string): SalePayment {
  return {
    id,
    method: TRADE_IN_METHOD,
    amount: 0,
    state: "SETTLED",
    at,
    inBalance: false,
  };
}

/**
 * Has the unit a trade-in brought in moved on — sold, reserved, sent to
 * service, written off? Once it has, the trade-in is a fact other documents
 * stand on, and it can no longer be removed or repriced from the sale.
 */
export function tradeInUnitMovedOn(
  db: Pick<MockDb, "units" | "events">,
  serial: string | undefined,
): boolean {
  if (!serial) return false;
  const unit = db.units.find((u) => u.serial === serial);
  if (unit === undefined) return false;
  return unit.status !== "TERSEDIA" && unit.status !== "QC";
}

/** What `bookTradeIn` needs from the store, handed in rather than imported. */
export interface BookContext {
  /** The document the unit came in on — the sale's SI or the purchase's BP. */
  readonly code: string;
  readonly orderId?: string;
  readonly at: string;
  readonly staff: string;
  readonly nextId: (prefix: string) => string;
  readonly appendEvent: (
    d: MockDb,
    serial: string,
    ev: {
      type: string;
      toStatus?: string;
      refCode?: string;
      note?: string;
    },
  ) => void;
  readonly ensureQcDescription: (d: MockDb, phrase: string) => string;
  /** The timeline's two notes, already translated. */
  readonly receivedNote: string;
  readonly qcNote: string;
}

/**
 * Takes a customer's unit into stock at what the shop paid for it.
 *
 * An accessory is a quantity (2026-09-19): one piece on the stock ledger at
 * its value, no unit minted. A unit is minted with the QC the dialog took
 * (owner 2026-10-31: *"they will only do 1 QC"*) — `DITERIMA`, then, when it
 * passes the bench's own gate (`qcReady`), `QC_SELESAI` onto the shelf. One
 * that does not, an older draft with no description, waits in QC where
 * `OrphanQcCard` finds it. Returns the serial minted, if any.
 */
export function bookTradeIn(
  d: MockDb,
  x: TradeInLine,
  ctx: BookContext,
): string | undefined {
  const serial = (x.serial ?? "").trim().toUpperCase();
  if (x.skuId && !skuTracksSerial(d, x.skuId)) {
    d.stockMoves.push({
      id: ctx.nextId("sm"),
      skuId: x.skuId,
      locationId: d.myWarehouseId,
      qty: 1,
      cost: x.value,
      type: "TUKAR_TAMBAH",
      at: ctx.at,
      refCode: ctx.code,
      ...(ctx.orderId ? { orderId: ctx.orderId } : {}),
      note: x.label,
      staff: ctx.staff,
    });
    return undefined;
  }
  if (serial === "") return undefined;
  if (d.units.some((u) => u.serial === serial)) return undefined;
  const grade = gradeForCondition(x.condition ?? "SECOND", x.grade);
  d.units.push({
    serial,
    // The variant when the dialog recognised one, and "" when it did not.
    skuId: x.skuId ?? "",
    status: "QC",
    locationId: d.myWarehouseId,
    buy: x.value,
    // The phrases the dialog's QC chose; an older draft without one still
    // files its label, as it always did.
    description: x.qc
      ? splitDescription(x.qc.description ?? "")
          .map((phrase) => ctx.ensureQcDescription(d, phrase))
          .filter(Boolean)
          .join(", ")
      : x.label,
    poId: null,
    ...(grade ? { grade } : {}),
    ...(x.qc?.batteryHealth !== undefined
      ? { batteryHealth: x.qc.batteryHealth }
      : {}),
    ...(x.qc?.cycleCount !== undefined ? { cycleCount: x.qc.cycleCount } : {}),
    ...(x.qc?.fcc !== undefined ? { fcc: x.qc.fcc } : {}),
    ...(x.qc?.neverServiced !== undefined
      ? { neverServiced: x.qc.neverServiced }
      : {}),
    ...(x.qc?.price ? { price: x.qc.price } : {}),
  });
  ctx.appendEvent(d, serial, {
    type: "DITERIMA",
    toStatus: "QC",
    refCode: ctx.code,
    note: ctx.receivedNote,
  });
  const minted = d.units.find((u) => u.serial === serial)!;
  if (x.qc && qcReady(minted)) {
    ctx.appendEvent(d, serial, {
      type: "QC_SELESAI",
      toStatus: "TERSEDIA",
      refCode: ctx.code,
      note: ctx.qcNote,
    });
  }
  return serial;
}

/** Is this sale's trade-in recorded gross? See the header. */
export const isGross = (o: Pick<Order, "tradeInGross">): boolean =>
  o.tradeInGross === true;
