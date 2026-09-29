/**
 * One supplier's account: what they have invoiced, what has been paid, and
 * what the shop is holding on deposit against future invoices.
 *
 * ## The owner's ask (2026-09-08)
 *
 * > *"Their current business flow is that they can have 1 supplier in that
 * > month sending them 2-3 invoices. Then they will make a deposit to that
 * > supplier, but they have not decided where the deposit money should go (to
 * > which purchase order) … the user must be able to allocate the deposit
 * > funds to a purchase order … Also per supplier we might have an unpaid
 * > transaction from years ago, so make sure we can input how much we owe
 * > them."*
 *
 * ## Why a deposit cannot just be a payment
 *
 * `PoPayment` already exists and already carries an amount, a method and a
 * target — and it hangs off ONE purchase order. That is exactly what a deposit
 * is not. The shop transfers Rp30.000.000 to a supplier on the 3rd, and which
 * of that month's three invoices it settles is a decision nobody has made yet;
 * forcing it onto an invoice at the moment the money moves means guessing, and
 * a guess in the ledger is worse than an unallocated balance because it looks
 * like a fact.
 *
 * So a deposit is money held AGAINST THE SUPPLIER, and allocating it later
 * writes an ordinary `PoPayment` carrying the deposit's own method and a
 * `fromDepositId` — *"deposit is the result of the payment, instead of a
 * payment method"* (owner, 2026-09-09), so the row says both how the money
 * moved and that it moved already. The deposit's own row keeps
 * the allocations so the balance is always `amount − Σ allocated`, and the
 * unallocated remainder is a real figure the shop can see rather than a
 * discrepancy somebody discovers at year end.
 *
 * ## ~~The opening balance~~ (gone 2026-09-24)
 *
 * *"Per supplier we might have an unpaid transaction from years ago"* was
 * answered by `Supplier.openingBalance` for a fortnight. The owner withdrew
 * it — *"remove the column 'Utang lama' or the amount from previous app, we
 * don't track it anymore (remove from database schema)"* — and the column,
 * `Payment.supplierId` and the payments that hung off it went with it. What
 * the shop owes a supplier is its open inbound invoices and nothing else.
 *
 * Money is whole rupiah, as everywhere in the mock layer.
 *
 * Pure: no React, no store. `test/supplierLedger.test.ts` is the spec.
 */

/**
 * Money paid to a supplier before anybody decided which invoice it settles.
 *
 * ⚠️ Mock-only. Prisma has `Payment` with a nullable `poId`, so a deposit is
 * ALMOST expressible — a payment with no order — but nothing there records the
 * supplier it was paid to (the supplier is reached through the order), and
 * nothing records an allocation. `Payment.supplierId` was that column for two
 * days and went on 2026-09-24 with the opening balance it was added for.
 */
export interface SupplierDeposit {
  readonly id: string;
  readonly supplierId: string;
  readonly amount: number;
  /** A `PaymentMethod` code — TRANSFER, TUNAI. */
  readonly method: string;
  readonly at: string;
  readonly note?: string;
  /**
   * False when the money never left the shop's cash or bank — the half of a
   * payment's switch that a remainder carries onto a deposit (2026-09-22).
   */
  readonly inBalance?: boolean;
  readonly staff: string;
  /** Where the money has been put since. */
  readonly allocations: readonly DepositAllocation[];
}

/** A slice of a deposit, put against one invoice. */
export interface DepositAllocation {
  readonly id: string;
  readonly poId: string;
  readonly amount: number;
  readonly at: string;
  readonly staff: string;
  readonly note?: string;
}

/** Σ what has been allocated out of one deposit. */
export function allocatedOf(d: Pick<SupplierDeposit, "allocations">): number {
  return d.allocations.reduce((n, a) => n + Math.max(0, a.amount), 0);
}

/**
 * What is left of one deposit.
 *
 * Floored at zero. Over-allocation is refused at the point of entry
 * (`allocationProblems`), and if a bad row reached the store anyway a negative
 * balance would read as the supplier owing the shop money — which is a
 * completely different situation and not one this figure should ever claim.
 */
export function remainingOf(d: SupplierDeposit): number {
  return Math.max(0, d.amount - allocatedOf(d));
}

/** What one supplier's account comes to. */
export interface SupplierAccount {
  readonly supplierId: string;
  /** Σ every open invoice's total. */
  readonly invoiced: number;
  /** Σ every payment recorded against those invoices, deposits included. */
  readonly paid: number;
  /** What the invoices still owe. */
  readonly owedOnInvoices: number;
  /**
   * Everything the shop owes — the invoices, and nothing else. Debt from
   * before this app went on 2026-09-24 with `Supplier.openingBalance`
   * (*"we don't track it anymore"*), so this and `owedOnInvoices` are the
   * same figure; both are kept because they are different questions and one
   * of them could grow another term again.
   */
  readonly owed: number;
  /** Money paid in advance and not yet put against anything. */
  readonly unallocated: number;
  /**
   * What the shop would have to transfer today to be square.
   *
   * The deposit comes off, because it is money the supplier already has. It is
   * floored at zero: a supplier holding more of the shop's money than the shop
   * owes them is in credit, and `credit` is where that shows.
   */
  readonly netOwed: number;
  /** The other direction: money on deposit above what is owed. */
  readonly credit: number;
  /** How many invoices are not fully paid. */
  readonly openInvoices: number;
  /** The oldest unpaid invoice's date, so a screen can say how old it is. */
  readonly oldestUnpaidAt?: string;
}

/** One invoice, as this ledger needs it. */
export interface LedgerInvoice {
  readonly id: string;
  readonly supplierId: string;
  readonly date: string;
  readonly total: number;
  readonly paid: number;
  /** Cancelled or closed invoices do not count towards what is owed. */
  readonly ignore?: boolean;
}

export function supplierAccount(
  supplierId: string,
  invoices: readonly LedgerInvoice[],
  deposits: readonly SupplierDeposit[],
): SupplierAccount {
  let invoiced = 0;
  let paid = 0;
  let openInvoices = 0;
  const unpaidDates: string[] = [];
  for (const inv of invoices) {
    if (inv.supplierId !== supplierId || inv.ignore) continue;
    invoiced += inv.total;
    paid += inv.paid;
    if (inv.paid < inv.total) {
      openInvoices += 1;
      unpaidDates.push(inv.date);
    }
  }
  unpaidDates.sort();
  const owedOnInvoices = Math.max(0, invoiced - paid);
  const owed = owedOnInvoices;
  const unallocated = deposits
    .filter((d) => d.supplierId === supplierId)
    .reduce((n, d) => n + remainingOf(d), 0);
  return {
    supplierId,
    invoiced,
    paid,
    owedOnInvoices,
    owed,
    unallocated,
    netOwed: Math.max(0, owed - unallocated),
    credit: Math.max(0, unallocated - owed),
    openInvoices,
    ...(unpaidDates[0] === undefined ? {} : { oldestUnpaidAt: unpaidDates[0] }),
  };
}

/**
 * Everything wrong with an allocation, in the order a reader would fix it.
 * Empty means it can be written.
 *
 * Both bounds are checked and both matter. Putting more than the deposit holds
 * against an invoice would create money; putting more than the invoice owes
 * would leave the invoice overpaid and the excess invisible — the shop would
 * think it had used the deposit when part of it is still sitting there.
 */
export function allocationProblems(input: {
  readonly amount: number;
  readonly depositRemaining: number;
  readonly invoiceOutstanding: number;
}): string[] {
  const out: string[] = [];
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    out.push("Enter how much of the deposit to use.");
  }
  if (input.amount > input.depositRemaining) {
    out.push("That is more than this deposit has left.");
  }
  if (input.amount > input.invoiceOutstanding) {
    out.push("That is more than this invoice still owes.");
  }
  return out;
}

/**
 * How much of a deposit to suggest against an invoice.
 *
 * The smaller of what is left and what is owed, which is what somebody
 * allocating would type nine times out of ten — and which, by construction,
 * can never be one of the two mistakes above.
 */
export function suggestedAllocation(
  depositRemaining: number,
  invoiceOutstanding: number,
): number {
  return Math.max(0, Math.min(depositRemaining, invoiceOutstanding));
}

/**
 * Spread a deposit over several invoices, oldest first.
 *
 * The one-press version of the same job, and oldest-first is the shop's rule
 * rather than the arithmetic's: an invoice that has been outstanding for six
 * weeks is the one the supplier telephones about. Returns what to put where,
 * with nothing over-allocated in either direction.
 */
export function spreadOldestFirst(
  remaining: number,
  invoices: readonly {
    readonly id: string;
    readonly date: string;
    readonly outstanding: number;
  }[],
): { readonly poId: string; readonly amount: number }[] {
  let left = Math.max(0, remaining);
  const out: { poId: string; amount: number }[] = [];
  for (const inv of [...invoices].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (left <= 0) break;
    const amount = Math.min(left, Math.max(0, inv.outstanding));
    if (amount <= 0) continue;
    out.push({ poId: inv.id, amount });
    left -= amount;
  }
  return out;
}

/**
 * Everything that has moved on one supplier's account, in one list.
 *
 * > *"In supplier tab, we should be able to add supplier and how much we owe
 * > them, and all the transaction history (now is deposit)."*
 * > — owner, 2026-09-09
 *
 * The page showed a table of deposits and called it the history, which is a
 * quarter of the story: what the shop OWES this supplier is invoices, and what
 * it has PAID is payments against those invoices — neither of which appeared
 * anywhere. So the question "what has happened between us and CV Apel Segar
 * this month?" had no screen at all.
 *
 * Four kinds of row, and the sign of each says which way the money went from
 * the SHOP's point of view: an invoice and an opening balance are charges (the
 * shop owes more), a payment and a deposit are money out. An allocation is
 * neither — it is the same rupiah being labelled, which is why it is a row of
 * its own with an amount that does not enter the running total. Recording it
 * as a payment as well as a deposit would double what the shop appears to have
 * spent, which is exactly the mistake `PoPayment.fromDepositId` exists to make
 * visible.
 *
 * Newest first, because this list is read from the top.
 */
export type LedgerEntryKind =
  /** An invoice the supplier raised. */
  | "INVOICE"
  /** Money sent against one invoice. */
  | "PAYMENT"
  /** Money sent in advance, against nothing yet. */
  | "DEPOSIT"
  /** Part of a deposit put against an invoice. Moves nothing. */
  | "ALLOCATION";

export interface LedgerEntry {
  readonly id: string;
  readonly kind: LedgerEntryKind;
  readonly at: string;
  /** The document this row is about, where it has one. */
  readonly ref?: string;
  /** The invoice it touches — for a link, and for an allocation's target. */
  readonly poId?: string;
  readonly amount: number;
  /**
   * What it does to what the shop owes: a charge raises it, a payment lowers
   * it, and an allocation does neither.
   */
  readonly direction: "CHARGE" | "PAYMENT" | "NEUTRAL";
  readonly note?: string;
  /** A `PaymentMethod` code, on the rows that moved money. */
  readonly method?: string;
}

/** One invoice, with what the history needs on top of what the account does. */
export interface HistoryInvoice extends LedgerInvoice {
  /** The shop's own document number — PI-2026/09-000003. */
  readonly code: string;
  /** The number the SUPPLIER put on their invoice. See `Po.invoice`. */
  readonly invoiceNo?: string;
  readonly payments: readonly {
    readonly id: string;
    readonly at: string;
    readonly amount: number;
    readonly method: string;
    /** Set when this payment came out of a deposit. See `PoPayment`. */
    readonly fromDepositId?: string;
  }[];
}

export function supplierHistory(
  supplierId: string,
  invoices: readonly HistoryInvoice[],
  deposits: readonly SupplierDeposit[],
): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const inv of invoices) {
    if (inv.supplierId !== supplierId) continue;
    out.push({
      id: `inv-${inv.id}`,
      kind: "INVOICE",
      at: inv.date,
      ref: inv.code,
      poId: inv.id,
      amount: inv.total,
      direction: "CHARGE",
      ...(inv.invoiceNo ? { note: inv.invoiceNo } : {}),
    });
    for (const p of inv.payments) {
      // A payment funded by a deposit is NOT money leaving the shop — that
      // happened on the day of the deposit. It appears below as an allocation
      // instead, hanging off the deposit it came out of.
      if (p.fromDepositId) continue;
      out.push({
        id: `pay-${p.id}`,
        kind: "PAYMENT",
        at: p.at,
        ref: inv.code,
        poId: inv.id,
        amount: p.amount,
        direction: "PAYMENT",
        method: p.method,
      });
    }
  }
  for (const d of deposits) {
    if (d.supplierId !== supplierId) continue;
    out.push({
      id: `dep-${d.id}`,
      kind: "DEPOSIT",
      at: d.at,
      amount: d.amount,
      direction: "PAYMENT",
      method: d.method,
      ...(d.note ? { note: d.note } : {}),
    });
    for (const a of d.allocations) {
      out.push({
        id: `alloc-${a.id}`,
        kind: "ALLOCATION",
        at: a.at,
        poId: a.poId,
        amount: a.amount,
        direction: "NEUTRAL",
        ...(a.note ? { note: a.note } : {}),
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
