/**
 * The six tabs of the Inbound list (spec 2026-11-04 §3, owner revision: four
 * list invoices, two list serials).
 *
 * - **Needs QC** — invoices with a unit in QC that is not yet `qcReady`, or a
 *   slot still waiting for a serial.
 * - **Back from service** — units in QC that just came back from a visit
 *   (`backFromService`), with the visit's note and charges.
 * - **Ready to accept** — units in QC that pass `qcReady` and did not come
 *   back from service.
 * - **Arrived, not paid** — arrived, open invoices that still owe money.
 * - **All invoices** — every invoice, as the list always was.
 * - **Closed** — closed invoices.
 *
 * A unit in QC is counted in exactly one of the first three. The invoice tabs
 * return ids, because the page already builds an invoice's row.
 */
import { qcReady } from "./inboundQc.js";
import { poClosed, poTotals } from "./inbound.js";
import { isBackFromService, qcWaitingRows } from "./qcWaiting.js";
import { backFromService, visitCost } from "./service.js";
import { batterySettingsFrom, readUnitBattery } from "./battery.js";
import type { MockDb, Unit } from "../mock/seed.js";

export type InboundTab =
  "NEEDS_QC" | "BACK_FROM_SERVICE" | "READY" | "UNPAID" | "ALL" | "CLOSED";

/** One serial on Back from service or Ready to accept. */
export interface SerialTabRow {
  readonly serial: string;
  readonly skuId: string;
  readonly product: string;
  readonly poId?: string;
  readonly poCode?: string;
  readonly grade?: Unit["grade"];
  /** The battery as every other column reads it (`readUnitBattery`). */
  readonly battery: string;
  readonly sellPrice?: number;
  /** Back from service only: the visit it came back from. */
  readonly visit?: {
    readonly id: string;
    readonly note: string;
    readonly charges: number;
  };
}

export interface InboundTabs {
  readonly NEEDS_QC: string[];
  readonly BACK_FROM_SERVICE: SerialTabRow[];
  readonly READY: SerialTabRow[];
  readonly UNPAID: string[];
  readonly ALL: string[];
  readonly CLOSED: string[];
  /** Per invoice: units in QC not yet ready, plus slots waiting. */
  readonly toQc: ReadonlyMap<string, number>;
}

export function inboundTabs(store: MockDb, now: number): InboundTabs {
  const battery = batterySettingsFrom(store.settings);
  const pos = new Map(store.pos.map((p) => [p.id, p]));
  const skus = new Map(store.skus.map((s) => [s.id, s]));
  const serialRow = (u: Unit): SerialTabRow => {
    const sku = skus.get(u.skuId);
    const po = u.poId ? pos.get(u.poId) : undefined;
    return {
      serial: u.serial,
      skuId: u.skuId,
      product: sku ? `${sku.name} ${sku.variantLabel}`.trim() : "",
      ...(u.poId ? { poId: u.poId } : {}),
      ...(po ? { poCode: po.code } : {}),
      ...(u.grade ? { grade: u.grade } : {}),
      battery: readUnitBattery(u, store, battery).text,
      ...(u.price !== undefined ? { sellPrice: u.price } : {}),
    };
  };

  // Needs QC: what the Waiting-for-QC list holds, less the ready units.
  const toQc = new Map<string, number>();
  for (const r of qcWaitingRows(store, now)) {
    const unit =
      r.serial === null
        ? undefined
        : store.units.find((u) => u.serial === r.serial);
    if (unit && qcReady(unit)) continue;
    toQc.set(r.poId, (toQc.get(r.poId) ?? 0) + 1);
  }

  const BACK_FROM_SERVICE: SerialTabRow[] = [];
  const READY: SerialTabRow[] = [];
  for (const u of store.units) {
    if (u.status !== "QC") continue;
    const visit = backFromService(store, u.serial);
    if (visit) {
      BACK_FROM_SERVICE.push({
        ...serialRow(u),
        visit: {
          id: visit.id,
          note: visit.note ?? "",
          charges: visitCost(visit),
        },
      });
    } else if (u.poId && qcReady(u) && !isBackFromService(store, u.serial)) {
      // A unit on no invoice keeps its own card (OrphanQcCard) on Needs QC.
      READY.push(serialRow(u));
    }
  }

  const UNPAID: string[] = [];
  const CLOSED: string[] = [];
  for (const po of store.pos) {
    if (poClosed(po)) CLOSED.push(po.id);
    else if (po.status === "RECEIVED" && poTotals(po).outstanding > 0)
      UNPAID.push(po.id);
  }

  return {
    NEEDS_QC: [...toQc.keys()],
    BACK_FROM_SERVICE,
    READY,
    UNPAID,
    ALL: store.pos.map((p) => p.id),
    CLOSED,
    toQc,
  };
}
