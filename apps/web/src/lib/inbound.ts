/**
 * Inbound: what a purchase order costs, what has been paid, and how far its
 * goods have got.
 *
 * The Inbound screen merged the Purchase Order and Stock In (QC) pages on
 * 2026-08-24. They were always one job seen twice — an order is raised, goods
 * turn up, each serial is graded onto a shelf — and splitting them across two
 * menu items meant the question "where is that order up to?" had no screen that
 * could answer it.
 *
 * Three intake stories have to work, and they are the reason the stage below is
 * derived rather than stored:
 *
 * 1. **Goods match the invoice.** Lines are entered, the goods arrive, each one
 *    is graded.
 * 2. **Goods do not match.** A line never turns up (`notReceived`), a different
 *    product arrives instead, or the price on the invoice is not the price that
 *    was paid.
 * 3. **Paid first, product later.** The owner wires money against an invoice
 *    without telling the staff what it buys. The order exists with a payment
 *    and no lines at all, and the products are filled in when the boxes land.
 *
 * A stored status cannot survive story 3: on the day it is raised, such an
 * order is simultaneously "ordered", "nothing received" and "fully paid", and
 * any single column has to pick one and be wrong about the others.
 */
import type {
  MockDb,
  Po,
  PoPayment,
  PoPaymentFor,
  Unit,
} from "../mock/seed.js";

/**
 * How far a unit — or a whole order — has got.
 *
 * `ARRIVED` and `IN_QC` are both `UnitStatus.QC` in the schema; nothing
 * separates them there and nothing needs to. The difference is whether anyone
 * has started recording, which is a question the QC data itself answers, so
 * deriving it costs no column and cannot drift from what staff actually did.
 */
export type InboundStage =
  | "PENDING"
  | "ARRIVED"
  | "IN_QC"
  | "ON_SERVICE"
  | "REJECTED"
  | "IN_INVENTORY"
  /**
   * Filed away — an order-level stage only, and the one stage no unit can be
   * at (owner revision 2026-08-27). It outranks everything below because a
   * person said so: closing is the answer to "is this order finished with?",
   * which is the question the whole column exists to answer, and a closed
   * order with one ungraded machine is closed anyway. See `Po.closedAt`.
   */
  | "CLOSED";

export const INBOUND_STAGE_LABEL: Record<InboundStage, string> = {
  PENDING: "Pending",
  ARRIVED: "Arrived",
  IN_QC: "In QC",
  ON_SERVICE: "On service",
  REJECTED: "Returned to supplier",
  IN_INVENTORY: "In inventory",
  CLOSED: "Closed",
};

export const INBOUND_STAGE_COLOR: Record<InboundStage, string> = {
  PENDING: "default",
  ARRIVED: "blue",
  IN_QC: "gold",
  ON_SERVICE: "purple",
  REJECTED: "red",
  IN_INVENTORY: "green",
  CLOSED: "default",
};

/**
 * Ordered worst-first, which is what makes an order's stage its least-far unit.
 *
 * `ON_SERVICE` and `REJECTED` sit at the END, beside `IN_INVENTORY`, and that
 * placement is deliberate: they are not stalled units, they are FINISHED ones.
 * A unit sent to the bench or shipped back to the supplier has had its QC
 * decision made, and an order should not read as "still being worked on"
 * because one of its machines was refused. Putting them earlier would hold
 * every such order at the rejected unit's stage forever, since nothing further
 * ever happens to it against this order.
 */
const STAGE_ORDER: InboundStage[] = [
  "PENDING",
  "ARRIVED",
  "IN_QC",
  "ON_SERVICE",
  "REJECTED",
  "IN_INVENTORY",
  // Last, and unreachable by this list's one caller: `poStage` answers CLOSED
  // before it ever looks at a unit, and no unit is ever at this stage. It is
  // here so the array stays a total ordering of the type rather than a partial
  // one that returns -1 for a member nobody expected to pass in.
  "CLOSED",
];

/**
 * The stage one unit is at.
 *
 * A unit still in QC counts as merely `ARRIVED` until someone records something
 * about it — a price, a description, or a battery reading. That is the honest
 * reading of "in QC": the box is open and work has started, as opposed to a
 * pallet nobody has touched.
 *
 * ⚠️ Every non-QC status used to fall through to `IN_INVENTORY`, which was a
 * real bug rather than a simplification (fixed 2026-08-26): pressing *Service*
 * or *Reject* on the QC table moved the unit correctly and then painted it with
 * a green "In inventory" tag, because this function could not tell a unit that
 * had passed QC from one that had been refused. The person who had just
 * refused a machine was shown the machine entering stock. The three outcomes of
 * QC are now three stages, and the tag says which one happened.
 */
export function unitStage(unit: Unit): InboundStage {
  if (unit.status === "SERVIS") return "ON_SERVICE";
  if (unit.status === "RETUR_SUPPLIER") return "REJECTED";
  if (unit.status !== "QC") return "IN_INVENTORY";
  // A price used to count as a sign of work, because QC asked for one per
  // serial. It does not any more — the price is the variant's and is set on the
  // Product — so what marks a box as opened is what somebody wrote ABOUT this
  // particular machine: its condition, or a battery reading off the screen.
  // Either era's reading counts as work: a 2017 body is measured in cycles
  // and a 2023 one in percent, and a box opened is a box opened.
  const started =
    unit.description.trim() !== "" ||
    unit.batteryHealth != null ||
    unit.cycleCount != null ||
    unit.fcc != null;
  return started ? "IN_QC" : "ARRIVED";
}

/**
 * The stage an order is at: the stage of its least-far machine.
 *
 * Least-far, not most-far, because the question the column answers is "is this
 * order finished with?". An order with nine graded units and one still in its
 * box is not finished, and showing it as "In inventory" is how the tenth unit
 * gets forgotten.
 *
 * `po.status` is what says the goods physically turned up, and since
 * 2026-08-26 it is the ONLY thing that can. Arrival used to mint a placeholder
 * unit per line-quantity, so "has any unit at all?" stood in for "has it
 * arrived?"; now a unit exists only once someone has read a serial off a
 * machine, and an order can be sitting on the bench with every serial still
 * unread. Asking the units would report that as `PENDING` — "nothing has
 * turned up" — for the whole of the job it is describing.
 *
 * An order with no lines at all is `PENDING` however much has been paid —
 * story 3 above. Lines marked `notReceived` are excluded: they are part of
 * what was invoiced, not part of what turned up, so an order whose only
 * outstanding line is one the supplier never sent is genuinely complete.
 *
 * ⚠️ `expected` sums QUANTITIES, not lines. Counting lines (the reading until
 * 2026-08-26) meant a single line of qty 3 was satisfied by one graded unit,
 * so an order read "In inventory" with two machines still unaccounted for —
 * the exact forgetting the least-far rule above exists to prevent.
 */
export function poStage(po: Po, units: readonly Unit[]): InboundStage {
  // Before anything derived, because closing is a statement ABOUT the derived
  // answer: somebody looked at whatever this would have said and decided the
  // order is finished with regardless.
  if (poClosed(po)) return "CLOSED";
  if (po.status !== "RECEIVED") return "PENDING";

  const mine = units.filter((u) => u.poId === po.id);
  const expected = po.items
    .filter((i) => !i.notReceived)
    .reduce((n, i) => n + i.qty, 0);
  // Received, but nobody has said what it was for: story 3, still pending.
  if (expected === 0 && mine.length === 0) return "PENDING";

  // A machine the invoice expects that has no serial yet has had nothing done
  // to it at all, which is precisely `ARRIVED`.
  let worst: InboundStage = mine.length < expected ? "ARRIVED" : "IN_INVENTORY";
  for (const u of mine) {
    const stage = unitStage(u);
    if (STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(worst)) worst = stage;
  }
  return worst;
}

/**
 * The same rule as {@link poStage}, computed from the API's counts.
 *
 * A second function rather than a shared one, because the two have genuinely
 * different inputs: `poStage` reads a whole `Po` and every `Unit` in the shop
 * out of the browser mock, and this reads a row the server already aggregated.
 * Making one serve both would mean shipping every unit to the client purely so
 * the mock's signature could be honoured — which is the opposite of the reason
 * the list moved to the API.
 *
 * The reading is the one `poStage`'s docblock argues for, unchanged: the stage
 * of the LEAST-far machine, because the question the column answers is "is this
 * order finished with?", and an order with nine graded units and one still in
 * its box is not finished.
 */
export function poStageFromCounts(row: {
  readonly status: string;
  readonly closedAt: string | null;
  readonly qty: number;
  readonly identified: number;
  readonly accepted: number;
  readonly inQc: number;
  readonly describedInQc: number;
  readonly returned: number;
  readonly onService: number;
}): InboundStage {
  // Before anything derived: closing is a statement ABOUT the derived answer.
  if (row.closedAt !== null && row.closedAt !== "") return "CLOSED";
  // DITERIMA is what says the goods physically turned up, and since 2026-08-26
  // it is the only thing that can — an order can sit on the bench with every
  // serial still unread, and asking the units would call that "nothing has
  // turned up" for the whole of the job it is describing.
  if (row.status !== "DITERIMA") return "PENDING";
  // Received, and nobody has said what it was for.
  if (row.qty === 0 && row.identified === 0) return "PENDING";

  // Least-far wins, so the checks run from the least far forward.
  if (row.onService > 0) return "ON_SERVICE";
  if (row.returned > 0) return "REJECTED";
  // A machine the invoice expects that has no serial yet has had nothing done
  // to it at all, and one with a serial and no description is the same.
  if (row.identified < row.qty) return "ARRIVED";
  if (row.inQc > row.describedInQc) return "ARRIVED";
  if (row.inQc > 0) return "IN_QC";
  return "IN_INVENTORY";
}

/** Whether somebody has filed this order away. See `Po.closedAt`. */
export function poClosed(po: Po): boolean {
  return typeof po.closedAt === "string" && po.closedAt !== "";
}

/**
 * Which part of the invoice a payment was settling.
 *
 * A payment recorded before the buckets existed said nothing, and "nothing"
 * means the goods: shipping and tax were separate figures on the order long
 * before anyone could pay them separately, so a bare transfer was always
 * against the machines. Reading a missing value as `ORDER` keeps the old rows
 * adding up instead of stranding them in a fourth, unlabelled column.
 */
export function paymentFor(p: PoPayment): PoPaymentFor {
  return p.appliedTo ?? "ORDER";
}

/**
 * Whether a QC decision on this machine can still be taken back.
 *
 * The owner asked for this outright (2026-08-27): staff accept the wrong
 * machine into stock, or send the wrong one back to the supplier, and until
 * now the only remedy was a stock adjustment that told the story wrong. A
 * reopen writes a `KOREKSI` event and puts the unit back in QC — the ledger
 * keeps both the mistake and the correction, which is the whole point of an
 * append-only ledger.
 *
 * It stops where the machine stops being the shop's alone. Reserved, sold or
 * written off means somebody outside this screen has acted on it, and pulling
 * such a unit back to a QC bench would be a claim about a machine that is
 * promised to a customer or already out of the door. Those are corrected where
 * they happened — the reservation, the sale, Stock Movement.
 *
 * ⚠️ `packages/domain/unitState.ts` has no arrow back into QC, and
 * `RETUR_SUPPLIER` is terminal there. This is the web build's behaviour on the
 * mock store; wiring it to the API needs that state machine changed first, and
 * that is an owner decision.
 */
export function canReopenQc(unit: Unit): boolean {
  return ["TERSEDIA", "SERVIS", "RETUR_SUPPLIER"].includes(unit.status);
}

/** What an order costs and what is still owed. */
export interface PoTotals {
  /** Σ line totals, ignoring lines the supplier never sent. */
  readonly subtotal: number;
  /** Shipping + tax, less any negotiated discount. */
  readonly fees: number;
  readonly total: number;
  readonly paid: number;
  /** Never negative: an overpayment is a supplier credit, not a negative debt. */
  readonly outstanding: number;
  readonly fullyPaid: boolean;
  /** What each bucket is worth on the invoice. Sums to `total`. */
  readonly due: Readonly<Record<PoPaymentFor, number>>;
  /** What has actually been transferred against each bucket. */
  readonly paidFor: Readonly<Record<PoPaymentFor, number>>;
  /** Still owed per bucket, never negative — same rule as `outstanding`. */
  readonly owedFor: Readonly<Record<PoPaymentFor, number>>;
}

/**
 * Money on an order.
 *
 * A line the supplier never sent still shows in the list — staff need to see
 * what was invoiced — but it does not add to what is owed. Charging for goods
 * that never arrived is precisely the mistake the `notReceived` flag exists to
 * prevent.
 *
 * With no lines at all (story 3) the total is zero and everything paid reads as
 * an overpayment. That is correct rather than awkward: until someone says what
 * was bought, the shop genuinely holds credit with that supplier, and the
 * screen says "paid Rp X, nothing invoiced yet".
 */
export function poTotals(po: Po): PoTotals {
  const subtotal = po.items
    .filter((i) => !i.notReceived)
    .reduce((t, i) => t + i.unitCost * i.qty, 0);
  const fees = po.shippingFee + po.taxFee - po.discount;
  const total = Math.max(0, subtotal + fees);
  const paid = po.payments.reduce((t, p) => t + p.amount, 0);

  // The discount comes off the GOODS, which is where it was negotiated: a
  // supplier knocking a million off does not reduce the forwarder's bill.
  // Clamped at zero, so a discount larger than the goods it was given against
  // never turns the bucket into a credit the shipping bucket would have to
  // absorb — the three then sum to slightly more than `total`, which is a
  // rounding of an invoice nobody has ever written rather than an error worth
  // machinery.
  const due: Record<PoPaymentFor, number> = {
    ORDER: Math.max(0, subtotal - po.discount),
    SHIPPING: po.shippingFee,
    TAX: po.taxFee,
  };
  const paidFor: Record<PoPaymentFor, number> = {
    ORDER: 0,
    SHIPPING: 0,
    TAX: 0,
  };
  for (const p of po.payments) paidFor[paymentFor(p)] += p.amount;

  return {
    subtotal,
    fees,
    total,
    paid,
    outstanding: Math.max(0, total - paid),
    fullyPaid: total > 0 && paid >= total,
    due,
    paidFor,
    owedFor: {
      ORDER: Math.max(0, due.ORDER - paidFor.ORDER),
      SHIPPING: Math.max(0, due.SHIPPING - paidFor.SHIPPING),
      TAX: Math.max(0, due.TAX - paidFor.TAX),
    },
  };
}

/** Units belonging to an order, in serial order. */
export function unitsOfPo(db: MockDb, poId: string): Unit[] {
  return db.units
    .filter((u) => u.poId === poId)
    .sort((a, b) => a.serial.localeCompare(b.serial));
}
