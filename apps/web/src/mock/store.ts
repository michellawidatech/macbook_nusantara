/**
 * In-memory demo data, shaped after packages/db/prisma/schema.prisma.
 * UI-first build: pages read and mutate this store; swapping it for the real
 * API is a per-page change, not a rewrite. Money is plain whole-rupiah numbers
 * here (the API boundary will serialize BigInt as strings).
 */
import { useSyncExternalStore } from "react";
import {
  buildSeed,
  type MockDb,
  type ReasonActivity,
  type UnitNotePhoto,
} from "./seed.js";
import { purgePlaceholderUnits } from "../lib/inboundQc.js";

/**
 * Boot, minus the residue of a withdrawn design.
 *
 * Arrival used to mint a `TBD-…` unit for every line-quantity, so a store could
 * be carrying units that stand for no machine. Nothing mints them any more
 * (see lib/inboundQc.ts) and the owner asked for the ones already there to be
 * deleted outright rather than migrated — a row with no serial is not about
 * anything, so there is nothing it could be reconciled against. The seed has
 * never written one; this is here so that no store can start holding one.
 */
function boot(): MockDb {
  const seeded = buildSeed();
  purgePlaceholderUnits(seeded);
  return seeded;
}

let db: MockDb = boot();
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

/**
 * Resolve a QC description to a row in `qcDescriptions`, creating it if it is
 * new — `ensureReason` for the thing QC actually types.
 *
 * Called INSIDE the same `mutate` that writes the description onto the unit,
 * for the same no-orphan-data reason: the suggestion list must never be a step
 * behind the machines described with it.
 *
 * Matching is case-insensitive on the trimmed label, so "Mulus, fullset dus"
 * typed in lower case does not become a second entry beside the seeded one.
 * That is most of what this is FOR — three people typing the same sentence six
 * ways is exactly the mess the list replaces.
 *
 * Returns the stored label, which may differ from what was typed only in case
 * and whitespace. Callers write THAT onto the unit, so the phrase on a machine
 * and the phrase in the list are one string.
 */
export function ensureQcDescription(draft: MockDb, label: string): string {
  const clean = label.trim();
  if (!clean) return "";
  const found = draft.qcDescriptions.find(
    (d) => d.label.toLowerCase() === clean.toLowerCase(),
  );
  if (found) {
    // A phrase switched off in Settings but typed again is back in use.
    found.active = true;
    return found.label;
  }
  draft.qcDescriptions.push({ id: nextId("qcd"), label: clean, active: true });
  return clean;
}

/** The label for a reason id, falling back to the id so a row never renders blank. */
export function reasonLabel(draft: MockDb, id: string | undefined): string {
  if (!id) return "—";
  return draft.reasons.find((r) => r.id === id)?.label ?? id;
}

/**
 * The QC photographs of one machine, newest first.
 *
 * Reads through the notes rather than off the unit because that is where the
 * schema puts them — `UnitNotePhoto` → `UnitNote` → unit. See `UnitNote` in
 * seed.ts.
 */
export function qcPhotosOf(db: MockDb, serial: string): UnitNotePhoto[] {
  return db.unitNotes
    .filter((n) => n.serial === serial && n.tag === QC_PHOTO_TAG)
    .flatMap((n) => n.photos)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** What marks a note as carrying grading photographs. */
export const QC_PHOTO_TAG = "QC";

/**
 * Attach a photograph to a machine's QC note, creating the note if it is the
 * first one.
 *
 * One note per machine per grading rather than one per picture: the four
 * photographs somebody takes of a dented lid are one observation, and four
 * notes would make the timeline read as four.
 */
export function addQcPhoto(
  draft: MockDb,
  serial: string,
  url: string,
  staffName = "Michella",
): void {
  let note = draft.unitNotes.find(
    (n) => n.serial === serial && n.tag === QC_PHOTO_TAG,
  );
  if (!note) {
    note = {
      id: nextId("note"),
      serial,
      body: "",
      tag: QC_PHOTO_TAG,
      staff: staffName,
      at: new Date().toISOString(),
      photos: [],
    };
    draft.unitNotes.push(note);
  }
  note.photos.push({
    id: nextId("ph"),
    url,
    sortOrder: note.photos.length,
  });
}

/** Drop one photograph. Renumbers the rest so `sortOrder` stays a sequence. */
export function removeQcPhoto(draft: MockDb, serial: string, photoId: string) {
  for (const note of draft.unitNotes) {
    if (note.serial !== serial || note.tag !== QC_PHOTO_TAG) continue;
    note.photos = note.photos
      .filter((ph) => ph.id !== photoId)
      .map((ph, i) => ({ ...ph, sortOrder: i }));
  }
  // A note whose last picture has gone and that carries no words is nothing.
  draft.unitNotes = draft.unitNotes.filter(
    (n) =>
      n.tag !== QC_PHOTO_TAG || n.photos.length > 0 || n.body.trim() !== "",
  );
}

/**
 * Purge a sold machine's QC photographs — CLAUDE.md's ONE sanctioned hard
 * delete, and it stops here.
 *
 * The grading photographs exist to answer "what condition was this in when we
 * took it in?", and once the machine has left the shop that question has an
 * owner, which is the person holding it. Keeping a folder of pictures of other
 * people's laptops is a liability with no use, so the row and the file both go
 * (owner decision 2026-08-24).
 *
 * The `UnitEvent` ledger is untouched: the sale is still on the timeline, and
 * so is the description typed at QC. Only the image goes. Do NOT generalise
 * this to any other row in this store.
 */
export function purgeQcPhotos(draft: MockDb, serials: readonly string[]): void {
  const sold = new Set(serials);
  draft.unitNotes = draft.unitNotes.filter(
    (n) => !(sold.has(n.serial) && n.tag === QC_PHOTO_TAG),
  );
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
