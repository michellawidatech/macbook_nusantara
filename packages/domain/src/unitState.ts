/**
 * The unit state machine — docs/rebuild/08-data-integrity.md §4.
 *
 * Every arrow in that diagram is a UnitEvent row. This module is the only
 * place that decides whether an arrow exists; the checkout, arrival and claim
 * transactions assert against it before they write.
 *
 * Pure: no I/O, no Prisma, no clock.
 */

export const UNIT_STATUSES = [
  // Owner decision 2026-08-15: arrival is no longer sellable. A unit lands in
  // QC and only becomes TERSEDIA once staff record description + asking price.
  "QC",
  "TERSEDIA",
  "DIRESERVASI",
  "TERJUAL",
  "KLAIM_GARANSI",
  "RETUR_SUPPLIER",
  "REFUND_KLAIM",
  "HILANG",
  "KOREKSI_KELUAR",
  // At the repairer or on its way (owner ask 2026-09-08), and in PostgreSQL
  // since 20260913120000_store_on_postgres. No arrow in TRANSITIONS names it
  // yet: the browser records the trip as DICATAT with a status change, which
  // the store commit checks for continuity rather than against this table —
  // declaring the service arrows is the follow-up (docs/store-on-postgres.md).
  "SERVIS",
] as const;

export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const UNIT_EVENT_TYPES = [
  "DITERIMA",
  "QC_SELESAI",
  "DICATAT",
  "DIPINDAH",
  "DIRESERVASI",
  "RESERVASI_BATAL",
  "TERJUAL",
  "RETUR_PELANGGAN",
  "RETUR_SUPPLIER",
  "KLAIM_DIBUKA",
  "KLAIM_SELESAI",
  "REFUND",
  "OPNAME_HILANG",
  "OPNAME_DITEMUKAN",
  "KOREKSI",
  "QC_DIBUKA",
  "DIARSIPKAN",
] as const;

export type UnitEventType = (typeof UNIT_EVENT_TYPES)[number];

/** ClaimRes in the ERD. Only KLAIM_SELESAI reads it. */
export type ClaimResolution = "STOK" | "RETUR" | "REFUND";

/**
 * Events that record something about a unit without moving it through the
 * state machine. DIPINDAH changes locationId, DICATAT attaches a note,
 * DIARSIPKAN sets archivedAt — none of them change status.
 */
export const STATUS_PRESERVING_EVENTS = [
  "DICATAT",
  "DIPINDAH",
  "DIARSIPKAN",
] as const;

type StatusPreservingEvent = (typeof STATUS_PRESERVING_EVENTS)[number];

export function isStatusPreserving(
  type: UnitEventType,
): type is StatusPreservingEvent {
  return (STATUS_PRESERVING_EVENTS as readonly string[]).includes(type);
}

/**
 * The transition table. `from: null` is a GENESIS — the unit does not exist
 * yet. There are two: a purchase order's arrival, and a machine found at a
 * stock take that was never booked in.
 *
 * This is §4's diagram, written out. Anything not in this list is rejected.
 */
export interface Transition {
  readonly from: UnitStatus | null;
  readonly type: UnitEventType;
  readonly to: UnitStatus;
  readonly resolution?: ClaimResolution;
}

export const TRANSITIONS: readonly Transition[] = [
  { from: null, type: "DITERIMA", to: "QC" },

  /**
   * The second genesis: a machine found on a shelf that the system has never
   * heard of (owner ask 2026-08-31).
   *
   * A stock take turns up a laptop nobody booked in — bought over the counter
   * and never entered, or carried across from the old build. The shop HAS it,
   * so it has to become a unit; the question is only what state it starts in.
   *
   * QC, not TERSEDIA, and the owner chose it: a surplus machine has no grade,
   * no description and no cost, and a second-hand shop that puts such a thing
   * straight on the shelf is a shop selling a machine nobody has looked at.
   * `DITERIMA` would have been the lazy reuse and it would have lied — that
   * arrow means "came off a purchase order", and this one did not.
   */
  { from: null, type: "OPNAME_DITEMUKAN", to: "QC" },

  // QC exits: pass into stock, send back to the supplier, or write off.
  // "On service" before entering stock is a QC hold with a DICATAT note —
  // it is not a separate status (yet; revisit if staff need a queue for it).
  { from: "QC", type: "QC_SELESAI", to: "TERSEDIA" },
  { from: "QC", type: "RETUR_SUPPLIER", to: "RETUR_SUPPLIER" },
  { from: "QC", type: "KOREKSI", to: "KOREKSI_KELUAR" },

  /**
   * QC exits, undone (owner revision 2026-08-27).
   *
   * Three machines come off one pallet, two of them the same model, and the
   * person grading accepts the wrong one or sends the wrong one back. Before
   * these two arrows the only remedy was a stock adjustment — which files the
   * correction as a different KIND of event from the mistake and leaves the
   * timeline reading "arrived, passed QC, mysteriously adjusted out".
   *
   * Nothing is rewritten. The QC_SELESAI or RETUR_SUPPLIER that was wrong
   * stays on the ledger, because it was really recorded and somebody may need
   * to know it was; this arrow follows it. That is what an append-only ledger
   * is FOR, and a state machine with no way back out of a human mistake is one
   * that guarantees the mistake gets hidden somewhere worse.
   *
   * Its own event type rather than KOREKSI: that one already has an arrow out
   * of both QC and TERSEDIA, so a second meaning for the same (from, type)
   * pair would make `statusAfter` ambiguous about where the unit lands.
   *
   * Reserved and sold are deliberately absent. Once a machine is promised to
   * a customer or out of the door, somebody outside QC has acted on it, and
   * pulling it back to a bench would be a claim about a machine the shop no
   * longer has to itself. Those are corrected where they happened — the
   * reservation, the sale.
   */
  { from: "TERSEDIA", type: "QC_DIBUKA", to: "QC" },
  { from: "RETUR_SUPPLIER", type: "QC_DIBUKA", to: "QC" },

  { from: "TERSEDIA", type: "DIRESERVASI", to: "DIRESERVASI" },
  { from: "TERSEDIA", type: "TERJUAL", to: "TERJUAL" },
  { from: "TERSEDIA", type: "RETUR_SUPPLIER", to: "RETUR_SUPPLIER" },
  { from: "TERSEDIA", type: "OPNAME_HILANG", to: "HILANG" },
  { from: "TERSEDIA", type: "KOREKSI", to: "KOREKSI_KELUAR" },

  { from: "DIRESERVASI", type: "RESERVASI_BATAL", to: "TERSEDIA" },
  { from: "DIRESERVASI", type: "TERJUAL", to: "TERJUAL" },

  { from: "TERJUAL", type: "RETUR_PELANGGAN", to: "TERSEDIA" },
  { from: "TERJUAL", type: "KLAIM_DIBUKA", to: "KLAIM_GARANSI" },

  {
    from: "KLAIM_GARANSI",
    type: "KLAIM_SELESAI",
    to: "TERSEDIA",
    resolution: "STOK",
  },
  {
    from: "KLAIM_GARANSI",
    type: "KLAIM_SELESAI",
    to: "RETUR_SUPPLIER",
    resolution: "RETUR",
  },
  {
    from: "KLAIM_GARANSI",
    type: "KLAIM_SELESAI",
    to: "REFUND_KLAIM",
    resolution: "REFUND",
  },
  { from: "KLAIM_GARANSI", type: "REFUND", to: "REFUND_KLAIM" },

  // The same event from a unit that already exists: one that was written off
  // as lost and has turned up again. It goes back on the shelf rather than to
  // QC — the shop has graded it before and nothing about it has changed.
  { from: "HILANG", type: "OPNAME_DITEMUKAN", to: "TERSEDIA" },
];

/**
 * Statuses with no outgoing arrow. §4 marked three of them "(terminal)".
 *
 * `RETUR_SUPPLIER` left this list on 2026-08-27, and it is the only member
 * that ever has. It was terminal because a machine shipped back to a supplier
 * is gone — which is true of a return that really happened, and not true of
 * one raised by mistake ten minutes ago against the wrong serial. QC_DIBUKA is
 * the arrow back, and a status with an arrow out of it is not terminal, so
 * leaving it here would have made `statusAfter` refuse the very transition the
 * table above now declares.
 *
 * The other two stay. A refunded claim and a written-off unit have both had
 * money settled against them by somebody outside this screen; undoing either
 * is an accounting correction, not a status change.
 */
export const TERMINAL_STATUSES = ["REFUND_KLAIM", "KOREKSI_KELUAR"] as const;

export function isTerminal(status: UnitStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The resulting status, or null if this event is not a legal arrow from here.
 *
 * A status-preserving event keeps the current status — except out of a
 * terminal status, where nothing further may be recorded, and except at
 * intake, where there is no status to preserve.
 */
export function statusAfter(
  from: UnitStatus | null,
  type: UnitEventType,
  resolution?: ClaimResolution,
): UnitStatus | null {
  if (isStatusPreserving(type)) {
    if (from === null) return null;
    if (isTerminal(from)) return null;
    return from;
  }

  for (const t of TRANSITIONS) {
    if (t.from !== from) continue;
    if (t.type !== type) continue;
    if (t.resolution !== undefined && t.resolution !== resolution) continue;
    return t.to;
  }
  return null;
}

/** Every status this unit could legally reach next. Useful for the UI. */
export function legalTargets(from: UnitStatus | null): UnitStatus[] {
  const out: UnitStatus[] = [];
  for (const t of TRANSITIONS) {
    if (t.from === from && !out.includes(t.to)) out.push(t.to);
  }
  return out;
}

/**
 * Thrown when a transaction attempts an arrow that does not exist.
 *
 * 08 §4: "Anything not in this table is rejected with a message naming the
 * serial and its current status."
 */
export class IllegalUnitTransitionError extends Error {
  readonly serial: string;
  readonly from: UnitStatus | null;
  readonly type: UnitEventType;
  readonly resolution?: ClaimResolution;

  constructor(
    serial: string,
    from: UnitStatus | null,
    type: UnitEventType,
    resolution?: ClaimResolution,
  ) {
    const where =
      from === null
        ? `belum tercatat di stok`
        : `berstatus ${from}${isTerminal(from) ? " (final)" : ""}`;
    const because =
      resolution === undefined ? "" : ` dengan resolusi ${resolution}`;
    super(`Unit ${serial} ${where} — event ${type}${because} tidak diizinkan.`);
    this.name = "IllegalUnitTransitionError";
    this.serial = serial;
    this.from = from;
    this.type = type;
    this.resolution = resolution;
  }
}

/**
 * Assert the arrow and return the status to project. This is what the
 * checkout / arrival / claim transactions call before writing anything.
 */
export function assertTransition(
  serial: string,
  from: UnitStatus | null,
  type: UnitEventType,
  resolution?: ClaimResolution,
): UnitStatus {
  const to = statusAfter(from, type, resolution);
  if (to === null) {
    throw new IllegalUnitTransitionError(serial, from, type, resolution);
  }
  return to;
}
