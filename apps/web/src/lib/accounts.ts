/**
 * Which pot the money is in — the till, or the bank.
 *
 * ## The owner's ask (2026-09-09)
 *
 * > *"For the balance, we need to separate the cash balance and the bank
 * > balance. So for the payment method for both income and expense, it is:
 * > Cash, transfer (bank), and credit card. So deposit is the result of the
 * > payment, instead of a payment method."*
 *
 * One "Balance" figure could not answer the question the shop actually asks in
 * the morning, which is not *how much money do we have* but *how much is in
 * the drawer*. Those are different numbers with different jobs: the drawer
 * pays a courier and gives change, the bank pays a supplier. A shop that knows
 * only the sum discovers the difference when somebody cannot make change.
 *
 * ## A method belongs to an account, and that is the whole mapping
 *
 * There is no separate "account" to pick, and there must not be: staff already
 * say how the money moved, and asking a second time for something derivable
 * from the first answer is how the two end up disagreeing. Cash is the drawer;
 * a transfer, a card and a QRIS scan all land in the bank.
 *
 * Marketplace money is a bank movement — but only once it has been withdrawn,
 * and that is a fact about the payment's STATE rather than about its method.
 * A balance is built from settled movements alone, so escrow never reaches
 * one; when the withdrawal is confirmed the money arrives the way every
 * payout does, by transfer, and lands in the bank. `lib/marketplace.ts` owns
 * everything before that moment.
 *
 * ## Deposit is not a method (owner, 2026-09-09)
 *
 * It used to be one, which made "how was this invoice paid?" answerable with
 * "deposit" — a sentence that says when the money was decided about and
 * nothing about how it moved. A deposit is paid BY cash, transfer or card, and
 * a deposit is what RESULTS. So an allocation now carries the deposit's own
 * method plus `fromDepositId`, and the balance skips it: the money left the
 * shop on the day of the deposit, and counting it again when somebody decides
 * which invoice it settles would spend it twice.
 *
 * Pure: no React, no store. `test/accounts.test.ts` is the spec.
 */

/** The two pots a balance is kept in. */
export type AccountKind = "CASH" | "BANK";

/**
 * Where money that has SETTLED through this method ends up.
 *
 * `undefined` means no pot, and it is the safe direction to be wrong in: a
 * method nobody has mapped is left out of both balances rather than silently
 * inflating one. Everything the shop is paid through today is mapped, so an
 * undefined answer is a method somebody added in Settings — and a figure the
 * balance reports separately rather than losing.
 */
export function accountOfMethod(code: string): AccountKind | undefined {
  switch (code) {
    case "TUNAI":
    case "COD":
      return "CASH";
    case "TRANSFER":
    case "KARTU_KREDIT":
    case "QRIS":
    case "DEBIT":
    case "MARKETPLACE":
      // MARKETPLACE is a payout, once it is a payout: escrow is kept out of
      // the balance by only settled movements reaching this, and what a
      // marketplace finally sends arrives in the bank like any other transfer.
      return "BANK";
    case "TRANSFER_LUAR":
      /*
       * Money from an account this app does not keep (owner ask 2026-09-23):
       * *"Transfer from other bank for expense/deposit to supplier, which does
       * not reduce the bank balance in the POS."*
       *
       * No pot, deliberately and by name rather than by falling through to
       * the default: an unmapped method is a method somebody added in
       * Settings and a figure the balance reports separately, and this is not
       * that — it is a method whose whole job is to settle a debt and move
       * neither figure.
       */
      return undefined;
    case "RETUR_SUPPLIER":
      /*
       * A supplier return's credit against the unit's invoice (owner
       * 2026-10-26): the invoice owes less and no money moved anywhere. No
       * pot, by name, for the reason TRANSFER_LUAR has none.
       */
      return undefined;
    default:
      return undefined;
  }
}

/**
 * The methods an adjustment may be recorded through — the owner's three.
 *
 * Codes rather than rows, the same trade `PAYMENT_METHOD_CODES` makes in the
 * fixture: `PaymentMethod` is a real table with its own labels, and a second
 * list of labels here would be a second answer to what the shop accepts. The
 * finance screen resolves these against `db.paymentMethods`.
 */
export const ADJUSTMENT_METHOD_CODES = [
  "TUNAI",
  "TRANSFER",
  "KARTU_KREDIT",
  // Settles without moving a pot (owner ask 2026-09-23) — an expense paid
  // from an account this app does not keep.
  "TRANSFER_LUAR",
] as const;

/**
 * Methods the app writes by itself and no payment picker offers: a supplier
 * return's credit (2026-10-26) is written by the return dialog, and typing
 * one by hand would shrink an invoice with no unit going back.
 */
export const UNPICKABLE_METHOD_CODES: ReadonlySet<string> = new Set([
  "RETUR_SUPPLIER",
]);

/** May a person pick this method in a payment dialog? */
export function isPickableMethod(code: string): boolean {
  return !UNPICKABLE_METHOD_CODES.has(code);
}

/** One movement of money, reduced to the two things a balance needs. */
export interface Movement {
  /** A `PaymentMethod` code. */
  readonly method: string;
  /** Positive in, negative out. */
  readonly amount: number;
}

/** What the shop holds, in each pot and altogether. */
export interface Balances {
  readonly cash: number;
  readonly bank: number;
  /** cash + bank. Not a third pot — the sum, said once so nobody adds it up. */
  readonly total: number;
  /**
   * Money that moved through a method belonging to no pot.
   *
   * Reported rather than dropped: a figure that vanishes is a figure nobody
   * can reconcile. Nothing the shop is paid through today lands here, so
   * anything that does is a method somebody added in Settings — and the
   * balance says so out loud instead of guessing which pot it belongs to.
   */
  readonly unassigned: number;
}

/**
 * Add up movements into the two pots.
 *
 * Opening balances are passed in rather than being movements of their own,
 * because they are not movements: they are what was in each pot on the day
 * the shop started using this app, stated once. See `AppSettings.openingCash`.
 */
export function balancesOf(
  movements: readonly Movement[],
  opening: { readonly cash?: number; readonly bank?: number } = {},
): Balances {
  let cash = opening.cash ?? 0;
  let bank = opening.bank ?? 0;
  let unassigned = 0;
  for (const m of movements) {
    const account = accountOfMethod(m.method);
    if (account === "CASH") cash += m.amount;
    else if (account === "BANK") bank += m.amount;
    else unassigned += m.amount;
  }
  return { cash, bank, total: cash + bank, unassigned };
}
