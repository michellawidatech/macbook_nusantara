/**
 * The S/N tracker's list: every serial the shop holds, where it is, and when
 * its ledger last moved (owner ask 2026-09-19).
 *
 * ## Why a list at all
 *
 * The tracker answered one question — "what happened to THIS serial?" — and
 * could only be asked it one serial at a time, through a picker that showed
 * nothing until somebody typed. The owner asked for the question before that
 * one: which serials are there, where are they, and which of them moved
 * lately. So the page opens on every serial the store holds, and one serial's
 * history is a button (or a scan) away.
 *
 * ## The last movement is the ledger's, not the projection's
 *
 * `Unit.status` says where a unit IS; it cannot say WHEN it got there. The
 * `UnitEvent` ledger can, and every state change appends a row to it — so a
 * unit's last movement is its newest event. Newest by `seq`, the order the
 * ledger was written in, rather than by `at`: two events appended in one
 * mutation can share a timestamp, and `seq` is also the order the history
 * view's timeline narrates, so the list and the timeline agree about which
 * event came last.
 *
 * ## Category, product and unit are one filter
 *
 * A category contains products and a product contains units (variants), so
 * the three filters the owner named are one tree rather than three dropdowns
 * — three dropdowns can contradict each other ("iPad" AND "MacBook Air M2"
 * matches nothing), a tree cannot. The picks are kept as VARIANTS: a ticked
 * category is every variant under it. A variant is what a row carries, so the
 * test a row has to pass is one set lookup, and the tree only ever offers
 * what the list actually holds — the same promise `ProTable`'s header filters
 * make, that no option can return nothing.
 *
 * Pure: no React, no store. `test/serialTracker.test.ts` is the spec.
 */
import type { MockDb, UnitEvent, UnitStatus } from "../mock/seed.js";
import { resolveSerialQuery } from "./serialInput.js";

/** A unit's newest ledger row, as far as the list is concerned. */
export interface TrackerMovement {
  /** `UnitEvent.type` — DITERIMA, QC_SELESAI, TERJUAL… */
  readonly type: string;
  /** When it happened, ISO. What the date range filters on. */
  readonly at: string;
  readonly seq: number;
}

/** One serial, as the tracker's list shows it. */
export interface TrackerRow {
  readonly serial: string;
  readonly skuId: string;
  /** `CatalogModel.id`, or "" when the catalogue no longer knows the variant. */
  readonly modelId: string;
  /** `CatalogModel.category`, or "" when unknown. */
  readonly category: string;
  /** The product — `Sku.name`, which is its model's name. */
  readonly product: string;
  /** The unit (variant) — `Sku.variantLabel`. */
  readonly variant: string;
  readonly status: UnitStatus;
  readonly locationId: string;
  /** The warehouse's name, or "" when the location is not one the store knows. */
  readonly warehouse: string;
  /**
   * The newest ledger row. Absent only for a unit nothing was ever written
   * about — which the demo shop never has, and a unit keyed in by hand before
   * the ledger existed might.
   */
  readonly last?: TrackerMovement;
}

/** What the list is built from — the store, narrowed to what it reads. */
export type TrackerSource = Pick<
  MockDb,
  "units" | "skus" | "models" | "warehouses" | "events"
>;

/** Each serial's newest event, by ledger order. */
export function latestEvents(
  events: readonly UnitEvent[],
): Map<string, UnitEvent> {
  const out = new Map<string, UnitEvent>();
  for (const e of events) {
    const seen = out.get(e.serial);
    if (seen === undefined || e.seq > seen.seq) out.set(e.serial, e);
  }
  return out;
}

/**
 * Every serial the store holds, joined to its catalogue entry, its warehouse
 * and its last movement.
 *
 * One pass over each table into a map, rather than a `find` per unit: the
 * shop's history runs to thousands of serials and tens of thousands of
 * events, and this is rebuilt whenever the store moves.
 */
export function trackerRows(db: TrackerSource): TrackerRow[] {
  const skus = new Map(db.skus.map((s) => [s.id, s]));
  const models = new Map(db.models.map((m) => [m.id, m]));
  const warehouses = new Map(db.warehouses.map((w) => [w.id, w]));
  const last = latestEvents(db.events);
  return db.units.map((u) => {
    const sku = skus.get(u.skuId);
    const model = sku === undefined ? undefined : models.get(sku.modelId);
    const e = last.get(u.serial);
    return {
      serial: u.serial,
      skuId: u.skuId,
      modelId: model?.id ?? "",
      category: model?.category ?? "",
      product: sku?.name ?? "",
      variant: sku?.variantLabel ?? "",
      status: u.status,
      locationId: u.locationId,
      warehouse: warehouses.get(u.locationId)?.name ?? "",
      ...(e === undefined
        ? {}
        : { last: { type: e.type, at: e.at, seq: e.seq } }),
    };
  });
}

/** What narrows the list. Every field is optional; absent narrows nothing. */
export interface TrackerFilter {
  /**
   * What was typed in the search box. Matched word by word against the
   * serial, product, unit, category and warehouse — "air m2" finds a
   * "MacBook Air … / M2 / …" whose two words are not next to each other.
   */
  readonly query?: string;
  /** Origin codes the shop has issued, so a store barcode finds its serial. */
  readonly supplierCodes?: Iterable<string>;
  /** Variants (`Sku.id`) to keep. Empty keeps every variant. */
  readonly skuIds?: readonly string[];
  /** The last movement on or after this instant (epoch ms). */
  readonly movedFrom?: number;
  /** The last movement on or before this instant (epoch ms). */
  readonly movedTo?: number;
}

/**
 * The rows a filter keeps, in the order they came in.
 *
 * Besides the word match, the query is also RESOLVED against the serials the
 * list holds (`resolveSerialQuery`) and the serial it names is kept whatever
 * its text: the shop's own sticker reads `AS` + the serial, which no substring
 * of the serial contains. A unit with no ledger at all has no last movement,
 * so a date range leaves it out — there is nothing to place in the range.
 */
export function filterTrackerRows(
  rows: readonly TrackerRow[],
  filter: TrackerFilter,
): TrackerRow[] {
  const words = (filter.query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  const named =
    words.length === 0
      ? undefined
      : resolveSerialQuery(
          filter.query ?? "",
          rows.map((r) => r.serial),
          filter.supplierCodes,
        );
  const skus =
    filter.skuIds !== undefined && filter.skuIds.length > 0
      ? new Set(filter.skuIds)
      : undefined;
  const { movedFrom, movedTo } = filter;
  const dated = movedFrom !== undefined || movedTo !== undefined;

  return rows.filter((r) => {
    if (skus !== undefined && !skus.has(r.skuId)) return false;
    if (dated) {
      if (r.last === undefined) return false;
      const at = Date.parse(r.last.at);
      if (Number.isNaN(at)) return false;
      if (movedFrom !== undefined && at < movedFrom) return false;
      if (movedTo !== undefined && at > movedTo) return false;
    }
    if (words.length === 0 || r.serial === named) return true;
    const haystack = [r.serial, r.product, r.variant, r.category, r.warehouse]
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/**
 * The serial a search box names outright, or null — what Enter (or a scan)
 * opens straight away.
 *
 * `resolveSerialQuery` tries every reading of the input — as typed, the shop's
 * sticker with its origin code taken off, the case's number with the marker
 * put back — and answers with the first that names a serial the store holds.
 * Anything that is not a serial the store holds opens nothing: a product name
 * typed and entered just stays a filter on the list.
 */
export function serialToOpen(
  query: string,
  known: Iterable<string>,
  supplierCodes: Iterable<string> = [],
): string | null {
  const serials = new Set(known);
  const hit = resolveSerialQuery(query, serials, supplierCodes);
  return hit !== "" && serials.has(hit) ? hit : null;
}

// ---------------------------------------------------------------------------
// The category → product → unit tree
// ---------------------------------------------------------------------------

/** One node of the filter tree. A leaf is a variant; its key is `skuKey`. */
export interface CatalogueNode {
  readonly key: string;
  /** What the node reads as. "" when the catalogue has no name for it. */
  readonly title: string;
  readonly children?: readonly CatalogueNode[];
}

const CATEGORY = "cat:";
const PRODUCT = "prod:";
const VARIANT = "sku:";

/** The tree key of a variant — what a checked leaf is called. */
export const skuKey = (skuId: string): string => `${VARIANT}${skuId}`;

/** The variant a leaf key names, or null for a category or product node. */
export function skuOfKey(key: string): string | null {
  return key.startsWith(VARIANT) ? key.slice(VARIANT.length) : null;
}

const byTitle = (a: CatalogueNode, b: CatalogueNode) =>
  a.title.localeCompare(b.title, undefined, { numeric: true });

/**
 * Category → product → unit, built from the rows the list holds.
 *
 * A product is keyed by its model where there is one and by its name where
 * there is not, so a variant whose model was deleted still lands somewhere a
 * person can tick. Alphabetical at every level, with numbers compared as
 * numbers — "MacBook Air 13 2015" before "… 2017", "8GB" before "16GB".
 */
export function catalogueTree(rows: readonly TrackerRow[]): CatalogueNode[] {
  const categories = new Map<
    string,
    Map<string, { title: string; variants: Map<string, string> }>
  >();
  for (const r of rows) {
    const products = categories.get(r.category) ?? new Map();
    categories.set(r.category, products);
    const productKey =
      r.modelId !== "" ? r.modelId : `~${r.product || r.skuId}`;
    const product = products.get(productKey) ?? {
      title: r.product,
      variants: new Map<string, string>(),
    };
    products.set(productKey, product);
    product.variants.set(r.skuId, r.variant);
  }
  return [...categories]
    .map(([category, products]) => ({
      key: `${CATEGORY}${category}`,
      title: category,
      children: [...products]
        .map(([productKey, p]) => ({
          key: `${PRODUCT}${productKey}`,
          title: p.title,
          children: [...p.variants]
            .map(([skuId, variant]) => ({ key: skuKey(skuId), title: variant }))
            .sort(byTitle),
        }))
        .sort(byTitle),
    }))
    .sort(byTitle);
}

/**
 * The variants a set of tree keys covers — a category or product key stands
 * for every variant under it. What a tree select hands back is turned into
 * the one shape the list filters on.
 */
export function skusUnder(
  tree: readonly CatalogueNode[],
  keys: readonly string[],
): string[] {
  const wanted = new Set(keys);
  const out = new Set<string>();
  const walk = (nodes: readonly CatalogueNode[], inside: boolean) => {
    for (const n of nodes) {
      const picked = inside || wanted.has(n.key);
      const sku = skuOfKey(n.key);
      if (sku !== null) {
        if (picked) out.add(sku);
      } else if (n.children !== undefined) {
        walk(n.children, picked);
      }
    }
  };
  walk(tree, false);
  return [...out];
}
