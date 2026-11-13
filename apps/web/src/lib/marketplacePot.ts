/**
 * A marketplace's seller balance — the third place money can be (owner ask
 * 2026-11-13).
 *
 * > *"They only know the deduction of the transaction, but for getting it into
 * > bank account, they cannot know which transaction. They look at their
 * > shopee web, transfer a certain amount they want to liquidate to bank
 * > account, and that's it … Pending in marketplace should also account for
 * > the deduction, so like the final amount minus deduction, then in
 * > transaction, can add income from shopee, which will minus the 'Pending in
 * > Marketplace' balance."*
 *
 * Shopee releases each order into the shop's SELLER BALANCE, net of what it
 * kept, and nothing reaches the bank until somebody withdraws a lump of their
 * own choosing on Shopee's site. No withdrawal names an order, so matching
 * payouts to sales — what this app tried since 2026-09-08 — cannot work. What
 * can: each channel is a pot.
 *
 * - A marketplace payment still PENDING is *awaiting release* — at what the
 *   customer paid, less any deduction already typed against it.
 * - Once released (SETTLED: a deduction recorded, the Shopee upload, *Mark as
 *   settled*) its net is *in the seller balance*. Not the bank: the Cash and
 *   Bank cards, the running balance and both reconciliations leave it out
 *   (`movesBalance` reads `CashflowRow.marketplace`).
 * - A withdrawal is an income adjustment of reason `PENARIKAN_SHOPEE` /
 *   `PENARIKAN_TOKOPEDIA`: into the pot its method names, out of this one.
 *   Not revenue (Profit & Loss counted the sale) and kept out of the charts.
 *
 * ## The cutoff (`AppSettings.marketplacePotFrom`)
 *
 * A payment released BEFORE the rule arrived keeps counting as bank, as it
 * always did: the bank balance the shop has reconciled since 2026-10-27 must
 * not move by itself the morning after a deploy. The migration that brought
 * the rule wrote the instant; absent (tests, the demo seed) the rule applies
 * to everything. A payment still pending is always the pot's — when it is
 * released it is released after the cutoff.
 *
 * Pure: no React, no store. `test/marketplacePot.test.ts` is the spec.
 */
import type { CashflowRow } from "./cashflowRows.js";

/** The channels that hold a seller balance — the till's two marketplace chips. */
export const POT_CHANNELS = ["SHOPEE", "TOKOPEDIA"] as const;
export type PotChannel = (typeof POT_CHANNELS)[number];

/** The income reason that withdraws from each channel's pot. */
export const WITHDRAWAL_REASON: Readonly<Record<PotChannel, string>> = {
  SHOPEE: "PENARIKAN_SHOPEE",
  TOKOPEDIA: "PENARIKAN_TOKOPEDIA",
};

const isPotChannel = (c: string | undefined): c is PotChannel =>
  c !== undefined && (POT_CHANNELS as readonly string[]).includes(c);

/** The channel a withdrawal reason empties, or undefined for any other. */
export function withdrawalChannel(reason: string): PotChannel | undefined {
  return POT_CHANNELS.find((c) => WITHDRAWAL_REASON[c] === reason);
}

/** Is this income reason a withdrawal from a seller balance? */
export const isWithdrawalReason = (reason: string): boolean =>
  withdrawalChannel(reason) !== undefined;

/**
 * Which seller balance a sale's payment is in, or undefined when it is the
 * shop's cash or bank money as before.
 *
 * Only a payment a marketplace holds (`channel` Shopee or Tokopedia — a part
 * corrected to cash drops its channel). Pending is always the pot's; a
 * settled one is the pot's from the cutoff on.
 */
export function marketplacePotOf(
  p: {
    readonly channel?: string;
    readonly state: string;
    readonly at: string;
  },
  potFrom: string | undefined,
): PotChannel | undefined {
  if (!isPotChannel(p.channel)) return undefined;
  if (p.state !== "SETTLED") return p.channel;
  return potFrom === undefined || p.at >= potFrom ? p.channel : undefined;
}

/** One channel's seller balance, as the Income & Expense card shows it. */
export interface MarketplacePot {
  readonly channel: PotChannel;
  /** Paid by customers, not yet released: amount less any typed deduction. */
  readonly awaitingRelease: number;
  /** Released, net of deductions, less what has been withdrawn. */
  readonly inSellerBalance: number;
  /** What withdrawals have taken out, altogether. */
  readonly withdrawn: number;
  /** `awaitingRelease + inSellerBalance` — the money the platform holds. */
  readonly total: number;
}

/**
 * Every channel's pot, from Income & Expense's rows (`cashflowRows`).
 *
 * A payment and its derived deduction row both carry `marketplace`, so adding
 * them signed is `amount − deductions`. A row that never reached the shop
 * (`inBalance` false — an exchange's moved copy) is left out, as the balance
 * leaves it out. A withdrawal counts whatever pot it landed in: it left the
 * seller balance either way.
 */
export function marketplacePots(
  rows: readonly CashflowRow[],
): MarketplacePot[] {
  return POT_CHANNELS.map((channel) => {
    let awaitingRelease = 0;
    let released = 0;
    let withdrawn = 0;
    for (const r of rows) {
      if (r.marketplace === channel && r.inBalance) {
        const signed = r.direction === "INCOME" ? r.amount : -r.amount;
        if (r.status === "SETTLED") released += signed;
        else if (r.status === "PENDING") awaitingRelease += signed;
      } else if (
        r.direction === "INCOME" &&
        r.category === WITHDRAWAL_REASON[channel] &&
        r.status === "SETTLED"
      ) {
        withdrawn += r.amount;
      }
    }
    const inSellerBalance = released - withdrawn;
    return {
      channel,
      awaitingRelease,
      inSellerBalance,
      withdrawn,
      total: awaitingRelease + inSellerBalance,
    };
  });
}
