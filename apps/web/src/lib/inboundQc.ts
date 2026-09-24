/**
 * The QC grid: what an arrived order has already identified, and what it still
 * owes the shelf.
 *
 * ## No unit exists before its serial does (owner decision 2026-08-26)
 *
 * Until this revision, *Mark arrived* minted one `TBD-<order>-<n>` unit per
 * line-quantity and QC overwrote the placeholder with the real serial off the
 * case. That was wrong in the way this codebase cares most about: the serial
 * number is the subject of the database, so a row whose serial is a made-up
 * string is a unit that is not about any machine. It carried a `DITERIMA`
 * event, it counted in inventory, it could be printed on a label — and nobody
 * had yet held the thing it claimed to be.
 *
 * It also broke the serial field itself. The QC table keyed its rows on the
 * serial and wrote every keystroke straight to the store, so each character
 * re-keyed the row, React remounted the input, and focus was gone: one click
 * per character, which is exactly how the owner reported it.
 *
 * So the grid is now DERIVED rather than materialised:
 *
 * - a **unit row** is a real machine — it has a serial somebody read off it;
 * - a **slot** is a machine the invoice says is here that nobody has
 *   identified yet. It lives in the page, not in the store, and it becomes a
 *   unit at the moment a serial is entered or scanned into it.
 *
 * Two whole classes of bug go away with it. Quantities need no syncing — raise
 * a quantity and a slot appears, because slots are counted, not stored — and
 * there is no longer any such thing as a unit with no serial to clean up.
 *
 * ## Lowering a quantity still never deletes work
 *
 * A unit row beyond its line's quantity is marked `overQuota`, the page paints
 * it red, and a human decides. The owner asked for exactly this: *"highlight
 * the row in red to show it instead of deleting it"*. Slots are the only thing
 * a lowered quantity removes, and a slot is nothing — it is a gap in the
 * paperwork, and no gap has ever been worth keeping.
 */
import type { MockDb, Po, Unit } from "../mock/seed.js";
import { conditionOf, needsDescription } from "./condition.js";

/**
 * The shape the old placeholders had.
 *
 * Kept for one reason only: `purgePlaceholderUnits` has to recognise them to
 * remove them. Nothing mints these any more, and nothing should — see the
 * docblock. When no store can still be carrying one, this can go.
 */
export const PLACEHOLDER_PREFIX = "TBD-";

/**
 * A NEW unit's stored serial — ten to twelve, owned by `lib/serialScan.ts`
 * (owner rules 2026-09-21: the barcode's `S` is dropped and nothing is put in
 * front). A second-hand serial is taken as read and has no window at all.
 * `readSerialInput` is what actually judges a serial; these only describe it.
 */
export { SERIAL_MAX_LENGTH, SERIAL_MIN_LENGTH } from "./serialScan.js";

export function isPlaceholderSerial(serial: string): boolean {
  return serial.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * Deletes every left-over placeholder unit, row and events together.
 *
 * The one sanctioned hard delete besides QC photos, and it is a migration
 * rather than a feature: these rows are not machines, they are the residue of
 * a design that has been withdrawn, so there is no history to preserve and
 * nothing they could be reconciled against. Runs once as the store boots.
 *
 * Returns how many units went, so a caller can say so.
 */
export function purgePlaceholderUnits(db: MockDb): number {
  const doomed = new Set(
    db.units.filter((u) => isPlaceholderSerial(u.serial)).map((u) => u.serial),
  );
  if (doomed.size === 0) return 0;
  db.units = db.units.filter((u) => !doomed.has(u.serial));
  db.events = db.events.filter((e) => !doomed.has(e.serial));
  return doomed.size;
}

/** One line of the QC table. */
export type QcRow =
  | {
      readonly kind: "unit";
      readonly key: string;
      readonly skuId: string;
      readonly unit: Unit;
      /** No live invoice line accounts for this machine any more. */
      readonly overQuota: boolean;
    }
  | {
      readonly kind: "slot";
      readonly key: string;
      readonly skuId: string;
      /** What the invoice paid for it, carried onto the unit it becomes. */
      readonly unitCost: number;
      /** 1-based, within its product — "2 of 3" on screen. */
      readonly ordinal: number;
      readonly quota: number;
    };

/**
 * The rows an arrived order should show, grouped by product.
 *
 * Identified machines first, in the order they were identified, then one slot
 * per machine the invoice still expects. Insertion order rather than serial
 * order on purpose: a serial entered into a slot must not make its row jump
 * somewhere else in the table the instant it is committed, and the newest
 * unit belongs next to the slots it was just promoted out of.
 *
 * A SKU with units but no live line — its line was deleted, or marked never
 * received — still appears, with a quota of zero, so every one of its units
 * comes back `overQuota` rather than silently vanishing from the screen.
 */
export function qcRows(po: Po, units: readonly Unit[]): QcRow[] {
  const quota = new Map<string, number>();
  const cost = new Map<string, number>();
  const order: string[] = [];
  const see = (skuId: string) => {
    if (!quota.has(skuId)) {
      quota.set(skuId, 0);
      order.push(skuId);
    }
  };

  for (const item of po.items) {
    if (item.notReceived || !item.skuId) continue;
    see(item.skuId);
    quota.set(item.skuId, quota.get(item.skuId)! + item.qty);
    if (!cost.has(item.skuId)) cost.set(item.skuId, item.unitCost);
  }

  const mine = units.filter((u) => u.poId === po.id);
  for (const u of mine) see(u.skuId);

  const rows: QcRow[] = [];
  for (const skuId of order) {
    const q = quota.get(skuId) ?? 0;
    const held = mine.filter((u) => u.skuId === skuId);
    held.forEach((unit, i) => {
      rows.push({
        kind: "unit",
        key: `unit:${unit.serial}`,
        skuId,
        unit,
        overQuota: i >= q,
      });
    });
    for (let n = held.length; n < q; n += 1) {
      rows.push({
        kind: "slot",
        // Positional, and only meaningful for as long as the counts hold:
        // filling any slot renumbers the rest, because a slot has no identity
        // beyond "the nth machine of this product that has no unit yet". The
        // page must therefore not park anything on a slot key that it would
        // mind losing — see `commitSerial` in InboundDetailPage.
        key: `slot:${skuId}:${n}`,
        skuId,
        unitCost: cost.get(skuId) ?? 0,
        ordinal: n + 1,
        quota: q,
      });
    }
  }
  return rows;
}

/**
 * A description is a LIST of phrases, comma-separated in the column (owner
 * revision 2026-08-27).
 *
 * "Mulus, fullset dus, charger original" is three facts about one machine, not
 * one sentence, and the shop writes the same facts about machine after
 * machine. As one free string they were three spellings waiting to happen and
 * nothing anyone could filter on; as a list they are picked from a managed
 * vocabulary (`QcDescription`) with new phrases joining it as they are typed.
 *
 * The COLUMN does not change — `Unit.description` is still one string, and it
 * is still the sentence a human reads on the unit's page. Comma is the join,
 * which is what the shop had already been typing.
 *
 * Splitting is case-insensitively deduped for the same reason the vocabulary
 * is: "mulus, Mulus" is somebody choosing the same phrase twice.
 */
export function splitDescription(stored: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of stored.split(",")) {
    const clean = part.trim();
    if (clean === "") continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** The stored form of a list of phrases. Inverse of `splitDescription`. */
export function joinDescription(parts: readonly string[]): string {
  return splitDescription(parts.join(",")).join(", ");
}

/**
 * Can this machine be accepted into stock?
 *
 * One question, one answer, three call sites — the Accept button's `disabled`,
 * the row's status tag and the group heading's "N ready to accept" count. They
 * used to each test `description.trim() === ""` themselves, which was fine
 * while the rule was one line; it stopped being fine the moment the rule
 * learned about condition (owner ask 2026-08-28), because a screen where the
 * button is live and the tag still says "Needs a description" is a screen
 * nobody trusts.
 *
 * Grade is deliberately NOT part of it. A machine can be accepted ungraded —
 * the description is what gates acceptance and the grade never has.
 */
export function qcReady(unit: Unit): boolean {
  if (!needsDescription(conditionOf(unit.grade))) return true;
  return unit.description.trim() !== "";
}

/**
 * The QC grid, grouped by the product each machine is (owner revision
 * 2026-08-27).
 *
 * One flat table could not say what it was for. Every row carried a Product
 * cell repeating the line above it, the rows a product still owed looked
 * exactly like the rows it had already filled, and there was nowhere for the
 * screen to say "this product expects three machines and you have two" — so it
 * read as a report on data that already existed rather than as the form it
 * actually is. The owner said as much: *"it looks just like display table but
 * the user is left confused"*.
 *
 * Grouping fixes all three at once. The product is said once, in a heading;
 * the counts below it are the group's own progress; and the rows inside are
 * just the machines, which is what a row should have been about from the
 * start.
 *
 * A group is derived, like everything else on this screen. Order follows
 * `qcRows` — invoice lines first, then any product with units but no live line
 * — so a product whose line was deleted still gets a heading rather than
 * vanishing with the machines under it.
 */
export interface QcGroup {
  readonly skuId: string;
  /** Machines the live invoice lines expect. Zero once the line has gone. */
  readonly quota: number;
  readonly rows: QcRow[];
  /** Rows that have a serial, and are therefore real machines. */
  readonly identified: number;
  /** Rows still waiting for one. */
  readonly waiting: number;
  /**
   * Units in QC that cannot be accepted yet, because nothing describes them.
   *
   * Second-hand machines only, as of the owner's condition ask (2026-08-28): a
   * sealed machine's description is optional, so counting one here would put a
   * warning tag on a group's heading that no amount of work could clear.
   */
  readonly needDescription: number;
  /** Units that have left QC — accepted, on the bench, or sent back. */
  readonly settled: number;
  /** Machines no live line accounts for. Painted red; see the docblock above. */
  readonly overQuota: number;
}

export function qcGroups(po: Po, units: readonly Unit[]): QcGroup[] {
  const groups: QcGroup[] = [];
  for (const row of qcRows(po, units)) {
    let group = groups.find((g) => g.skuId === row.skuId);
    if (!group) {
      group = {
        skuId: row.skuId,
        quota: 0,
        rows: [],
        identified: 0,
        waiting: 0,
        needDescription: 0,
        settled: 0,
        overQuota: 0,
      };
      groups.push(group);
    }
    // Written through the readonly face because the rows are being counted as
    // they arrive; nothing outside this loop ever mutates a group.
    const g = group as {
      -readonly [K in keyof QcGroup]: QcGroup[K];
    };
    g.rows.push(row);
    if (row.kind === "slot") {
      g.waiting += 1;
      // Every slot of a product is one of its quota, and the row knows the
      // whole quota — including the part already filled by units.
      g.quota = row.quota;
    } else {
      g.identified += 1;
      if (row.overQuota) g.overQuota += 1;
      if (row.unit.status === "QC") {
        if (!qcReady(row.unit)) g.needDescription += 1;
      } else {
        g.settled += 1;
      }
    }
  }
  // A group with no slots left never saw a `quota`, and its quota is however
  // many machines are covered by a line — which is all of them but the
  // over-quota ones.
  for (const g of groups) {
    if (g.waiting === 0) {
      (g as { quota: number }).quota = g.identified - g.overQuota;
    }
  }
  return groups;
}

/**
 * Move what was typed into a slot along, after one slot became a unit.
 *
 * ## Why this has to exist
 *
 * Every column is typable before the serial is (owner revision 2026-08-27):
 * the bench grades a machine in whatever order the machine offers itself, and
 * a screen that insists on the serial first is a screen that makes somebody
 * put the laptop down and pick it up again. So a slot can be carrying a
 * description and a battery reading with nothing to store them against yet.
 *
 * That collides with the one thing a slot does not have, which is identity. A
 * slot key is positional — "the nth machine of this product with no unit yet"
 * — so filling ANY slot removes the FIRST key from the list, and everything
 * typed into the slots above the one that was filled shifts down a row. Type
 * "dent kiri" into the third row, enter a serial on the third row, and the
 * dent lands on what is now the first.
 *
 * ## What it does instead
 *
 * Nothing arithmetic. The slots are in a stable order both before and after —
 * grouped by product, units then slots — so dropping the filled key from the
 * old list and zipping what is left against the new list is exact, and it
 * cannot drift if `qcRows` ever changes how it numbers them.
 *
 * Drafts on unit rows are keyed by serial and never move, so they are copied
 * across untouched.
 */
export function reslotDrafts<T>(
  drafts: Readonly<Record<string, T>>,
  before: readonly QcRow[],
  after: readonly QcRow[],
  filledKey: string,
): Record<string, T> {
  const from = before
    .filter((r) => r.kind === "slot" && r.key !== filledKey)
    .map((r) => r.key);
  const to = after.filter((r) => r.kind === "slot").map((r) => r.key);

  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(drafts)) {
    if (!key.startsWith("slot:")) out[key] = value;
  }
  from.forEach((was, i) => {
    const now = to[i];
    if (now !== undefined && was in drafts) out[now] = drafts[was]!;
  });
  return out;
}

/** Machines on the order that no live invoice line accounts for. */
export function overQuotaSerials(po: Po, units: readonly Unit[]): Set<string> {
  return new Set(
    qcRows(po, units)
      .filter((r) => r.kind === "unit" && r.overQuota)
      .map((r) => (r as Extract<QcRow, { kind: "unit" }>).unit.serial),
  );
}
