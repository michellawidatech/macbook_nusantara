/**
 * Correcting a unit's serial, everywhere the browser names it by one.
 *
 * A unit is keyed by its serial in the store, so a correction moves the
 * ledger, the QC notes and photos, and the invoice line's link with it. On
 * Postgres the commit carries it as a rename in place (2026-09-24, "The
 * ledger's two edits actually land"); the collections not rewritten here
 * project through the unit there and read right after a reload.
 *
 * Shared by Inventory's *Edit unit* and the stock take's match
 * (`lib/opnameMatch.ts`), so the two cannot correct a serial differently.
 * The caller checks that `to` is free.
 */
import type { MockDb } from "../mock/seed.js";

export function renameUnitSerial(d: MockDb, from: string, to: string): boolean {
  if (from === to) return false;
  const u = d.units.find((x) => x.serial === from);
  if (!u) return false;
  for (const e of d.events) if (e.serial === from) e.serial = to;
  for (const n of d.unitNotes) if (n.serial === from) n.serial = to;
  for (const po of d.pos) {
    for (const item of po.items) {
      if (item.serial === from) item.serial = to;
    }
  }
  u.serial = to;
  return true;
}
