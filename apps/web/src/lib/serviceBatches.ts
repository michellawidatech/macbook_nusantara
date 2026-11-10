/**
 * Service visits, grouped into the batches they were sent in (owner ask
 * 2026-11-10: *"make it per batch service, grouped by the time and the
 * warehouse it was sent from and sent to"*).
 *
 * A batch is never stored: one press of *Send to service* writes every
 * visit with the SAME `openedAt` instant, from one warehouse, to one
 * destination, so those three facts are what make a batch. Visits sent one
 * at a time in the same minute, between the same two warehouses, read as one
 * batch too — which is what they were on the bench.
 *
 * Where a visit was SENT TO is not a column on the visit: it is the
 * warehouse its send event put the unit in (the event at `openedAt` that
 * moved it to SERVIS), and failing that, where the unit is while the visit
 * is open. A unit serviced where it stood was sent "to" its own warehouse.
 *
 * Pure: no React, no store. `test/serviceBatches.test.ts` is the spec.
 */
import type { BenchRow, ServiceRec } from "./service.js";

export interface BatchEvent {
  readonly serial: string;
  readonly at: string;
  readonly toStatus: string;
  readonly locationId: string;
}

export interface BatchUnit {
  readonly serial: string;
  readonly locationId: string;
}

export interface ServiceBatch {
  /** Stable for a render: the minute, the two warehouses. */
  readonly key: string;
  /** The earliest send in the batch. */
  readonly openedAt: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly rows: readonly BenchRow[];
  /** Every visit in it is finished. */
  readonly closed: boolean;
  /** Σ what the batch's visits have cost so far. */
  readonly cost: number;
}

/** Where the visit's unit was serviced. */
export function serviceLocationOf(
  rec: Pick<ServiceRec, "serial" | "openedAt" | "fromLocationId" | "closedAt">,
  events: readonly BatchEvent[],
  units: readonly BatchUnit[],
): string {
  const opened = Date.parse(rec.openedAt);
  const send = events.find(
    (e) =>
      e.serial === rec.serial &&
      e.toStatus === "SERVIS" &&
      Math.abs(Date.parse(e.at) - opened) < 1000,
  );
  if (send) return send.locationId;
  if (rec.closedAt === undefined) {
    const unit = units.find((u) => u.serial === rec.serial);
    if (unit) return unit.locationId;
  }
  return rec.fromLocationId;
}

/** The minute an instant falls in — what one press of Send shares. */
const minuteOf = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : String(Math.floor(ms / 60_000));
};

/**
 * The rows, grouped. Batches keep the order their first row arrives in, so
 * whatever order the caller sorted the visits into is the order of batches.
 */
export function serviceBatches(
  rows: readonly BenchRow[],
  sources: {
    readonly events: readonly BatchEvent[];
    readonly units: readonly BatchUnit[];
  },
): ServiceBatch[] {
  const groups = new Map<
    string,
    { from: string; to: string; rows: BenchRow[] }
  >();
  for (const r of rows) {
    const to = serviceLocationOf(r.rec, sources.events, sources.units);
    const from = r.rec.fromLocationId;
    const key = `${minuteOf(r.rec.openedAt)}|${from}|${to}`;
    const g = groups.get(key);
    if (g) g.rows.push(r);
    else groups.set(key, { from, to, rows: [r] });
  }
  return [...groups.entries()].map(([key, g]) => ({
    key,
    openedAt: g.rows
      .map((r) => r.rec.openedAt)
      .reduce((a, b) => (b < a ? b : a)),
    fromLocationId: g.from,
    toLocationId: g.to,
    rows: g.rows,
    closed: g.rows.every((r) => r.closed),
    cost: g.rows.reduce((n, r) => n + r.cost, 0),
  }));
}
