/**
 * Shopee's income report, read into "this order paid out this much".
 *
 * > *"Upload a Shopee Income report (Laporan Penghasilan, .xlsx) to mark
 * > sales received. Match each report row to a pending Shopee payment by the
 * > marketplace order number."* — owner brief, 2026-09-19
 *
 * Ticking thirty sales off against Shopee's dashboard one by one is how a
 * payout ends up recorded against the wrong sales. Shopee already lists every
 * released order with what it paid out for it, and the till has stored each
 * sale's Shopee order number since the same day (`SalePayment.ref`), so the
 * list can be matched rather than retyped.
 *
 * ## What the report looks like, as far as anybody here knows
 *
 * There was no sample file when this was written. Shopee's export has a few
 * summary rows at the top, then a table whose order column is headed
 * **"No. Pesanan"** ("Order ID" / "Order SN" in English) and whose payout
 * column is something like **"Total Penghasilan"**, "Jumlah Dana Dilepaskan",
 * "Total Income" or "Escrow Amount", often with a release date ("Tanggal Dana
 * Dilepaskan") beside it. So:
 *
 * - **The header row is FOUND, not assumed** — the first thirty rows of every
 *   sheet are scanned for an order-number heading, and the row that also has
 *   the most convincing payout heading wins.
 * - **Detection says how sure it is.** `sure` is true only when exactly one
 *   order column and one strong payout column were recognised by name. When
 *   it is false the import screen shows the two pickers — order-number column,
 *   payout column — built from the header row, so a layout nobody predicted is
 *   still usable rather than refused.
 *
 * ## Three files, as of 2026-09-21
 *
 * Two real exports have turned up since — the order export (2026-09-20) and
 * the seller balance report (2026-09-21); the income report's headings are
 * still the guess above. Each is recognised by its headings:
 *
 * | file | payout column | fee lines |
 * |---|---|---|
 * | Rincian Penghasilan (income report) | `Total Penghasilan` | its own columns |
 * | `my_balance_transaction_report.shopee.*` (seller balance) | `Jumlah`, on an order's rows | none — the rates supply them |
 * | `Order.completed.*` (order export) | **none**: refused | none — estimated |
 *
 * The balance report is the one the shop actually downloads to see what
 * landed; `BALANCE_HEADERS` has what makes it safe to read.
 *
 * ## Money
 *
 * A number cell is a number already (`lib/xlsxRead.ts` reads the XML value,
 * which carries no formatting) and is rounded to the rupiah. A TEXT cell is
 * parsed by `parseAmount`, which never hands a formatted string to
 * `parseFloat`: the dot is Indonesian thousands, and "1.500" is fifteen
 * hundred rupiah, not one and a half.
 *
 * Pure: no React, no store. `test/shopeeIncome.test.ts` builds workbooks and
 * reads them back.
 */
import {
  commissionOn,
  commissionPctOf,
  seedFees,
  settlementTotals,
  type SettlementDraft,
} from "./marketplace.js";
import {
  closeOnPayout,
  estimateShopeeFees,
  reconcileEstimate,
  statedFee,
  type EstimatedFee,
  type ShopeeSaleFacts,
} from "./shopeeFees.js";
import type { Cell, XlsxSheet } from "./xlsxRead.js";
import { fmtNone } from "./format.js";

/** Where the report's table is in the workbook. */
export interface IncomeLayout {
  /** Index into the workbook's sheets. */
  readonly sheet: number;
  /** 0-based row index of the header row; data starts on the next row. */
  readonly headerRow: number;
  /** Column holding the marketplace's order number. */
  readonly order?: number;
  /** Column holding what Shopee paid out for the order. */
  readonly payout?: number;
  /** Column holding when Shopee released it, when there is one. */
  readonly released?: number;
  /**
   * The fee columns the income report carries, when it carries any.
   *
   * Their presence is what tells a Rincian Penghasilan from every other
   * Shopee export: the order export has 49 columns and not one fee among
   * them. When they are here, the deductions are Shopee's own statement and
   * nothing has to be estimated.
   */
  readonly fees?: readonly FeeColumn[];
  /**
   * True when both columns were recognised by name and nothing competed.
   * False means the screen must let a person say which columns they are.
   */
  readonly sure: boolean;
  /** This is `Order.completed.*.xlsx`, which carries no payout at all. */
  readonly orderExport?: boolean;
  /**
   * This is the SELLER BALANCE report, and these are its other columns. See
   * `BALANCE_HEADERS`.
   */
  readonly balance?: BalanceColumns;
}

/**
 * The seller balance report's own columns, beside the order number and the
 * amount (which are `order` and `payout`).
 */
export interface BalanceColumns {
  /** "Tipe Transaksi": Penghasilan dari Pesanan, Penyesuaian, Penarikan Dana… */
  readonly type?: number;
  /** "Jenis Transaksi": Transaksi Masuk / Transaksi Keluar. */
  readonly direction?: number;
  /** "Deskripsi": "Kompensasi Jasa Kirim", "Isi Ulang Saldo Iklan/Koin Penjual". */
  readonly description?: number;
  /** "Status": "Transaksi Selesai" when the money has moved. */
  readonly status?: number;
}

/** One of the income report's fee columns. */
export interface FeeColumn {
  readonly column: number;
  /** What it is called on Shopee's own statement. */
  readonly label: string;
}

/** How far down a sheet the header is looked for. */
export const HEADER_SCAN_ROWS = 30;

/** A heading, reduced to lowercase words: "No. Pesanan" → "no pesanan". */
export function headerKey(v: Cell | undefined): string {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  return String(v)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The order number's heading. Anchored at the start, so "No. Pengajuan" (a
 * return request) and a bare "No." (the row counter) are not mistaken for it.
 */
const ORDER_HEADERS: readonly RegExp[] = [
  /^(no|nomor|id) pesanan\b/,
  /^order (id|sn|no|number)\b/,
  /^(no|nomor) order\b/,
];

/**
 * The payout's heading, strongest first. A score of 8 or more is a heading
 * that can only mean the payout; below that it is a guess worth offering and
 * not worth trusting.
 */
const PAYOUT_HEADERS: readonly (readonly [RegExp, number])[] = [
  [/^total penghasilan\b/, 10],
  [/^(jumlah |total )?dana (yang )?dilepaskan\b/, 9],
  [
    /^(total income|payout amount|escrow amount|released amount|amount released|total released|income amount)\b/,
    8,
  ],
  [/\bpenghasilan\b/, 3],
  [/\b(income|payout|escrow)\b/, 3],
];

/** Headings that name a date, a state or a method — never the money. */
const NOT_MONEY = /\b(tanggal|waktu|date|time|status|metode|method)\b/;

/**
 * Headings that mean this is the ORDER export, not the income report.
 *
 * `Order.completed.*.xlsx` comes from Pesanan → Export. It has 49 columns and
 * **not one of them is a fee**; its only seller-facing money column is `Total
 * Pembayaran`, which is the BUYER's bill — subtotal, less Shopee's voucher
 * subsidy, plus the buyer's ongkir and a handling fee that never reaches the
 * shop. Measured against the two orders the owner screenshotted, it is out by
 * −46.750 on one and +425.572 on the other, so no correction factor rescues
 * it (docs/shopee-settlement-import.md).
 *
 * This is the foot-gun that document names: because such a file detects as
 * `sure: false`, the column pickers appear and a person can hand-pick `Total
 * Pembayaran` and import 27 rows of confident nonsense. It was confirmed by
 * running it. The fix is a REJECTION — recognising the file — rather than
 * another payout pattern, which would have made the foot-gun automatic.
 */
const ORDER_EXPORT_HEADERS: readonly RegExp[] = [
  /^total pembayaran\b/,
  /^perkiraan ongkos kirim\b/,
  /^no resi\b/,
  /^returned quantity\b/,
];

const RELEASED_HEADERS: readonly RegExp[] = [
  /^(tanggal|waktu)\b.*\b(dilepaskan|pelepasan)\b/,
  /\b(payout|release|released|escrow release)\b.*\b(date|time)\b/,
];

/**
 * The SELLER BALANCE report — Saldo Penjual → Transaksi → Export, the file
 * that arrives as `my_balance_transaction_report.shopee.*.xlsx` (owner,
 * 2026-09-21: *"the purpose of this file is to see what they actually
 * receive"*).
 *
 * It is the ledger of the shop's Shopee wallet, one row per movement: every
 * order's payout ("Penghasilan dari Pesanan #…", its `No. Pesanan` filled in),
 * courier compensation and other adjustments against an order, and the rows
 * that belong to no order at all — ad top-ups paid out of the balance and
 * withdrawals to the bank, whose `No. Pesanan` is "-". An order's `Jumlah` is
 * exactly what it paid in, so it is as good a payout figure as the income
 * report's `Total Penghasilan`; it just carries no fee breakdown, which is
 * what the published rates supply (`lib/shopeeFees.ts`).
 *
 * ⚠️ Two of its headings are traps, and the signature below is what keeps
 * both shut:
 *
 * - **"Jumlah" alone means nothing.** In the ORDER export it is the quantity
 *   column, so it is taken as money only when the rest of the header says this
 *   is the balance report — an order number, plus a running balance or a
 *   transaction type, and none of the order export's own headings.
 * - **"Saldo Akhir" is the running balance** after each row. It is never a
 *   payout: read as one, a Rp5.240.002 order would record Rp42.875.796.
 */
const BALANCE_HEADERS = {
  amount: /^(jumlah|amount)$/,
  running: /^(saldo akhir|ending balance|balance after transaction)$/,
  type: /^(tipe transaksi|transaction type)$/,
  direction: /^(jenis transaksi|transaction direction|money flow)$/,
  description: /^(deskripsi|description)$/,
  status: /^status$/,
  date: /^(tanggal|waktu) transaksi$|^transaction (date|time)$/,
} as const;

/** What one row, read as a header, says about the columns. */
export interface ColumnGuess {
  readonly order?: number;
  readonly payout?: number;
  readonly released?: number;
  readonly fees?: readonly FeeColumn[];
  /** True when the names leave no doubt. See `IncomeLayout.sure`. */
  readonly sure: boolean;
  /** How clearly the payout heading names the payout — see PAYOUT_HEADERS. */
  readonly payoutScore: number;
  /** This is the order export, which carries no payout. See above. */
  readonly orderExport: boolean;
  /** This is the seller balance report. See `BALANCE_HEADERS`. */
  readonly balance?: BalanceColumns;
}

/** Fee columns the income report carries, in the order Shopee lists them. */
const FEE_HEADERS: readonly (readonly [RegExp, string])[] = [
  [/^biaya administrasi\b/, "Biaya Administrasi"],
  [/^biaya proses pesanan\b/, "Biaya Proses Pesanan"],
  [/^biaya (gratis )?ongkir\b/, "Biaya Gratis Ongkir XTRA"],
  [/^biaya layanan\b/, "Biaya Layanan"],
  [/^biaya promo(si| xtra)?\b/, "Biaya Promo XTRA"],
  [/^(komisi ams|biaya komisi ams)\b/, "Komisi AMS"],
  [/^(premi|biaya lainnya)\b/, "Premi"],
];

/** Read one row as a header row. */
export function guessColumns(header: readonly Cell[]): ColumnGuess {
  const orders: number[] = [];
  let payout: number | undefined;
  let payoutScore = 0;
  let payoutTies = 0;
  let released: number | undefined;
  let orderExport = false;
  const fees: { column: number; label: string }[] = [];
  /** The balance report's headings, by name — see `BALANCE_HEADERS`. */
  const seen: Partial<Record<keyof typeof BALANCE_HEADERS, number>> = {};
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    if (key === "") return;
    if (ORDER_EXPORT_HEADERS.some((re) => re.test(key))) orderExport = true;
    const fee = FEE_HEADERS.find(([re]) => re.test(key));
    if (fee !== undefined) {
      fees.push({ column: i, label: fee[1] });
      return;
    }
    if (ORDER_HEADERS.some((re) => re.test(key))) {
      orders.push(i);
      return;
    }
    // None of these scores as a payout on its own, so noting them here and
    // moving on changes nothing for any other file.
    const named = (
      Object.keys(BALANCE_HEADERS) as (keyof typeof BALANCE_HEADERS)[]
    ).find((k) => BALANCE_HEADERS[k].test(key));
    if (named !== undefined) {
      seen[named] ??= i;
      return;
    }
    if (released === undefined && RELEASED_HEADERS.some((re) => re.test(key))) {
      released = i;
      return;
    }
    if (NOT_MONEY.test(key)) return;
    const score = PAYOUT_HEADERS.find(([re]) => re.test(key))?.[1] ?? 0;
    if (score === 0) return;
    if (score > payoutScore) {
      payout = i;
      payoutScore = score;
      payoutTies = 1;
    } else if (score === payoutScore) {
      payoutTies += 1;
    }
  });
  // The whole signature, or "Jumlah" is only a quantity — see BALANCE_HEADERS.
  const balance =
    !orderExport &&
    orders.length === 1 &&
    seen.amount !== undefined &&
    (seen.running !== undefined || seen.type !== undefined);
  if (balance) {
    payout = seen.amount;
    payoutScore = 10;
    payoutTies = 1;
    released ??= seen.date;
  }
  const balanceColumns: BalanceColumns = {
    ...(seen.type === undefined ? {} : { type: seen.type }),
    ...(seen.direction === undefined ? {} : { direction: seen.direction }),
    ...(seen.description === undefined
      ? {}
      : { description: seen.description }),
    ...(seen.status === undefined ? {} : { status: seen.status }),
  };
  return {
    ...(orders[0] === undefined ? {} : { order: orders[0] }),
    ...(payout === undefined ? {} : { payout }),
    ...(released === undefined ? {} : { released }),
    ...(fees.length === 0 ? {} : { fees }),
    ...(balance ? { balance: balanceColumns } : {}),
    // An order export is never `sure`, whatever else it matched: there is no
    // payout column in it to be sure about.
    sure:
      !orderExport &&
      orders.length === 1 &&
      payoutScore >= 8 &&
      payoutTies === 1,
    payoutScore,
    orderExport,
  };
}

/**
 * Find the report's table: the sheet and row whose headings name an order
 * number, preferring the one that also names the payout most clearly.
 *
 * When no row names an order number at all, the header is taken to be the
 * row with the most text in it — a starting point for the pickers, marked
 * unsure. `undefined` only for a workbook with nothing in it.
 */
export function detectIncomeLayout(
  sheets: readonly XlsxSheet[],
): IncomeLayout | undefined {
  let best: { layout: IncomeLayout; score: number } | undefined;
  sheets.forEach((sheet, s) => {
    const limit = Math.min(HEADER_SCAN_ROWS, sheet.rows.length);
    for (let r = 0; r < limit; r++) {
      const { payoutScore, ...columns } = guessColumns(sheet.rows[r] ?? []);
      if (columns.order === undefined) continue;
      const score = 100 + payoutScore;
      if (best === undefined || score > best.score) {
        best = { layout: { sheet: s, headerRow: r, ...columns }, score };
      }
    }
  });
  if (best !== undefined) return best.layout;

  // Nothing looks like an order number: offer the wordiest row.
  let fallback: { sheet: number; row: number; words: number } | undefined;
  sheets.forEach((sheet, s) => {
    const limit = Math.min(HEADER_SCAN_ROWS, sheet.rows.length);
    for (let r = 0; r < limit; r++) {
      const words = (sheet.rows[r] ?? []).filter(
        (c) => typeof c === "string" && c.trim() !== "",
      ).length;
      if (words > 0 && (fallback === undefined || words > fallback.words)) {
        fallback = { sheet: s, row: r, words };
      }
    }
  });
  if (fallback !== undefined) {
    return { sheet: fallback.sheet, headerRow: fallback.row, sure: false };
  }
  const first = sheets.findIndex((sh) => sh.rows.length > 0);
  return first < 0 ? undefined : { sheet: first, headerRow: 0, sure: false };
}

/** A column as the pickers offer it. */
export interface ColumnOption {
  readonly index: number;
  /** Excel's letter for it: A, B, … AA. */
  readonly letter: string;
  /** The heading, when the header row has one. */
  readonly header?: string;
}

export function columnLetter(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Every column the pickers can offer: as wide as the header row or the first
 * rows under it, whichever is wider, so a column with data and no heading is
 * still pickable.
 */
export function columnOptions(
  sheet: XlsxSheet,
  headerRow: number,
): ColumnOption[] {
  let width = 0;
  for (
    let r = headerRow;
    r < Math.min(sheet.rows.length, headerRow + 21);
    r++
  ) {
    width = Math.max(width, sheet.rows[r]?.length ?? 0);
  }
  const header = sheet.rows[headerRow] ?? [];
  return Array.from({ length: width }, (_, i) => {
    const h = header[i];
    const text =
      h === null || h === undefined || typeof h === "boolean"
        ? ""
        : String(h).trim();
    return {
      index: i,
      letter: columnLetter(i),
      ...(text === "" ? {} : { header: text }),
    };
  });
}

/**
 * An order number as both sides are compared: no spaces, upper case. A
 * number cell is written out in full — `toFixed(0)` rather than `String`, so a
 * long all-digit order number is not turned into "2.4e+14".
 */
export function normaliseOrderNo(v: Cell | undefined): string {
  if (v === null || v === undefined || typeof v === "boolean") return "";
  const s =
    typeof v === "number"
      ? Number.isInteger(v)
        ? v.toFixed(0)
        : String(v)
      : v;
  return s.replace(/^'/, "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Could this be an order number? It has a digit and is not a word — which is
 * what drops a "TOTAL" row, a repeated heading and the notes under a table.
 * Exported for `lib/shopeeRefunds.ts`, which reads the order export's rows.
 */
export function looksLikeOrderNo(s: string): boolean {
  return s.length >= 4 && /\d/.test(s) && /^[A-Z0-9][A-Z0-9\-_/.]*$/.test(s);
}

/** Groups of three after the first, or the reading is refused. */
const GROUPS = (sep: string) => new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`);

/**
 * A money cell, in whole rupiah — or `undefined` when it cannot be read with
 * confidence.
 *
 * Numbers are rounded. Text is read by its SEPARATORS, never by `parseFloat`:
 *
 * - both a dot and a comma: whichever comes LAST is the decimal point —
 *   "1.234.567,50" and "1,234,567.50" are the same amount;
 * - dots only: several are thousands ("1.234.567"); one followed by exactly
 *   three digits is thousands too ("1.500" is fifteen hundred, the Indonesian
 *   reading); one followed by one or two digits is a decimal point;
 * - commas only: the same rule, mirrored ("1,500" is fifteen hundred — a
 *   rupiah amount of one and a half does not occur);
 * - thousands must group in threes, or the text is refused rather than
 *   guessed at.
 *
 * "Rp", spaces, a trailing ",-", a leading minus and accounting parentheses
 * are all understood. Fractions of a rupiah are rounded half up.
 */
export function parseAmount(v: Cell | undefined): number | undefined {
  if (typeof v === "number")
    return Number.isFinite(v) ? Math.round(v) : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[\s\u00a0]/g, "").toLowerCase();
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1] ?? "";
  }
  const takeMinus = () => {
    if (s.startsWith("-")) {
      negative = !negative;
      s = s.slice(1);
    }
  };
  takeMinus();
  if (s.startsWith("rp")) s = s.slice(2);
  takeMinus();
  if (s.endsWith(",-") || s.endsWith(".-")) s = s.slice(0, -2);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return undefined;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let whole = s;
  let fraction = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const cut = Math.max(lastDot, lastComma);
    whole = s.slice(0, cut);
    fraction = s.slice(cut + 1);
    // "12.34,56" or "1,234,5.00" — not a shape anybody writes on purpose.
    if (whole.includes(decimal) || !GROUPS(thousands).test(whole)) {
      return undefined;
    }
    whole = whole.split(thousands).join("");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const count = s.split(sep).length - 1;
    const after = s.slice(s.lastIndexOf(sep) + 1);
    if (count > 1 || after.length === 3) {
      if (!GROUPS(sep).test(s)) return undefined;
      whole = s.split(sep).join("");
    } else if (after.length <= 2) {
      whole = s.slice(0, s.lastIndexOf(sep));
      fraction = after;
      if (whole === "") whole = "0";
    } else {
      // "1.2345": four digits after a lone separator is neither a grouping
      // nor a decimal anybody writes on a rupiah amount.
      return undefined;
    }
  }
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return undefined;
  if (whole.replace(/^0+/, "").length > 15) return undefined;
  const value =
    Number(whole) + (fraction !== "" && fraction[0]! >= "5" ? 1 : 0);
  return negative ? -value : value;
}

/**
 * A release date for the preview: an ISO day for an Excel date serial, or
 * the text as the report wrote it. Excel stores a date as days since
 * 1899-12-30, and a serial between 20000 and 80000 is a day between 1954 and
 * 2119 — which a payout date is, and an order number or an amount in this
 * column would not be.
 */
export function releasedText(v: Cell | undefined): string | undefined {
  if (typeof v === "number") {
    if (v < 20_000 || v > 80_000) return undefined;
    const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return undefined;
}

/** One order in the report — every row it has, added up. */
export interface IncomeLine {
  /** Normalised — see `normaliseOrderNo`. */
  readonly orderNo: string;
  /**
   * What Shopee paid out for it, whole rupiah. `undefined` when a row's
   * payout could not be read, or no payout column was chosen.
   */
  readonly payout: number | undefined;
  /** See `releasedText`. The first of the order's rows that has one. */
  readonly released?: string;
  /**
   * The fee lines the report states for it, when the file carries any.
   *
   * Shopee writes a deduction as a positive figure in a fee column, so these
   * come back positive too — the sign convention `SettlementFee` already
   * uses. A column that is blank on this row is left out rather than recorded
   * as zero: "Shopee charged nothing for this" and "this order paid no
   * SPayLater fee because there was no instalment" are the same row either
   * way, and a zero line in a deductions table is noise.
   */
  readonly fees?: readonly {
    readonly label: string;
    readonly amount: number;
  }[];
  /**
   * The balance report's rows for this order, one each, in file order — what
   * the payout is the SUM of. A plain order has one, its payout; a return
   * the courier compensated has a negative payout beside the compensation.
   * Only the balance report says this, so only it fills it in.
   */
  readonly parts?: readonly IncomePart[];
  /** The spreadsheet row numbers (1-based) it was read from. */
  readonly rows: readonly number[];
}

/** One balance-report row about an order. */
export interface IncomePart {
  /** "Penghasilan dari Pesanan", "Kompensasi Jasa Kirim" — Shopee's words. */
  readonly label: string;
  /** Signed: money into the balance is positive. */
  readonly amount: number;
  /** Is this the order's own payout, rather than an adjustment beside it? */
  readonly payout: boolean;
}

/**
 * Has this balance-report row's money actually moved? "Transaksi Selesai" has;
 * anything else named in the Status column — in progress, failed — has not,
 * and is left out rather than recorded as received. A blank status says
 * nothing either way and is kept.
 */
export function balanceRowDone(status: Cell | undefined): boolean {
  if (status === null || status === undefined) return true;
  const s = String(status).trim().toLowerCase();
  return s === "" || /selesai|berhasil|sukses|complete|success/.test(s);
}

/**
 * The amount with the sign the direction column gives it. Shopee writes an
 * outgoing row as a negative already; this is for an export that writes it
 * unsigned beside "Transaksi Keluar".
 */
function directed(amount: number, direction: Cell | undefined): number {
  const d = typeof direction === "string" ? direction.toLowerCase() : "";
  if (/keluar|outgoing|debit|\bout\b/.test(d)) return -Math.abs(amount);
  if (/masuk|incoming|credit|\bin\b/.test(d)) return Math.abs(amount);
  return amount;
}

const text = (v: Cell | undefined): string =>
  v === null || v === undefined || typeof v === "boolean"
    ? ""
    : String(v).trim();

/** What a balance-report row is, in Shopee's words, without the order no. */
function partLabel(row: readonly Cell[], columns: BalanceColumns): string {
  const description =
    columns.description === undefined
      ? ""
      : text(row[columns.description]).replace(/\s*#\s*\S+$/, "");
  return (
    description || (columns.type === undefined ? "" : text(row[columns.type]))
  );
}

/** Is this row an order's own payout — "Penghasilan dari Pesanan"? */
function isOrderPayout(row: readonly Cell[], columns: BalanceColumns): boolean {
  const said = [columns.type, columns.description]
    .map((c) => (c === undefined ? "" : text(row[c]).toLowerCase()))
    .join(" ");
  return /penghasilan dari pesanan|order income|income from order/.test(said);
}

/**
 * The report's orders, in the order they first appear.
 *
 * An order on more than one row — an adjustment beside the original payout —
 * is ONE line with the rows added up, because the question being answered is
 * "what did this order pay out", and two lines for one sale would try to
 * settle it twice.
 */
export function incomeLines(
  sheet: XlsxSheet,
  layout: IncomeLayout,
): IncomeLine[] {
  if (layout.order === undefined) return [];
  const balance = layout.balance;
  const by = new Map<
    string,
    {
      payout: number | undefined;
      unreadable: boolean;
      released?: string;
      /** Label → running total, so an order on two rows adds its fees up too. */
      fees: Map<string, number>;
      parts: IncomePart[];
      rows: number[];
    }
  >();
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const orderNo = normaliseOrderNo(row[layout.order]);
    if (!looksLikeOrderNo(orderNo)) continue;
    // Money still in flight is not money received — `balanceLeftovers`
    // counts what this leaves out, so the screen can say so.
    if (balance?.status !== undefined && !balanceRowDone(row[balance.status])) {
      continue;
    }
    const read =
      layout.payout === undefined ? undefined : parseAmount(row[layout.payout]);
    const amount =
      read === undefined || balance?.direction === undefined
        ? read
        : directed(read, row[balance.direction]);
    const released =
      layout.released === undefined
        ? undefined
        : releasedText(row[layout.released]);
    let cur = by.get(orderNo);
    if (cur === undefined) {
      cur = {
        payout: amount,
        unreadable: amount === undefined,
        ...(released === undefined ? {} : { released }),
        fees: new Map<string, number>(),
        parts: [],
        rows: [r + 1],
      };
      by.set(orderNo, cur);
    } else {
      cur.rows.push(r + 1);
      cur.unreadable ||= amount === undefined;
      cur.payout =
        cur.payout === undefined || amount === undefined
          ? undefined
          : cur.payout + amount;
      if (cur.released === undefined && released !== undefined) {
        cur.released = released;
      }
    }
    if (balance !== undefined && amount !== undefined) {
      cur.parts.push({
        label: partLabel(row, balance),
        amount,
        payout: isOrderPayout(row, balance),
      });
    }
    for (const col of layout.fees ?? []) {
      const fee = parseAmount(row[col.column]);
      // Blank or unreadable is not zero — see `IncomeLine.fees`.
      if (fee === undefined || fee === 0) continue;
      // Shopee writes a deduction as a negative on some sheets and a positive
      // on others. Either way it is money kept, so the magnitude is the fee.
      cur.fees.set(col.label, (cur.fees.get(col.label) ?? 0) + Math.abs(fee));
    }
  }
  return [...by.entries()].map(([orderNo, l]) => ({
    orderNo,
    payout: l.unreadable ? undefined : l.payout,
    ...(l.released === undefined ? {} : { released: l.released }),
    ...(l.fees.size === 0
      ? {}
      : {
          fees: [...l.fees.entries()].map(([label, amount]) => ({
            label,
            amount,
          })),
        }),
    ...(l.parts.length === 0 ? {} : { parts: l.parts }),
    rows: l.rows,
  }));
}

/** What a balance report holds besides order payouts. */
export interface BalanceLeftovers {
  /**
   * Rows about no order — ad top-ups paid out of the balance, withdrawals to
   * the bank — grouped by what Shopee calls them. Not a sale's payout, so the
   * upload records none of them; it only says they were there.
   */
  readonly other: readonly {
    readonly label: string;
    readonly count: number;
    /** Signed total. */
    readonly amount: number;
  }[];
  /** Order rows whose money has not moved yet (see `balanceRowDone`). */
  readonly notDone: number;
}

/** The rest of a balance report — see `BalanceLeftovers`. */
export function balanceLeftovers(
  sheet: XlsxSheet,
  layout: IncomeLayout,
): BalanceLeftovers {
  const balance = layout.balance;
  if (
    balance === undefined ||
    layout.order === undefined ||
    layout.payout === undefined
  ) {
    return { other: [], notDone: 0 };
  }
  const by = new Map<string, { count: number; amount: number }>();
  let notDone = 0;
  for (let r = layout.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const read = parseAmount(row[layout.payout]);
    // A blank row, or the notes under the table.
    if (read === undefined) continue;
    if (looksLikeOrderNo(normaliseOrderNo(row[layout.order]))) {
      if (
        balance.status !== undefined &&
        !balanceRowDone(row[balance.status])
      ) {
        notDone += 1;
      }
      continue;
    }
    const amount =
      balance.direction === undefined
        ? read
        : directed(read, row[balance.direction]);
    const label = partLabel(row, balance) || fmtNone();
    const cur = by.get(label) ?? { count: 0, amount: 0 };
    by.set(label, { count: cur.count + 1, amount: cur.amount + amount });
  }
  return {
    other: [...by.entries()].map(([label, v]) => ({ label, ...v })),
    notDone,
  };
}

/** A report order that matched exactly one pending sale. */
export interface IncomeMatch<P> {
  readonly line: IncomeLine;
  readonly pending: P;
}

/** The report against what the app is waiting for. */
export interface IncomeReconciliation<P> {
  readonly matched: readonly IncomeMatch<P>[];
  /** In the report; no Shopee sale in the app carries the number. */
  readonly unknown: readonly IncomeLine[];
  /** In the report; the sale carrying it was already recorded as received. */
  readonly alreadySettled: readonly IncomeLine[];
  /** In the report; more than one pending sale carries the number. */
  readonly ambiguous: readonly IncomeLine[];
  /** Pending in the app; the report does not mention it. */
  readonly missing: readonly P[];
}

/**
 * Match report orders to pending payments by order number.
 *
 * `settledRefs` are the order numbers of Shopee payments already received:
 * uploading the same report twice then says "already recorded" instead of
 * "unknown", and never settles a sale twice. Two pending sales carrying one
 * number are left for a person — picking one would be a guess.
 */
export function reconcileIncome<P>(
  lines: readonly IncomeLine[],
  pending: readonly P[],
  refOf: (p: P) => string | undefined,
  settledRefs: Iterable<string>,
): IncomeReconciliation<P> {
  const byRef = new Map<string, P[]>();
  for (const p of pending) {
    const ref = normaliseOrderNo(refOf(p) ?? "");
    if (ref === "") continue;
    byRef.set(ref, [...(byRef.get(ref) ?? []), p]);
  }
  const settled = new Set<string>();
  for (const r of settledRefs) settled.add(normaliseOrderNo(r));

  const matched: IncomeMatch<P>[] = [];
  const unknown: IncomeLine[] = [];
  const alreadySettled: IncomeLine[] = [];
  const ambiguous: IncomeLine[] = [];
  const mentioned = new Set<P>();
  for (const line of lines) {
    const hits = byRef.get(line.orderNo) ?? [];
    for (const p of hits) mentioned.add(p);
    if (hits.length === 1) matched.push({ line, pending: hits[0]! });
    else if (hits.length > 1) ambiguous.push(line);
    else if (settled.has(line.orderNo)) alreadySettled.push(line);
    else unknown.push(line);
  }
  return {
    matched,
    unknown,
    alreadySettled,
    ambiguous,
    missing: pending.filter((p) => !mentioned.has(p)),
  };
}

/**
 * Can this match be recorded? Only with a payout above zero: an unreadable
 * cell is a question for a person, and nothing or less than nothing paid out
 * is a refund or a cancellation — a return, not a withdrawal.
 */
export function recordable(line: IncomeLine): boolean {
  return line.payout !== undefined && line.payout > 0;
}

/**
 * What the file says about one waiting sale.
 *
 * - `STATED` — the file carries Shopee's own payout for it (the balance
 *   report's `Jumlah`, the income report's `Total Penghasilan`). What landed
 *   is that figure; the lines only say what the deduction was made of.
 * - `ESTIMATED` — the file carries no payout (the order export), so the
 *   published rates are all there is.
 * - `NOTHING_PAID` — Shopee paid out nothing, or took money back. A refund,
 *   a cancellation, a return: never a withdrawal.
 * - `UNREADABLE` — the file has a payout column and this order's cell in it
 *   could not be read. A question for a person, not a cue to estimate.
 */
export type PayoutStatus =
  "STATED" | "ESTIMATED" | "NOTHING_PAID" | "UNREADABLE";

/** Why a recordable row is not ticked when the preview opens. */
export type PayoutReview =
  /** More than a plain payout: a compensation, a refund, a correction. */
  | { readonly kind: "PARTS" }
  /** Shopee paid this much more than its own published fees leave room for. */
  | { readonly kind: "ABOVE_RATES"; readonly amount: number };

/** One waiting sale with what the file says it paid out. */
export interface PayoutRow<P> {
  readonly pending: P;
  readonly line: IncomeLine;
  readonly status: PayoutStatus;
  readonly gross: number;
  /** What landed — or, for `NOTHING_PAID`, what the file says it netted. */
  readonly received: number;
  /**
   * The deduction lines. For `STATED` they close exactly on `gross −
   * received`, the last of them naming whatever no rule accounts for.
   */
  readonly fees: readonly EstimatedFee[];
  /** Did the lines come off the file, or out of the rates? */
  readonly feesStated: boolean;
  readonly review: readonly PayoutReview[];
  readonly recordable: boolean;
  /** Ticked when the preview opens: recordable, and nothing to look at. */
  readonly preselect: boolean;
}

/**
 * Every matched sale, worked out.
 *
 * > *"The system will further add/breakdown what is the expense per pending
 * > payment based on rule base. However if there is discrepancies that are
 * > not mentioned in the rule just add like Biaya lainnya / additional
 * > payment."* — owner, 2026-09-21
 *
 * So for a stated payout the lines are, in order of preference: the fee lines
 * the report itself printed, or else the published rates for the sale's
 * category — and either way closed on Shopee's figure by `closeOnPayout`,
 * which is where "Biaya Lainnya" and "Pembayaran Tambahan" come from.
 *
 * `facts(p, estimating)` describes the sale; `estimating` is true only for a
 * row with no stated payout, which is the one place the conditional
 * programmes a person switched on belong. On a stated payout they would only
 * cut an unexplained remainder into a guess.
 *
 * Nothing unusual is ticked for the person — they tick it after reading why:
 * an order whose balance rows are more than one plain payout (a return in
 * the 1–21 Sep 2026 report paid −Rp53.625 and was compensated
 * Rp10.000.000 by the courier), and a payout above what the rates allow for, which usually
 * means the sale was recorded below its Shopee price.
 */
export function payoutRows<P>(
  matched: readonly IncomeMatch<P>[],
  layout: Pick<IncomeLayout, "payout">,
  gross: (p: P) => number,
  facts: (p: P, estimating: boolean) => ShopeeSaleFacts,
): PayoutRow<P>[] {
  return matched.map(({ line, pending }) => {
    const g = gross(pending);
    const base = { pending, line, gross: g, feesStated: false, review: [] };
    if (line.payout === undefined) {
      if (layout.payout !== undefined) {
        return {
          ...base,
          status: "UNREADABLE" as const,
          received: 0,
          fees: [],
          recordable: false,
          preselect: false,
        };
      }
      const fees = estimateShopeeFees(facts(pending, true));
      const deducted = fees.reduce((n, f) => n + f.amount, 0);
      return {
        ...base,
        status: "ESTIMATED" as const,
        received: Math.max(0, g - deducted),
        fees,
        recordable: true,
        preselect: true,
      };
    }
    if (line.payout <= 0) {
      return {
        ...base,
        status: "NOTHING_PAID" as const,
        received: line.payout,
        fees: [],
        recordable: false,
        preselect: false,
      };
    }
    const stated = (line.fees ?? []).map((f) => statedFee(f.label, f.amount));
    const { fees, unexplained } =
      stated.length > 0
        ? closeOnPayout(stated, g, line.payout)
        : reconcileEstimate(facts(pending, false), line.payout);
    const parts = line.parts ?? [];
    const review: PayoutReview[] = [];
    if (parts.length > 1 || parts.some((x) => !x.payout || x.amount <= 0)) {
      review.push({ kind: "PARTS" });
    }
    if (unexplained < 0)
      review.push({ kind: "ABOVE_RATES", amount: -unexplained });
    return {
      ...base,
      status: "STATED" as const,
      received: line.payout,
      fees,
      feesStated: stated.length > 0,
      review,
      recordable: true,
      preselect: review.length === 0,
    };
  });
}

/** What the shop's own rule expects Shopee to pay out for a sale. */
export function expectedPayout(
  gross: number,
  rates: Readonly<Record<string, number>> | undefined,
): number {
  return gross - commissionOn(gross, commissionPctOf("SHOPEE", rates));
}

/**
 * Report matches, as settlements ready to write — one per payment, each with
 * the report's payout as what landed.
 *
 * The fees are the shop's commission rule (`seedFees`), the same line a
 * withdrawal typed by hand opens with; the report's payout is the truth, and
 * where the two disagree the difference carries `reason`, exactly as it
 * would in the dialog.
 */
export function incomeDrafts(
  matches: readonly {
    readonly paymentId: string;
    readonly orderId: string;
    readonly gross: number;
    readonly payout: number;
  }[],
  rates: Readonly<Record<string, number>> | undefined,
  reason: string | undefined,
  newFeeId: () => string,
): SettlementDraft[] {
  return matches.map((m) => {
    const fees = seedFees(m.gross, "SHOPEE", rates, newFeeId());
    const disagrees = settlementTotals({
      gross: m.gross,
      fees,
      received: m.payout,
    }).needsReason;
    return {
      paymentId: m.paymentId,
      orderId: m.orderId,
      gross: m.gross,
      fees,
      received: m.payout,
      ...(disagrees && reason?.trim() ? { reason: reason.trim() } : {}),
    };
  });
}
