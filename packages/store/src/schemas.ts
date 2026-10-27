/**
 * The store's rows, as Zod schemas — one definition for three jobs.
 *
 * 1. **The server validates what a browser commits.** A changeset arrives as
 *    untrusted JSON; every row is parsed against these before anything is
 *    written, and a field the server does not know is refused rather than
 *    dropped (`strictObject`), so a page that grows a field nobody mapped
 *    fails loudly instead of losing the value on the next reload.
 * 2. **Money crosses the wire as a string.** CLAUDE.md: money is BigInt whole
 *    rupiah, serialised as a JSON string, never a `number`. The schemas are
 *    built by `storeSchemas(money)` with a money CODEC: `moneyAsBigInt` for the
 *    server, `moneyAsNumber` for the browser, whose pages have always done
 *    arithmetic on whole-rupiah numbers. `schema.decode(wire)` and
 *    `schema.encode(value)` convert in the two directions.
 * 3. **The browser's `MockDb` is checked against them.** `apps/web` asserts at
 *    compile time that its store is assignable to the decoded shape here, so
 *    the two cannot drift apart silently.
 *
 * The shapes mirror `apps/web/src/mock/seed.ts` field for field; the reasoning
 * behind each field lives in that file's docblocks and is not repeated here.
 *
 * Pure: no Prisma, no React, no I/O.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Vocabularies. The server maps each to a column or an enum in schema.prisma.
// ---------------------------------------------------------------------------

export const UNIT_STATUSES = [
  "QC",
  "TERSEDIA",
  "DIRESERVASI",
  "TERJUAL",
  "KLAIM_GARANSI",
  "RETUR_SUPPLIER",
  "REFUND_KLAIM",
  "HILANG",
  "KOREKSI_KELUAR",
  "SERVIS",
] as const;

export const UNIT_EVENT_TYPES = [
  "DITERIMA",
  "QC_SELESAI",
  "DICATAT",
  "DIPINDAH",
  "DIRESERVASI",
  "RESERVASI_BATAL",
  "TERJUAL",
  "RETUR_PELANGGAN",
  "RETUR_SUPPLIER",
  "KLAIM_DIBUKA",
  "KLAIM_SELESAI",
  "REFUND",
  "OPNAME_HILANG",
  "OPNAME_DITEMUKAN",
  "KOREKSI",
  "QC_DIBUKA",
  "DIARSIPKAN",
] as const;

/** `SaleSource` in apps/web/src/lib/channels.ts, plus LAINNYA (owner answer 2026-09-13). */
export const SALE_SOURCES = [
  "OFFLINE",
  "SHOPEE",
  "TOKOPEDIA",
  "TIKTOK",
  "INSTAGRAM",
  "WHATSAPP",
  "LAINNYA",
] as const;

export const GRADES = ["A", "B", "C", "NEW"] as const;
export const CONDITIONS = ["NEW", "SECOND"] as const;
export const LOCATION_KINDS = ["TOKO", "GUDANG", "SERVIS", "TRANSIT"] as const;
export const REASON_ACTIVITIES = [
  "ADJUSTMENT",
  "RETURN_CUSTOMER",
  "RETURN_SUPPLIER",
] as const;
export const CATALOG_SOURCES = ["MANUAL", "APPLEDB"] as const;
export const PO_STATUSES = ["DRAFT", "ORDERED", "RECEIVED"] as const;
export const PO_PAYMENT_FOR = ["ORDER", "TAX", "SHIPPING"] as const;
/** `FeeKind` — ONGKIR, PAJAK, BEACUKAI, LAIN — in the browser's words. */
export const PO_FEE_KINDS = ["SHIPPING", "TAX", "CUSTOMS", "OTHER"] as const;
export type PoFeeKind = (typeof PO_FEE_KINDS)[number];

/**
 * The order an invoice's expenses are listed in: by kind, then by label, then
 * by id — the same on the server's projection and in the browser.
 *
 * Needed because nothing stores an order: an expense's id is a random token,
 * and a list that reshuffles every time a till polls is a list nobody can
 * find their place in.
 */
export function byFeeOrder(
  a: { readonly kind: PoFeeKind; readonly label: string; readonly id: string },
  b: { readonly kind: PoFeeKind; readonly label: string; readonly id: string },
): number {
  const kind = PO_FEE_KINDS.indexOf(a.kind) - PO_FEE_KINDS.indexOf(b.kind);
  if (kind !== 0) return kind;
  // By code unit rather than `localeCompare`, so the order cannot depend on
  // the locale of whichever machine sorted it.
  const la = a.label.toLowerCase();
  const lb = b.label.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export const STOCK_IN_DECISIONS = ["ACCEPTED", "REJECTED"] as const;
export const STOCK_IN_REJECT_KINDS = ["SUPPLIER", "SERVICE"] as const;
export const PAYMENT_STATES = ["SETTLED", "PENDING", "DUE"] as const;
export const RETURN_KINDS = ["CUSTOMER", "SUPPLIER"] as const;
export const RETURN_STATUSES = [
  "PENDING",
  "ARRIVED",
  "DONE",
  "CANCELLED",
] as const;
export const RESERVATION_STATUSES = ["ACTIVE", "DONE", "CANCELLED"] as const;
export const DISCOUNT_TYPES = ["PCT", "NOMINAL", "BUNDLE"] as const;
export const EXPENSE_KINDS = [
  "OPERATIONAL",
  "PAYROLL",
  "MARKETING",
  "RENT",
  // Not offered by the picker since 2026-09-23 (the owner's list); accepted
  // so rows already written under them still commit.
  "PROFESSIONAL",
  "SOFTWARE",
  // Money handed back on a return or a cheaper exchange (owner ask
  // 2026-09-21). Written by the customer-return form.
  "REFUND",
  // The owner's categories, 2026-09-23 — see the migration of that date.
  "BUNGA",
  "SELISIH",
  "KOMPENSASI",
  "SUPPLIER",
  "TRANSFER",
  // A unit's own cost — a service charge paid (owner 2026-10-26). Written only
  // from a charge, never from Add adjustment; already in the unit's COGS.
  "UNIT",
  // A bank's or a marketplace's fee — what the monthly reconciliation records
  // a deduction under (owner 2026-10-27).
  "BIAYA_ADMIN",
] as const;
export const INCOME_REASONS = [
  "SALES",
  "TRANSFER",
  // Money coming back around a return: a supplier's credit, or a customer's
  // top-up on a dearer exchange.
  "REFUND",
  "BUNGA",
  "SELISIH",
] as const;
export const PAYMENT_LOG_ACTIONS = ["ADDED", "AMENDED", "REMOVED"] as const;
/**
 * Reconciliation (owner ask 2026-10-27, docs/superpowers/specs/
 * 2026-10-27-reconciliation-design.md): a DAILY count of the bank and the
 * drawer, and a MONTHLY match of the bank against its e-statement.
 */
export const RECON_KINDS = ["DAILY", "MONTHLY"] as const;
export const RECON_POTS = ["BANK", "CASH"] as const;
export const RECON_STATUSES = [
  "OPEN",
  "MATCHED",
  "ADJUSTED",
  "RECONCILED",
] as const;
export const STATEMENT_LINE_STATUSES = [
  "UNMATCHED",
  "MATCHED",
  "SUGGESTED",
  "IGNORED",
] as const;
export const RECON_EDIT_ACTIONS = ["EDITED", "ADDED"] as const;
export const SETTLEMENT_FEE_KINDS = [
  "COMMISSION",
  "SERVICE",
  "TRANSFER",
  "PROMOTION",
  "OTHER",
] as const;
export const SETTLEMENT_LOG_ACTIONS = [
  "RECORDED",
  "AMENDED",
  "REOPENED",
] as const;
export const SERVICE_FEE_KINDS = [
  "LABOUR",
  "PART",
  "SHIPPING",
  "OTHER",
] as const;
export const SERVICE_RAISED_BY = ["QC", "ADJUSTMENT", "RETURN"] as const;
export const ADJUSTMENT_KINDS = ["IN", "OUT"] as const;
export const OPNAME_STATUSES = ["DRAFT", "POSTED"] as const;
/**
 * Why a counted product's quantity moved (owner decision 2026-09-19). One
 * per door stock comes in or goes out of; see `stockMove`.
 */
export const STOCK_MOVE_TYPES = [
  "MASUK",
  "MASUK_BATAL",
  "TERJUAL",
  "RETUR_PELANGGAN",
  "TUKAR_TAMBAH",
  "OPNAME",
  "KOREKSI",
  "RETUR_SUPPLIER",
] as const;

// ---------------------------------------------------------------------------
// Money and time
// ---------------------------------------------------------------------------

export const MONEY_PATTERN = /^-?\d+$/;

/** The server's money: a decimal string on the wire, a BigInt in memory. */
export const moneyAsBigInt = z.codec(
  z.string().regex(MONEY_PATTERN, "Nilai rupiah harus bilangan bulat."),
  z.bigint(),
  {
    decode: (s) => BigInt(s),
    encode: (b) => b.toString(),
  },
);

/**
 * The browser's money: a decimal string on the wire, a whole-rupiah number in
 * memory — what every page has always computed with.
 *
 * Decoding refuses a figure past `Number.MAX_SAFE_INTEGER` rather than
 * rounding it (Rp9 quadrillion; no receipt reaches it, and a silently wrong
 * total is the thing to refuse). Encoding rounds to the rupiah: a percentage
 * fee computed in the browser can land on a fraction, and a commit refused at
 * the till over half a rupiah helps nobody.
 */
export const moneyAsNumber = z.codec(
  z
    .string()
    .regex(MONEY_PATTERN, "Nilai rupiah harus bilangan bulat.")
    .refine(
      (s) => Number.isSafeInteger(Number(s)),
      "Nilai rupiah terlalu besar.",
    ),
  z.number(),
  {
    decode: (s) => Number(s),
    encode: (n) => String(Math.round(n)),
  },
);

export type MoneyCodec = typeof moneyAsBigInt | typeof moneyAsNumber;

/** An instant, ISO-8601. Parsed by the server, not trusted. */
const instant = z
  .string()
  .refine(
    (s) => s !== "" && !Number.isNaN(Date.parse(s)),
    "Waktu tidak valid.",
  );

/** A calendar day, `YYYY-MM-DD` (Asia/Jakarta) — the schema's convention. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid.");

const id = z.string().min(1);
const text = z.string();
const count = z.number().int();

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

export function storeSchemas<M extends MoneyCodec>(money: M) {
  const settings = z.strictObject({
    batteryGoodMin: z.number(),
    batteryFairMin: z.number(),
    cycleGoodMax: z.number().optional(),
    cycleFairMax: z.number().optional(),
    marketplaceMarkupPct: z.number().optional(),
    marketplaceFees: z.record(z.string(), z.number()).optional(),
    openingCash: z.optional(money),
    openingBank: z.optional(money),
    openingBalanceAt: instant.optional(),
    /**
     * Where the book was closed up to (`AppSetting` `finance.booksClosedAt`).
     * ⚠️ IGNORED since 2026-10-27, when the book close was retired in favour
     * of reconciliation; still in the contract so a shop that closed a month
     * still loads. Nothing writes it and nothing locks by it.
     */
    booksClosedAt: instant.optional(),
    shopName: text.optional(),
    shopTagline: text.optional(),
    shopAddress: text.optional(),
    shopContact: text.optional(),
  });

  const paymentMethod = z.strictObject({
    id,
    code: z.string().min(1),
    label: text,
    builtIn: z.boolean(),
    forPo: z.boolean(),
    forSale: z.boolean(),
    active: z.boolean(),
  });

  const warehouse = z.strictObject({
    id,
    /**
     * `Location.code` — the shop's own number for the warehouse, `01` to `04`
     * from B2Soft (owner ask 2026-10-08). Optional so a changeset written
     * before it still commits.
     */
    code: text.optional(),
    name: text,
    active: z.boolean(),
    kind: z.enum(LOCATION_KINDS).optional(),
  });

  const rack = z.strictObject({
    id,
    warehouseId: id,
    name: text,
    active: z.boolean(),
  });

  /*
   * Money paid against a debt from before this app — `Customer.openingBalance`
   * (owner answer 2026-09-22). A `Payment` naming the customer directly,
   * because there is no sale for it to hang off. The opening figure itself is
   * never rewritten: what was owed on the day and what has been paid since are
   * two facts.
   *
   * The SUPPLIER half of this went on 2026-09-24 (*"we don't track it anymore
   * (remove from database schema)"*), and `Payment.supplierId` with it.
   */
  const openingPayment = z.strictObject({
    id,
    method: z.string().min(1),
    amount: money,
    at: instant,
    note: text.optional(),
    /** `Payment.inBalance`. Absent means it counts, as on every payment. */
    inBalance: z.boolean().optional(),
  });

  const supplier = z.strictObject({
    id,
    name: z.string().min(1),
    phone: text.optional(),
    address: text.optional(),
    code: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  });

  const reason = z.strictObject({
    id,
    activity: z.enum(REASON_ACTIVITIES),
    label: z.string().min(1),
    active: z.boolean(),
  });

  const qcDescription = z.strictObject({
    id,
    label: z.string().min(1),
    active: z.boolean(),
  });

  const named = z.strictObject({
    id,
    name: z.string().min(1),
    active: z.boolean(),
  });

  /**
   * A product category, and the one fact about it the app branches on
   * (2026-09-15).
   *
   * Categories reached the browser as bare NAMES on a model and on a grading
   * rule, which was enough while nothing else was true of one. `tracksSerial`
   * is something else true of one — *"Accessories do not have serial number"* —
   * so the category itself now crosses the wire.
   */
  const category = z.strictObject({
    id,
    name: z.string().min(1),
    /** False for what the shop counts rather than identifies. See `Category`. */
    tracksSerial: z.boolean(),
  });

  const gradingCriterion = z.strictObject({
    id,
    category: z.string().min(1),
    name: text,
    options: z.array(z.strictObject({ id, label: text })),
  });

  const gradingRule = z.strictObject({
    id,
    category: z.string().min(1),
    grade: z.enum(GRADES),
    conditions: z.array(
      z.strictObject({ criterionId: id, optionIds: z.array(id) }),
    ),
  });

  const model = z.strictObject({
    id,
    name: z.string().min(1),
    category: z.string().min(1),
    releaseYear: count,
    line: text.optional(),
    sizeInch: z.number().optional(),
    axes: z.array(z.strictObject({ name: text, values: z.array(text) })),
    identifier: text.optional(),
    source: z.enum(CATALOG_SOURCES).optional(),
    /** The product's facts (2026-10-21) — see `CatalogModel.family`. */
    family: text.optional(),
    chip: text.optional(),
    extra: text.optional(),
    /** AppleDB identifiers linked to this product. Written once, never removed. */
    identifiers: z.array(text).optional(),
    /** Products a person said are NOT this one. Written once, never removed. */
    notDuplicateOf: z.array(id).optional(),
  });

  const sku = z.strictObject({
    id,
    modelId: id,
    code: z.string().min(1),
    name: text,
    variantLabel: text,
    axisValues: z.record(z.string(), z.string()).optional(),
    price: money,
    /** Merged into another variant (2026-10-21): kept for history, offered nowhere. */
    mergedIntoId: id.optional(),
  });

  const unit = z.strictObject({
    serial: z.string().min(1),
    skuId: id,
    status: z.enum(UNIT_STATUSES),
    locationId: id,
    rackId: id.optional(),
    buy: money,
    description: text,
    poId: id.nullable(),
    grade: z.enum(GRADES).optional(),
    batteryHealth: z.number().optional(),
    price: z.optional(money),
    marketPrice: z.optional(money),
    cycleCount: z.number().optional(),
    fcc: z.number().optional(),
  });

  const unitNote = z.strictObject({
    id,
    serial: z.string().min(1),
    body: text,
    tag: text.optional(),
    staff: text,
    at: instant,
    photos: z.array(
      z.strictObject({ id, url: z.string().min(1), sortOrder: count }),
    ),
  });

  const event = z.strictObject({
    id,
    serial: z.string().min(1),
    seq: count.min(1),
    type: z.enum(UNIT_EVENT_TYPES),
    at: instant,
    fromStatus: z.union([z.enum(UNIT_STATUSES), z.literal("-")]),
    toStatus: z.enum(UNIT_STATUSES),
    locationId: id,
    note: text.optional(),
    refCode: text.optional(),
    staff: text,
  });

  /**
   * One movement of a product the shop COUNTS rather than identifies — an
   * accessory (owner decision 2026-09-19: "quantity in the database too").
   *
   * Append-only, like `event`: what is on the shelf is the SUM of these per
   * variant and location, and nothing stores that sum, so there is no second
   * copy of it to disagree. `qty` is signed and never zero. `cost` is ONE
   * piece's: what an arrival paid, or the moving average a departure left at.
   */
  const stockMove = z.strictObject({
    id,
    skuId: id,
    locationId: id,
    qty: count.refine((n) => n !== 0, "Jumlah tidak boleh nol."),
    cost: money,
    type: z.enum(STOCK_MOVE_TYPES),
    at: instant,
    refCode: text.optional(),
    poId: id.optional(),
    poItemId: id.optional(),
    orderId: id.optional(),
    orderLineId: id.optional(),
    opnameId: id.optional(),
    reasonId: id.optional(),
    note: text.optional(),
    staff: text,
  });

  const po = z.strictObject({
    id,
    code: z.string().min(1),
    supplierId: id,
    invoice: text,
    noInvoice: z.boolean().optional(),
    date: day,
    locationId: id,
    items: z.array(
      z.strictObject({
        id,
        /*
         * Blank while nobody has picked the product (owner report 2026-09-15).
         *
         * A line exists before its product is chosen, and refusing that row
         * here refused the whole commit — "Not saved — items.0.skuId:
         * too_small" — and every edit queued behind it went down too. The
         * column is nullable (`PurchaseOrderItem.skuId`); "" is how the
         * browser spells null, and the page is what stops a blank line being
         * received.
         */
        skuId: text,
        serial: text.nullable(),
        qty: count,
        unitCost: money,
        /*
         * Knocked off this line and off nothing else (owner ask 2026-09-20).
         * Optional, so a changeset extracted before the column existed still
         * commits and reads as what it is: a line with no discount.
         */
        discount: z.optional(money),
        notReceived: z.boolean().optional(),
        /*
         * Taken in although the supplier's paper never billed it (owner ask
         * 2026-09-24) — the mirror of `notReceived`. Optional for the same
         * reason `discount` is: a changeset extracted before the column
         * existed still commits, and reads as a line that was on the invoice.
         */
        outsideInvoice: z.boolean().optional(),
      }),
    ),
    payments: z.array(
      z.strictObject({
        id,
        method: z.string().min(1),
        amount: money,
        at: instant,
        appliedTo: z.enum(PO_PAYMENT_FOR).optional(),
        fromDepositId: id.optional(),
        /** The expense this payment settles — `Payment.poFeeId`. */
        feeId: id.optional(),
        /*
         * `Payment.inBalance` (owner answer 2026-09-22): false when the money
         * did not come out of the shop's cash or bank — the owner paid it
         * personally. Absent means it counts, which is what every payment
         * written before the column meant.
         */
        inBalance: z.boolean().optional(),
        /*
         * The supplier return this payment is the credit of —
         * `Payment.unitReturnId`, a `returns` row's `id` (2026-10-26). Written
         * with method RETUR_SUPPLIER. Optional, so a changeset from before
         * the column still commits.
         */
        returnId: id.optional(),
      }),
    ),
    /*
     * The invoice's expenses, one row each (owner ask 2026-09-18). Replaced
     * the two figures `shippingFee` and `taxFee`, which could not say that an
     * invoice had customs AND a packing charge, nor which of them belonged in
     * a machine's cost.
     */
    fees: z.array(
      z.strictObject({
        id,
        kind: z.enum(PO_FEE_KINDS),
        label: text,
        amount: money,
        inCogs: z.boolean(),
      }),
    ),
    discount: money,
    status: z.enum(PO_STATUSES),
    closedAt: instant.optional(),
  });

  const stockIn = z.strictObject({
    id,
    serial: z.string().min(1),
    skuId: id,
    poId: id.nullable(),
    locationId: id,
    rackId: id.optional(),
    decision: z.enum(STOCK_IN_DECISIONS),
    rejectKind: z.enum(STOCK_IN_REJECT_KINDS).optional(),
    reason: text.optional(),
    buy: money,
    description: text.optional(),
    batteryHealth: z.number().optional(),
    cycleCount: z.number().optional(),
    fcc: z.number().optional(),
    at: instant,
    staff: text,
  });

  /**
   * A customer is a name OR a phone number — either is enough, neither is
   * refused (owner ask 2026-09-24: a debt at the till may be recorded
   * against a number alone). `Customer.name` is NOT NULL in prisma and
   * empty here means "recorded by number"; `phone` empty means "no number
   * yet", which is how the B2Soft customers arrived (2026-09-13).
   */
  const customer = z
    .strictObject({
      id,
      name: text,
      phone: text,
      address: text.optional(),
      addresses: z
        .array(z.strictObject({ id, label: text.optional(), line: text }))
        .optional(),
      referralSourceId: id.optional(),
      createdAt: instant,
      openingBalance: z.optional(money),
      openingBalanceAt: instant.optional(),
      openingPayments: z.array(openingPayment).optional(),
    })
    .refine((c) => c.name.trim() !== "" || c.phone.trim() !== "", {
      message: "a customer needs a name or a phone number",
      path: ["name"],
    });

  const salePayment = z.strictObject({
    id,
    method: z.string().min(1),
    amount: money,
    state: z.enum(PAYMENT_STATES),
    channel: z.enum(SALE_SOURCES).optional(),
    at: instant,
    dueAt: instant.optional(),
    note: text.optional(),
    /** The marketplace's order number, for Shopee/Tokopedia/TikTok sales. */
    ref: text.optional(),
    /** `Payment.inBalance`: false when the money never reached the shop's cash or bank. */
    inBalance: z.boolean().optional(),
  });

  /**
   * Money handed BACK to the customer on a sale — what a return refunds
   * (owner brief 2026-09-19). A `Payment` with direction KELUAR on the order;
   * kept apart from `payments`, which are what the customer paid.
   */
  const saleRefund = z.strictObject({
    id,
    method: z.string().min(1),
    amount: money,
    at: instant,
    note: text.optional(),
  });

  /**
   * What a return took off a sale's bill — `OrderAdjustment`, whose RETUR type
   * carries the return's own SG code.
   */
  const orderAdjustment = z.strictObject({
    id,
    type: z.enum(["RETUR", "REFUND", "VOID"]),
    code: text.optional(),
    amount: money,
    reason: text,
    at: instant,
  });

  const order = z.strictObject({
    id,
    code: z.string().min(1),
    ts: instant,
    customerId: id.nullable(),
    serials: z.array(z.string().min(1)),
    prices: z.record(z.string(), money),
    listPrices: z.record(z.string(), money).optional(),
    /**
     * What was sold of COUNTED products, by quantity (2026-09-19) — an
     * `OrderItem` with no unit. `price` is per piece; `returnedQty` is
     * `OrderItem.returnedQty`. What the pieces cost is on the `TERJUAL`
     * stock moves that name the line.
     */
    lines: z
      .array(
        z.strictObject({
          id,
          skuId: id,
          qty: count.min(1),
          price: money,
          listPrice: z.optional(money),
          returnedQty: count.min(0).optional(),
        }),
      )
      .optional(),
    discount: money,
    discountId: id.optional(),
    source: z.enum(SALE_SOURCES),
    salesmanId: id.optional(),
    referralSourceId: id.optional(),
    shippingAddress: text.optional(),
    payMethod: z.string().min(1),
    settled: z.boolean(),
    payments: z.array(salePayment).optional(),
    refunds: z.array(saleRefund).optional(),
    adjustments: z.array(orderAdjustment).optional(),
    extra: z.optional(money),
    extraNote: text.optional(),
    fees: z
      .array(z.strictObject({ id, label: text, amount: money }))
      .optional(),
    tradeIns: z
      .array(
        z.strictObject({
          id,
          label: text,
          serial: text.optional(),
          value: money,
          note: text.optional(),
          skuId: id.optional(),
          condition: z.enum(CONDITIONS).optional(),
          grade: z.enum(GRADES).optional(),
        }),
      )
      .optional(),
    total: money,
    grossTotal: z.optional(money),
    netReceived: z.optional(money),
    reservationId: id.optional(),
  });

  const unitReturn = z.strictObject({
    id,
    code: z.string().min(1),
    kind: z.enum(RETURN_KINDS),
    serial: z.string().min(1),
    reason: text,
    reasonDetail: text.optional(),
    date: day,
    status: z.enum(RETURN_STATUSES),
    fromQc: z.boolean().optional(),
    exchangeSerial: text.optional(),
    fee: z.optional(money),
    supplierId: id.optional(),
    expectedCredit: z.optional(money),
    /**
     * Σ the REFUND incomes naming this return (`ManualIncome.unitReturnId`) —
     * DERIVED, no column (2026-10-26). An account without finance access is
     * sent no incomes, and without this would read a supplier's refund as
     * still awaited and offer to record it twice. The adapter ignores it on
     * write and recomputes it on every projection.
     */
    refundReceived: z.optional(money),
  });

  const reservation = z.strictObject({
    id,
    code: z.string().min(1),
    customerId: text,
    when: instant,
    note: text,
    sourceId: id.optional(),
    items: z.array(z.strictObject({ id, serial: z.string().min(1) })),
    status: z.enum(RESERVATION_STATUSES),
  });

  const discount = z.strictObject({
    id,
    code: z.string().min(1),
    name: text,
    type: z.enum(DISCOUNT_TYPES),
    pct: z.number().optional(),
    amountRp: z.optional(money),
    maxRp: z.optional(money),
    bundleQty: count.optional(),
    bundlePriceRp: z.optional(money),
    usageLimit: count.optional(),
    used: count,
    fromDate: day.optional(),
    toDate: day.optional(),
    active: z.boolean(),
    scope: text,
  });

  const income = z.strictObject({
    id,
    reason: z.enum(INCOME_REASONS),
    amount: money,
    date: day,
    note: text.optional(),
    method: z.string().min(1),
    /** The sale it is about, where the category names one (2026-09-23). */
    orderId: id.optional(),
    /**
     * The supplier return this is the refund of — `ManualIncome.unitReturnId`,
     * a `returns` row's `id` (2026-10-26).
     */
    returnId: id.optional(),
    /**
     * When it was typed — `ManualIncome.createdAt`; the till's clock when it
     * sends one, the server's otherwise. Orders a day's typed rows on Income &
     * Expense, which carry a date and no time (2026-10-24), and nothing else.
     */
    createdAt: instant.optional(),
  });

  const expense = z.strictObject({
    id,
    label: text.optional(),
    kind: z.enum(EXPENSE_KINDS),
    amount: money,
    date: day,
    note: text.optional(),
    referralSourceId: id.optional(),
    method: z.string().min(1),
    /** The sale it is about, where the category names one (2026-09-23). */
    orderId: id.optional(),
    /**
     * The service charge this paid — `Expense.serviceFeeId`, the `id` of a
     * fee inside a `services` row (2026-10-26). Kind UNIT. At most one
     * expense per charge.
     */
    serviceFeeId: id.optional(),
    /** When it was typed — `Expense.createdAt`; see `income`. */
    createdAt: instant.optional(),
  });

  const chat = z.strictObject({
    phone: z.string().min(1),
    name: text,
    channel: text,
    needsReply: z.boolean(),
    summary: text,
    messages: z.array(
      z.strictObject({
        id,
        dir: text,
        text,
        at: instant,
        correctedText: text.optional(),
      }),
    ),
  });

  const knowledge = z.strictObject({
    id,
    question: text,
    answer: text,
    active: z.boolean(),
    updatedAt: instant,
  });

  const correction = z.strictObject({
    id,
    threadPhone: text,
    messageId: text,
    original: text,
    corrected: text,
    note: text.optional(),
    at: instant,
    staff: text,
  });

  const persona = z.strictObject({
    id,
    name: text,
    blurb: text,
    prompt: text,
    builtIn: z.boolean(),
  });

  const adjustment = z.strictObject({
    id,
    serial: z.string().min(1),
    description: text,
    reasonId: id,
    at: instant,
    staff: text,
    kind: z.enum(ADJUSTMENT_KINDS),
    batchId: z.string().min(1),
    batteryHealth: z.number().optional(),
    cycleCount: z.number().optional(),
    fcc: z.number().optional(),
    newUnit: z.boolean().optional(),
  });

  const opname = z.strictObject({
    id,
    code: z.string().min(1),
    label: text.optional(),
    locationIds: z.array(id),
    rackIds: z.array(id),
    categories: z.array(z.string().min(1)),
    conditions: z.array(z.enum(CONDITIONS)),
    date: day,
    at: instant,
    counted: z.array(z.string().min(1)),
    missing: z.array(z.string().min(1)),
    unknown: z.array(z.string().min(1)),
    /**
     * What was found of each product the shop COUNTS rather than scans, by
     * variant id (2026-09-15). A variant with no entry was not reached; zero
     * means somebody looked. See `Category.tracksSerial`.
     */
    counts: z.record(z.string(), count),
    notes: z.record(z.string(), text),
    surplus: z.record(
      z.string(),
      z.strictObject({
        skuId: id,
        locationId: id,
        reason: text,
        condition: z.enum(CONDITIONS),
      }),
    ),
    status: z.enum(OPNAME_STATUSES),
  });

  const paymentState = z.strictObject({
    amount: money,
    state: z.enum(PAYMENT_STATES),
  });

  const paymentLog = z.strictObject({
    id,
    paymentId: id,
    at: instant,
    staff: text,
    action: z.enum(PAYMENT_LOG_ACTIONS),
    before: paymentState.optional(),
    after: paymentState.optional(),
    reason: text.optional(),
  });

  const settlement = z.strictObject({
    id,
    paymentId: id,
    orderId: id,
    channel: z.enum(SALE_SOURCES),
    gross: money,
    fees: z.array(
      z.strictObject({
        id,
        kind: z.enum(SETTLEMENT_FEE_KINDS),
        label: text.optional(),
        amount: money,
      }),
    ),
    received: money,
    reason: text.optional(),
    at: instant,
    staff: text,
  });

  const settlementFigures = z.strictObject({
    received: money,
    deducted: money,
  });

  const settlementLog = z.strictObject({
    id,
    settlementId: id,
    at: instant,
    staff: text,
    action: z.enum(SETTLEMENT_LOG_ACTIONS),
    before: settlementFigures.optional(),
    after: settlementFigures.optional(),
    reason: text.optional(),
  });

  const service = z.strictObject({
    id,
    serial: z.string().min(1),
    fromLocationId: id,
    openedAt: instant,
    arrivedAt: instant.optional(),
    closedAt: instant.optional(),
    toLocationId: id.optional(),
    fees: z.array(
      z.strictObject({
        id,
        kind: z.enum(SERVICE_FEE_KINDS),
        label: text.optional(),
        amount: money,
        at: instant,
        staff: text,
        /*
         * Has an `Expense` paid this charge (`Expense.serviceFeeId`,
         * 2026-10-26)? DERIVED on the server from that row, never written —
         * it exists because an account without finance access is sent no
         * expenses, and without it the service bench could not tell a paid
         * charge from an owed one and would offer to pay it twice. `true` or
         * absent; which method paid it is the expense's, not this.
         */
        paid: z.literal(true).optional(),
      }),
    ),
    note: text.optional(),
    raisedBy: z.enum(SERVICE_RAISED_BY),
    poId: id.optional(),
    staff: text,
  });

  const deposit = z.strictObject({
    id,
    supplierId: id,
    amount: money,
    method: z.string().min(1),
    at: instant,
    note: text.optional(),
    /*
     * `SupplierDeposit.inBalance`, the deposit's half of the payment switch
     * (2026-09-22): a payment larger than every invoice leaves its remainder
     * here, and it moved the balance exactly as the rest of that payment did.
     */
    inBalance: z.boolean().optional(),
    staff: text,
    allocations: z.array(
      z.strictObject({
        id,
        poId: id,
        amount: money,
        at: instant,
        staff: text,
        note: text.optional(),
      }),
    ),
  });

  /**
   * The money row a reconciliation names — exactly one of the four, as the
   * database's CHECK says (`ReconciliationEdit`, `BankStatementMatch`). A sale
   * payment, a refund, a customer's old-debt payment and a supplier payment
   * are all `Payment` rows; a deposit, an expense and an income are their own.
   */
  const moneyRef = {
    paymentId: id.optional(),
    expenseId: id.optional(),
    incomeId: id.optional(),
    depositId: id.optional(),
  };
  const exactlyOneRef = (r: {
    paymentId?: string | undefined;
    expenseId?: string | undefined;
    incomeId?: string | undefined;
    depositId?: string | undefined;
  }) =>
    [r.paymentId, r.expenseId, r.incomeId, r.depositId].filter(
      (x) => x !== undefined,
    ).length === 1;

  /**
   * A count of one pot (DAILY, one day) or the bank against its e-statement
   * (MONTHLY, one month) — `Reconciliation` (2026-10-27). `edits` are the
   * corrections it made to the real records and the transactions it added,
   * before → after, each written once.
   */
  const reconciliation = z.strictObject({
    id,
    kind: z.enum(RECON_KINDS),
    pot: z.enum(RECON_POTS),
    periodStart: day,
    periodEnd: day,
    posBalance: money,
    actualBalance: money,
    statementOpening: z.optional(money),
    statementClosing: z.optional(money),
    /** The uploaded file's NAME, never its contents. */
    statementFile: text.optional(),
    status: z.enum(RECON_STATUSES),
    note: text.optional(),
    staff: text,
    createdAt: instant,
    updatedAt: instant,
    edits: z.array(
      z
        .strictObject({
          id,
          ...moneyRef,
          action: z.enum(RECON_EDIT_ACTIONS),
          before: z.optional(money),
          after: money,
          staff: text,
          at: instant,
        })
        .refine(exactlyOneRef, {
          message: "an edit names exactly one money row",
        }),
    ),
  });

  /**
   * One movement off a bank's e-statement — `BankStatementLine` — with the
   * POS movements it is matched to (`BankStatementMatch`). `amount` is signed
   * (a debit is negative) and in whole rupiah: the statement's sen are
   * checked when the file is read and are not carried (lib/bankStatement.ts).
   */
  const statementLine = z.strictObject({
    id,
    reconciliationId: id,
    lineNo: count.min(1),
    date: day,
    description: text,
    amount: money,
    balance: z.optional(money),
    status: z.enum(STATEMENT_LINE_STATUSES),
    note: text.optional(),
    matches: z.array(
      z
        .strictObject({ id, ...moneyRef, reason: z.string().min(1) })
        .refine(exactlyOneRef, {
          message: "a match names exactly one money row",
        }),
    ),
  });

  const rows = {
    paymentMethods: paymentMethod,
    warehouses: warehouse,
    racks: rack,
    suppliers: supplier,
    reasons: reason,
    qcDescriptions: qcDescription,
    reservationSources: named,
    referralSources: named,
    salesmen: named,
    categories: category,
    models: model,
    gradingCriteria: gradingCriterion,
    gradingRules: gradingRule,
    skus: sku,
    customers: customer,
    discounts: discount,
    knowledge,
    units: unit,
    pos: po,
    stockMoves: stockMove,
    deposits: deposit,
    reservations: reservation,
    orders: order,
    returns: unitReturn,
    opnames: opname,
    services: service,
    settlements: settlement,
    events: event,
    unitNotes: unitNote,
    stockIns: stockIn,
    adjustments: adjustment,
    expenses: expense,
    incomes: income,
    paymentLog,
    settlementLog,
    reconciliations: reconciliation,
    statementLines: statementLine,
    chats: chat,
    corrections: correction,
    personas: persona,
  } as const;

  const singletons = {
    settings,
    appleDbHidden: z.array(z.string()),
    myWarehouseId: z.string(),
    activePersonaId: z.string(),
  } as const;

  const db = z.strictObject({
    settings,
    paymentMethods: z.array(paymentMethod),
    warehouses: z.array(warehouse),
    racks: z.array(rack),
    suppliers: z.array(supplier),
    reasons: z.array(reason),
    qcDescriptions: z.array(qcDescription),
    gradingCriteria: z.array(gradingCriterion),
    gradingRules: z.array(gradingRule),
    reservationSources: z.array(named),
    salesmen: z.array(named),
    categories: z.array(category),
    models: z.array(model),
    appleDbHidden: z.array(z.string()),
    skus: z.array(sku),
    units: z.array(unit),
    events: z.array(event),
    unitNotes: z.array(unitNote),
    pos: z.array(po),
    stockMoves: z.array(stockMove),
    stockIns: z.array(stockIn),
    customers: z.array(customer),
    orders: z.array(order),
    returns: z.array(unitReturn),
    reservations: z.array(reservation),
    discounts: z.array(discount),
    expenses: z.array(expense),
    incomes: z.array(income),
    paymentLog: z.array(paymentLog),
    settlements: z.array(settlement),
    settlementLog: z.array(settlementLog),
    reconciliations: z.array(reconciliation),
    statementLines: z.array(statementLine),
    services: z.array(service),
    deposits: z.array(deposit),
    chats: z.array(chat),
    knowledge: z.array(knowledge),
    corrections: z.array(correction),
    personas: z.array(persona),
    activePersonaId: z.string(),
    adjustments: z.array(adjustment),
    opnames: z.array(opname),
    referralSources: z.array(named),
    myWarehouseId: z.string(),
  });

  return { rows, singletons, db };
}

/** The server's schemas: money as BigInt. */
export const serverSchemas = storeSchemas(moneyAsBigInt);

/** The browser's schemas: money as a whole-rupiah number. */
export const browserSchemas = storeSchemas(moneyAsNumber);

/** The store as the server holds it — money in BigInt. */
export type ServerStore = z.output<typeof serverSchemas.db>;

/** The store as the browser holds it — money in whole-rupiah numbers. */
export type BrowserStore = z.output<typeof browserSchemas.db>;

/** The store on the wire — money as decimal strings. */
export type WireStore = z.input<typeof serverSchemas.db>;

export type RowSchemas = ReturnType<typeof storeSchemas>["rows"];
