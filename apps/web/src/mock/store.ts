/**
 * In-memory demo data, shaped after packages/db/prisma/schema.prisma.
 * UI-first build: pages read and mutate this store; swapping it for the real
 * API is a per-page change, not a rewrite. Money is plain whole-rupiah numbers
 * here (the API boundary will serialize BigInt as strings).
 */
import { useSyncExternalStore } from "react";
import { buildSeed, type MockDb, type ReasonActivity } from "./seed.js";

let db: MockDb = buildSeed();
const listeners = new Set<() => void>();

export function useDb(): MockDb {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => db,
  );
}

/** Replace-on-write: pages mutate a draft copy, subscribers re-render. */
export function mutate(fn: (draft: MockDb) => void): void {
  const draft = structuredClone(db);
  fn(draft);
  db = draft;
  listeners.forEach((l) => l());
}

let n = 100;
export const nextId = (prefix: string) => `${prefix}_${++n}`;

export function docCode(prefix: string): string {
  const d = new Date();
  const ym = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${prefix}-${ym}-${String(++n).padStart(6, "0")}`;
}

/**
 * Resolve a reason label to a row in `reasons`, creating it if it is new.
 *
 * This is the whole no-orphan-data rule in one function. A screen that lets a
 * user type a reason must call this INSIDE the same `mutate` that writes the
 * record referencing it, so the managed list is never a step behind the data
 * pointing at it — there is no window in which an adjustment names a reason
 * Settings has never heard of.
 *
 * Matching is case-insensitive on the trimmed label, so "internal use" does not
 * become a second row beside "Internal Use".
 */
export function ensureReason(
  draft: MockDb,
  activity: ReasonActivity,
  label: string,
): string {
  const clean = label.trim();
  if (!clean) return "";
  const found = draft.reasons.find(
    (r) =>
      r.activity === activity && r.label.toLowerCase() === clean.toLowerCase(),
  );
  if (found) {
    // A reason that was switched off but is being used again is on again.
    found.active = true;
    return found.id;
  }
  const id = nextId("rsn");
  draft.reasons.push({ id, activity, label: clean, active: true });
  return id;
}

/** The label for a reason id, falling back to the id so a row never renders blank. */
export function reasonLabel(draft: MockDb, id: string | undefined): string {
  if (!id) return "—";
  return draft.reasons.find((r) => r.id === id)?.label ?? id;
}

/** Append a lifecycle event and update the unit projection together. */
export function appendEvent(
  draft: MockDb,
  serial: string,
  ev: {
    type: string;
    note?: string;
    toStatus?: string;
    toLocationId?: string;
    refCode?: string;
  },
  staffName = "Michella",
): void {
  const unit = draft.units.find((u) => u.serial === serial);
  if (!unit) return;
  draft.events.push({
    id: nextId("ev"),
    serial,
    seq: draft.events.filter((e) => e.serial === serial).length + 1,
    type: ev.type,
    at: new Date().toISOString(),
    fromStatus: unit.status,
    toStatus: ev.toStatus ?? unit.status,
    locationId: ev.toLocationId ?? unit.locationId,
    note: ev.note,
    refCode: ev.refCode,
    staff: staffName,
  });
  if (ev.toStatus) unit.status = ev.toStatus as typeof unit.status;
  if (ev.toLocationId) unit.locationId = ev.toLocationId;
}
