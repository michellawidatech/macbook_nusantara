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
 * Shopee pays each order into the shop's SELLER BALANCE, net of what it kept,
 * and nothing reaches the bank until somebody withdraws a lump of their own
 * choosing on Shopee's site. No withdrawal names an order, so matching
 * payouts to sales — what this app tried since 2026-09-08 — cannot work. What
 * can: each channel is a pot.
 *
 * ## Revised the same day (owner): no Pending, no Received
 *
 * > *"For the Shopee transaction, the status is no longer 'Held by
 * > marketplace' or 'Received', but only save the total amount and the
 * > deduction … when they add a transaction from Shopee it gets counted to …
 * > 'Shopee balance'."*
 *
 * - ⚠️ REVISED 2026-11-15: a Shopee or Tokopedia payment is in that
 *   channel's balance once its payout is RECORDED (`marketplacePotOf`), not
 *   from the sale — until then it is waiting on the marketplace and in no
 *   balance at all. It counts what the customer paid less any deduction
 *   recorded against it. Its
 *   stored state (the till still writes PENDING, an older upload wrote
 *   SETTLED) is not read for this — no screen offers the choice any more.
 *   Not the bank: the Cash and Bank cards, the running balance and both
 *   reconciliations leave it out (`movesBalance` reads
 *   `CashflowRow.marketplace`).
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
 * to everything. Only a payment stored SETTLED before it is the bank's — that
 * is the one a person said had landed; one still stored PENDING never reached
 * the bank and is the pot's whatever its date.
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
 * Which seller balance a sale's payment is in, or undefined when it is not in
 * one — still waiting on Shopee (`awaitingChannelOf`), or the shop's cash or
 * bank money as before.
 *
 * ## Revised 2026-11-15 (owner): in the balance once released
 *
 * > *"At first when they make a transaction from Shopee, it is not even in
 * > their Shopee account. But when they add a deduction or mark as received
 * > or import an excel file, it will be added to the Shopee balance."*
 *
 * So a payment a marketplace takes (`channel` Shopee or Tokopedia — a part
 * corrected to cash drops its channel) is in the pot once it is RELEASED: it
 * has a settlement (a deduction typed, *Mark as received*, or the upload), or
 * it is stored SETTLED. One stored SETTLED before the cutoff stays where it was
 * counted: bank.
 */
export function marketplacePotOf(
  p: {
    readonly channel?: string;
    readonly state: string;
    readonly at: string;
  },
  potFrom: string | undefined,
  released: boolean,
): PotChannel | undefined {
  if (!isPotChannel(p.channel)) return undefined;
  if (isBankBeforeCutoff(p, potFrom)) return undefined;
  return released || p.state === "SETTLED" ? p.channel : undefined;
}

/**
 * The channel a payment is still waiting on — a marketplace payment nobody
 * has recorded a payout for. Not in the seller balance and not in the bank:
 * Shopee has not released it.
 */
export function awaitingChannelOf(
  p: {
    readonly channel?: string;
    readonly state: string;
    readonly at: string;
  },
  potFrom: string | undefined,
  released: boolean,
): PotChannel | undefined {
  if (!isPotChannel(p.channel) || p.state === "DUE") return undefined;
  if (isBankBeforeCutoff(p, potFrom)) return undefined;
  return marketplacePotOf(p, potFrom, released) === undefined
    ? p.channel
    : undefined;
}

const isBankBeforeCutoff = (
  p: { readonly state: string; readonly at: string },
  potFrom: string | undefined,
) => p.state === "SETTLED" && potFrom !== undefined && p.at < potFrom;

/** Where a channel's balance starts: Shopee's own figure at an instant. */
export interface PotBase {
  readonly amount: number;
  /** ISO instant. Everything released or withdrawn up to it is inside `amount`. */
  readonly at: string;
}

/** The starting points `AppSettings` holds — Shopee's only, for now. */
export function potBasesOf(settings: {
  readonly shopeeBalanceBase?: number;
  readonly shopeeBalanceBaseAt?: string;
}): Partial<Record<PotChannel, PotBase>> {
  return settings.shopeeBalanceBase !== undefined &&
    settings.shopeeBalanceBaseAt !== undefined
    ? {
        SHOPEE: {
          amount: settings.shopeeBalanceBase,
          at: settings.shopeeBalanceBaseAt,
        },
      }
    : {};
}

/** One channel's balance, as the Income & Expense card shows it. */
export interface MarketplacePot {
  readonly channel: PotChannel;
  /** Shopee's own figure the balance starts from; 0 when none is set. */
  readonly base: number;
  /** Σ (amount − deductions) of every payment released into this pot. */
  readonly paidIn: number;
  /** What withdrawals have taken out, altogether. */
  readonly withdrawn: number;
  /** `base + paidIn − withdrawn` — what the platform holds for the shop now. */
  readonly balance: number;
}

/**
 * Every channel's pot, from Income & Expense's rows (`cashflowRows`).
 *
 * A payment and its derived deduction row both carry `marketplace`, so adding
 * them signed is `amount − deductions`. A row that never reached the shop
 * (`inBalance` false — an exchange's moved copy) is left out, as the balance
 * leaves it out. A withdrawal counts whatever pot it landed in: it left the
 * seller balance either way.
 *
 * With a starting point (`bases`, 2026-11-15), only what was released
 * (`releasedAt`) or withdrawn AFTER its instant moves the balance — the rest
 * is already inside Shopee's figure, which is what lets the owner's report be
 * uploaded again without counting a payout twice.
 */
export function marketplacePots(
  rows: readonly CashflowRow[],
  bases: Partial<Record<PotChannel, PotBase>> = {},
): MarketplacePot[] {
  return POT_CHANNELS.map((channel) => {
    const base = bases[channel];
    const after = (at: string) => base === undefined || at > base.at;
    let paidIn = 0;
    let withdrawn = 0;
    for (const r of rows) {
      if (r.marketplace === channel && r.inBalance) {
        if (after(r.releasedAt ?? r.at))
          paidIn += r.direction === "INCOME" ? r.amount : -r.amount;
      } else if (
        r.direction === "INCOME" &&
        r.category === WITHDRAWAL_REASON[channel] &&
        r.status === "SETTLED" &&
        after(r.at)
      ) {
        withdrawn += r.amount;
      }
    }
    const start = base?.amount ?? 0;
    return {
      channel,
      base: start,
      paidIn,
      withdrawn,
      balance: start + paidIn - withdrawn,
    };
  });
}
