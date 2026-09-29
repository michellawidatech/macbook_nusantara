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
  PoFee,
  PoFeeKind,
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

/**
 * The bucket a payment for this expense is filed under — `Payment.appliedTo`.
 *
 * The schema's `PayTarget` has three members (goods, shipping, tax) and an
 * expense has four kinds, so customs and anything else file under tax, which
 * is where every non-shipping charge sat before expenses were a list. The
 * payment's `feeId` is what says which expense it really paid; this only keeps
 * the older bucket column truthful for anything that still reads it.
 */
export function payTargetOfFee(kind: PoFeeKind): PoPaymentFor {
  return kind === "SHIPPING" ? "SHIPPING" : "TAX";
}

/** One side of an invoice's money: what it is worth and what has been paid. */
export interface Standing {
  readonly due: number;
  readonly paid: number;
  /** Never negative: an overpayment is a supplier credit, not a negative debt. */
  readonly owed: number;
}

/** One expense, and what has been paid against it. */
export interface FeeStanding extends Standing {
  readonly fee: PoFee;
}

/** What an order costs and what is still owed. */
export interface PoTotals {
  /** Σ line totals, ignoring lines the supplier never sent. */
  readonly subtotal: number;
  /** Σ the invoice's expenses — shipping, tax, customs, anything. */
  readonly expenses: number;
  readonly total: number;
  readonly paid: number;
  /** Never negative: an overpayment is a supplier credit, not a negative debt. */
  readonly outstanding: number;
  readonly fullyPaid: boolean;
  /** The goods: the subtotal less the discount, and what was paid for them. */
  readonly goods: Standing;
  /** Every expense, in the invoice's order, and what was paid against each. */
  readonly feeStandings: readonly FeeStanding[];
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
 *
 * ## Which expense a payment paid (2026-09-18)
 *
 * A payment that names its expense (`feeId`) paid that expense. One recorded
 * before expenses were a list names only a bucket — shipping, or tax, which
 * held every other charge — and is spread over that bucket's expenses in
 * order, each filled before the next. What no expense can take, like a
 * payment against a bucket that has none, counts towards the goods: it is
 * money the supplier was paid on this invoice all the same.
 */
export function poTotals(po: Po): PoTotals {
  // Net of each line's own discount (owner ask 2026-09-20). `po.discount` is
  // the one negotiated off the whole order and is taken off below; this one
  // was given on particular goods, so it belongs to their line total.
  const subtotal = po.items
    .filter((i) => !i.notReceived)
    .reduce(
      (t, i) => t + Math.max(0, i.unitCost * i.qty - (i.discount ?? 0)),
      0,
    );
  const expenses = po.fees.reduce((t, f) => t + f.amount, 0);
  const total = Math.max(0, subtotal + expenses - po.discount);
  const paid = po.payments.reduce((t, p) => t + p.amount, 0);

  const paidFee = new Map(po.fees.map((f) => [f.id, 0]));
  let paidGoods = 0;
  /** Money that names a bucket and no expense. */
  const unlinked = { SHIPPING: 0, TAX: 0 };
  for (const p of po.payments) {
    if (p.feeId !== undefined && paidFee.has(p.feeId)) {
      paidFee.set(p.feeId, paidFee.get(p.feeId)! + p.amount);
      continue;
    }
    const bucket = paymentFor(p);
    if (bucket === "ORDER") paidGoods += p.amount;
    else unlinked[bucket] += p.amount;
  }
  for (const bucket of ["SHIPPING", "TAX"] as const) {
    let left = unlinked[bucket];
    for (const fee of po.fees) {
      if (left <= 0) break;
      if (payTargetOfFee(fee.kind) !== bucket) continue;
      const room = Math.max(0, fee.amount - paidFee.get(fee.id)!);
      const take = Math.min(room, left);
      paidFee.set(fee.id, paidFee.get(fee.id)! + take);
      left -= take;
    }
    paidGoods += left;
  }

  // The discount comes off the GOODS, which is where it was negotiated: a
  // supplier knocking a million off does not reduce the forwarder's bill.
  // Clamped at zero, so a discount larger than the goods it was given against
  // never turns into a credit an expense would have to absorb.
  const goodsDue = Math.max(0, subtotal - po.discount);
  return {
    subtotal,
    expenses,
    total,
    paid,
    outstanding: Math.max(0, total - paid),
    fullyPaid: total > 0 && paid >= total,
    goods: {
      due: goodsDue,
      paid: paidGoods,
      owed: Math.max(0, goodsDue - paidGoods),
    },
    feeStandings: po.fees.map((fee) => {
      const feePaid = paidFee.get(fee.id)!;
      return {
        fee,
        due: fee.amount,
        paid: feePaid,
        owed: Math.max(0, fee.amount - feePaid),
      };
    }),
  };
}

/**
 * The three states of the GOODS on an order — `Po.status`, and now a field
 * somebody can set rather than a consequence of pressing *Mark arrived*
 * (owner ask 2026-09-15: *"All of the information should be editable …
 * Status"*).
 *
 * In English, for the reason `PO_PAYMENT_STATUS_LABEL` gives: no `t` is in
 * scope in a module constant, so the call site renders `t(PO_STATUS_LABEL[…])`.
 * "Arrived" rather than "Received" because that is the word the rest of the
 * screen already uses — the button says *Mark arrived*, and a Status offering
 * "Received" beside it would read as a second, different idea.
 */
export const PO_STATUSES: readonly Po["status"][] = [
  "DRAFT",
  "ORDERED",
  "RECEIVED",
];

export const PO_STATUS_LABEL: Record<Po["status"], string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  RECEIVED: "Arrived",
};

/**
 * Where an invoice stands on MONEY — three answers (owner revision 2026-09-15,
 * renamed 2026-09-18).
 *
 * > *"I think we can change the payment status of each invoice to be 'open',
 * > 'partially paid', and 'fully paid'."*
 *
 * The middle one was called "Closed" until 2026-09-18, which said the
 * opposite of what it meant — and "closing" an invoice is a different act on
 * the same screen (`Po.closedAt`), so the codes changed with the words.
 *
 * This REPLACED `poStage` on the list and on the order's own header on
 * 2026-09-15. A stage answered "how far have the goods got", which the order's
 * own page already shows, while the question staff bring to the list is who is
 * still owed money. `poStage` and `unitStage` stay: a UNIT's stage is what the
 * reopen dialog names, and that has nothing to do with payment.
 *
 * ## Why an unpriced invoice with money against it is partly paid
 *
 * An order with no lines yet and a transfer against it is the owner's
 * paid-first case (see `poTotals`). It cannot be fully paid, because nobody
 * knows what full is; it is not open either, because money has moved. Partly
 * paid is the honest reading and the one that keeps the row in front of
 * whoever has to finish it.
 */
export type PoPaymentStatus =
  /** Nothing has been paid against it. */
  | "OPEN"
  /** Something has, but not all of it. */
  | "PARTIALLY_PAID"
  /** Settled in full. */
  | "FULLY_PAID";

/**
 * In English, because this is a module-level constant with no `t` in scope —
 * the same bargain `INBOUND_STAGE_LABEL` strikes. Every call site renders
 * `t(PO_PAYMENT_STATUS_LABEL[…])`, and `test/i18n.test.ts` lists these among
 * the strings whose English IS the key.
 */
export const PO_PAYMENT_STATUS_LABEL: Record<PoPaymentStatus, string> = {
  OPEN: "Open",
  PARTIALLY_PAID: "Partially paid",
  FULLY_PAID: "Fully paid",
};

export const PO_PAYMENT_STATUS_COLOR: Record<PoPaymentStatus, string> = {
  // Red rather than grey: an invoice nobody has paid anything against is the
  // one this column exists to surface.
  OPEN: "red",
  PARTIALLY_PAID: "gold",
  FULLY_PAID: "green",
};

/** Ordered as the money moves, for a facet that reads like a progression. */
export const PO_PAYMENT_STATUSES: readonly PoPaymentStatus[] = [
  "OPEN",
  "PARTIALLY_PAID",
  "FULLY_PAID",
];

/** Which of the three an invoice is at. Derived — there is no column for it. */
export function poPaymentStatus(po: Po): PoPaymentStatus {
  const { paid, fullyPaid } = poTotals(po);
  if (fullyPaid) return "FULLY_PAID";
  return paid > 0 ? "PARTIALLY_PAID" : "OPEN";
}

/**
 * What deleting an invoice would take with it, and what stops it.
 *
 * > *"Make the inbound deletable. with right click and add modal popup
 * > confirmation"* (owner ask 2026-09-15)
 *
 * Deleting is CANCELLING. Nothing is hard-deleted on the Postgres side — the
 * header goes to `BATAL`, its lines are marked removed and its payments voided
 * (`packages/db/src/store/adapters/documents.ts`) — and the browser's copy
 * simply stops carrying the row, which is what that projection leaves out.
 *
 * ## What it may take with it
 *
 * A machine still in QC. It exists only because this invoice said so: nobody
 * has graded it, nothing has been decided about it, and leaving it behind
 * would strand a unit on `OrphanQcCard` that no document explains.
 *
 * ## What stops it
 *
 * A machine that has LEFT QC — accepted onto a shelf, reserved, sold, sent to
 * the bench, returned to the supplier. The shop really did buy that machine on
 * this invoice, and an invoice is the only record of what it cost; deleting it
 * would leave a unit whose `buy` no document backs. Those are named rather
 * than counted, because the answer is to deal with each one — a QC reopen, a
 * stock adjustment — and a number tells nobody which.
 *
 * Payments do NOT stop it. Money paid against an invoice that turned out not
 * to exist is money paid to that supplier, which the supplier's own account is
 * what tracks.
 */
export interface PoDeletion {
  /** Serials that would go with the invoice — machines still in QC. */
  readonly takes: readonly string[];
  /** Serials that refuse it, because they have left QC. */
  readonly blockers: readonly string[];
  /** Whether the invoice can be deleted at all. */
  readonly allowed: boolean;
}

export function poDeletion(po: Po, units: readonly Unit[]): PoDeletion {
  const mine = units.filter((u) => u.poId === po.id);
  const takes = mine.filter((u) => u.status === "QC").map((u) => u.serial);
  const blockers = mine.filter((u) => u.status !== "QC").map((u) => u.serial);
  return {
    takes: [...takes].sort(),
    blockers: [...blockers].sort(),
    allowed: blockers.length === 0,
  };
}

/** Units belonging to an order, in serial order. */
export function unitsOfPo(db: MockDb, poId: string): Unit[] {
  return db.units
    .filter((u) => u.poId === poId)
    .sort((a, b) => a.serial.localeCompare(b.serial));
}
