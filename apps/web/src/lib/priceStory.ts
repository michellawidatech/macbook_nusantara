/**
 * The price list story (owner ask 2026-11-17): an Instagram-story image of
 * what is on sale, made by hand from Export stock.
 *
 * > *"Make a feature to generate images like this based on the stock. For all
 * > stock, can be multiple."* — and, after four rounds of mockups: *"Use the
 * > design E, change the laptop to be more realistic, and make the user can
 * > customize the text as well."*
 *
 * This file is the part a test can read: which units count, one row per
 * variant with its price range, what staff typed per row (a "before" price
 * to strike through, a NEW tag, leaving a row off), the default words, and
 * how the rows are cut into pages. Drawing is `priceStoryLayout.ts` (where
 * everything goes, still pure) and `priceStoryPaint.ts` (the canvas).
 *
 * Which units: the same rule as the price list to copy in the same dialog
 * and the chatbot's — on sale (`isSellable`), admitted by the dialog's
 * filters, with their OWN sell price (`Unit.price`). The two lists must not
 * disagree, and `Sku.price` is not a price the shop stands behind
 * (2026-11-05). A unit with no sell price is counted and reported, not shown.
 *
 * Pure: no React, no store, no canvas.
 */
import type { Unit } from "../mock/seed.js";
import {
  inStockExport,
  type StockExportFilter,
  type StockExportSources,
} from "./stockExport.js";
import { isSellable } from "./inventory.js";

/** One variant on the story. */
export interface StoryRow {
  readonly skuId: string;
  /** The variant's axes, `8GB | 256GB`. Empty for a variant with none. */
  readonly spec: string;
  /** Lowest and highest own sell price among its units on sale. */
  readonly lo: number;
  readonly hi: number;
  readonly qty: number;
  /** Every unit counted is sealed — the NEW tag's default. */
  readonly allNew: boolean;
}

/** One product: its full name and its variants, cheapest first. */
export interface StoryProduct {
  readonly name: string;
  readonly rows: readonly StoryRow[];
}

export interface StoryStock {
  readonly products: readonly StoryProduct[];
  /** Units that pass the filters but have no sell price — left off. */
  readonly unpriced: number;
}

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/** `i5 / 8GB / 256GB` → `i5 | 8GB | 256GB`. */
export function specOf(variantLabel: string | undefined): string {
  return (variantLabel ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" | ");
}

/** What is on sale, one row per variant, grouped by product. */
export function storyStock(
  src: StockExportSources,
  filter: StockExportFilter,
): StoryStock {
  const skuById = new Map(src.skus.map((s) => [s.id, s]));
  const modelById = new Map(src.models.map((m) => [m.id, m]));
  const modelOf = (skuId: string) => {
    const sku = skuById.get(skuId);
    return sku && modelById.get(sku.modelId);
  };
  let unpriced = 0;
  const bySku = new Map<string, Unit[]>();
  for (const u of src.units) {
    if (!isSellable(u) || !inStockExport(u, filter, modelOf)) continue;
    if (!skuById.has(u.skuId)) continue;
    if (u.price === undefined || u.price <= 0) {
      unpriced += 1;
      continue;
    }
    const list = bySku.get(u.skuId);
    if (list) list.push(u);
    else bySku.set(u.skuId, [u]);
  }
  const byProduct = new Map<string, StoryRow[]>();
  for (const [skuId, units] of bySku) {
    const sku = skuById.get(skuId)!;
    const prices = units.map((u) => u.price!);
    const row: StoryRow = {
      skuId,
      spec: specOf(sku.variantLabel),
      lo: Math.min(...prices),
      hi: Math.max(...prices),
      qty: units.length,
      allNew: units.every((u) => u.grade === "NEW"),
    };
    const name = sku.name.trim();
    const rows = byProduct.get(name);
    if (rows) rows.push(row);
    else byProduct.set(name, [row]);
  }
  const products = [...byProduct.entries()]
    .map(([name, rows]) => ({
      name,
      rows: rows
        .slice()
        .sort((a, b) => a.lo - b.lo || collator.compare(a.spec, b.spec)),
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
  return { products, unpriced };
}

/** What staff set on one variant, kept on this device by its id. */
export interface StoryRowPref {
  /** The "before" price, struck through. Absent: only the price now. */
  readonly before?: number;
  /** The NEW tag, when staff switched it from its default. */
  readonly isNew?: boolean;
  /** Left off the story. */
  readonly hidden?: boolean;
}

export type StoryPrefs = Readonly<Record<string, StoryRowPref>>;

/** A row as it is drawn. */
export interface StoryLine extends StoryRow {
  readonly before?: number;
  readonly isNew: boolean;
}

export interface StoryGroup {
  readonly name: string;
  readonly rows: readonly StoryLine[];
}

/** A variant row with the product it belongs to — one line of the dialog's table. */
export interface StoryTableRow extends StoryRow {
  readonly product: string;
}

/** Every variant, flat, in the default order (product by name, cheapest first). */
export function flatRows(products: readonly StoryProduct[]): StoryTableRow[] {
  return products.flatMap((p) =>
    p.rows.map((r) => ({ ...r, product: p.name })),
  );
}

/**
 * The rows in the order staff dragged them into (owner ask 2026-11-18: *"they
 * can reorder the rows as well"*). `order` is the variant ids as last
 * arranged, kept on this device. A variant it does not name — new stock since
 * — goes straight after the row it follows by default, so it turns up beside
 * its own product rather than at the foot of the list. An id for stock that
 * has gone is skipped.
 */
export function orderedRows<T extends { readonly skuId: string }>(
  rows: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return rows.slice();
  const rank = new Map(order.map((id, i) => [id, i]));
  const out = rows
    .filter((r) => rank.has(r.skuId))
    .sort((a, b) => rank.get(a.skuId)! - rank.get(b.skuId)!);
  let prev: string | undefined;
  for (const r of rows) {
    if (!rank.has(r.skuId)) {
      const at =
        prev === undefined ? -1 : out.findIndex((o) => o.skuId === prev);
      out.splice(at + 1, 0, r);
    }
    prev = r.skuId;
  }
  return out;
}

/** `id` moved to sit just before (or after) `target`; every other id keeps its place. */
export function moveId(
  ids: readonly string[],
  id: string,
  target: string,
  place: "before" | "after",
): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target))
    return ids.slice();
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  rest.splice(at, 0, id);
  return rest;
}

/** Whether a row matches the search box: every word in its product name or spec. */
export function rowMatches(
  row: Pick<StoryTableRow, "product" | "spec">,
  query: string,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${row.product} ${row.spec}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * The rows with what staff set laid on top, hidden ones dropped, in `order`.
 * Neighbouring rows of one product share a card; a product whose variants were
 * dragged apart is drawn as a card at each place, because the picture follows
 * the list exactly.
 */
export function storyLines(
  products: readonly StoryProduct[],
  prefs: StoryPrefs,
  order: readonly string[] = [],
): StoryGroup[] {
  const out: { name: string; rows: StoryLine[] }[] = [];
  for (const r of orderedRows(flatRows(products), order)) {
    const pref = prefs[r.skuId] ?? {};
    if (pref.hidden) continue;
    const { product, ...row } = r;
    const line: StoryLine = {
      ...row,
      ...(pref.before !== undefined && pref.before > 0
        ? { before: pref.before }
        : {}),
      isNew: pref.isNew ?? r.allNew,
    };
    const last = out[out.length - 1];
    if (last && last.name === product) last.rows.push(line);
    else out.push({ name: product, rows: [line] });
  }
  return out;
}

/** A before price that does not sit above the price now — worth a warning. */
export function beforeIsLow(row: Pick<StoryRow, "lo">, before?: number) {
  return before !== undefined && before > 0 && before <= row.lo;
}

/**
 * Cut the groups into pages of at most `room` pixels, by each group's drawn
 * height (`heightOf(rowCount)`) plus `gap` between groups. A product is never
 * split across pages unless it alone is taller than a page; then it is cut
 * into page-sized pieces, each carrying the product's name.
 */
export function paginate(
  groups: readonly StoryGroup[],
  room: number,
  gap: number,
  heightOf: (rows: number) => number,
): StoryGroup[][] {
  // The most rows one card can hold on an empty page; never fewer than one.
  let most = 1;
  while (heightOf(most + 1) <= room) most += 1;
  const pieces: StoryGroup[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.rows.length; i += most) {
      pieces.push({ name: g.name, rows: g.rows.slice(i, i + most) });
    }
  }
  const pages: StoryGroup[][] = [];
  let page: StoryGroup[] = [];
  let used = 0;
  for (const piece of pieces) {
    const h = heightOf(piece.rows.length);
    const need = page.length === 0 ? h : used + gap + h;
    if (page.length > 0 && need > room) {
      pages.push(page);
      page = [piece];
      used = h;
    } else {
      page.push(piece);
      used = need;
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** The words on the story — every one of them editable. */
export interface StoryTexts {
  /** The chip at the top of the green card. */
  readonly promo: string;
  /** The big headline, two lines; the second is drawn in lime. */
  readonly titleTop: string;
  readonly titleBottom: string;
  readonly subtitle: string;
  /** The small chips at the foot of the green card, comma-separated. */
  readonly chips: string;
  /** Above the list. */
  readonly listTitle: string;
  readonly instagram: string;
  readonly whatsapp: string;
  readonly location: string;
}

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const MON = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MEI",
  "JUN",
  "JUL",
  "AGU",
  "SEP",
  "OKT",
  "NOV",
  "DES",
];

/** `PROMO · 17–30 NOV 2026`, or across a month: `PROMO · 25 NOV – 8 DES 2026`. */
export function promoPeriod(from: Date, days = 13): string {
  const to = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + days,
  );
  const a = from.getDate();
  const b = to.getDate();
  if (from.getFullYear() !== to.getFullYear()) {
    return `PROMO · ${a} ${MON[from.getMonth()]} ${from.getFullYear()} – ${b} ${MON[to.getMonth()]} ${to.getFullYear()}`;
  }
  if (from.getMonth() !== to.getMonth()) {
    return `PROMO · ${a} ${MON[from.getMonth()]} – ${b} ${MON[to.getMonth()]} ${to.getFullYear()}`;
  }
  return `PROMO · ${a}–${b} ${MON[from.getMonth()]} ${from.getFullYear()}`;
}

/** The words a new story starts from. Indonesian: it is the shop's own post. */
export function defaultStoryTexts(
  now: Date,
  contact: { readonly whatsapp: string },
): StoryTexts {
  return {
    promo: promoPeriod(now),
    titleTop: "Best",
    titleBottom: "Price.",
    subtitle: `${MONTHS[now.getMonth()]} ${now.getFullYear()} — lebih hemat dengan tukar tambah`,
    chips: "Tukar tambah, Garansi toko",
    listTitle: "Daftar harga",
    instagram: "macbooknusantara",
    whatsapp: contact.whatsapp,
    location: "Serpong",
  };
}

/** `11.999.000` — the dotted thousands the shop prints. */
export function dots(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `Rp 9.499.000`, or `Rp 9.499.000 – 10.299.000`. */
export function nowText(row: Pick<StoryRow, "lo" | "hi">): string {
  return row.lo === row.hi
    ? `Rp ${dots(row.lo)}`
    : `Rp ${dots(row.lo)} – ${dots(row.hi)}`;
}

/** `story-2026-11-17-1.png`. */
export function storyFileName(now: Date, page: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `story-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${page}.png`;
}
