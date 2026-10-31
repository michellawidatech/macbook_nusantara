/**
 * Waiting for QC — every unit the bench still owes a grade, across every
 * invoice (owner ask 2026-10-26).
 *
 * > *"In the inbound page, they need to know which unit is not QCed yet,
 * > currently they need to check the inbound manually which is painful …
 * > they can search from the product (which will show which invoice has it),
 * > and search from the invoice, which will show the units that need to be
 * > graded."*
 *
 * `/inbound/:id` answers the question for ONE invoice; this answers it for
 * all of them at once, so a unit found on a shelf leads to its invoice and an
 * invoice leads to its units.
 *
 * ## What waits
 *
 * - **A unit in `QC` that came on an invoice** (`poId` set). One with no
 *   invoice — a stock take's surplus — is `OrphanQcCard`'s, which grades it
 *   in place; it is not listed here.
 * - **An invoice slot with no serial yet** (`receivingState` WAITING) on an
 *   order whose boxes have arrived (`status === "RECEIVED"`). A slot on a
 *   DRAFT or ORDERED invoice is a box still in a van, and a slot marked Not
 *   arrived, or with no product, or of a COUNTED product (a quantity, never a
 *   unit) is not something anybody can grade.
 *
 * ## The two dates
 *
 * *Arrived* is when the unit was received (its `DITERIMA`), or the invoice's
 * date for a slot nobody has scanned. *Days waiting* counts from the LAST time
 * the unit went into QC — a unit reopened yesterday after a month on the shelf
 * has been waiting one day, not thirty. For most units the two are the same.
 *
 * Pure: no React, no store. `test/qcWaiting.test.ts` is the spec.
 */
import type { Po, Unit, UnitEvent } from "../mock/seed.js";
import { receivingRows, receivingState } from "./inboundRows.js";
import { skuTracksSerial, type TrackingCatalogue } from "./serialTracking.js";

/** The slice of the store this reads. `MockDb` satisfies it. */
export interface QcWaitingStore extends TrackingCatalogue {
  readonly units: readonly Unit[];
  readonly pos: readonly Po[];
  readonly events: readonly Pick<
    UnitEvent,
    "serial" | "type" | "at" | "toStatus"
  >[];
  readonly skus: readonly {
    readonly id: string;
    readonly modelId: string;
    readonly code: string;
    readonly name: string;
    readonly variantLabel: string;
  }[];
  readonly suppliers: readonly { readonly id: string; readonly name: string }[];
}

export interface QcWaitingRow {
  /** Unique across the list: `unit:<serial>` or `slot:<po>:<row key>`. */
  readonly key: string;
  /** A unit in hand, or a line of the invoice nobody has scanned yet. */
  readonly kind: "UNIT" | "SLOT";
  /** null for a slot — there is no serial until somebody reads one. */
  readonly serial: string | null;
  /** A slot's receiving-row key on its invoice (`receivingRows`). */
  readonly rowKey?: string;
  readonly skuId: string;
  /** The product's name; "" when the variant is unknown to the catalogue. */
  readonly product: string;
  readonly variant: string;
  /** The shop's short code (`Sku.code`). */
  readonly skuCode: string;
  readonly poId: string;
  /** The shop's own number, `PI-…`; the id when the invoice is not held. */
  readonly poCode: string;
  /** The supplier's invoice number; null when the supplier issued none. */
  readonly invoice: string | null;
  readonly supplierId: string;
  /** "" when the supplier is unknown. */
  readonly supplier: string;
  /** An ISO instant, or a bare `YYYY-MM-DD` (the invoice date). */
  readonly arrivedAt: string;
  readonly days: number;
}

const DAY = 86_400_000;

/** Midnight, LOCAL, of the day an ISO instant or a bare date names. */
function localDay(at: string | number): number {
  if (typeof at === "string") {
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
    // A bare date is a day on the shop's calendar, not midnight in London.
    if (bare) {
      return new Date(+bare[1]!, +bare[2]! - 1, +bare[3]!).getTime();
    }
  }
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `at` to `now`, never negative. */
function daysSince(at: string, now: number): number {
  const from = localDay(at);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.round((localDay(now) - from) / DAY));
}

/** Units in QC that came on an invoice. */
function waitingUnits(store: QcWaitingStore): Unit[] {
  return store.units.filter((u) => u.status === "QC" && u.poId !== null);
}

/** Each invoice's slots still waiting for a serial, without dates. */
function waitingSlots(
  store: QcWaitingStore,
): { po: Po; key: string; skuId: string }[] {
  const isCounted = (skuId: string) => !skuTracksSerial(store, skuId);
  const out: { po: Po; key: string; skuId: string }[] = [];
  for (const po of store.pos) {
    if (po.status !== "RECEIVED") continue;
    for (const row of receivingRows(po, store.units, isCounted)) {
      if (receivingState(row) !== "WAITING") continue;
      out.push({ po, key: row.key, skuId: row.expectedSkuId });
    }
  }
  return out;
}

export function qcWaitingRows(
  store: QcWaitingStore,
  now: number,
): QcWaitingRow[] {
  const pos = new Map(store.pos.map((p) => [p.id, p]));
  const skus = new Map(store.skus.map((s) => [s.id, s]));
  const suppliers = new Map(store.suppliers.map((s) => [s.id, s.name]));

  const units = waitingUnits(store);
  const wanted = new Set(units.map((u) => u.serial));
  /** serial → [when it was received, when it last went into QC]. */
  const dates = new Map<string, { received?: string; intoQc?: string }>();
  for (const e of store.events) {
    if (!wanted.has(e.serial)) continue;
    const d = dates.get(e.serial) ?? {};
    if (
      e.type === "DITERIMA" &&
      (d.received === undefined || e.at > d.received)
    ) {
      d.received = e.at;
    }
    if (e.toStatus === "QC" && (d.intoQc === undefined || e.at > d.intoQc)) {
      d.intoQc = e.at;
    }
    dates.set(e.serial, d);
  }

  const describe = (skuId: string, po: Po | undefined, poId: string) => {
    const sku = skus.get(skuId);
    const supplierId = po?.supplierId ?? "";
    return {
      skuId,
      product: sku?.name ?? "",
      variant: sku?.variantLabel ?? "",
      skuCode: sku?.code ?? "",
      poId,
      poCode: po?.code ?? poId,
      invoice:
        po === undefined || po.noInvoice || po.invoice.trim() === ""
          ? null
          : po.invoice,
      supplierId,
      supplier: suppliers.get(supplierId) ?? "",
    };
  };

  const rows: QcWaitingRow[] = [];
  for (const u of units) {
    const poId = u.poId!;
    const po = pos.get(poId);
    const d = dates.get(u.serial) ?? {};
    const arrivedAt = d.received ?? d.intoQc ?? po?.date ?? "";
    rows.push({
      key: `unit:${u.serial}`,
      kind: "UNIT",
      serial: u.serial,
      ...describe(u.skuId, po, poId),
      arrivedAt,
      days: daysSince(d.intoQc ?? arrivedAt, now),
    });
  }
  for (const slot of waitingSlots(store)) {
    rows.push({
      key: `slot:${slot.po.id}:${slot.key}`,
      kind: "SLOT",
      serial: null,
      rowKey: slot.key,
      ...describe(slot.skuId, slot.po, slot.po.id),
      arrivedAt: slot.po.date,
      days: daysSince(slot.po.date, now),
    });
  }
  // The longest wait first; one invoice's rows together after that.
  return rows.sort(
    (a, b) =>
      b.days - a.days ||
      a.poCode.localeCompare(b.poCode) ||
      a.key.localeCompare(b.key),
  );
}

/** How many rows each invoice has on the list. An invoice with none is absent. */
export function qcWaitingByPo(
  rows: readonly Pick<QcWaitingRow, "poId">[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.poId, (out.get(r.poId) ?? 0) + 1);
  return out;
}

/**
 * The list's length, without dating anything — what the nav badge reads on
 * every store change, so it skips the walk over the event ledger.
 */
export function qcWaitingCount(store: QcWaitingStore): number {
  return waitingUnits(store).length + waitingSlots(store).length;
}
