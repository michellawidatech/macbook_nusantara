/**
 * A machine away at a repairer: where it sits, what it costs, and how that
 * cost reaches the margin.
 *
 * ## The owner's ask (2026-09-08)
 *
 * > *"When marking a unit as 'serviced', we should keep track of it as to get
 * > to warehouse 4 (the warehouse for service items) and can add service fee
 * > and additional fee. When marking a unit as service in the PO, we should
 * > have another column to add additional fee, and a notification that the
 * > unit will be able to be seen in warehouse 4. In warehouse 4, we should be
 * > able to add the service fee per unit and another additional fee if the
 * > unit is then transferred to another warehouse. The service will be
 * > included to count the COGS."*
 *
 * Three things, and the third is the one that changes numbers elsewhere.
 *
 * ## 1. Service is a PLACE, not only a status
 *
 * `Unit.status = SERVIS` said the machine was being repaired and said nothing
 * about where it was. The shop has a service bench — `wh-4`, `Meja Servis`,
 * which has existed in the fixture since the beginning and which nothing ever
 * moved anything to — so sending a machine to service now moves it there, in
 * the same transaction as the status. That is the ordinary rule of this
 * database (a projection is written with its event) applied to the one status
 * that was exempt from it.
 *
 * ## 2. What a repair costs is a list, not a number
 *
 * A repair is a labour charge, a part, and — very often — the courier both
 * ways. One "service fee" column would fold three parties into one figure and
 * lose which of them to chase when the machine comes back broken. So a service
 * record carries fees the way a purchase order carries them.
 *
 * ## 3. The cost lands on the MACHINE, and therefore on the margin
 *
 * *"The service will be included to count the COGS."* `Unit.buy` is what the
 * machine cost to acquire and stays that — it is a fact about a purchase, and
 * rewriting it would make the invoice and the unit disagree. The repair is a
 * second cost against the same serial, and `costOfUnit` is the sum the till,
 * Inventory and the P&L all ask for. A machine bought at Rp4jt and repaired
 * for Rp800k has cost the shop Rp4.8jt, and selling it at Rp4.5jt is a loss
 * the till has to be able to show.
 *
 * Pure: no React, no store. `test/service.test.ts` is the spec.
 */

/** What kind of charge this is. Four, because four different parties bill. */
export type ServiceFeeKind =
  /** The repairer's labour. */
  | "LABOUR"
  /** A component: a battery, a screen, a keyboard. */
  | "PART"
  /** Courier, either direction. */
  | "SHIPPING"
  /** Anything else — a diagnostic charge, a rush fee. */
  | "OTHER";

export const SERVICE_FEE_KINDS: readonly {
  readonly value: ServiceFeeKind;
  readonly label: string;
  readonly guide: string;
}[] = [
  { value: "LABOUR", label: "Labour", guide: "What the repairer charged." },
  { value: "PART", label: "Part", guide: "A battery, a screen, a keyboard." },
  {
    value: "SHIPPING",
    label: "Shipping",
    guide: "Courier to the repairer, or back, or a transfer afterwards.",
  },
  { value: "OTHER", label: "Other", guide: "Diagnostics, a rush charge." },
];

export interface ServiceFee {
  readonly id: string;
  readonly kind: ServiceFeeKind;
  readonly label?: string;
  readonly amount: number;
  readonly at: string;
  readonly staff: string;
}

/**
 * One machine's stay at the bench.
 *
 * One record per VISIT, not one per machine: a laptop that goes back twice has
 * been repaired twice and cost the shop twice, and folding the two into one
 * row would lose the fact that the first repair did not hold.
 *
 * ⚠️ Mock-only. Prisma has `Location` with `kind: SERVIS` and a `UnitStatus`
 * of `SERVIS`, so the PLACE half needs nothing new — but there is no table for
 * a service visit or its fees. That is two tables (`ServiceVisit` and
 * `ServiceFee`, FK with `onDelete: Restrict` like every other) plus an owner
 * decision.
 */
export interface ServiceRec {
  readonly id: string;
  readonly serial: string;
  /** Where the machine was when it was sent. It goes back here by default. */
  readonly fromLocationId: string;
  readonly openedAt: string;
  /**
   * When somebody at the bench confirmed the machine actually got there
   * (owner ask 2026-09-09).
   *
   * > *"After that, the unit will be logged to warehouse 4 (the user need to
   * > confirm that it has arrived in warehouse 4, then they can proceed with
   * > adding service fee etc)."*
   *
   * Absent means it is on its way. That is a real state and not a formality:
   * the shop's warehouses are separate buildings, so a machine sent on Monday
   * is somewhere in a van on Monday, and the bench's first question every
   * morning is which of the ones that were sent have actually turned up.
   * Before this, sending a machine moved it to `wh-4` instantly and the bench
   * had a list of machines it could not find.
   *
   * A repair that needs no journey — the machine is already at the bench, or
   * the repairer collects — opens with this set, so nothing has to be
   * confirmed that nobody is waiting for.
   */
  readonly arrivedAt?: string;
  /** Set when the machine leaves the bench, whichever way it goes. */
  readonly closedAt?: string;
  /** Where it went afterwards. Absent while it is still on the bench. */
  readonly toLocationId?: string;
  readonly fees: readonly ServiceFee[];
  /** What is wrong with it, in words. */
  readonly note?: string;
  /** Which desk sent it: QC, an adjustment, or the returns desk. */
  readonly raisedBy: "QC" | "ADJUSTMENT" | "RETURN";
  /** The invoice it came off, when QC raised it. */
  readonly poId?: string;
  readonly staff: string;
}

/** Σ the fees of one visit. */
export function visitCost(rec: Pick<ServiceRec, "fees">): number {
  // Negative charges are refused rather than netted, exactly as a marketplace
  // fee is: money coming back is a credit and is its own document.
  return rec.fees.reduce((n, f) => n + Math.max(0, f.amount), 0);
}

/**
 * What every repair of one machine has cost, closed visits and open ones.
 *
 * Open ones included on purpose. A machine on the bench with Rp600k of parts
 * already billed has cost the shop that money whether or not anybody has
 * pressed "finished", and a margin that ignores it is a margin that flatters
 * every unit still in the workshop.
 */
export function serviceCostOf(
  serial: string,
  records: readonly ServiceRec[],
): number {
  return records
    .filter((r) => r.serial === serial)
    .reduce((n, r) => n + visitCost(r), 0);
}

/**
 * What one machine has actually cost the shop.
 *
 * The number every margin is computed against, since 2026-09-08.
 * `Unit.buy` alone was right while a repair was somebody else's problem;
 * it stopped being right the moment the shop started paying for one.
 */
export function costOfUnit(
  unit: { readonly serial: string; readonly buy: number },
  records: readonly ServiceRec[],
): number {
  return unit.buy + serviceCostOf(unit.serial, records);
}

/** The visit a machine is on right now, if it is on one. */
export function openVisit(
  serial: string,
  records: readonly ServiceRec[],
): ServiceRec | undefined {
  return records.find((r) => r.serial === serial && r.closedAt === undefined);
}

/**
 * The shop's service bench, by `Location.kind`.
 *
 * By KIND and not by id, because `wh-4` is this shop's service location and
 * the next shop's will not be. A shop with no service location answers
 * undefined and the callers fall back to leaving the machine where it is —
 * which is exactly what happened before this feature, so nothing breaks in a
 * database that has not got one.
 */
export function serviceLocationOf(
  locations: readonly { readonly id: string; readonly kind?: string }[],
): string | undefined {
  return locations.find((l) => l.kind === "SERVIS")?.id;
}

/** What a bench row shows. */
export interface BenchRow {
  readonly rec: ServiceRec;
  readonly serial: string;
  /** Σ its fees so far. */
  readonly cost: number;
  /** What the machine cost to buy. */
  readonly buy: number;
  /** buy + cost — what it will have to sell above. */
  readonly total: number;
  /** How many days it has been away. */
  readonly days: number;
  /** Has it actually reached the bench? See `ServiceRec.arrivedAt`. */
  readonly arrived: boolean;
}

export function benchRows(
  records: readonly ServiceRec[],
  buyOf: (serial: string) => number,
  now: number = Date.now(),
): BenchRow[] {
  return records
    .filter((r) => r.closedAt === undefined)
    .map((rec) => {
      const cost = visitCost(rec);
      const buy = buyOf(rec.serial);
      return {
        rec,
        serial: rec.serial,
        cost,
        buy,
        total: buy + cost,
        arrived: rec.arrivedAt !== undefined,
        // Floored at zero: a clock skew must not report a machine as having
        // been away for minus a day.
        days: Math.max(
          0,
          Math.floor((now - Date.parse(rec.openedAt)) / 86_400_000),
        ),
      };
    })
    .sort((a, b) => b.days - a.days);
}

/**
 * The machines the bench is waiting for, and the ones it has.
 *
 * Two lists rather than one with a column, because they are two different
 * jobs. The first is *did the van arrive* — answered by walking to the shelf
 * and looking, and nothing else can be done to those machines until it is.
 * The second is *what is this repair costing*, which is the screen's real
 * work. A single table sorted by anything at all would interleave them.
 */
export function splitBench(rows: readonly BenchRow[]): {
  readonly expected: BenchRow[];
  readonly onBench: BenchRow[];
} {
  return {
    expected: rows.filter((r) => !r.arrived),
    onBench: rows.filter((r) => r.arrived),
  };
}

/**
 * Change one charge that has already been recorded (owner ask 2026-09-09).
 *
 * > *"The service fee should be editable in the service tab, not only add but
 * > also reduce the price."*
 *
 * A repairer who quoted Rp900k and billed Rp650k is the ordinary case, not the
 * exception, and before this the only way to record it was a second visit or a
 * number nobody could correct. What is NOT offered is removing the row: this
 * database does not hard-delete, and a charge edited to zero says "we were
 * quoted this and did not pay it", which is the more useful sentence anyway.
 *
 * Returns a new record — `ServiceRec` is readonly and the store is
 * replace-on-write, the same discipline `Order.payments` follows.
 */
export function editFee(
  rec: ServiceRec,
  feeId: string,
  patch: Partial<Pick<ServiceFee, "kind" | "label" | "amount">>,
): ServiceRec {
  return {
    ...rec,
    fees: rec.fees.map((f) =>
      f.id === feeId
        ? {
            ...f,
            ...(patch.kind === undefined ? {} : { kind: patch.kind }),
            // An emptied label is a label somebody cleared, so it is dropped
            // rather than written as "". `undefined` in the patch means "not
            // touched"; the two are told apart by the key being present.
            ...("label" in patch
              ? patch.label
                ? { label: patch.label }
                : { label: undefined }
              : {}),
            // Floored at zero for the reason `visitCost` floors: money coming
            // back from a repairer is a credit and is its own document, not a
            // negative charge hidden inside a bill.
            ...(patch.amount === undefined
              ? {}
              : { amount: Math.max(0, patch.amount) }),
          }
        : f,
    ),
  };
}
