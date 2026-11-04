/**
 * The inbound unit popup's held answers (owner list 2026-11-03: *"the
 * activity should not be saved before the changes are made"*; rebuilt
 * 2026-11-04 after review).
 *
 * For a unit that already has a serial, the popup's QC answers — grade,
 * description, never serviced, battery, sell price — are held here, per
 * field, until Done. The page draws the store with them laid on top
 * (`withEdits`), so every reader (cells, Accept, *Done & accept n*) sees
 * them; Done writes them in one mutation, field by field, onto whatever the
 * store holds by then. Nothing else is held: a scan, a serial, a decision
 * commits at once, as it always did.
 *
 * Plain data, never closures, so it survives a reload (`parsePopupEdits`) and
 * can be re-applied after another till's change without capturing row ids.
 */
import { produce } from "immer";
import type { MockDb, Unit } from "../mock/seed.js";
import { joinDescription } from "./inboundQc.js";

/** One unit's held answers. `null` empties a field; absent leaves it. */
export interface UnitEdit {
  readonly grade?: string | null;
  /** The description as phrases. */
  readonly description?: readonly string[];
  readonly neverServiced?: boolean | null;
  readonly batteryHealth?: number | null;
  readonly cycleCount?: number | null;
  readonly fcc?: number | null;
  readonly price?: number | null;
}

/** serial → its held answers. */
export type PopupEdits = Readonly<Record<string, UnitEdit>>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function set<K extends keyof Unit>(
  u: Mutable<Unit>,
  key: K,
  value: Unit[K] | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) delete u[key];
  else u[key] = value;
}

/**
 * Write one unit's held answers onto it. `phrase` turns a phrase into the
 * one the vocabulary holds (Done passes `ensureQcDescription`).
 */
export function applyUnitEdit(
  u: Unit,
  e: UnitEdit,
  phrase: (p: string) => string = (p) => p,
): void {
  const m = u as Mutable<Unit>;
  if (e.grade !== undefined) set(m, "grade", e.grade as Unit["grade"] | null);
  if (e.description !== undefined)
    m.description = joinDescription(e.description.map(phrase).filter(Boolean));
  set(m, "neverServiced", e.neverServiced);
  set(m, "batteryHealth", e.batteryHealth);
  set(m, "cycleCount", e.cycleCount);
  set(m, "fcc", e.fcc);
  set(m, "price", e.price);
}

/** The store as the popup shows it: the held answers laid on top. */
export function withEdits(db: MockDb, edits: PopupEdits): MockDb {
  const serials = Object.keys(edits);
  if (serials.length === 0) return db;
  return produce(db, (d) => {
    for (const s of serials) {
      const u = d.units.find((x) => x.serial === s);
      if (u) applyUnitEdit(u as Unit, edits[s]!);
    }
  });
}

const FIELDS = [
  "grade",
  "description",
  "neverServiced",
  "batteryHealth",
  "cycleCount",
  "fcc",
  "price",
] as const;

/** The serials whose held answers differ from what the store holds. */
export function changedSerials(db: MockDb, edits: PopupEdits): string[] {
  const out: string[] = [];
  for (const [s, e] of Object.entries(edits)) {
    const stored = db.units.find((x) => x.serial === s);
    if (!stored) continue;
    const next = { ...stored };
    applyUnitEdit(next, e);
    if (FIELDS.some((f) => next[f] !== stored[f])) out.push(s);
  }
  return out;
}

/** Edits kept on this device, for units still in QC; anything else dropped. */
export function parsePopupEdits(
  raw: unknown,
  units: readonly Unit[],
): PopupEdits {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, UnitEdit> = {};
  for (const [s, e] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof e !== "object" || e === null) continue;
    if (!units.some((u) => u.serial === s && u.status === "QC")) continue;
    out[s] = e as UnitEdit;
  }
  return out;
}
