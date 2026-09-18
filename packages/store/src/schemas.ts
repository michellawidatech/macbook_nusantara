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
  "PROFESSIONAL",
  "SOFTWARE",
] as const;
export const INCOME_REASONS = ["SALES", "TRANSFER"] as const;
export const PAYMENT_LOG_ACTIONS = ["ADDED", "AMENDED", "REMOVED"] as const;
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

  const supplier = z.strictObject({
    id,
    name: z.string().min(1),
    phone: text.optional(),
    address: text.optional(),
    code: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    openingBalance: z.optional(money),
    openingBalanceAt: instant.optional(),
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
  });

  const sku = z.strictObject({
    id,
    modelId: id,
    code: z.string().min(1),
    name: text,
    variantLabel: text,
    axisValues: z.record(z.string(), z.string()).optional(),
    price: money,
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
        notReceived: z.boolean().optional(),
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
      }),
    ),
    shippingFee: money,
    taxFee: money,
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

  const customer = z.strictObject({
    id,
    name: z.string().min(1),
    phone: text,
    address: text.optional(),
    addresses: z
      .array(z.strictObject({ id, label: text.optional(), line: text }))
      .optional(),
    referralSourceId: id.optional(),
    createdAt: instant,
    openingBalance: z.optional(money),
    openingBalanceAt: instant.optional(),
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
  });

  const order = z.strictObject({
    id,
    code: z.string().min(1),
    ts: instant,
    customerId: id.nullable(),
    serials: z.array(z.string().min(1)),
    prices: z.record(z.string(), money),
    listPrices: z.record(z.string(), money).optional(),
    discount: money,
    discountId: id.optional(),
    source: z.enum(SALE_SOURCES),
    salesmanId: id.optional(),
    referralSourceId: id.optional(),
    shippingAddress: text.optional(),
    payMethod: z.string().min(1),
    settled: z.boolean(),
    payments: z.array(salePayment).optional(),
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
