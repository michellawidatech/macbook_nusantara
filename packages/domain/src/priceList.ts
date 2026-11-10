/**
 * The shop's price list as text (owner ask 2026-11-10): one line per variant,
 * grouped under its product, with the lowest and highest SELL price of the
 * units on sale. Two readers, one shape: Inventory's *Export stock* hands it
 * over to be pasted into a chat, and the chatbot sends it when a customer asks
 * for the day's pricelist — so what a customer is sent and what staff paste
 * cannot drift apart.
 *
 * A unit counts only with its own sell price above zero: the variant's asking
 * price is not a figure the shop stands behind (2026-11-05), and a unit with
 * no price has nothing to put on a list.
 *
 * Pure: no I/O, no clock — the caller passes the date it means.
 */
import { formatRupiah } from "./money.js";

/** One sellable unit, as the list reads it. */
export interface PriceListUnit {
  /** The product: `MacBook Air 13" M1`. */
  readonly product: string;
  /** The variant's specs: `8/256`. Empty for a product with one variant. */
  readonly variant: string;
  /** This unit's own sell price, whole rupiah. */
  readonly price: bigint | number | null;
}

/** One printed line: a variant and the spread of its prices. */
export interface PriceListLine {
  readonly product: string;
  readonly variant: string;
  readonly min: bigint;
  readonly max: bigint;
}

const toBig = (p: bigint | number | null): bigint | null => {
  if (p === null) return null;
  const v = typeof p === "bigint" ? p : BigInt(Math.trunc(p));
  return v > 0n ? v : null;
};

/**
 * The lines, products in name order (numbers compared as numbers, so 13"
 * comes before 15") and each product's variants cheapest first.
 */
export function priceListLines(
  units: readonly PriceListUnit[],
): PriceListLine[] {
  const byKey = new Map<
    string,
    { product: string; variant: string; prices: bigint[] }
  >();
  for (const u of units) {
    const price = toBig(u.price);
    if (price === null) continue;
    const product = u.product.trim();
    const variant = u.variant.trim();
    const key = `${product}\u0000${variant}`;
    const row = byKey.get(key);
    if (row) row.prices.push(price);
    else byKey.set(key, { product, variant, prices: [price] });
  }
  const collator = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  return [...byKey.values()]
    .map(({ product, variant, prices }) => ({
      product,
      variant,
      min: prices.reduce((a, b) => (b < a ? b : a)),
      max: prices.reduce((a, b) => (b > a ? b : a)),
    }))
    .sort(
      (a, b) =>
        collator.compare(a.product, b.product) ||
        (a.min < b.min ? -1 : a.min > b.min ? 1 : 0) ||
        collator.compare(a.variant, b.variant),
    );
}

/** `Rp 9.200.000`, or `Rp 9.200.000 – Rp 10.120.000` when the units differ. */
export function priceRangeText(min: bigint, max: bigint): string {
  return min === max
    ? formatRupiah(min)
    : `${formatRupiah(min)} – ${formatRupiah(max)}`;
}

export interface PriceListTextOptions {
  /** A first line, e.g. "Pricelist Macbook Nusantara · 10 Nov 2026". */
  readonly title?: string;
  /** WhatsApp bold (`*…*`) on each product heading. */
  readonly bold?: boolean;
}

/**
 * The list as a chat message:
 *
 *     MacBook Air 13" M1
 *     • 8/256: Rp 9.200.000 – Rp 10.120.000
 *     • 16/512: Rp 12.500.000
 *
 * A product with one unnamed variant prints its price on the bullet alone.
 */
export function priceListText(
  lines: readonly PriceListLine[],
  opts: PriceListTextOptions = {},
): string {
  const groups: string[][] = [];
  let product: string | null = null;
  for (const l of lines) {
    if (l.product !== product) {
      product = l.product;
      groups.push([opts.bold ? `*${l.product}*` : l.product]);
    }
    const price = priceRangeText(l.min, l.max);
    groups[groups.length - 1]!.push(
      l.variant ? `• ${l.variant}: ${price}` : `• ${price}`,
    );
  }
  const body = groups.map((g) => g.join("\n")).join("\n\n");
  return [opts.title ?? "", body].filter((s) => s !== "").join("\n\n");
}
