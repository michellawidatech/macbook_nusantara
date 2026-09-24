/**
 * A customer return's money — and which sale it undoes.
 *
 * ## The owner's rule (brief of 2026-09-19)
 *
 * > *"If the unit is paid, it will be recorded as buying back from the
 * > customer. If the unit is unpaid, it will be recorded as return."*
 *
 * What the returned units are worth back — the CREDIT, their sale price less
 * anything charged for them (the form's "additional expense") — comes off the
 * sale's bill as an `OrderAdjustment` (RETUR, carrying the return's SG code),
 * and a PLAIN return applies it in this order (`applyReturnCredit`):
 *
 * 1. what the customer still OWES on the sale — their debt is cancelled, no
 *    money moves: an unpaid sale is simply a return;
 * 2. what a MARKETPLACE is still holding for it — the marketplace refunds the
 *    customer, not the shop;
 * 3. whatever is left is handed back in money — a `SaleRefund`: a paid sale
 *    is a buy-back.
 *
 * The credit is not overridable any more (owner, 2026-09-21: the "Refund
 * value" box went with the section around it). A unit is worth what it sold
 * for, less its expense.
 *
 * ## Exchanges (owner, 2026-09-21)
 *
 * > *"The user can add multiple product in exchange … If the unit they
 * > exchange for is cheaper than the one they purchase, the money will not
 * > return so no need to bring it back."*
 *
 * and, asked how far: one unit back for two out, and units back from two
 * sales at once, all of them exchanged for one, two or three. The
 * replacements go out on ONE of those sales — the one the form names — and
 * `planReturn` works out what that means for every sale involved:
 *
 * - replacements that cost LESS than what came back: no money goes back to
 *   the customer, from the shop or through a marketplace. The shop keeps the
 *   difference;
 * - replacements that cost MORE: the customer pays the difference now, as a
 *   settled payment on the sale taking them;
 * - money the customer put on ANOTHER sale in the return pays for the
 *   replacements by MOVING to the sale that takes them — the same method, the
 *   same state, the same day it arrived — so every sale still adds up on its
 *   own and no rupiah is counted twice.
 *
 * Pure: no React, no store. `test/returns.test.ts` is the spec.
 */
import { channelOf } from "./channels.js";
import {
  billAfterReturns,
  paymentsOf,
  refundedOf,
  saleBalance,
  type OrderAdjustmentRec,
  type PaymentState,
  type SalePayment,
  type SaleRefund,
} from "./salePayments.js";

/** How a return's credit was used. */
export interface ReturnMoney {
  readonly credit: number;
  /** The customer's debt it cancelled — unrecorded debt first, then DUE parts. */
  readonly debtCancelled: number;
  /** What a marketplace was holding for the sale that it cancelled. */
  readonly heldCancelled: number;
  /** What is handed back in money. */
  readonly refund: number;
  /** The sale's payments with the cancelled parts taken off. */
  readonly payments: SalePayment[];
}

/**
 * Take up to `amount` off the parts in one state, the newest first, editing
 * `parts` in place (each part it touches is replaced by a copy). `onTake` is
 * told what came off which part. Returns how much was taken.
 */
function cutParts(
  parts: SalePayment[],
  state: PaymentState,
  amount: number,
  onTake?: (part: SalePayment, n: number) => void,
): number {
  let left = amount;
  let taken = 0;
  for (let i = parts.length - 1; i >= 0 && left > 0; i -= 1) {
    const p = parts[i]!;
    if (p.state !== state || p.amount <= 0) continue;
    const n = Math.min(p.amount, left);
    parts[i] = { ...p, amount: p.amount - n };
    onTake?.(p, n);
    left -= n;
    taken += n;
  }
  return taken;
}

/** Whole rupiah, never below nothing. */
const whole = (n: number) => Math.max(0, Math.round(n));

/**
 * Apply a credit to a sale's money, in the owner's order. `bill` is the sale's
 * bill after any earlier return; `refunded` what was handed back before.
 */
export function applyReturnCredit(input: {
  readonly bill: number;
  readonly payments: readonly SalePayment[];
  readonly refunded?: number;
  readonly credit: number;
}): ReturnMoney {
  const credit = whole(input.credit);
  const balance = saleBalance(input.bill, input.payments, input.refunded ?? 0);
  let left = credit;
  const out = input.payments.map((p) => ({ ...p }));

  // Debt nobody wrote a row for disappears with the bill: nothing to edit.
  const unrecorded = Math.min(left, balance.unaccounted);
  left -= unrecorded;

  const due = cutParts(out, "DUE", left);
  left -= due;
  const held = cutParts(out, "PENDING", left);
  left -= held;
  // Never hand back more than the shop holds from this sale.
  const refund = Math.min(left, balance.settled);

  return {
    credit,
    debtCancelled: unrecorded + due,
    heldCancelled: held,
    refund,
    payments: out.filter((p) => p.amount > 0),
  };
}

/** One sale in a return, as `planReturn` reads it. */
export interface ReturnSaleInput {
  readonly id: string;
  /** The sale's code — named on any money moved off it. */
  readonly code: string;
  /** Its bill before this return: `billAfterReturns(order)`. */
  readonly bill: number;
  /** `paymentsOf(order)`. */
  readonly payments: readonly SalePayment[];
  /** Handed back on it before: `refundedOf(order)`. */
  readonly refunded?: number;
  /** What its ticked units and lines are worth back — price less expense. */
  readonly credit: number;
}

/** What a return does to one sale. */
export interface ReturnSalePlan {
  readonly id: string;
  /**
   * What comes off this sale's bill: the total of its RETUR adjustments, to be
   * split over the units and lines coming back on it (`splitByWeight`).
   */
  readonly applied: number;
  /** Its payments after the return — no part of zero or less. */
  readonly payments: SalePayment[];
  /** Money handed back on it. Only a plain return ever hands any back. */
  readonly refund: number;
  /** Customer debt on it the return cancelled. */
  readonly debtCancelled: number;
  /** Money a marketplace held for it the return cancelled (plain return). */
  readonly heldCancelled: number;
  /** Money moved off it to the sale taking the replacements. */
  readonly movedOut: number;
  /** On the sale taking the replacements: money moved in from the others. */
  readonly movedIn: number;
  /** On the sale taking the replacements: what the customer pays now. */
  readonly topUp: number;
}

/** What a whole return does. */
export interface ReturnPlan {
  /** One per sale given, in the order given. */
  readonly sales: readonly ReturnSalePlan[];
  /** True when something goes out in exchange. */
  readonly exchange: boolean;
  /** The sale the replacements go out on — an exchange only. */
  readonly into?: string;
  /** Money handed back, all sales together. Zero on an exchange. */
  readonly refund: number;
  /** What the customer pays now for the exchange. */
  readonly topUp: number;
  /**
   * Credit an exchange did not need — replacements cheaper than what came
   * back. The shop keeps what it stands for and nothing goes back (owner,
   * 2026-09-21).
   */
  readonly unused: number;
}

/** The replacements of an exchange, as `planReturn` reads them. */
export interface ExchangeInput {
  /** What they cost together — every unit's price, every line's qty × price. */
  readonly total: number;
  /** The sale they go out on. One of `sales`. */
  readonly into: string;
}

/**
 * What a return does to the money of every sale it touches.
 *
 * **A plain return** (no `exchange`): each sale on its own, by
 * `applyReturnCredit` — its debt first, then what a marketplace holds, then
 * money back. The credit is applied whole.
 *
 * **An exchange** — anything at all going out instead, even a unit given away
 * at Rp0. With E the sale taking the replacements and R their total:
 *
 * 1. Every OTHER sale cancels its own customer debt first (unaccounted debt,
 *    then DUE parts newest first) — what is left of its credit can move to E
 *    only as far as money the customer actually put on it (settled or held by
 *    a marketplace).
 * 2. The pool is E's own credit plus what the others can move. What is used
 *    of it is capped at R plus E's own debt; beyond that it is the shop's.
 *    Short of R, the customer pays the rest now (the top-up).
 * 3. E's own credit is used first, then the others' in list order. Money
 *    moved off a sale comes from its settled parts first, newest first, then
 *    from what a marketplace holds; each piece lands on E as a copy keeping
 *    its method, state, channel, marketplace reference and the day it
 *    arrived.
 * 4. A sale's applied credit is only what was USED of it — what cancelled its
 *    debt and what moved (or, on E, what paid for the replacements). The rest
 *    is not taken off its bill, which is what "the money will not return"
 *    means in the ledger: that sale keeps the money it was paid.
 * 5. On E, anything recorded above its new bill comes off its DUE parts,
 *    newest first — so the customer's debt there shrinks by exactly what the
 *    pool had left over, capped at the debt. Nothing is ever handed back.
 *
 * `newId` names every payment part it creates. `code` is the return's code,
 * written into their notes.
 */
export function planReturn(input: {
  readonly sales: readonly ReturnSaleInput[];
  readonly exchange?: ExchangeInput;
  /** How a top-up is paid — TUNAI or TRANSFER. */
  readonly method: string;
  /** When: a top-up's `at`. */
  readonly at: string;
  /** The return's code, for the notes on the parts it writes. */
  readonly code: string;
  readonly newId: () => string;
}): ReturnPlan {
  const { exchange, newId, code } = input;

  if (exchange === undefined) {
    const sales = input.sales.map((s): ReturnSalePlan => {
      const m = applyReturnCredit(s);
      return {
        id: s.id,
        applied: m.credit,
        payments: m.payments,
        refund: m.refund,
        debtCancelled: m.debtCancelled,
        heldCancelled: m.heldCancelled,
        movedOut: 0,
        movedIn: 0,
        topUp: 0,
      };
    });
    return {
      sales,
      exchange: false,
      refund: sales.reduce((t, s) => t + s.refund, 0),
      topUp: 0,
      unused: 0,
    };
  }

  const total = whole(exchange.total);
  const e =
    input.sales.find((s) => s.id === exchange.into) ??
    input.sales[input.sales.length - 1];
  if (e === undefined) {
    return {
      sales: [],
      exchange: true,
      refund: 0,
      topUp: total,
      unused: 0,
    };
  }

  // 1. Every other sale: its own debt first, then what could move.
  const others = input.sales
    .filter((s) => s !== e)
    .map((s) => {
      const credit = whole(s.credit);
      const balance = saleBalance(s.bill, s.payments, s.refunded ?? 0);
      const parts = s.payments.map((p) => ({ ...p }));
      const debt = Math.min(credit, balance.customerOwes);
      // Unaccounted debt disappears with the bill; the rest is DUE rows.
      cutParts(parts, "DUE", debt - Math.min(debt, balance.unaccounted));
      const movable = Math.min(
        credit - debt,
        balance.settled + balance.pending,
      );
      return { s, balance, parts, debt, movable };
    });

  // 2. The pool, and how much of it the exchange uses.
  const creditE = whole(e.credit);
  const balanceE = saleBalance(e.bill, e.payments, e.refunded ?? 0);
  const pool = creditE + others.reduce((t, o) => t + o.movable, 0);
  const used = Math.min(pool, total + balanceE.customerOwes);
  const topUp = Math.max(0, total - pool);

  // 3. E's own credit first, then the others' in list order.
  const usedE = Math.min(creditE, used);
  let remaining = used - usedE;
  const movedIn: SalePayment[] = [];
  const plans = new Map<ReturnSaleInput, ReturnSalePlan>();
  for (const o of others) {
    const moved = Math.min(o.movable, remaining);
    remaining -= moved;
    // Settled money first — no more of it than the shop still holds, since
    // an earlier refund has already left from it — then a marketplace's.
    const fromSettled = Math.min(moved, o.balance.settled);
    const moveFrom = (state: PaymentState, amount: number) => {
      const taken: SalePayment[] = [];
      cutParts(o.parts, state, amount, (p, n) => {
        taken.push({
          id: newId(),
          method: p.method,
          amount: n,
          state: p.state,
          ...(p.channel === undefined ? {} : { channel: p.channel }),
          at: p.at,
          ...(p.ref === undefined ? {} : { ref: p.ref }),
          note: `Moved from ${o.s.code} — exchange ${code}`,
        });
      });
      // Taken newest first; they land on E oldest first, as they arrived.
      return taken.reverse();
    };
    movedIn.push(
      ...moveFrom("SETTLED", fromSettled),
      ...moveFrom("PENDING", moved - fromSettled),
    );
    plans.set(o.s, {
      id: o.s.id,
      applied: o.debt + moved,
      payments: o.parts.filter((p) => p.amount > 0),
      refund: 0,
      debtCancelled: o.debt,
      heldCancelled: 0,
      movedOut: moved,
      movedIn: 0,
      topUp: 0,
    });
  }

  // 4–5. E: its own parts, what moved in, the top-up — and no more recorded
  // than its new bill, the excess coming off its DUE parts.
  const partsE: SalePayment[] = [
    ...e.payments.map((p) => ({ ...p })),
    ...movedIn,
  ];
  if (topUp > 0) {
    partsE.push({
      id: newId(),
      method: input.method,
      amount: topUp,
      state: "SETTLED",
      at: input.at,
      note: `Exchange top-up (${code})`,
    });
  }
  const billE = Math.max(0, e.bill - usedE + total);
  const excess = saleBalance(billE, partsE, e.refunded ?? 0).recorded - billE;
  if (excess > 0) cutParts(partsE, "DUE", excess);
  const paymentsE = partsE.filter((p) => p.amount > 0);
  const owedAfter = saleBalance(billE, paymentsE, e.refunded ?? 0).customerOwes;
  plans.set(e, {
    id: e.id,
    applied: usedE,
    payments: paymentsE,
    refund: 0,
    debtCancelled: Math.max(0, balanceE.customerOwes - owedAfter),
    heldCancelled: 0,
    movedOut: 0,
    movedIn: used - usedE,
    topUp,
  });

  return {
    sales: input.sales.map((s) => plans.get(s)!),
    exchange: true,
    into: e.id,
    refund: 0,
    topUp,
    unused: pool - used,
  };
}

/**
 * Split a whole-rupiah amount over weights, largest remainder — so the parts
 * always add back up to the whole. What a sale's applied credit is, unit by
 * unit and line by line. A weight of zero gets nothing — unless every weight
 * is zero, when the first takes it all.
 */
export function splitByWeight(
  amount: number,
  weights: readonly number[],
): number[] {
  const total = weights.reduce((t, w) => t + Math.max(0, w), 0);
  if (weights.length === 0) return [];
  if (total === 0) {
    const even = weights.map((_, i) => (i === 0 ? amount : 0));
    return even;
  }
  const exact = weights.map((w) => (amount * Math.max(0, w)) / total);
  const floors = exact.map(Math.floor);
  let rest = amount - floors.reduce((t, n) => t + n, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return floors;
}

/** A sale as returns read it. */
export interface ReturnableOrder {
  readonly id: string;
  readonly code: string;
  readonly ts: string;
  readonly customerId: string | null;
  readonly serials: readonly string[];
  readonly prices: Readonly<Record<string, number>>;
  readonly total: number;
  readonly payMethod: string;
  readonly settled: boolean;
  readonly source: string;
  readonly payments?: readonly SalePayment[];
  readonly refunds?: readonly SaleRefund[];
  readonly adjustments?: readonly OrderAdjustmentRec[];
}

/**
 * The sale a unit that is out of the door went out on: the newest receipt
 * carrying its serial. A unit sold, returned and sold again is on two
 * receipts, and only the second is still with a customer.
 */
export function saleOfSerial<O extends ReturnableOrder>(
  orders: readonly O[],
  serial: string,
): O | undefined {
  let found: O | undefined;
  for (const o of orders) {
    if (!o.serials.includes(serial)) continue;
    if (found === undefined || o.ts > found.ts) found = o;
  }
  return found;
}

/**
 * The units of `sale` that can come back ON IT: sold (`statusOf` says
 * TERJUAL), on this receipt as their newest one, and not already on a
 * customer return still waiting for them (`pending`).
 *
 * The middle condition is the one that matters on an old receipt: a unit
 * sold, returned and sold again is on two receipts, and it can only come back
 * on the second.
 */
export function returnableSerials<O extends ReturnableOrder>(
  sale: O,
  orders: readonly O[],
  statusOf: (serial: string) => string | undefined,
  pending: ReadonlySet<string>,
): string[] {
  return sale.serials.filter(
    (s) =>
      statusOf(s) === "TERJUAL" &&
      !pending.has(s) &&
      saleOfSerial(orders, s)?.id === sale.id,
  );
}

/**
 * The sale a recorded return undid: the one carrying its RETUR adjustment
 * (the SG code), or — for a return recorded before adjustments existed — the
 * newest receipt of its serial dated on or before the return.
 */
export function saleOfReturn<O extends ReturnableOrder>(
  orders: readonly O[],
  ret: {
    readonly code: string;
    readonly serial: string;
    readonly date: string;
  },
): O | undefined {
  const byCode = orders.find((o) =>
    (o.adjustments ?? []).some((a) => a.code === ret.code),
  );
  if (byCode) return byCode;
  let found: O | undefined;
  for (const o of orders) {
    if (!o.serials.includes(ret.serial)) continue;
    if (o.ts.slice(0, 10) > ret.date) continue;
    if (found === undefined || o.ts > found.ts) found = o;
  }
  return found;
}

/**
 * The marketplace order numbers a sale's payments carry, each with the
 * marketplace's name — `["Shopee 260912RGK2YKYU"]`.
 *
 * Written into the reason of the sale's RETUR adjustments, because a return
 * that cancels what Shopee was holding removes the payment and the reference
 * with it — and a Shopee file listing that order as refunded is later matched
 * to the sale through these words (`lib/shopeeRefunds.ts`).
 */
export function marketplaceRefs(
  payments: readonly Pick<SalePayment, "ref" | "channel">[],
  source: string,
): string[] {
  const out: string[] = [];
  for (const p of payments) {
    const ref = p.ref?.trim();
    if (!ref) continue;
    const name = channelOf(p.channel ?? source)?.label;
    const said = name ? `${name} ${ref}` : ref;
    if (!out.includes(said)) out.push(said);
  }
  return out;
}

/** A sale's money as it stands, for the form to show before a return. */
export function saleMoney(order: ReturnableOrder) {
  return {
    bill: billAfterReturns(order),
    payments: paymentsOf(order),
    refunded: refundedOf(order),
  };
}
