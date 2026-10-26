/**
 * What sending a unit to service, paying for a repair and taking either back
 * WRITE — the rules behind every door into the bench (owner asks 2026-10-26,
 * docs/superpowers/specs/2026-10-26-service-returns-qc-design.md §2 and §4).
 *
 * ## One dialog, one plan
 *
 * Inbound & QC, Inventory's unit rows and the bench itself all send a unit to
 * service, and until now each wrote it its own way: QC asked about a courier
 * and a quote, Inventory's stock-out asked nothing, and both picked "the
 * bench" by `Location.kind`. `planSendToService` is the one answer, and
 * `components/SendToServiceModal` the one dialog that asks for it.
 *
 * ## A charge is paid, or it is owed
 *
 * A paid charge is an `Expense` of kind UNIT naming it
 * (`Expense.serviceFeeId`) — that is how service money reaches Income &
 * Expense. It is already in the unit's cost (`costOfUnit`), so Profit & Loss
 * keeps UNIT out of its operating expenses and nothing is counted twice. An
 * owed charge has no expense and still counts in the cost: the shop owes it
 * whether or not it has paid it yet.
 *
 * ⚠️ The CHARGE owns its expense. An account without finance access is sent no
 * expenses at all, so it cannot remove or correct one — the server does it
 * for it when the charge is removed or its amount changes. A finance account's
 * browser does the same in its own copy, and the server accepts that too.
 * `fee.paid` is how the bench knows a charge is paid without seeing the
 * expense; taking a payment BACK ("Not paid yet" on a paid charge) needs the
 * expense itself, so only an account that can see it is offered that.
 *
 * ## Taking it back
 *
 * A charge, or a whole visit, can be deleted — the sixth sanctioned hard
 * delete, and only these two rows. The history rows the visit wrote go with it
 * through the ordinary remove-event path, so the unit falls back to what it
 * was before it was sent. A visit the unit has since moved on from is refused:
 * removing its rows from the middle of a history would leave the projection
 * describing a visit that no longer exists.
 *
 * Pure: no React, no store. `test/serviceActions.test.ts` is the spec.
 */
import dayjs from "dayjs";
import { isBookClosed, type BookCloseSettings } from "./bookClose.js";
import type { ServiceFee, ServiceRec } from "./service.js";
import type { Expense, UnitEvent, UnitStatus } from "../mock/seed.js";

/** How a charge was paid — the three methods a repairer is paid with — or not. */
export type PaidWith = "TRANSFER" | "TRANSFER_LUAR" | "TUNAI" | "UNPAID";

/** The four choices, in the order the dialog draws them. */
export const PAID_WITH: readonly PaidWith[] = [
  "UNPAID",
  "TRANSFER",
  "TRANSFER_LUAR",
  "TUNAI",
];

export const isPaidWith = (v: unknown): v is PaidWith =>
  typeof v === "string" && (PAID_WITH as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Who may go
// ---------------------------------------------------------------------------

/** Why a unit cannot be sent to service; undefined when it can. */
export type SendBlock =
  /** Reserved: it belongs to a customer until the hold is released. */
  | "HELD"
  /** Already away. */
  | "AT_SERVICE"
  /** Sold, written off or back with its supplier. */
  | "NOT_IN_STOCK";

/**
 * A unit in QC or on the shelf can go; nothing else can. A held unit is the
 * customer's until somebody releases it — sending it away from under them is
 * the hold the 2026-09-08 reservation fix exists to keep.
 */
export function sendToServiceBlock(status: UnitStatus): SendBlock | undefined {
  switch (status) {
    case "QC":
    case "TERSEDIA":
      return undefined;
    case "DIRESERVASI":
      return "HELD";
    case "SERVIS":
      return "AT_SERVICE";
    default:
      return "NOT_IN_STOCK";
  }
}

// ---------------------------------------------------------------------------
// Days and the closed book
// ---------------------------------------------------------------------------

/** The local calendar day of an instant — the day an expense is filed under. */
export function localDay(iso: string): string {
  return dayjs(iso).format("YYYY-MM-DD");
}

/**
 * Is this calendar day inside the closed book? Judged on the DAY, as an
 * Income & Expense adjustment is (`adjustmentDeletionBlock`) and as the server
 * judges a service charge (`assertServiceBooksOpen`, Jakarta day): its first
 * instant against the closing one.
 */
export function dayClosed(
  day: string,
  settings: BookCloseSettings | undefined,
): boolean {
  return isBookClosed(dayjs(day).startOf("day").toISOString(), settings);
}

/** Is an instant's day inside the closed book? */
export function instantClosed(
  at: string,
  settings: BookCloseSettings | undefined,
): boolean {
  return dayClosed(localDay(at), settings);
}

// ---------------------------------------------------------------------------
// A charge's money
// ---------------------------------------------------------------------------

/** Where a charge stands: paid (by which expense, when it is visible) or owed. */
export interface FeePayment {
  readonly paid: boolean;
  /**
   * The expense, when this browser holds it — a finance account's. An account
   * without finance access sees `paid` from `fee.paid` and no expense.
   */
  readonly expense?: Expense;
}

export function feePayment(
  fee: Pick<ServiceFee, "id" | "paid">,
  expenses: readonly Expense[],
): FeePayment {
  const expense = expenses.find((e) => e.serviceFeeId === fee.id);
  return expense ? { paid: true, expense } : { paid: fee.paid === true };
}

/** What the expense says it was for: the serial, then the charge's own words. */
export function chargeNote(
  serial: string,
  fee: Pick<ServiceFee, "label" | "kind">,
) {
  return `${serial} · ${fee.label?.trim() || KIND_WORD[fee.kind]}`;
}

/** Stored, so English and frozen — the same footing as every event note. */
const KIND_WORD: Record<ServiceFee["kind"], string> = {
  LABOUR: "Labour",
  PART: "Part",
  SHIPPING: "Shipping",
  OTHER: "Other",
};

/** The expense that pays a charge. */
export function chargeExpense(input: {
  readonly id: string;
  readonly serial: string;
  readonly fee: Pick<ServiceFee, "id" | "label" | "kind" | "amount">;
  readonly method: Exclude<PaidWith, "UNPAID">;
  /** The day it was paid, `YYYY-MM-DD`. The charge's own day by default. */
  readonly day: string;
  readonly createdAt: string;
}): Expense {
  return {
    id: input.id,
    kind: "UNIT",
    amount: input.fee.amount,
    date: input.day,
    method: input.method,
    note: chargeNote(input.serial, input.fee),
    serviceFeeId: input.fee.id,
    createdAt: input.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Sending a unit
// ---------------------------------------------------------------------------

export interface SendInput {
  readonly unit: {
    readonly serial: string;
    readonly locationId: string;
  };
  /** Where it is serviced. Its own warehouse means it does not travel. */
  readonly dest: string;
  /** The courier, asked only when it travels. */
  readonly shippingFee?: number;
  readonly shippingPaid?: PaidWith;
  /** The repairer's quote, if anybody knows it yet. */
  readonly quote?: number;
  readonly quotePaid?: PaidWith;
  readonly note?: string;
  readonly raisedBy: ServiceRec["raisedBy"];
  readonly poId?: string;
  /** The one instant the send event, the visit and its charges share. */
  readonly at: string;
  readonly staff: string;
  /** Stored words, in the language of whoever sent it. */
  readonly words: {
    readonly shipLabel: string;
    readonly quoteLabel: string;
    /** "Sent to service — 03 · Gudang Bandung" or "Sent to service". */
    readonly eventNote: string;
  };
  /** Fresh ids, one per call. */
  readonly nextId: (prefix: string) => string;
}

export interface SendPlan {
  /** Whether the unit changes warehouse. */
  readonly travelling: boolean;
  /** What `appendEvent` is handed. */
  readonly event: {
    readonly type: "DICATAT";
    readonly toStatus: "SERVIS";
    readonly toLocationId?: string;
    readonly note: string;
    readonly at: string;
  };
  readonly visit: ServiceRec;
  readonly expenses: Expense[];
}

/**
 * Everything one send writes: the event (SERVIS, and the move when it
 * travels), the visit (arrived at once — there is no arrival step since
 * 2026-09-25), the charges, and an expense per charge already paid.
 *
 * ⚠️ `fromLocationId` is the unit's warehouse as it is BEFORE the event — the
 * caller reads the unit before `appendEvent` writes the projection, or *Back
 * in stock* would default to the warehouse it was sent to.
 */
export function planSendToService(input: SendInput): SendPlan {
  const travelling = input.dest !== input.unit.locationId;
  const fees: ServiceFee[] = [];
  const expenses: Expense[] = [];
  const day = localDay(input.at);
  const charge = (
    kind: ServiceFee["kind"],
    label: string,
    amount: number | undefined,
    paid: PaidWith | undefined,
    prefix: string,
  ) => {
    if (amount === undefined || !(amount > 0)) return;
    const fee: ServiceFee = {
      id: input.nextId(prefix),
      kind,
      label,
      amount,
      at: input.at,
      staff: input.staff,
      ...(paid !== undefined && paid !== "UNPAID" ? { paid: true } : {}),
    };
    fees.push(fee);
    if (paid !== undefined && paid !== "UNPAID") {
      expenses.push(
        chargeExpense({
          id: input.nextId("exp"),
          serial: input.unit.serial,
          fee,
          method: paid,
          day,
          createdAt: input.at,
        }),
      );
    }
  };
  if (travelling)
    charge(
      "SHIPPING",
      input.words.shipLabel,
      input.shippingFee,
      input.shippingPaid,
      "svcf",
    );
  charge(
    "LABOUR",
    input.words.quoteLabel,
    input.quote,
    input.quotePaid,
    "svcf",
  );
  const note = input.note?.trim();
  return {
    travelling,
    event: {
      type: "DICATAT",
      toStatus: "SERVIS",
      ...(travelling ? { toLocationId: input.dest } : {}),
      note: input.words.eventNote,
      at: input.at,
    },
    visit: {
      id: input.nextId("svc"),
      serial: input.unit.serial,
      fromLocationId: input.unit.locationId,
      openedAt: input.at,
      arrivedAt: input.at,
      fees,
      ...(note ? { note } : {}),
      raisedBy: input.raisedBy,
      ...(input.poId ? { poId: input.poId } : {}),
      staff: input.staff,
    },
    expenses,
  };
}

// ---------------------------------------------------------------------------
// The visit's own history rows
// ---------------------------------------------------------------------------

type Ev = Pick<
  UnitEvent,
  "id" | "serial" | "seq" | "type" | "at" | "fromStatus" | "toStatus" | "note"
>;

/** The row that sent it: same unit, same instant, into SERVIS from elsewhere. */
export function isSendEvent(e: Ev, rec: ServiceRec): boolean {
  return (
    e.serial === rec.serial &&
    e.at === rec.openedAt &&
    e.toStatus === "SERVIS" &&
    e.fromStatus !== "SERVIS"
  );
}

/**
 * The line a charge added to the timeline (`saveFee` on the bench): same
 * instant as the charge, a note written while the unit was at service. The
 * charges a send records share the SEND's instant and have no line of their
 * own — the from-status keeps the send row from being taken for one.
 */
export function isChargeNote(
  e: Ev,
  rec: ServiceRec,
  fee: Pick<ServiceFee, "at">,
): boolean {
  return (
    e.serial === rec.serial &&
    e.type === "DICATAT" &&
    e.at === fee.at &&
    e.fromStatus === "SERVIS" &&
    e.toStatus === "SERVIS"
  );
}

/**
 * A correction of a charge (`saveFee`, "Service charge corrected …") — the
 * visit's own as much as the charge it corrects, and the reason a visit whose
 * charge was ever corrected is not "moved on".
 */
function isChargeCorrection(e: Ev, rec: ServiceRec): boolean {
  return (
    e.serial === rec.serial &&
    e.type === "DICATAT" &&
    e.fromStatus === "SERVIS" &&
    e.toStatus === "SERVIS" &&
    e.at > rec.openedAt &&
    (rec.closedAt === undefined || e.at <= rec.closedAt) &&
    (e.note ?? "").startsWith("Service charge")
  );
}

/** The row that brought it back, when the visit is closed. */
export function isBackEvent(e: Ev, rec: ServiceRec): boolean {
  return (
    rec.closedAt !== undefined &&
    e.serial === rec.serial &&
    e.at === rec.closedAt &&
    e.fromStatus === "SERVIS" &&
    e.toStatus !== "SERVIS" &&
    // A return to the supplier closes the visit at its own instant
    // (2026-10-26), but that row is the RETURN's: the unit moved on, and
    // deleting the visit must not take the return's history with it.
    e.type !== "RETUR_SUPPLIER"
  );
}

/** Newest first: the order rows come off a history without stranding one. */
const newestFirst = (a: Ev, b: Ev) => b.seq - a.seq;

// ---------------------------------------------------------------------------
// Deleting a charge
// ---------------------------------------------------------------------------

export type ChargeDeletionBlock = "BOOKS_CLOSED";

export interface ChargeDeletionPlan {
  readonly block?: ChargeDeletionBlock;
  /** The charge's timeline line, when there is one. */
  readonly eventIds: string[];
  /** Its expense, when this browser holds it (a finance account). */
  readonly expenseIds: string[];
}

export interface DeletionSources {
  readonly events: readonly Ev[];
  readonly expenses: readonly Expense[];
  readonly settings: BookCloseSettings | undefined;
}

export function planChargeDeletion(
  src: DeletionSources,
  rec: ServiceRec,
  feeId: string,
): ChargeDeletionPlan {
  const fee = rec.fees.find((f) => f.id === feeId);
  if (fee === undefined) return { eventIds: [], expenseIds: [] };
  const expense = src.expenses.find((e) => e.serviceFeeId === fee.id);
  const closed =
    instantClosed(fee.at, src.settings) ||
    (expense !== undefined && dayClosed(expense.date, src.settings));
  return {
    ...(closed ? { block: "BOOKS_CLOSED" as const } : {}),
    eventIds: src.events
      .filter((e) => isChargeNote(e, rec, fee))
      .sort(newestFirst)
      .map((e) => e.id),
    expenseIds: expense ? [expense.id] : [],
  };
}

// ---------------------------------------------------------------------------
// Deleting a visit
// ---------------------------------------------------------------------------

export type VisitDeletionBlock =
  /** Something else has happened to the unit since. */
  "MOVED_ON" | "BOOKS_CLOSED";

export interface VisitDeletionPlan {
  readonly block?: VisitDeletionBlock;
  /** The visit's own history rows, newest first. */
  readonly eventIds: string[];
  /**
   * Was the row that SENT it found? A visit an older build wrote at a
   * different instant from its event has none to match — the visit and its
   * charges still go, and the person is told the history row was not found,
   * because guessing which row it was is how the wrong one gets deleted.
   */
  readonly sendEventFound: boolean;
  readonly expenseIds: string[];
}

export function planVisitDeletion(
  src: DeletionSources & {
    readonly unitStatus: UnitStatus | undefined;
  },
  rec: ServiceRec,
): VisitDeletionPlan {
  const mine = src.events.filter((e) => e.serial === rec.serial);
  const send = mine.find((e) => isSendEvent(e, rec));
  const own = new Set<string>();
  if (send) own.add(send.id);
  for (const e of mine) {
    if (rec.fees.some((f) => isChargeNote(e, rec, f))) own.add(e.id);
    else if (isChargeCorrection(e, rec)) own.add(e.id);
    else if (isBackEvent(e, rec)) own.add(e.id);
  }
  const expenses = src.expenses.filter((e) =>
    rec.fees.some((f) => f.id === e.serviceFeeId),
  );

  /*
   * Moved on: an open visit whose unit is no longer at service, or a row
   * after the send that is not the visit's own. Without the send row to
   * count from, the rows written while the unit sat at service — the
   * unmatched send itself among them — say nothing about it having left;
   * only a row that took it OUT of service does.
   */
  const after = (e: Ev) =>
    send !== undefined ? e.seq > send.seq : e.at > rec.openedAt;
  const movedOn =
    (rec.closedAt === undefined && src.unitStatus !== "SERVIS") ||
    mine.some(
      (e) =>
        !own.has(e.id) &&
        after(e) &&
        (send !== undefined || e.toStatus !== "SERVIS"),
    );
  const closed =
    instantClosed(rec.openedAt, src.settings) ||
    rec.fees.some((f) => instantClosed(f.at, src.settings)) ||
    expenses.some((e) => dayClosed(e.date, src.settings));

  return {
    ...(movedOn
      ? { block: "MOVED_ON" as const }
      : closed
        ? { block: "BOOKS_CLOSED" as const }
        : {}),
    eventIds: mine
      .filter((e) => own.has(e.id))
      .sort(newestFirst)
      .map((e) => e.id),
    sendEventFound: send !== undefined,
    expenseIds: expenses.map((e) => e.id),
  };
}
