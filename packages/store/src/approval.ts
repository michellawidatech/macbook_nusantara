/**
 * Which changesets only an approver may commit — edits and deletes of money
 * (owner/user 2026-11-13: "the delete, edit invoice, delete and edit inbound,
 * and delete / edit finance-related data have access management and others
 * can only send request").
 *
 * For an account without `Staff.canApprove`, `/api/store/commit` refuses (403,
 * `apps/api/src/auth/approvalScope.ts`) a changeset that:
 *
 *  - **sales** — removes an order; changes an existing order's date (`ts`),
 *    channel (`source`), customer, discount, additional charges (`fees`,
 *    `extra`), a trade-in it already carried, or the price of a unit or a
 *    counted line already on it; or takes a unit or a line off it;
 *  - **purchase invoices** — cancels one (removes the row); changes its
 *    order-level discount; lowers how many pieces it bills at a price, or
 *    moves the line discount on them; edits or removes an expense's amount;
 *    edits or removes a payment;
 *  - **Income & Expense** — edits or removes an existing `expenses` /
 *    `incomes` row.
 *
 * Everything else passes, deliberately, because the user drew the line at
 * "money that has already gone out of the bank — for unit-related, can still
 * change":
 *
 *  - a sale's PAYMENTS, refunds and return adjustments, and units or lines
 *    ADDED to it — the debt-payment dialog, Mark as settled, the Shopee
 *    upload, the return desk and an exchange all write those. A payment's
 *    reference travels with the payment, so it passes too.
 *  - QC on an invoice: serials, grades, arrival, `notReceived`, a product
 *    corrected on a line (the price stays), new lines, new expenses, new
 *    payments, and pricing a piece nobody has priced yet (unit cost 0 → a
 *    figure is entering the invoice, not correcting it).
 *  - an invoice still in DRAFT: nothing on it has been paid against.
 *  - a payment that is a supplier return's credit (`returnId`) or a deposit's
 *    allocation (`fromDepositId`): the return desk and /suppliers own those,
 *    and no money left the bank by them.
 *  - an expense that pays a service charge (`serviceFeeId`): the charge owns
 *    it, and service is unit work.
 *
 * Pieces are compared as a MULTISET, never by id: `normaliseLines` splits an
 * invoice written as "qty 3" into three pieces with new ids, and spreads the
 * line's discount over them, the first time anybody touches it. So the rule is
 * per unit price: the pieces billed at a price may not become fewer, and the
 * discount on them may not move.
 *
 * Here rather than in the API because both sides ask it: the server refuses,
 * and the browser asks the same question of a changeset it computed — which
 * is how the web suite proves the return desk, a debt payment and an
 * exchange still pass.
 *
 * Pure: no Prisma, no Express, no React. Shapes it does not recognise pass
 * through, to be refused by `commitStore` in its usual words.
 */
type Wire = Record<string, unknown>;

interface WireRow {
  readonly key: string;
  readonly base?: Wire;
  readonly next?: Wire;
}

/** Why a changeset needs an approver; undefined when it does not. */
export type ApprovalReason =
  | "SALE_REMOVED"
  | "SALE_EDITED"
  | "INVOICE_CANCELLED"
  | "INVOICE_PRICES"
  | "INVOICE_EXPENSE"
  | "INVOICE_PAYMENT"
  | "ADJUSTMENT_EDITED";

export interface ApprovalRefusal {
  readonly reason: ApprovalReason;
  readonly collection: string;
  readonly key: string;
}

function rowsOf(changes: unknown, collection: string): WireRow[] {
  if (typeof changes !== "object" || changes === null) return [];
  const collections = (changes as { collections?: unknown }).collections;
  if (typeof collections !== "object" || collections === null) return [];
  const change = (collections as Record<string, unknown>)[collection];
  if (typeof change !== "object" || change === null) return [];
  const rows = (change as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r): WireRow[] => {
    if (typeof r !== "object" || r === null) return [];
    const { key, base, next } = r as {
      key?: unknown;
      base?: unknown;
      next?: unknown;
    };
    if (typeof key !== "string") return [];
    const obj = (v: unknown): Wire | undefined =>
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? (v as Wire)
        : undefined;
    const b = obj(base);
    const n = obj(next);
    return [
      {
        key,
        ...(b === undefined ? {} : { base: b }),
        ...(n === undefined ? {} : { next: n }),
      },
    ];
  });
}

/** Canonical JSON, keys sorted and empties dropped — the store's own idea of "the same". */
function same(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}

function canon(value: unknown): string {
  return JSON.stringify(prune(value) ?? null);
}

function prune(value: unknown): unknown {
  if (value === undefined || value === null || value === false || value === "")
    return undefined;
  if (Array.isArray(value)) {
    const items = value.map((v) => prune(v) ?? null);
    return items.length === 0 ? undefined : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Wire).sort()) {
      const v = prune((value as Wire)[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}

/** Money on the wire is a decimal string; absent or empty is zero. */
function money(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

function list(v: unknown): Wire[] {
  return Array.isArray(v)
    ? v.filter((x): x is Wire => typeof x === "object" && x !== null)
    : [];
}

function byId(items: readonly Wire[]): Map<string, Wire> {
  const out = new Map<string, Wire>();
  for (const i of items) if (typeof i["id"] === "string") out.set(i["id"], i);
  return out;
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Is this edit of an existing sale one only an approver may make? */
function saleEditNeedsApproval(base: Wire, next: Wire): boolean {
  for (const field of [
    "ts",
    "source",
    "customerId",
    "discount",
    "discountId",
    "extra",
    "fees",
  ]) {
    if (!same(base[field], next[field])) return true;
  }
  // A unit already on the sale: still on it, at the price it sold for.
  const nextSerials = new Set(
    Array.isArray(next["serials"]) ? (next["serials"] as unknown[]) : [],
  );
  const basePrices = record(base["prices"]);
  const nextPrices = record(next["prices"]);
  const baseSerials = Array.isArray(base["serials"])
    ? (base["serials"] as unknown[])
    : [];
  for (const s of baseSerials) {
    if (typeof s !== "string") continue;
    if (!nextSerials.has(s)) return true;
    if (money(basePrices[s]) !== money(nextPrices[s])) return true;
  }
  // A counted line already on it: same product, same quantity, same price.
  // `returnedQty` is the return desk's and passes.
  const nextLines = byId(list(next["lines"]));
  for (const line of list(base["lines"])) {
    const id = line["id"];
    if (typeof id !== "string") continue;
    const now = nextLines.get(id);
    if (now === undefined) return true;
    if (
      now["skuId"] !== line["skuId"] ||
      now["qty"] !== line["qty"] ||
      money(now["price"]) !== money(line["price"])
    )
      return true;
  }
  // A trade-in it already took: still there, worth what it was.
  const nextTrades = byId(list(next["tradeIns"]));
  for (const trade of list(base["tradeIns"])) {
    const id = trade["id"];
    if (typeof id !== "string") continue;
    const now = nextTrades.get(id);
    if (now === undefined) return true;
    if (money(now["value"]) !== money(trade["value"])) return true;
  }
  return false;
}

/**
 * Pieces billed, per unit price: how many (a counted row's `qty`, an
 * identified piece's 1) and the discount on them. Unpriced pieces (0) are left
 * out — pricing one is entering it.
 */
function billedByPrice(
  items: readonly Wire[],
): Map<string, { pieces: number; discount: bigint }> {
  const out = new Map<string, { pieces: number; discount: bigint }>();
  for (const i of items) {
    const cost = money(i["unitCost"]);
    if (cost === 0n) continue;
    const key = cost.toString();
    const qty = typeof i["qty"] === "number" ? Math.max(1, i["qty"]) : 1;
    const had = out.get(key) ?? { pieces: 0, discount: 0n };
    out.set(key, {
      pieces: had.pieces + qty,
      discount: had.discount + money(i["discount"]),
    });
  }
  return out;
}

/** Which part of an existing invoice's money this edit touches, if any. */
function invoiceEditReason(base: Wire, next: Wire): ApprovalReason | undefined {
  if (money(base["discount"]) !== money(next["discount"]))
    return "INVOICE_PRICES";

  const was = billedByPrice(list(base["items"]));
  const now = billedByPrice(list(next["items"]));
  for (const [price, b] of was) {
    const n = now.get(price);
    if (n === undefined || n.pieces < b.pieces || n.discount !== b.discount)
      return "INVOICE_PRICES";
  }

  const fees = byId(list(next["fees"]));
  for (const fee of list(base["fees"])) {
    const id = fee["id"];
    if (typeof id !== "string") continue;
    const amount = money(fee["amount"]);
    if (amount === 0n) continue;
    const n = fees.get(id);
    if (n === undefined || money(n["amount"]) !== amount)
      return "INVOICE_EXPENSE";
  }

  const payments = byId(list(next["payments"]));
  for (const p of list(base["payments"])) {
    const id = p["id"];
    if (typeof id !== "string") continue;
    if (p["returnId"] !== undefined || p["fromDepositId"] !== undefined)
      continue;
    const n = payments.get(id);
    if (n === undefined) return "INVOICE_PAYMENT";
    for (const field of [
      "amount",
      "method",
      "at",
      "appliedTo",
      "feeId",
      "inBalance",
    ]) {
      const a = field === "amount" ? money(p[field]) : p[field];
      const b = field === "amount" ? money(n[field]) : n[field];
      if (field === "inBalance") {
        if ((a !== false) !== (b !== false)) return "INVOICE_PAYMENT";
      } else if (field === "amount") {
        if (a !== b) return "INVOICE_PAYMENT";
      } else if (!same(a, b)) {
        return "INVOICE_PAYMENT";
      }
    }
  }
  return undefined;
}

/** The first thing in `changes` that needs an approver, or undefined. */
export function approvalNeeded(changes: unknown): ApprovalRefusal | undefined {
  for (const r of rowsOf(changes, "orders")) {
    if (r.base === undefined) continue;
    if (r.next === undefined)
      return { reason: "SALE_REMOVED", collection: "orders", key: r.key };
    if (saleEditNeedsApproval(r.base, r.next))
      return { reason: "SALE_EDITED", collection: "orders", key: r.key };
  }

  for (const r of rowsOf(changes, "pos")) {
    if (r.base === undefined) continue;
    // A draft is still being typed; nothing has been paid against it.
    if (r.base["status"] === "DRAFT") continue;
    if (r.next === undefined)
      return { reason: "INVOICE_CANCELLED", collection: "pos", key: r.key };
    const reason = invoiceEditReason(r.base, r.next);
    if (reason !== undefined) return { reason, collection: "pos", key: r.key };
  }

  for (const r of rowsOf(changes, "expenses")) {
    if (r.base === undefined) continue;
    if (r.base["serviceFeeId"] !== undefined) continue;
    return { reason: "ADJUSTMENT_EDITED", collection: "expenses", key: r.key };
  }
  for (const r of rowsOf(changes, "incomes")) {
    if (r.base === undefined) continue;
    return { reason: "ADJUSTMENT_EDITED", collection: "incomes", key: r.key };
  }
  return undefined;
}
