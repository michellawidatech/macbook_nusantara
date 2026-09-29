/**
 * Which Shopee orders a file says were refunded — and which sale each one is.
 *
 * > *"Also make it able to detect excel file (see the excel file I provided)
 * > to see refunds."* — owner, 2026-09-21, with
 * > `my_balance_transaction_report.shopee.20260901_20260921.xlsx` attached.
 *
 * ## What a refund looks like in the seller balance report
 *
 * The balance report (Saldo Penjual → Export) is the ledger of the shop's
 * Shopee wallet, and `lib/shopeeIncome.ts` already reads it into one line per
 * order with each of the order's rows kept as a PART. An order the buyer was
 * refunded for still has its own "Penghasilan dari Pesanan" row — Shopee pays
 * the item back to the buyer and keeps charging the seller its fees, so that
 * row is zero or less (−Rp53.625 on 260912RGK2YKYU in the owner's file).
 *
 * So a refund is an order whose OWN payout part is zero or less. Two readings
 * that look simpler are both wrong on the owner's real case, and are not used:
 *
 * - **the order's net** — the same order was also paid Rp10.000.000 of
 *   "Kompensasi Jasa Kirim" (the courier lost the returning parcel), which
 *   makes it net +Rp9.946.375: a healthy-looking payout;
 * - **`payoutRows`' NOTHING_PAID / `recordable`** — built on that same net,
 *   so they miss it for the same reason.
 *
 * ## …and in the order export
 *
 * `Order.completed.*.xlsx` (Pesanan → Export) carries no money anybody can
 * trust (`ORDER_EXPORT_HEADERS` in shopeeIncome.ts), but it does say, per
 * product row, "Status Pembatalan/ Pengembalian" — "Permintaan Disetujui" on
 * the same order — and "Returned quantity". Either one marks the order, except
 * a status saying the request was turned down.
 *
 * ## Matching a sale
 *
 * By the marketplace order number a sale's payment carries (`SalePayment.ref`),
 * or — once a return has cancelled what Shopee was holding, which removes the
 * payment and its reference with it — by the RETUR adjustment whose reason
 * names the number (`marketplaceRefs` in lib/returns.ts writes it there).
 *
 * Nothing here writes anything: a match is a suggestion to record a return.
 *
 * Pure: no React, no store. `test/shopeeRefunds.test.ts` is the spec.
 */
import {
  detectIncomeLayout,
  headerKey,
  incomeLines,
  looksLikeOrderNo,
  normaliseOrderNo,
  parseAmount,
  type IncomeLayout,
  type IncomeLine,
  type IncomePart,
} from "./shopeeIncome.js";
import type { Cell, XlsxSheet } from "./xlsxRead.js";

/** One order a file says was refunded. */
export interface ShopeeRefund {
  /** Normalised — see `normaliseOrderNo`. */
  readonly orderNo: string;
  /**
   * Balance report: the order's rows, its own payout first — "Penghasilan
   * dari Pesanan −53.625", then "Kompensasi Jasa Kirim +10.000.000".
   * Empty for the order export.
   */
  readonly parts: readonly IncomePart[];
  /** Order export: Shopee's "Status Pembatalan/ Pengembalian" for it. */
  readonly status?: string;
  /** Order export: how many pieces came back ("Returned quantity"). */
  readonly returnedQty?: number;
  /** Spreadsheet rows (1-based) it was read from. */
  readonly rows: readonly number[];
}

/** Which Shopee file it was, as far as refunds are concerned. */
export type RefundFileKind = "BALANCE" | "ORDER_EXPORT" | "OTHER";

export interface RefundScan {
  readonly kind: RefundFileKind;
  readonly refunds: readonly ShopeeRefund[];
  /** How many orders the file mentions at all. */
  readonly orders: number;
}

/** Was this order refunded? Its OWN payout paid nothing, or took money back. */
export function isRefundLine(line: IncomeLine): boolean {
  return (line.parts ?? []).some((p) => p.payout && p.amount <= 0);
}

/** The refunded orders among a balance report's lines, in file order. */
export function balanceRefunds(lines: readonly IncomeLine[]): ShopeeRefund[] {
  return lines.filter(isRefundLine).map((l) => ({
    orderNo: l.orderNo,
    // The payout row first — it is the one that says "refunded" — and the
    // rest in file order (a stable sort keeps them so).
    parts: [...(l.parts ?? [])].sort(
      (a, b) => Number(b.payout) - Number(a.payout),
    ),
    rows: l.rows,
  }));
}

/** "Status Pembatalan/ Pengembalian", or an English export's equivalent. */
const STATUS_HEADERS: readonly RegExp[] = [
  /^status pembatalan\b/,
  /^(cancellation|cancel|return|refund)\b.*\bstatus$/,
];

/** "Returned quantity" — the order export's own English heading. */
const RETURNED_HEADERS: readonly RegExp[] = [
  /^returned quantity\b/,
  /^(jumlah|kuantitas) (yang )?dikembalikan\b/,
];

/** A status saying the request was turned down: the buyer was not refunded. */
const REJECTED = /ditolak|rejected|declined/i;

const text = (v: Cell | undefined): string =>
  v === null || v === undefined || typeof v === "boolean"
    ? ""
    : String(v).trim();

/**
 * The refunded orders in an ORDER export. One order can span several product
 * rows; its first non-empty status is its status, and the returned quantities
 * add up. `columns` is false when the header has neither column, so the file
 * cannot say anything about refunds.
 */
export function orderExportRefunds(
  sheet: XlsxSheet,
  layout: Pick<IncomeLayout, "headerRow" | "order">,
): { refunds: ShopeeRefund[]; orders: number; columns: boolean } {
  const order = layout.order;
  if (order === undefined) return { refunds: [], orders: 0, columns: false };
  let status: number | undefined;
  let returned: number | undefined;
  (sheet.rows[layout.headerRow] ?? []).forEach((cell, i) => {
    const key = headerKey(cell);
    if (key === "") return;
    if (status === undefined && STATUS_HEADERS.some((re) => re.test(key))) {
      status = i;
    } else if (
      returned === undefined &&
      RETURNED_HEADERS.some((re) => re.test(key))
    ) {
      returned = i;
    }
  });
  const by = new Map<
    string,
    { status?: string; qty: number; rows: number[] }
  >();
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const orderNo = normaliseOrderNo(row[order]);
    if (!looksLikeOrderNo(orderNo)) continue;
    const cur = by.get(orderNo) ?? { qty: 0, rows: [] };
    const said = status === undefined ? "" : text(row[status]);
    if (said !== "" && cur.status === undefined) cur.status = said;
    // "1" arrives as TEXT in the owner's file; parseAmount reads either.
    const qty = returned === undefined ? undefined : parseAmount(row[returned]);
    if (qty !== undefined && qty > 0) cur.qty += qty;
    cur.rows.push(r + 1);
    by.set(orderNo, cur);
  }
  const refunds: ShopeeRefund[] = [];
  for (const [orderNo, o] of by) {
    const approved = o.status !== undefined && !REJECTED.test(o.status);
    if (o.qty <= 0 && !approved) continue;
    refunds.push({
      orderNo,
      parts: [],
      ...(o.status === undefined ? {} : { status: o.status }),
      ...(o.qty > 0 ? { returnedQty: o.qty } : {}),
      rows: o.rows,
    });
  }
  return {
    refunds,
    orders: by.size,
    columns: status !== undefined || returned !== undefined,
  };
}

/**
 * Read a workbook for refunds: the seller balance report, or the order
 * export. Anything else — the income report among them, whose single payout
 * figure is the net this module refuses to judge by — is `OTHER`.
 */
export function scanShopeeRefunds(sheets: readonly XlsxSheet[]): RefundScan {
  const other: RefundScan = { kind: "OTHER", refunds: [], orders: 0 };
  const layout = detectIncomeLayout(sheets);
  if (layout === undefined || layout.order === undefined) return other;
  const sheet = sheets[layout.sheet];
  if (sheet === undefined) return other;
  if (layout.balance !== undefined) {
    const lines = incomeLines(sheet, layout);
    return {
      kind: "BALANCE",
      refunds: balanceRefunds(lines),
      orders: lines.length,
    };
  }
  if (layout.orderExport === true) {
    const read = orderExportRefunds(sheet, layout);
    if (!read.columns) return other;
    return { kind: "ORDER_EXPORT", refunds: read.refunds, orders: read.orders };
  }
  return other;
}

/** A sale, as far as matching a refund to it is concerned. */
export interface RefundableSale {
  readonly id: string;
  readonly ts: string;
  readonly payments?: readonly { readonly ref?: string }[];
  readonly adjustments?: readonly {
    readonly type: string;
    readonly reason: string;
  }[];
}

/** How a refund found its sale. */
export interface RefundMatch<O> {
  readonly order: O;
  /**
   * `PAYMENT`: a payment still carries the number. `ADJUSTMENT`: a recorded
   * return names it — the return is already on the books.
   */
  readonly via: "PAYMENT" | "ADJUSTMENT";
}

/** Squashed the way `normaliseOrderNo` squashes, for a search inside text. */
const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/**
 * Has a return been recorded against this Shopee order on this sale — a RETUR
 * adjustment whose reason names the number (`marketplaceRefs` writes it)?
 *
 * The signal that it is on the books whatever else the sale did: a return of
 * part of the order, or an exchange at the counter, leaves units out and the
 * payment still carrying the number, so neither "nothing is out" nor "no
 * payment names it" can say so on its own.
 */
export function returnNamesOrder(
  sale: Pick<RefundableSale, "adjustments">,
  orderNo: string,
): boolean {
  const no = normaliseOrderNo(orderNo);
  if (no === "") return false;
  return (sale.adjustments ?? []).some(
    (a) => a.type === "RETUR" && squash(a.reason).includes(no),
  );
}

/**
 * The sale a refunded Shopee order is: the one whose payment carries its
 * number, else the one whose RETUR adjustment names it. Two candidates is
 * possible — a part of a Shopee payment moved onto another sale by an
 * exchange keeps its reference — and the OLDER is the sale the buyer's order
 * was.
 */
export function saleOfRefund<O extends RefundableSale>(
  orderNo: string,
  orders: readonly O[],
): RefundMatch<O> | undefined {
  const no = normaliseOrderNo(orderNo);
  if (no === "") return undefined;
  const oldest = (list: O[]) => list.reduce((a, b) => (b.ts < a.ts ? b : a));
  const byPayment = orders.filter((o) =>
    (o.payments ?? []).some((p) => normaliseOrderNo(p.ref ?? "") === no),
  );
  if (byPayment.length > 0) {
    return { order: oldest(byPayment), via: "PAYMENT" };
  }
  const byReturn = orders.filter((o) => returnNamesOrder(o, no));
  if (byReturn.length > 0) {
    return { order: oldest(byReturn), via: "ADJUSTMENT" };
  }
  return undefined;
}
