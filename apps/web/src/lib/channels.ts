/**
 * Where a sale came from, and which channels hold the money before the shop
 * ever sees it.
 *
 * Its own module because the answer to "is this money in the shop's hands?" is
 * asked in four places — the till, the invoice, Income & Expense and
 * Transaction History — and until 2026-08-26 each of them asked it by writing
 * `source === "SHOPEE"`. That was fine while Shopee was the only marketplace.
 * The owner then added Tokopedia and TikTok with the same settlement
 * behaviour, and three literal comparisons in four files is three chances to
 * add the fourth marketplace to two of them.
 *
 * So the fact lives here once: a channel either settles at the till or it does
 * not, and everything downstream asks `holdsFunds`.
 *
 * ## Adding the next marketplace
 *
 * One entry in `SALE_CHANNELS`, and the till, the escrow banner, the pending
 * chart and the invoice all follow. What does NOT follow is the database:
 * `Platform` in schema.prisma is the enum a real sale is stored against, and
 * it currently knows OFFLINE, WA, IG and SHOPEE. Widening it is a migration
 * and an owner decision, not something this file can do — see the note in
 * `SALE_CHANNELS`.
 */

/** A sale's channel, as the mock store writes it onto `Order.source`. */
export type SaleSource =
  "OFFLINE" | "SHOPEE" | "TOKOPEDIA" | "TIKTOK" | "INSTAGRAM" | "WHATSAPP";

export interface SaleChannel {
  readonly value: SaleSource;
  /** The channel as a noun — a column, a receipt line: "Channel  Shopee". */
  readonly label: string;
  /** The same thing mid-sentence: "Sold on Shopee", "Sold via WhatsApp". */
  readonly phrase: string;
  /**
   * The marketplace keeps the money until a withdrawal is confirmed.
   *
   * True of every marketplace the shop sells through and false of everything
   * else, including the two chat channels: a customer who pays by transfer
   * after a WhatsApp conversation has paid the shop directly, and the
   * conversation is not what settled it.
   */
  readonly holdsFunds: boolean;
}

/**
 * Every channel a sale can be recorded against, in the order the till offers
 * them.
 *
 * ⚠️ `TOKOPEDIA` and `TIKTOK` exist in this list and in the mock store only.
 * `Platform` in `packages/db/prisma/schema.prisma` still reads
 * `OFFLINE | WA | IG | SHOPEE`, and CLAUDE.md's first non-negotiable is that
 * nothing here invents schema. Adding the two enum members is a migration the
 * owner has to sign off; until then the API cannot store a sale on either
 * channel and this file is the UI running ahead of the database on purpose.
 */
export const SALE_CHANNELS: readonly SaleChannel[] = [
  {
    value: "OFFLINE",
    label: "In store",
    phrase: "in store",
    holdsFunds: false,
  },
  { value: "SHOPEE", label: "Shopee", phrase: "on Shopee", holdsFunds: true },
  {
    value: "TOKOPEDIA",
    label: "Tokopedia",
    phrase: "on Tokopedia",
    holdsFunds: true,
  },
  { value: "TIKTOK", label: "TikTok", phrase: "on TikTok", holdsFunds: true },
  {
    value: "INSTAGRAM",
    label: "Instagram",
    phrase: "via Instagram",
    holdsFunds: false,
  },
  {
    value: "WHATSAPP",
    label: "WhatsApp",
    phrase: "via WhatsApp",
    holdsFunds: false,
  },
];

const BY_VALUE = new Map(SALE_CHANNELS.map((c) => [c.value, c]));

export function channelOf(source: string): SaleChannel | undefined {
  return BY_VALUE.get(source as SaleSource);
}

/**
 * Does this channel keep hold of the money until a withdrawal is confirmed?
 *
 * An unknown channel answers `false`, and deliberately: the failure of guessing
 * wrong in that direction is a sale that shows as settled when it is not, which
 * a reconciliation catches. Guessing the other way parks real money in a
 * pending list nobody will ever clear.
 */
export function holdsFunds(source: string): boolean {
  return channelOf(source)?.holdsFunds ?? false;
}

/**
 * The payment method written onto a marketplace sale.
 *
 * There is no method to pick — the customer paid the marketplace, not the
 * shop — so the field records which marketplace is holding it. `PaymentMethod`
 * has a `MARKETPLACE` row that this is the human form of.
 */
export function marketplacePayMethod(source: string): string {
  const channel = channelOf(source);
  return channel ? `${channel.label} (escrow)` : "Marketplace (escrow)";
}
