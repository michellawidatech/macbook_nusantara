/** Deterministic demo data. All money = whole rupiah numbers. */
import { productCode } from "../lib/productCode.js";
import type { SaleSource } from "../lib/channels.js";
import type { GradingCriterion, GradingRule } from "../lib/grading.js";
import type { UnitCondition } from "../lib/condition.js";
import { SCAN_PREFIX } from "../lib/serialScan.js";

export type UnitStatus =
  | "QC"
  | "TERSEDIA"
  | "DIRESERVASI"
  | "TERJUAL"
  | "RETUR_SUPPLIER"
  | "SERVIS"
  | "HILANG";

export interface Warehouse {
  id: string;
  name: string;
  active: boolean;
}
/**
 * A shelf inside a warehouse. Owner asked for "Rack 1/2/3", editable in
 * Settings, so this is a table rather than a hard-coded list — and it hangs off
 * a warehouse because four warehouses each have their own rack numbering.
 */
export interface RackLocation {
  id: string;
  warehouseId: string;
  name: string;
  active: boolean;
}
export interface Supplier {
  id: string;
  name: string;
  /** Optional by owner decision — a walk-in supplier may have neither. */
  phone?: string;
  address?: string;
  /**
   * The two-letter origin code that goes on the front of every serial taken in
   * from this supplier (owner ask 2026-08-28).
   *
   * `CV Apel Segar` is `AS`, so the machine whose own barcode reads
   * `SBJ347203KLM` is stored and printed as `ASBJ347203KLM`. Two machines can
   * share an Apple serial only if one is counterfeit; two SUPPLIERS is the
   * fact the shop wants back later — which pallet did this come off, and who
   * do we chase about it — so the origin goes in the one string every screen
   * already carries. `lib/serialScan.ts` is the whole scheme.
   *
   * Optional, and it has to be: every supplier in the shop predates the
   * scheme, and a walk-in seller may never get one. Intake refuses a SCANNED
   * serial for a supplier with no code (it would have nothing to prefix and
   * the machine's own label would then not find it); a typed one is unaffected.
   *
   * ⚠️ Schema gap: prisma's `Supplier` has no `code`. It wants a nullable
   * `String? @db.Char(2)` with a unique index — an owner decision plus a
   * migration before the API can carry it, on the same footing as the grading
   * tables.
   */
  code?: string;
}
/**
 * The activities that keep a managed list of reasons. Every reason a user can
 * pick anywhere in the app is a row in `reasons`, so a free-typed reason is
 * written HERE first and only then referenced — never a loose string that
 * outlives the list it came from.
 */
export type ReasonActivity =
  "ADJUSTMENT" | "RETURN_CUSTOMER" | "RETURN_SUPPLIER";
export interface Reason {
  id: string;
  activity: ReasonActivity;
  label: string;
  active: boolean;
}
/**
 * A phrase QC reaches for when describing a machine (owner revision
 * 2026-08-27).
 *
 * The Description column used to be a free textarea, and a shop of three
 * people typing the same six sentences all day spelled them six ways —
 * "fullset dus", "Fullset Dus", "fullset, dus lengkap" — which is fine to read
 * and useless to search. The field is a searchable list now, seeded with what
 * the shop actually writes, and anything typed that is not on the list JOINS
 * it (`ensureQcDescription`), so the vocabulary is the staff's own rather than
 * one somebody guessed in advance.
 *
 * Free text is still the point. This is a list of suggestions, not a set of
 * allowed values: a machine with a dent nobody has ever seen before gets
 * described in words, and those words are on the list next time.
 *
 * One fact per row, never a sentence. A machine's description is a LIST of
 * these joined by commas (`splitDescription` in `lib/inboundQc.ts`), so a
 * label with a comma in it would come back as two labels — which is why the
 * seeded phrases below are "Mulus" and "Fullset dus" rather than the one
 * string the shop used to type.
 *
 * ⚠️ Schema gap: prisma has no table for these. Same footing as `Reason`,
 * which does — needs an owner decision plus a migration.
 */
export interface QcDescription {
  id: string;
  label: string;
  active: boolean;
}
/** Where a reservation came in from — IG, WA, TikTok, Shopee, walk-in… */
export interface ReservationSource {
  id: string;
  name: string;
  active: boolean;
}
/**
 * A person a sale can be credited to.
 *
 * A managed list with an id rather than a name typed onto the sale, because
 * the owner wants per-staff KPI out of this: free text would make "Ayu",
 * "ayu " and "Ayu S." three different salespeople in next quarter's report,
 * and no amount of reporting fixes that afterwards. Deactivated, never
 * deleted — a salesperson who has left still owns the sales they made.
 */
export interface Salesman {
  id: string;
  name: string;
  active: boolean;
}
export interface AxisValue {
  axis: string;
  value: string;
}
export interface Sku {
  id: string;
  modelId: string;
  /** The printed product code, e.g. `PRO 13" 2017 i5 8/128 NTB`. Derived. */
  code: string;
  name: string;
  variantLabel: string;
  /**
   * Axis name to chosen value — `{ RAM: "8GB", SSD: "128GB", Chip: "i5" }`.
   *
   * Kept beside `variantLabel` rather than replacing it because the two answer
   * different questions: the label is what a human reads in a dropdown, this is
   * what the product code is built from. Parsing the former back into the
   * latter is exactly the kind of round-trip that puts a wrong code on a
   * sticker nobody can peel off.
   *
   * Optional only until the Master Product rework: SKUs created through the
   * current product form still carry a joined `variantLabel` and nothing else,
   * so a label falls back to showing that. Every seeded SKU has it.
   */
  axisValues?: Record<string, string>;
  price: number;
}
export interface CatalogModel {
  id: string;
  name: string;
  category: string;
  releaseYear: number;
  /** Short line code for the printed label — "PRO", "AIR". */
  line?: string;
  /** Screen size in inches, for the printed label. */
  sizeInch?: number;
  axes: { name: string; values: string[] }[];
  /** Apple's model identifier when the row came from AppleDB (e.g. Mac14,2). */
  identifier?: string;
  source?: "MANUAL" | "APPLEDB";
}
export interface Unit {
  serial: string;
  skuId: string;
  status: UnitStatus;
  locationId: string;
  /** Which shelf, once QC accepts it into stock. */
  rackId?: string;
  buy: number;
  description: string;
  poId: string | null;
  grade?: string;
  /**
   * Battery health as a percentage of original capacity, read off the machine
   * when it is graded at QC. Replaced the cycle count on 2026-08-24.
   *
   * Optional, and deliberately so in two directions: an accessory has no
   * battery to measure, and a unit adjusted into stock off the street may reach
   * inventory before anyone has opened System Information. A missing reading is
   * "not measured" and is not the same fact as a low one — 0% is a dead
   * battery someone actually looked at. `batteryGrade` in lib/battery.ts is
   * what turns this into something filterable.
   */
  batteryHealth?: number;
}
/**
 * A photograph attached to a note about one machine. Mirrors `UnitNotePhoto`.
 *
 * In the browser build `url` is a data URL produced by `FileReader`, because
 * there is no object store to put a file in yet. Against the real API it is
 * whatever the upload endpoint hands back; nothing that reads this cares which.
 */
export interface UnitNotePhoto {
  id: string;
  url: string;
  sortOrder: number;
}

/**
 * Something a human wrote about a machine, with pictures. Mirrors `UnitNote`.
 *
 * Photographs of a second-hand machine hang off a NOTE rather than off the
 * unit, and that is the schema's shape, not a convenience: `UnitNotePhoto`
 * points at `UnitNote`, which points at the unit. It also happens to be the
 * right model — a dent has a photo AND a sentence about the dent, and the two
 * are one observation made on one day by one person.
 *
 * `tag` is what tells a QC photo from any other. CLAUDE.md's one exception to
 * the no-hard-delete rule is about exactly these: a `QC`-tagged note's photos
 * are purged, row and file, when the machine is sold. `purgeQcPhotos` in
 * `mock/store.ts` is that rule; the `UnitEvent` ledger keeps the sale.
 */
export interface UnitNote {
  id: string;
  serial: string;
  body: string;
  /** "QC" for a grading photo. */
  tag?: string;
  staff: string;
  at: string;
  photos: UnitNotePhoto[];
}

export interface UnitEvent {
  id: string;
  serial: string;
  seq: number;
  type: string;
  at: string;
  fromStatus: string;
  toStatus: string;
  locationId: string;
  note?: string;
  refCode?: string;
  staff: string;
}
export interface PoItem {
  id: string;
  skuId: string;
  serial: string | null;
  qty: number;
  unitCost: number;
  /**
   * Set when the goods did not match the invoice and this line never turned up.
   * A not-received line still counts towards what was INVOICED — that is the
   * whole point of recording it — but not towards what arrived.
   */
  notReceived?: boolean;
}

/**
 * Money actually moved to the supplier.
 *
 * `amount` is back, reversing the note in PurchaseOrderPage that said the owner
 * had removed it (2026-08-24). It had to come back because a PO can now be paid
 * before anyone knows what it buys: the transfer is the only fact the shop has
 * on the day, and a PO whose total is the sum of lines it does not yet have
 * would record that transfer as zero.
 */
export interface PoPayment {
  id: string;
  /** A `PaymentMethod` code — TUNAI, KARTU_KREDIT, DEPOSIT. */
  method: string;
  amount: number;
  at: string;
  /**
   * Which part of the invoice this transfer was aimed at (owner revision
   * 2026-08-27).
   *
   * Shipping is very often a different party from the supplier — a forwarder
   * paid on its own day, in its own currency of trust — and tax is a third.
   * Recording all three as one undifferentiated "paid" left the shop unable to
   * answer the only question it ever asks of the money card: *has the ongkir
   * been settled?* Now each payment says.
   *
   * Optional because every payment written before this revision was a payment
   * against the goods; `paymentFor` reads a missing value as `ORDER` rather
   * than inventing a fourth bucket for "unknown".
   *
   * ⚠️ Schema gap: prisma's `Payment` has no such column. See CLAUDE.md — the
   * field is real in this mock and needs an owner decision plus a migration
   * before the API can carry it.
   */
  appliedTo?: PoPaymentFor;
}

/**
 * What a supplier payment is settling.
 *
 * Three buckets and no more: `poTotals` gives each one a figure, and a bucket
 * with nothing to owe against would be a choice that can never be right.
 * `DISCOUNT` is not here — a discount is money that never moved.
 */
export type PoPaymentFor = "ORDER" | "TAX" | "SHIPPING";

/** English labels; `t()` translates at the call site, as the enum maps do. */
export const PO_PAYMENT_FOR_LABEL: Record<PoPaymentFor, string> = {
  ORDER: "Products",
  SHIPPING: "Shipping",
  TAX: "Tax",
};

export interface Po {
  id: string;
  code: string;
  supplierId: string;
  invoice: string;
  /** Ticked when the supplier issues none — the escape hatch `invoice` needs. */
  noInvoice?: boolean;
  date: string;
  locationId: string;
  items: PoItem[];
  payments: PoPayment[];
  /** Charged on the whole order, not on any line. */
  shippingFee: number;
  taxFee: number;
  /** Negotiated off the whole order. */
  discount: number;
  status: "DRAFT" | "ORDERED" | "RECEIVED";
  /**
   * When somebody said this invoice is finished with (owner revision
   * 2026-08-27).
   *
   * Separate from `status`, which is about the GOODS — an order can be fully
   * received and still open because the ongkir has not been settled, and it
   * can be closed with a line the supplier never sent. Closing is a person's
   * judgement that nothing more will be recorded here; it makes the page
   * read-only and takes the order out of the shop's live work.
   *
   * Reversible on purpose. It is a filing decision, not a state change, and
   * the one thing an intake screen must never do is make a mistake permanent —
   * see the QC reopen in `InboundDetailPage`.
   *
   * ⚠️ Schema gap: prisma's `POStatus` has DRAF/DIPESAN/SEBAGIAN/DITERIMA/
   * BATAL and no closed-at. Needs an owner decision plus a migration.
   */
  closedAt?: string;
}
/**
 * One QC decision, kept forever so "Stock In history" can answer *who* accepted
 * or rejected a unit and *when* — questions the unit's own event log answers
 * only obliquely.
 */
export interface StockInRec {
  id: string;
  serial: string;
  skuId: string;
  poId: string | null;
  locationId: string;
  rackId?: string;
  decision: "ACCEPTED" | "REJECTED";
  /** Where a rejected unit went. Absent on an accept. */
  rejectKind?: "SUPPLIER" | "SERVICE";
  reason?: string;
  buy: number;
  description?: string;
  /** Battery health % read off the machine while grading it. Accepts only. */
  batteryHealth?: number;
  at: string;
  staff: string;
}
/**
 * One of a customer's addresses (owner ask 2026-09-01).
 *
 * A person has a home and an office and a mother's house, and the shop
 * delivers to whichever one they say this time. Before this the till re-typed
 * six fields on every repeat order, which is how the same customer ends up
 * with three spellings of one street.
 *
 * `line` is the composed single line `lib/address.ts` produces — the same
 * string `Order.shippingAddress` stores and the invoice prints — so a saved
 * address and a typed one are the same kind of thing and neither needs
 * translating into the other.
 *
 * ⚠️ Mock-only. Prisma's `Customer` has one `address` column; a second table
 * (`CustomerAddress`, FK to `Customer`, `onDelete: Cascade`) is an owner
 * decision plus a migration. CLAUDE.md forbids inventing either.
 */
export interface CustomerAddress {
  id: string;
  /** What the customer calls it — "Rumah", "Kantor". Optional. */
  label?: string;
  line: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  /** The one the schema has. Kept as the default where a list has no entry. */
  address?: string;
  /** Every address this customer has had an order sent to. ⚠️ Mock-only. */
  addresses?: CustomerAddress[];
  referralSourceId?: string;
  createdAt: string;
}
/**
 * A machine the customer handed over against the bill. Mirrors `TradeIn`.
 *
 * `serial` is optional in the schema and optional here, and the two cases are
 * genuinely different. With a serial the shop is BUYING the machine: it enters
 * stock at QC with `value` as its cost, and `unitSerial` records which unit it
 * became. Without one it is a valuation of something the shop is not taking in
 * — an old phone knocked off the price and given away with the box — and there
 * is nothing to create.
 */
export interface TradeInRec {
  id: string;
  /** What it is, in words. Printed on the invoice. */
  label: string;
  serial?: string;
  /** What the shop allowed for it. Comes off what the customer pays. */
  value: number;
  note?: string;
  /**
   * The catalogue variant the machine was recognised as, when it is one
   * (owner ask 2026-09-01).
   *
   * Optional in both directions and that is the point. A customer's
   * five-year-old Air is very often a variant this shop stocks, and picking it
   * here means the unit that enters QC already has its product, its category
   * and a price to compare the allowance against — which is the whole reason
   * the owner asked for the intake to be "the normal Inbound & QC flow, just
   * in one flow". A machine nobody's catalogue has stays as `label` alone and
   * is assigned a variant at QC, exactly as before.
   *
   * ⚠️ Mock-only. Prisma's `TradeIn` has `label`, `value` and `unitSerial`.
   */
  skuId?: string;
  /** Sealed or second-hand. Becomes `Unit.grade` via `gradeForCondition`. */
  condition?: "NEW" | "SECOND";
  /** The letter the grading checklist concluded, where one was run. */
  grade?: string;
}

/**
 * One named charge on a sale. Mirrors the `OrderFee` table that does not
 * exist yet — see `Order.fees`.
 */
export interface OrderFee {
  id: string;
  /** What it is for: Shipping, Shopping bag, Installation… */
  label: string;
  amount: number;
}

export interface Order {
  id: string;
  code: string;
  ts: string;
  customerId: string | null;
  serials: string[];
  /** What each serial was actually charged. */
  prices: Record<string, number>;
  /**
   * What each serial was LISTED at when the sale was recorded (owner ask
   * 2026-09-01).
   *
   * A snapshot, and it has to be one. `Sku.price` is what the shop asks
   * TODAY, and repricing a variant is an ordinary edit on the Product — so
   * deriving "was this haggled?" from the catalogue a month later would
   * measure last month's sale against this month's price list and invent
   * bargains and upsells that never happened.
   *
   * Both figures the salesperson's report needs come off this and `prices`:
   * what was given away, and what was sold above the asking price. Absent on
   * orders written before the field existed, which reads as "nothing was
   * negotiated" — the honest answer, since those tills had no way to say
   * otherwise.
   *
   * ⚠️ Mock-only. Prisma has `OrderItem.price` (the charged snapshot) and no
   * list-price column beside it. Carrying this over is one nullable column on
   * `OrderItem`, and an owner decision.
   */
  listPrices?: Record<string, number>;
  discount: number;
  discountId?: string;
  /** See `lib/channels.ts` — the list, and which of them hold the money. */
  source: SaleSource;
  /** Who made the sale — a row in `salesmen`. The basis of per-staff KPI. */
  salesmanId?: string;
  referralSourceId?: string;
  shippingAddress?: string;
  payMethod: string;
  /**
   * False while a marketplace is still holding the money.
   *
   * Which channels those are is `holdsFunds` in lib/channels.ts, not a list of
   * `=== "SHOPEE"` comparisons — Tokopedia and TikTok settle the same way
   * (owner decision 2026-08-26).
   */
  settled: boolean;
  /**
   * A charge the shop is adding — delivery, almost always (owner revision
   * 2026-08-27). Mirrors `Order.extra` / `Order.extraNote`.
   *
   * Kept as the FIRST fee's mirror now that a sale can carry several
   * (see `fees`), because it is what prisma actually has and what the invoice
   * has always printed. A sale with two fees writes the total here and the
   * breakdown in `fees`.
   */
  extra?: number;
  extraNote?: string;
  /**
   * Every charge on the sale, named (owner ask 2026-09-01: *"additional fee
   * could be more than 1"*).
   *
   * Shipping and a shopping bag are two different things on one receipt, and
   * folding them into a single "Extra Rp 165.000" is a line nobody can account
   * for a month later. Each fee carries its own category and amount.
   *
   * ⚠️ Mock-only, and this is the exact gap CLAUDE.md predicted: *"a sale that
   * needed two would need an `OrderFee` table the way a purchase order has
   * `PurchaseOrderFee`"*. Carrying this to the API is that table — a FK to
   * `Order` with `onDelete: Cascade`, a label and a `BigInt` amount — plus an
   * owner decision about whether `Order.extra` stays as the denormalised
   * total or goes.
   */
  fees?: OrderFee[];
  /** Machines taken in against the bill. See `TradeInRec`. */
  tradeIns?: TradeInRec[];
  total: number;
  /**
   * What the sale was worth before the marketplace took its cut. Written only
   * when a withdrawal is confirmed with a different net figure, so `total`
   * stays the one number the rest of the app adds up.
   */
  grossTotal?: number;
  /** Set when staff confirm a withdrawal for less than the sale price. */
  netReceived?: number;
  /** Which reservation this sale came out of, if any. */
  reservationId?: string;
}
export interface ReturnRec {
  id: string;
  code: string;
  kind: "CUSTOMER" | "SUPPLIER";
  serial: string;
  reason: string;
  /** Free text captured when `reason` is "Other". */
  reasonDetail?: string;
  date: string;
  /**
   * `CANCELLED` maps to prisma's `ReturnStatus.DITOLAK` — a claim the shop
   * withdrew. It is what a QC rejection becomes when the rejection turns out
   * to have been the wrong machine: the document stays, marked withdrawn,
   * because a supplier return that was raised really was raised. Nothing is
   * deleted here.
   */
  status: "PENDING" | "ARRIVED" | "DONE" | "CANCELLED";
  /** Set on a supplier return that came out of a QC rejection. */
  fromQc?: boolean;
  exchangeSerial?: string;
  fee?: number;
  supplierId?: string;
  expectedCredit?: number;
}
/**
 * One machine inside a reservation. Mirrors `ReservationItem`.
 *
 * There is no status column here, and that is deliberate rather than an
 * omission: whether this machine is still on hold, has been bought, or has
 * been let go is a fact about the UNIT, and `Unit.status` already carries it.
 * A second copy on the item is a second thing to keep in step, and the one
 * that would go stale is this one — a sale writes the unit, not the
 * reservation it may never have known about. `lib/reservations.ts` derives it.
 */
export interface ReservationItem {
  id: string;
  /** `ReservationItem.unitId` in the schema; the serial is how the mock names a unit. */
  serial: string;
  // No note. A hold's note belongs to the hold and not to one machine on it
  // (owner revision 2026-08-27) — `Reservation.note` above is the one place it
  // is written and the one place it is read. `ReservationItem.note` still
  // exists in schema.prisma and is now written by nothing.
}

/**
 * A hold: one customer, one moment, one or more machines.
 *
 * Was one row per serial until 2026-08-26. That was the mock running BEHIND
 * `schema.prisma`, not ahead of it — `Reservation` there has always been a
 * header with `ReservationItem[]` hanging off it — and the flat shape could
 * not express the thing staff do every day, which is put three machines aside
 * for one person in one conversation. It showed as three unrelated rows, sorted
 * apart from each other by whatever else came in between, and cancelling "the
 * reservation" meant finding all three.
 *
 * `status` is a PROJECTION, written in the same mutation as whatever moved the
 * units — the same rule `Unit.status` follows. `lib/reservations.ts` computes
 * it; nothing should set it by hand.
 */
export interface Reservation {
  id: string;
  /** Document number, RV-2026/08-000001 — what staff quote to a customer. */
  code: string;
  customerId: string;
  when: string;
  note: string;
  /** Which channel the customer reserved through. */
  sourceId?: string;
  items: ReservationItem[];
  status: "ACTIVE" | "DONE" | "CANCELLED";
}
/**
 * A discount, in one of three shapes.
 *
 * `BUNDLE` is the odd one out and deliberately so: PCT and NOMINAL take money
 * off whatever the basket happens to cost, while a bundle REPLACES the price of
 * a group of qualifying units with one agreed figure. "Any 2 accessories for
 * Rp1.000.000" is not expressible as a percentage — the saving depends on which
 * two, which is exactly why the shop wants it.
 */
export interface Discount {
  id: string;
  code: string;
  name: string;
  type: "PCT" | "NOMINAL" | "BUNDLE";
  pct?: number;
  amountRp?: number;
  maxRp?: number;
  /** BUNDLE only: how many units in `scope` make up one bundle. */
  bundleQty?: number;
  /** BUNDLE only: what one whole bundle costs, in place of its units' prices. */
  bundlePriceRp?: number;
  usageLimit?: number;
  used: number;
  fromDate?: string;
  toDate?: string;
  active: boolean;
  scope: string;
}
/**
 * Expense categories, fixed by the owner. The guide text is what the "?" button
 * on the Expenses page shows — it lives beside the value so the two cannot
 * drift apart.
 */
export const EXPENSE_CATEGORIES = [
  {
    value: "OPERATIONAL",
    label: "Operational",
    guide: "General and administrative expenses to run daily operations.",
  },
  {
    value: "PAYROLL",
    label: "Payroll",
    guide: "Employee salaries, wages, bonuses, and benefits.",
  },
  {
    value: "MARKETING",
    label: "Marketing & Advertisement",
    guide: "Campaigns, promotions, and brand awareness efforts.",
  },
  {
    value: "RENT",
    label: "Rent and Facilities",
    guide: "Commercial office space, storage, or warehouse leases.",
  },
  {
    value: "PROFESSIONAL",
    label: "Professional Services",
    guide: "Legal fees, accounting, and third-party contractor costs.",
  },
  {
    value: "SOFTWARE",
    label: "Software & Technology",
    guide: "SaaS subscriptions, cloud hosting, and IT hardware.",
  },
] as const;
export type ExpenseKind = (typeof EXPENSE_CATEGORIES)[number]["value"];

/**
 * Why money came IN by hand (owner ask 2026-09-01).
 *
 * Two, and only two, because everything else that raises the balance is a
 * SALE and the app already records those from the till. These are the entries
 * a sale cannot make: takings from before the app, or from a channel it does
 * not sell through, and money moved in from another account of the business's
 * own — which is not revenue and must never be counted as any.
 *
 * ⚠️ Mock-only. Prisma has no manual-income table; carrying this to the API is
 * an owner decision plus a migration. Same footing as `openingBalance`.
 */
export const INCOME_REASONS = [
  {
    value: "SALES",
    label: "Sales",
    guide: "Takings this app did not record — an off-app sale, or an old till.",
  },
  {
    value: "TRANSFER",
    label: "Account transfer",
    guide:
      "Money moved in from another account of the business. Not revenue — it raises the balance without being a sale.",
  },
] as const;
export type IncomeReason = (typeof INCOME_REASONS)[number]["value"];

/**
 * Money in, entered by hand. The income half of an adjustment.
 *
 * Deliberately NOT an `Order`: an order is a sale of specific serials with a
 * channel, a customer and a margin, and inventing one to hold a bank transfer
 * would put a sale in Transaction History that never happened and units on it
 * that do not exist.
 */
export interface ManualIncome {
  id: string;
  reason: IncomeReason;
  amount: number;
  date: string;
  note?: string;
}

export interface Expense {
  id: string;
  /**
   * What it was for, in words.
   *
   * Optional since the Add-adjustment dialog replaced Add-expense
   * (2026-09-01): that form asks for a reason, a date, an amount and a note,
   * and no separate label — the reason is the label for anything typed
   * through it. Seeded and older rows still carry one, so the history column
   * shows the label where there is one and the category where there is not.
   */
  label?: string;
  kind: ExpenseKind;
  amount: number;
  date: string;
  note?: string;
  /**
   * Marketing spend only: which referral source this campaign feeds, so the
   * money spent can be scored against the customers it brought in.
   */
  referralSourceId?: string;
}
export interface ChatMsg {
  id: string;
  dir: "IN" | "OUT" | "AGENT";
  text: string;
  at: string;
  /** Set once a human rewrites an agent reply; the original stays in `text`. */
  correctedText?: string;
}
export interface ChatThread {
  phone: string;
  name: string;
  channel: "WHATSAPP" | "INSTAGRAM";
  needsReply: boolean;
  summary: string;
  messages: ChatMsg[];
}
export interface Knowledge {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  updatedAt: string;
}
/**
 * A staff rewrite of something the bot said. This is the whole learning loop:
 * every correction is replayed into the next prompt as a "you said X, a human
 * would have said Y" example, so the same mistake costs one correction, once.
 */
export interface Correction {
  id: string;
  threadPhone: string;
  messageId: string;
  original: string;
  corrected: string;
  note?: string;
  at: string;
  staff: string;
}
/** A voice the bot can wear. `builtIn` rows cannot be deleted, only copied. */
export interface Persona {
  id: string;
  name: string;
  blurb: string;
  prompt: string;
  builtIn: boolean;
}
/**
 * A logged stock adjustment. `reasonId` points at a row in `reasons` — never a
 * loose string — which is what makes the Settings list authoritative rather
 * than decorative. See `ensureReason` in store.ts.
 */
export interface Adjustment {
  id: string;
  serial: string;
  description: string;
  reasonId: string;
  at: string;
  staff: string;
  /**
   * Which way the stock moved. IN puts a unit into sellable stock — including
   * one the shop did not know it had; OUT takes it out to service or writes it
   * off. Every row written before the batch editor existed is an OUT.
   */
  kind: AdjustmentKind;
  /**
   * Rows entered together share this. Staff adjust three or four units in one
   * sitting under one reason, and the log has to be able to show that as one
   * act rather than four coincidences a second apart.
   */
  batchId: string;
  /** Cycle count recorded on the unit as part of this adjustment. */
  batteryHealth?: number;
  /**
   * Set when this row's serial was NOT in stock and the adjustment created the
   * unit. The distinction outlives the moment: an audit asking where a serial
   * came from gets "it was adjusted in", not a unit with no intake.
   */
  newUnit?: boolean;
}
export type AdjustmentKind = "IN" | "OUT";
/**
 * A machine found at a stock take that the system has never heard of, and what
 * the counter decided about it.
 *
 * It is not a unit yet. The whole record lives on the draft until the count is
 * posted, at which point it becomes a `Unit` in QC with an `OPNAME_DITEMUKAN`
 * genesis event — QC and not the shelf, by owner decision: a surplus machine
 * has no grade, no description and no cost, and nothing in a second-hand shop
 * goes on sale before somebody has looked at it.
 */
export interface OpnameSurplus {
  /** Which product it is. A serial alone cannot raise anybody's stock count. */
  skuId: string;
  /** Where it was found. The count's warehouse, unless the count spans two. */
  locationId: string;
  /** `Reason.label`, activity `ADJUSTMENT` — why the shop has it and no record. */
  reason: string;
  /** Sealed or second-hand. Becomes `Unit.grade` via `gradeForCondition`. */
  condition: UnitCondition;
}

export interface OpnameRec {
  id: string;
  /** Document number, SO-2026/08-000001. The identifier staff quote. */
  code: string;
  /**
   * What staff typed to tell two counts of one warehouse apart — "rak A-C,
   * shift pagi". Mirrors `OpnameSession.label`, added 2026-08-24. Optional
   * because `code` is the identifier and this is only a human hint.
   */
  label?: string;
  /**
   * What the count covers (owner ask 2026-08-31). Every axis means "all" when
   * empty — `lib/opnameScope.ts` is the grammar and the reasoning.
   *
   * `locationIds` replaced a single `locationId` on 2026-08-31. It is a list
   * now because the owner asked for multiple selection on each axis, and the
   * one-warehouse count that used to be the only possibility is a list of one.
   *
   * ⚠️ Schema gap: prisma's `OpnameSession` holds a single `locationId` and
   * nothing about racks, categories or condition. Carrying this to the API
   * needs an owner decision plus a migration — and, because CLAUDE.md forbids
   * JSON columns, two join tables rather than an array column. Same footing as
   * the grading tables and `Supplier.code`.
   */
  locationIds: string[];
  rackIds: string[];
  /** `CatalogModel.category` names. */
  categories: string[];
  /** `"NEW"` / `"SECOND"` — see `lib/condition.ts`. */
  conditions: UnitCondition[];
  /** The date being counted FOR, chosen in the start dialog. */
  date: string;
  at: string;
  counted: string[];
  missing: string[];
  /**
   * Scanned here but not expected here.
   *
   * Two different facts share this list, and the confirmation screen tells them
   * apart by looking the serial up: a unit the system has never seen, and one
   * that belongs to a different warehouse. The second is the common case and
   * the more useful one — it says where the unit thinks it is.
   */
  unknown: string[];
  /** serial → what the counter wrote about a missing or unknown unit. */
  notes: Record<string, string>;
  /**
   * Unregistered serials the counter decided the shop should own, by serial
   * (owner ask 2026-08-31).
   *
   * Recorded on the draft and acted on at POST, which is the owner's own
   * choice and the only one that holds the page's promise together: a draft
   * writes nothing to any unit, and a button that minted a machine mid-count
   * would also make that machine *expected*, moving the missing and counted
   * figures under the hands of the person still counting.
   */
  surplus: Record<string, OpnameSurplus>;
  /** DRAFT survives a reload so a long count can be finished after a break. */
  status: "DRAFT" | "POSTED";
}
export interface ReferralSource {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Staff-editable knobs, mirroring the `AppSetting` table.
 *
 * Two thresholds rather than three ranges — see lib/battery.ts for why three
 * hand-entered ranges can overlap and two thresholds cannot.
 */
export interface AppSettings {
  batteryGoodMin: number;
  batteryFairMin: number;
  /**
   * The cash the business held before this app recorded anything — what the
   * Income & Expense balance starts counting from (owner ask 2026-08-27).
   * Unset until somebody enters it; the seed leaves it unset so the "add the
   * current balance" path is visible. Mirrors an `AppSetting` row, so no new
   * table — but the KEY does not exist there yet: owner decision + migration
   * before the API can carry it.
   */
  openingBalance?: number;
  /** When the opening balance was entered, so the card can say so. */
  openingBalanceAt?: string;
  /**
   * Who the shop is, as printed at the top of every faktur.
   *
   * These four were a `const SHOP` in `components/Invoice.tsx` until
   * 2026-09-02, with the comment "Hard-coded for now — Settings does not own
   * shop identity yet". Settings owns it now. The values are unchanged, so no
   * receipt printed before or after this reads differently; what changed is
   * that moving premises no longer needs a developer.
   *
   * Each mirrors an `AppSetting` row — `shop.name`, `shop.tagline`,
   * `shop.address`, `shop.contact` — which is a key/value table, so unlike
   * `openingBalance` this needs no migration and no new column. The real seed
   * writes the same four keys.
   *
   * Optional, and the invoice falls back to the same strings it always
   * printed: a receipt is the wrong place to discover that a setting is
   * missing.
   */
  shopName?: string;
  shopTagline?: string;
  shopAddress?: string;
  shopContact?: string;
}

/**
 * A way of paying, mirroring the `PaymentMethod` table.
 *
 * A table rather than a fixed list because Settings must be able to add one —
 * the same reason `ReferralSource` is a table. `forPo` splits the two sides:
 * a supplier is paid in cash, card or deposit, while a customer can also pay
 * by QRIS or leave money in a marketplace escrow.
 */
export interface PaymentMethodRec {
  id: string;
  code: string;
  label: string;
  /** Read by code somewhere in the app; staff may rename it, never delete it. */
  builtIn: boolean;
  forPo: boolean;
  forSale: boolean;
  active: boolean;
}

export interface MockDb {
  settings: AppSettings;
  paymentMethods: PaymentMethodRec[];
  warehouses: Warehouse[];
  racks: RackLocation[];
  suppliers: Supplier[];
  reasons: Reason[];
  /** Suggestions for the QC Description box. See `QcDescription`. */
  qcDescriptions: QcDescription[];
  /**
   * What QC inspects, per product category, and the combinations that make a
   * grade. See `lib/grading.ts` — including the schema gap.
   */
  gradingCriteria: GradingCriterion[];
  /** Evaluated in array order; first fit wins. */
  gradingRules: GradingRule[];
  reservationSources: ReservationSource[];
  salesmen: Salesman[];
  models: CatalogModel[];
  /**
   * AppleDB models the shop has HIDDEN from the import list — by AppleDB's
   * stable `key`, the same identity the import table dedupes on.
   *
   * It was a "not selling" MARK until 2026-08-28, which dimmed the row and
   * left it in the table. The owner asked for a hide instead, and the
   * difference is the whole feature: AppleDB's feed is thousands of models and
   * this shop sells a few dozen, so a list where every rejected model is still
   * present — merely greyer — is still a list nobody can read. Hidden rows
   * leave the table, and a switch above it brings them back when somebody
   * wants to reconsider one.
   *
   * Surviving a re-fetch is still the point: when next year's feed brings two
   * new models, the ones deliberately skipped are already out of the way and
   * the two genuinely new ones are what is left.
   *
   * ⚠️ Schema gap: would live beside `AppleDbCache` — owner decision +
   * migration before the API can carry it.
   */
  appleDbHidden: string[];
  skus: Sku[];
  units: Unit[];
  events: UnitEvent[];
  /** Notes and their photographs, keyed to a serial. See `UnitNote`. */
  unitNotes: UnitNote[];
  pos: Po[];
  stockIns: StockInRec[];
  customers: Customer[];
  orders: Order[];
  returns: ReturnRec[];
  reservations: Reservation[];
  discounts: Discount[];
  expenses: Expense[];
  /** Money in, entered by hand. See `ManualIncome`. ⚠️ Mock-only. */
  incomes: ManualIncome[];
  chats: ChatThread[];
  knowledge: Knowledge[];
  corrections: Correction[];
  personas: Persona[];
  activePersonaId: string;
  adjustments: Adjustment[];
  opnames: OpnameRec[];
  referralSources: ReferralSource[];
  /** Signed-in account → default warehouse (owner rule: account A → warehouse X). */
  myWarehouseId: string;
}

/**
 * Battery readings the seed hands out, in order.
 *
 * Weighted the way a second-hand shop's stock actually is — mostly healthy, a
 * few tired — while still visiting all three bands so the Inventory filter has
 * something to filter. See the use site for why this is a ladder, not
 * arithmetic.
 *
 * Interleaved rather than sorted, and that ordering is load-bearing: only a
 * handful of seeded units get a reading at all, so a descending ladder would
 * hand out nothing but healthy values and never reach the tired end. As
 * written, all three bands appear within the first five readings.
 */
const BATTERY_LADDER = [
  98, 92, 79, 88, 74, 95, 77, 84, 68, 90, 76, 71,
] as const;

/**
 * The condition grades the seed hands out, in order. Mirrors prisma's `Grade`.
 *
 * Weighted toward A because that is what a shop that grades its own intake
 * ends up holding — the C machines are the ones that sell first or go to the
 * bench — while still visiting every value, so the till's serial chooser and
 * Inventory's filter both have something to show. `NEW` is in here for sealed
 * stock, which this shop does carry (the accessories).
 *
 * Independent of `BATTERY_LADDER` on purpose. Grade is a judgement about the
 * case and the screen; battery health is a number off the machine. Correlating
 * them in demo data would hide every screen that shows one without the other.
 */
const GRADE_LADDER = ["A", "A", "B", "A", "C", "A", "B", "NEW"] as const;

const iso = (daysAgo: number, h = 10) =>
  new Date(
    Date.now() - daysAgo * 86_400_000 + h * 3_600_000 - 10 * 3_600_000,
  ).toISOString();

export function buildSeed(): MockDb {
  // Four warehouses by owner decision; the names are editable in Settings.
  const warehouses: Warehouse[] = [
    { id: "wh-1", name: "Warehouse 1", active: true },
    { id: "wh-2", name: "Warehouse 2", active: true },
    { id: "wh-3", name: "Warehouse 3", active: true },
    { id: "wh-4", name: "Warehouse 4", active: true },
  ];
  const racks: RackLocation[] = warehouses.flatMap((w) =>
    ["Rack 1", "Rack 2", "Rack 3"].map((name, i) => ({
      id: `${w.id}-rack-${i + 1}`,
      warehouseId: w.id,
      name,
      active: true,
    })),
  );
  const suppliers: Supplier[] = [
    {
      id: "sup-1",
      name: "PT Mac Jaya",
      phone: "+62215550101",
      address: "Jl. Gajah Mada 40, Jakarta",
      code: "MJ",
    },
    // The owner's own worked example: Apel Segar is AS, so `SBJ347203KLM`
    // scans in as `ASBJ347203KLM`.
    { id: "sup-2", name: "CV Apel Segar", phone: "+62225550188", code: "AS" },
    // Deliberately left without one, so the screen that has to cope with a
    // supplier that predates the scheme is a screen somebody can actually see.
    { id: "sup-3", name: "Batam Importir" },
  ];
  const reasons: Reason[] = [
    // Seeded by owner decision. A free-typed reason joins this list before it
    // is ever referenced by an adjustment — see `ensureReason` in store.ts.
    {
      id: "rsn-adj-internal",
      activity: "ADJUSTMENT",
      label: "Internal Use",
      active: true,
    },
    {
      id: "rsn-adj-transfer",
      activity: "ADJUSTMENT",
      label: "Stock Transfer",
      active: true,
    },
    {
      id: "rsn-adj-service",
      activity: "ADJUSTMENT",
      label: "On Service",
      active: true,
    },
    {
      id: "rsn-cus-return",
      activity: "RETURN_CUSTOMER",
      label: "Changed their mind",
      active: true,
    },
    {
      id: "rsn-cus-wrong",
      activity: "RETURN_CUSTOMER",
      label: "Wrong item sent",
      active: true,
    },
    {
      id: "rsn-cus-dead",
      activity: "RETURN_CUSTOMER",
      label: "Doesn't power on",
      active: true,
    },
    {
      id: "rsn-cus-other",
      activity: "RETURN_CUSTOMER",
      label: "Other",
      active: true,
    },
    {
      id: "rsn-sup-defect",
      activity: "RETURN_SUPPLIER",
      label: "Defective on arrival",
      active: true,
    },
    {
      id: "rsn-sup-qc",
      activity: "RETURN_SUPPLIER",
      label: "Rejected at QC",
      active: true,
    },
    {
      id: "rsn-sup-wrong",
      activity: "RETURN_SUPPLIER",
      label: "Wrong model delivered",
      active: true,
    },
    {
      id: "rsn-sup-other",
      activity: "RETURN_SUPPLIER",
      label: "Other",
      active: true,
    },
  ];
  /**
   * What the shop actually writes on a second-hand Mac, in the shop's own
   * words — Indonesian, because that is the language the bench works in even
   * on an English screen, and a suggestion nobody recognises is a suggestion
   * nobody picks. Anything typed that is not here joins the list.
   */
  const qcDescriptions: QcDescription[] = [
    // One fact each, and no commas in any of them — a description is a LIST of
    // these now (owner revision 2026-08-27), so a phrase carrying its own
    // comma would arrive as two the moment it was read back. Grouped roughly
    // as the bench works: overall condition, then marks, then what is in the
    // box.
    { id: "qcd-1", label: "Mulus", active: true },
    { id: "qcd-2", label: "Normal", active: true },
    { id: "qcd-3", label: "Lecet halus", active: true },
    { id: "qcd-4", label: "Lecet di casing bawah", active: true },
    { id: "qcd-5", label: "Dent di sudut", active: true },
    { id: "qcd-6", label: "Layar ada garis", active: true },
    { id: "qcd-7", label: "Keyboard aus", active: true },
    { id: "qcd-8", label: "Baterai lemah", active: true },
    { id: "qcd-9", label: "Engsel longgar", active: true },
    { id: "qcd-10", label: "Sudah ganti SSD", active: true },
    { id: "qcd-11", label: "Fullset dus", active: true },
    { id: "qcd-12", label: "Charger original", active: true },
    { id: "qcd-13", label: "Unit only", active: true },
    { id: "qcd-14", label: "Tanpa charger", active: true },
  ];
  /**
   * Grading configuration, per category (owner ask 2026-08-27) — the criteria
   * QC checks and the combinations that add up to each grade. See
   * `lib/grading.ts` for the semantics and the schema gap.
   *
   * Seeded for the two laptop categories the shop actually grades; the same
   * checks under two categories because the configuration is PER CATEGORY and
   * a Mac mini, when one arrives, will need different ones — which is the
   * whole reason it is not one global list. "Accessory" is deliberately left
   * without one: a charger is not graded, and its absence exercises the QC
   * modal's no-configuration path.
   */
  const gradingCriteria: GradingCriterion[] = [];
  const gradingRules: GradingRule[] = [];
  for (const [pref, category] of [
    ["air", "MacBook Air"],
    ["pro", "MacBook Pro"],
  ] as const) {
    gradingCriteria.push(
      {
        id: `gc-${pref}-screen`,
        category,
        name: "Screen",
        options: [
          { id: `gco-${pref}-screen-new`, label: "Like new" },
          { id: `gco-${pref}-screen-scratch`, label: "Little scratch" },
          { id: `gco-${pref}-screen-yellow`, label: "Yellow screen" },
          { id: `gco-${pref}-screen-dead`, label: "Dead pixels / lines" },
        ],
      },
      {
        id: `gc-${pref}-body`,
        category,
        name: "Body",
        options: [
          { id: `gco-${pref}-body-new`, label: "Like new" },
          { id: `gco-${pref}-body-marks`, label: "Light marks" },
          { id: `gco-${pref}-body-dent`, label: "Dent or crack" },
        ],
      },
      {
        id: `gc-${pref}-ports`,
        category,
        name: "Ports & WiFi",
        options: [
          { id: `gco-${pref}-ports-full`, label: "Fully functional" },
          { id: `gco-${pref}-ports-partial`, label: "Partly working" },
          { id: `gco-${pref}-ports-faulty`, label: "Faulty" },
        ],
      },
    );
    gradingRules.push(
      // Checked top to bottom, first fit wins — best grade first, catch-all
      // last. The shape the owner described: A is everything at its best, B is
      // nothing worse than light wear, C is whatever is left.
      {
        id: `gr-${pref}-a`,
        category,
        grade: "A",
        conditions: [
          {
            criterionId: `gc-${pref}-screen`,
            optionIds: [`gco-${pref}-screen-new`],
          },
          {
            criterionId: `gc-${pref}-body`,
            optionIds: [`gco-${pref}-body-new`],
          },
          {
            criterionId: `gc-${pref}-ports`,
            optionIds: [`gco-${pref}-ports-full`],
          },
        ],
      },
      {
        id: `gr-${pref}-b`,
        category,
        grade: "B",
        conditions: [
          {
            criterionId: `gc-${pref}-screen`,
            optionIds: [
              `gco-${pref}-screen-new`,
              `gco-${pref}-screen-scratch`,
            ],
          },
          {
            criterionId: `gc-${pref}-body`,
            optionIds: [`gco-${pref}-body-new`, `gco-${pref}-body-marks`],
          },
          {
            criterionId: `gc-${pref}-ports`,
            optionIds: [`gco-${pref}-ports-full`],
          },
        ],
      },
      { id: `gr-${pref}-c`, category, grade: "C", conditions: [] },
    );
  }
  const reservationSources: ReservationSource[] = [
    { id: "rsv-src-ig", name: "Instagram", active: true },
    { id: "rsv-src-wa", name: "WhatsApp", active: true },
    { id: "rsv-src-tiktok", name: "TikTok", active: true },
    { id: "rsv-src-shopee", name: "Shopee", active: true },
    { id: "rsv-src-tokopedia", name: "Tokopedia", active: true },
    { id: "rsv-src-walkin", name: "Walk-in", active: true },
  ];
  // Three by owner decision; the list is managed in Settings.
  const salesmen: Salesman[] = [
    { id: "sm-1", name: "Michella", active: true },
    { id: "sm-2", name: "Dimas Pratama", active: true },
    { id: "sm-3", name: "Ayu Lestari", active: true },
  ];
  const models: CatalogModel[] = [
    {
      id: "m-air-m2",
      name: "MacBook Air M2",
      category: "MacBook Air",
      releaseYear: 2022,
      line: "AIR",
      sizeInch: 13,
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["8GB", "16GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    },
    {
      id: "m-pro14-m1",
      name: "MacBook Pro 14 M1 Pro",
      category: "MacBook Pro",
      releaseYear: 2021,
      line: "PRO",
      sizeInch: 14,
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["16GB", "32GB"] },
        { name: "SSD", values: ["512GB", "1TB"] },
      ],
    },
    {
      id: "m-pro13-m1",
      name: "MacBook Pro 13 M1",
      category: "MacBook Pro",
      releaseYear: 2020,
      line: "PRO",
      sizeInch: 13,
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["8GB", "16GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    },
    // The 2016s, added 2026-08-24. One axis each has a single value because
    // that is how these actually shipped: the 15-inch came 16GB or not at all,
    // and the 12-inch never offered a RAM choice worth listing. The generator
    // below handles a one-value axis without special casing — it just yields
    // fewer variants, which is the honest catalogue.
    {
      id: "m-pro13-2016",
      name: "MacBook Pro 13 2016",
      category: "MacBook Pro",
      releaseYear: 2016,
      line: "PRO",
      sizeInch: 13,
      source: "MANUAL",
      // Four axes, not two. This is the model the owner's example code
      // describes, and it is the one that genuinely shipped in both chips and
      // both touch-bar configurations — which is why chip and touch bar are
      // axes rather than columns.
      axes: [
        { name: "Chip", values: ["i5", "i7"] },
        { name: "RAM", values: ["8GB", "16GB"] },
        { name: "SSD", values: ["128GB", "256GB"] },
        { name: "Touch Bar", values: ["NTB", "TB"] },
      ],
    },
    {
      id: "m-pro15-2016",
      name: "MacBook Pro 15 2016",
      category: "MacBook Pro",
      releaseYear: 2016,
      line: "PRO",
      sizeInch: 15,
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["16GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    },
    {
      // The only member of its category so far. "MacBook" unqualified is the
      // 12-inch Retina line and nothing else, so it cannot live under Air or
      // Pro without misfiling it.
      id: "m-mb12-2016",
      name: "MacBook 12 Retina 2016",
      category: "MacBook",
      releaseYear: 2016,
      line: "MB",
      sizeInch: 12,
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    },
    /*
     * Older machines, added 2026-08-26 at the owner's request.
     *
     * The catalogue jumped from 2016 to 2020 and had nothing in between, which
     * is the opposite of what a second-hand shop actually turns over — the
     * 2015 Airs and the last Intel Pros are the volume, and the M-series are
     * the ones that arrive occasionally and leave quickly. A demo catalogue
     * that only holds the expensive end teaches the wrong shape of screen.
     *
     * 13.3 rather than 13 on the Intel bodies is not fussiness: these really
     * are 13.3", `sizeInch` is a Decimal(3,1) in the schema for that reason,
     * and `productCode` prints the decimal only when there is one.
     */
    {
      id: "m-air-2015",
      name: "MacBook Air 13 2015",
      category: "MacBook Air",
      releaseYear: 2015,
      line: "AIR",
      sizeInch: 13.3,
      source: "MANUAL",
      axes: [
        { name: "Chip", values: ["i5"] },
        { name: "RAM", values: ["4GB", "8GB"] },
        { name: "SSD", values: ["128GB", "256GB"] },
      ],
    },
    {
      id: "m-air-2017",
      name: "MacBook Air 13 2017",
      category: "MacBook Air",
      releaseYear: 2017,
      line: "AIR",
      sizeInch: 13.3,
      source: "MANUAL",
      axes: [
        { name: "Chip", values: ["i5"] },
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["128GB", "256GB"] },
      ],
    },
    {
      id: "m-pro13-2015",
      name: "MacBook Pro 13 2015",
      category: "MacBook Pro",
      releaseYear: 2015,
      line: "PRO",
      sizeInch: 13.3,
      source: "MANUAL",
      axes: [
        { name: "Chip", values: ["i5", "i7"] },
        { name: "RAM", values: ["8GB", "16GB"] },
        { name: "SSD", values: ["128GB", "256GB"] },
      ],
    },
    {
      id: "m-air-m1",
      name: "MacBook Air M1",
      category: "MacBook Air",
      releaseYear: 2020,
      line: "AIR",
      sizeInch: 13,
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["8GB", "16GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    },
    /*
     * iPads, added 2026-08-26.
     *
     * Their axes are the first in this catalogue that are neither RAM nor SSD:
     * an iPad varies by storage and by whether it has a SIM, and calling the
     * storage axis "SSD" to fit the existing loop would put a word on the
     * Products screen that is wrong about the hardware. The SKU builder reads
     * `Storage` alongside `SSD` instead — see the loop below — which is the
     * same accommodation `Chip` and `Touch Bar` already got in 2026-08-24.
     */
    {
      id: "m-ipad-9",
      name: "iPad 9",
      category: "iPad",
      releaseYear: 2021,
      line: "IPAD",
      sizeInch: 10.2,
      source: "MANUAL",
      axes: [
        { name: "Storage", values: ["64GB", "256GB"] },
        { name: "Connectivity", values: ["WiFi", "Cellular"] },
      ],
    },
    {
      id: "m-ipad-air-4",
      name: "iPad Air 4",
      category: "iPad",
      releaseYear: 2020,
      line: "IPAD AIR",
      sizeInch: 10.9,
      source: "MANUAL",
      axes: [
        { name: "Storage", values: ["64GB", "256GB"] },
        { name: "Connectivity", values: ["WiFi", "Cellular"] },
      ],
    },
    {
      id: "m-ipad-pro11-m1",
      name: "iPad Pro 11 M1",
      category: "iPad",
      releaseYear: 2021,
      line: "IPAD PRO",
      sizeInch: 11,
      source: "MANUAL",
      axes: [
        { name: "Storage", values: ["128GB", "256GB", "512GB"] },
        { name: "Connectivity", values: ["WiFi", "Cellular"] },
      ],
    },
    {
      id: "m-ipad-mini-6",
      name: "iPad mini 6",
      category: "iPad",
      releaseYear: 2021,
      line: "IPAD MINI",
      sizeInch: 8.3,
      source: "MANUAL",
      axes: [
        { name: "Storage", values: ["64GB", "256GB"] },
        { name: "Connectivity", values: ["WiFi", "Cellular"] },
      ],
    },
  ];
  /**
   * Every combination of a model's axes.
   *
   * Was two nested loops over `axes[0]` and `axes[1]`, which quietly assumed
   * every model has exactly RAM and SSD. The Intel-era Pros also vary by chip
   * and by touch bar, and those are axes too (owner decision 2026-08-24), so
   * the shape has to come from the data rather than from the loop.
   */
  const combinations = (
    axes: readonly { name: string; values: string[] }[],
  ): Record<string, string>[] =>
    axes.reduce<Record<string, string>[]>(
      (acc, axis) =>
        acc.flatMap((partial) =>
          axis.values.map((v) => ({ ...partial, [axis.name]: v })),
        ),
      [{}],
    );

  const skus: Sku[] = [];
  // Not a sticker price: the loop below adds 2.5jt for a 16GB-or-more RAM tier
  // and 1.5jt for the larger SSD, so this is the floor variant's price minus
  // those steps. The 2016 bases look low for that reason — a 15-inch 2016 with
  // 16GB lands at 6.8jt, and the 12-inch at 4.2jt.
  const basePrice: Record<string, number> = {
    "m-air-m2": 11_500_000,
    "m-pro14-m1": 16_500_000,
    "m-pro13-m1": 9_800_000,
    "m-pro13-2016": 3_000_000,
    "m-pro15-2016": 4_300_000,
    "m-mb12-2016": 4_200_000,
    // The older machines and the iPads, added 2026-08-26.
    "m-air-2015": 3_200_000,
    "m-air-2017": 4_100_000,
    "m-pro13-2015": 4_500_000,
    "m-air-m1": 8_900_000,
    "m-ipad-9": 3_400_000,
    "m-ipad-air-4": 5_600_000,
    "m-ipad-pro11-m1": 9_500_000,
    "m-ipad-mini-6": 5_900_000,
  };
  /**
   * What an iPad's storage tier adds over its floor variant.
   *
   * A table rather than another clause in the sum below, because an iPad's
   * ladder is not a Mac's: the jump from 64 to 256 is most of the price
   * difference between two otherwise identical tablets, while the same jump on
   * a Mac is the smaller of its two options. Kept separate from the SSD step so
   * that adding it did not move a single existing Mac price.
   */
  const STORAGE_STEP: Record<string, number> = {
    "64GB": 0,
    "128GB": 0,
    "256GB": 900_000,
    "512GB": 2_400_000,
  };
  for (const m of models) {
    let i = 0;
    for (const axisValues of combinations(m.axes)) {
      i += 1;
      const ram = axisValues["RAM"] ?? "";
      const ssd = axisValues["SSD"] ?? "";
      // An iPad calls it Storage; a Mac calls it SSD. The label prints
      // whichever the model actually has — see the iPad models above.
      const storage = axisValues["Storage"] ?? "";
      skus.push({
        id: `${m.id}-v${i}`,
        modelId: m.id,
        code: productCode({
          line: m.line,
          sizeInch: m.sizeInch,
          year: String(m.releaseYear),
          chip: axisValues["Chip"],
          ram,
          ssd: ssd || storage,
          // Whatever else separates two otherwise identical units. On an
          // Intel Pro that is the touch bar; on an iPad it is the SIM.
          extra: axisValues["Touch Bar"] ?? axisValues["Connectivity"],
        }),
        name: m.name,
        variantLabel: Object.values(axisValues).join(" / "),
        axisValues,
        price:
          basePrice[m.id]! +
          (ram.startsWith("1") || ram.startsWith("3") ? 2_500_000 : 0) +
          (ssd === "512GB" || ssd === "1TB" ? 1_500_000 : 0) +
          (axisValues["Chip"] === "i7" ? 1_200_000 : 0) +
          (STORAGE_STEP[storage] ?? 0) +
          // A cellular iPad costs more new and holds it second-hand.
          (axisValues["Connectivity"] === "Cellular" ? 1_100_000 : 0),
      });
    }
  }

  /**
   * Accessories.
   *
   * Built here rather than through the loop above because an accessory has one
   * axis (a colour, a layout), not the RAM x SSD grid every Mac has — and they
   * exist at all because "what else can this customer be sold" has no answer in
   * a catalogue that contains only laptops.
   */
  const accessoryModels: CatalogModel[] = [
    {
      id: "m-magic-mouse",
      name: "Magic Mouse",
      category: "Accessory",
      releaseYear: 2021,
      source: "MANUAL",
      axes: [{ name: "Colour", values: ["White", "Black"] }],
    },
    {
      id: "m-magic-keyboard",
      name: "Magic Keyboard",
      category: "Accessory",
      releaseYear: 2021,
      source: "MANUAL",
      axes: [{ name: "Layout", values: ["US", "US with Touch ID"] }],
    },
    {
      id: "m-usbc-hub",
      name: "USB-C Hub 7-in-1",
      category: "Accessory",
      releaseYear: 2023,
      source: "MANUAL",
      axes: [{ name: "Colour", values: ["Space Grey"] }],
    },
    {
      id: "m-sleeve",
      name: 'Laptop Sleeve 13-14"',
      category: "Accessory",
      releaseYear: 2024,
      source: "MANUAL",
      axes: [{ name: "Colour", values: ["Grey"] }],
    },
  ];
  const accessoryPrice: Record<string, number> = {
    "m-magic-mouse": 950_000,
    "m-magic-keyboard": 1_450_000,
    "m-usbc-hub": 385_000,
    "m-sleeve": 175_000,
  };
  for (const m of accessoryModels) {
    m.axes[0]!.values.forEach((value, i) => {
      skus.push({
        id: `${m.id}-v${i + 1}`,
        modelId: m.id,
        code: `${m.id.toUpperCase().replace(/-/g, "")}${i + 1}`,
        name: m.name,
        variantLabel: value,
        axisValues: { [m.axes[0]!.name]: value },
        price: accessoryPrice[m.id]!,
      });
    });
  }
  models.push(...accessoryModels);

  /**
   * Three arrived orders, plus one of each awkward case the owner described:
   * paid before anyone knew what it bought, and goods that did not match the
   * invoice. Both exist in the seed so the Inbound list shows every stage
   * without anyone having to create one by hand.
   */
  const pos: Po[] = [
    {
      id: "po-1",
      code: "PI-2026/08-000041",
      supplierId: "sup-1",
      invoice: "INV/MJ/0812",
      date: iso(9).slice(0, 10),
      locationId: "wh-1",
      items: [],
      payments: [
        // Two transfers on the same order, because that is how it goes: the
        // supplier is paid for the machines and the forwarder is paid for the
        // box they came in. Splitting them here is what gives the Purchase
        // card something to show for `appliedTo`.
        {
          id: "pp-1",
          method: "TUNAI",
          amount: 24_000_000,
          at: iso(9),
          appliedTo: "ORDER",
        },
        {
          id: "pp-1b",
          method: "TUNAI",
          amount: 250_000,
          at: iso(8),
          appliedTo: "SHIPPING",
        },
      ],
      shippingFee: 250_000,
      taxFee: 0,
      discount: 0,
      status: "RECEIVED",
    },
    {
      id: "po-2",
      code: "PI-2026/08-000042",
      supplierId: "sup-2",
      invoice: "AS-118",
      date: iso(2).slice(0, 10),
      locationId: "wh-1",
      items: [],
      payments: [],
      shippingFee: 0,
      taxFee: 0,
      discount: 0,
      status: "RECEIVED",
    },
    {
      id: "po-3",
      code: "PI-2026/08-000043",
      supplierId: "sup-3",
      invoice: "BTM-77",
      date: iso(1).slice(0, 10),
      locationId: "wh-2",
      items: [],
      payments: [],
      shippingFee: 0,
      taxFee: 0,
      discount: 0,
      status: "RECEIVED",
    },
    {
      // Story 3: the owner wired money against an invoice and told nobody what
      // it was for. No lines, no units, a real payment. The Inbound list must
      // show this as Pending rather than as an empty order.
      id: "po-4",
      code: "PI-2026/08-000044",
      supplierId: "sup-1",
      invoice: "INV/MJ/0871",
      date: iso(0).slice(0, 10),
      locationId: "wh-1",
      items: [],
      payments: [
        { id: "pp-2", method: "KARTU_KREDIT", amount: 18_500_000, at: iso(0) },
      ],
      shippingFee: 0,
      taxFee: 0,
      discount: 0,
      status: "ORDERED",
    },
    {
      // Story 2: lines were entered from the invoice, a deposit was paid, and
      // one line will never turn up. Outstanding balance is what makes the
      // partial payment visible.
      id: "po-5",
      code: "PI-2026/08-000045",
      supplierId: "sup-2",
      invoice: "AS-124",
      date: iso(0).slice(0, 10),
      locationId: "wh-1",
      items: [
        {
          id: "poi-x1",
          skuId: "m-pro13-2016-v1",
          serial: null,
          qty: 1,
          unitCost: 4_100_000,
        },
        {
          id: "poi-x2",
          skuId: "m-mb12-2016-v1",
          serial: null,
          qty: 1,
          unitCost: 3_900_000,
          notReceived: true,
        },
      ],
      payments: [
        {
          id: "pp-3",
          method: "DEPOSIT",
          amount: 2_000_000,
          at: iso(0),
          appliedTo: "ORDER",
        },
      ],
      shippingFee: 150_000,
      taxFee: 0,
      discount: 100_000,
      status: "ORDERED",
    },
  ];

  const units: Unit[] = [];
  const events: UnitEvent[] = [];
  const stockIns: StockInRec[] = [];
  let seq = 0;
  // Counts only the units that actually get a battery reading, so the ladder
  // is walked densely. Indexing by `seq` skipped entries — accessories and
  // units still in QC take no reading — and the skipped ones were exactly the
  // tired end of the ladder.
  let measured = 0;
  /** Walks `GRADE_LADDER`, counting only the units that actually get one. */
  let graded = 0;
  const addUnit = (
    skuId: string,
    status: UnitStatus,
    poId: string,
    daysAgo: number,
    desc: string,
  ) => {
    seq += 1;
    /*
     * `S` + twelve, which is the shape every serial in this app must now have
     * (owner correction 2026-09-01) — see `ORIGINAL_PATTERN`. The demo data
     * used to start `C02…` with no marker, and under the new rules not one of
     * those serials would have been accepted by the screen that created them.
     *
     * The two-letter tails avoid `I` and `O` on purpose: Apple prints neither,
     * so a scanner reading one is misreading a `1` or a `0`, and seeded data
     * that tripped that rule would be data the app refuses to re-scan.
     */
    const serial = `${SCAN_PREFIX}C02${String(7_400_000 + seq * 137).slice(0, 7)}${["JK", "LM", "QX", "PN"][seq % 4]}`;
    const sku = skus.find((s) => s.id === skuId)!;
    const buy = Math.round(sku.price * 0.82);
    const inStock = status !== "QC";
    const po = pos.find((p) => p.id === poId)!;
    const locationId = po.locationId;
    const rackId = inStock ? `${locationId}-rack-${(seq % 3) + 1}` : undefined;
    // Accessories have no battery, so they have no reading — the `undefined`
    // here is the case every battery column and filter has to survive.
    //
    // The Macs walk a fixed ladder rather than a modulo of `seq`. An arithmetic
    // spread looks like it covers the range and does not: with this few units
    // the earlier `100 - (seq * 37) % 35` landed on eight values and never once
    // hit the four-point-wide fair band, so the demo data hid a feature the app
    // has. The ladder visits every band on purpose, and stays deterministic so
    // a screenshot of this data is the same screenshot tomorrow.
    const isAccessory =
      models.find((m) => m.id === sku.modelId)?.category === "Accessory";
    const batteryHealth = isAccessory
      ? undefined
      : status === "QC"
        ? undefined
        : BATTERY_LADDER[measured++ % BATTERY_LADDER.length]!;
    units.push({
      serial,
      skuId,
      status,
      locationId,
      rackId,
      buy,
      description: inStock ? desc : "",
      poId,
      batteryHealth,
      // Recorded at QC, so a unit still IN QC has not got one yet — which is
      // the case the till's serial chooser and Inventory both have to render.
      // A ladder rather than a modulo, for the reason the battery one gives:
      // the point of demo data is that every branch of the screen has
      // something to draw. Weighted the way a second-hand shop's stock
      // actually is, mostly good with a few tired ones.
      ...(inStock
        ? { grade: GRADE_LADDER[graded++ % GRADE_LADDER.length]! }
        : {}),
    });
    po.items.push({ id: `poi-${seq}`, skuId, serial, qty: 1, unitCost: buy });
    let s = 0;
    const ev = (type: string, from: string, to: string, note?: string) =>
      events.push({
        id: `sev-${seq}-${++s}`,
        serial,
        seq: s,
        type,
        at: iso(daysAgo, 9 + s),
        fromStatus: from,
        toStatus: to,
        locationId,
        note,
        staff: "Michella",
      });
    ev("DITERIMA", "-", "QC", `Arrived on ${po.code}`);
    if (inStock) {
      ev("QC_SELESAI", "QC", "TERSEDIA", desc);
      stockIns.push({
        id: `si-${seq}`,
        serial,
        skuId,
        poId,
        locationId,
        rackId,
        decision: "ACCEPTED",
        buy,
        description: desc,
        batteryHealth,
        at: iso(daysAgo, 10),
        staff: "Michella",
      });
    }
    if (status === "TERJUAL") ev("TERJUAL", "TERSEDIA", "TERJUAL");
    if (status === "DIRESERVASI") ev("DIRESERVASI", "TERSEDIA", "DIRESERVASI");
    if (status === "RETUR_SUPPLIER") {
      ev("RETUR_SUPPLIER", "TERSEDIA", "RETUR_SUPPLIER", "Dead pixel cluster");
      stockIns.push({
        id: `si-${seq}-r`,
        serial,
        skuId,
        poId,
        locationId,
        decision: "REJECTED",
        rejectKind: "SUPPLIER",
        reason: "Rejected at QC",
        buy,
        at: iso(daysAgo, 11),
        staff: "Michella",
      });
    }
    return serial;
  };

  // PO-1 (older): fully QC'd; a mix of sold / reserved / available.
  const s1 = addUnit(
    "m-air-m2-v1",
    "TERSEDIA",
    "po-1",
    9,
    "Mulus 95%, battery 91%, fullset box",
  );
  addUnit(
    "m-air-m2-v2",
    "TERSEDIA",
    "po-1",
    9,
    "Mulus, battery 88%, unit only",
  );
  const s3 = addUnit(
    "m-pro14-m1-v2",
    "TERJUAL",
    "po-1",
    8,
    "Like new, battery 96%, fullset",
  );
  const s4 = addUnit(
    "m-pro14-m1-v1",
    "TERJUAL",
    "po-1",
    8,
    "Minor scratch lid, battery 93%",
  );
  const s5 = addUnit(
    "m-pro13-m1-v1",
    "DIRESERVASI",
    "po-1",
    7,
    "Mulus, battery 85%",
  );
  // Two more on hold, both for one customer (reservation rsv-2) — a batch is
  // the ordinary case, not the exotic one.
  const s6 = addUnit(
    "m-pro13-m1-v2",
    "DIRESERVASI",
    "po-1",
    7,
    "Dent kiri bawah, battery 90%",
  );
  const sHold2 = addUnit(
    "m-air-m2-v4",
    "DIRESERVASI",
    "po-1",
    7,
    "Mulus, battery 87%, fullset box",
  );
  const s7 = addUnit("m-air-m2-v3", "RETUR_SUPPLIER", "po-1", 6, "");
  // Accessories, all on PO-1 alongside the machines they get sold with. Some
  // already sold so "bought together" has history to read; the rest on the
  // shelf so there is something to recommend.
  const aMouseSold = addUnit(
    "m-magic-mouse-v1",
    "TERJUAL",
    "po-1",
    8,
    "Fullset box, like new",
  );
  addUnit(
    "m-magic-mouse-v2",
    "TERSEDIA",
    "po-1",
    5,
    "Fullset box, light scuff underside",
  );
  addUnit(
    "m-magic-keyboard-v2",
    "TERSEDIA",
    "po-1",
    5,
    "Touch ID, fullset box",
  );
  // Sold on Tokopedia — see order o-4, which is the seed's second marketplace.
  const aKeyboardSold = addUnit(
    "m-magic-keyboard-v1",
    "TERJUAL",
    "po-1",
    4,
    "Fullset box, keys clean",
  );
  const aHubSold = addUnit("m-usbc-hub-v1", "TERJUAL", "po-1", 6, "Sealed");
  addUnit("m-usbc-hub-v1", "TERSEDIA", "po-1", 3, "Sealed");
  const aSleeveSold = addUnit("m-sleeve-v1", "TERJUAL", "po-1", 6, "New");
  const sAirSold = addUnit(
    "m-air-m2-v2",
    "TERJUAL",
    "po-1",
    7,
    "Mulus, battery 92%, fullset",
  );
  addUnit("m-sleeve-v1", "TERSEDIA", "po-1", 3, "New");
  /*
   * The older Macs and the iPads, on the shelf (2026-08-26).
   *
   * Stock, not just catalogue rows: Inventory opens on "In stock" and hides a
   * product nothing is held of, so a model added without a unit behind it is
   * a model that appears to have failed to save. Spread across warehouses and
   * conditions so the filters have something to filter — a 4GB 2015 Air with a
   * tired battery is exactly the row the battery band exists to surface.
   */
  addUnit(
    "m-air-2015-v1",
    "TERSEDIA",
    "po-1",
    12,
    "Body mulus, engsel kencang, battery sudah lemah",
  );
  addUnit(
    "m-air-2015-v4",
    "TERSEDIA",
    "po-1",
    11,
    "Fullset dus, sedikit baret di palmrest",
  );
  addUnit(
    "m-air-2017-v2",
    "TERSEDIA",
    "po-1",
    10,
    "Mulus, keyboard responsif, unit only",
  );
  addUnit(
    "m-pro13-2015-v3",
    "TERSEDIA",
    "po-1",
    10,
    "Layar bersih, ada dent kecil di sudut kanan",
  );
  addUnit(
    "m-pro13-2015-v6",
    "TERSEDIA",
    "po-1",
    9,
    "Kondisi rapi, sudah ganti battery tahun lalu",
  );
  addUnit(
    "m-air-m1-v1",
    "TERSEDIA",
    "po-1",
    5,
    "Seperti baru, fullset dus dan charger asli",
  );
  addUnit(
    "m-air-m1-v3",
    "TERSEDIA",
    "po-1",
    5,
    "Mulus, pemakaian ringan, ada garansi toko",
  );
  addUnit(
    "m-ipad-9-v1",
    "TERSEDIA",
    "po-1",
    8,
    "Fullset dus, layar tanpa baret",
  );
  addUnit(
    "m-ipad-9-v4",
    "TERSEDIA",
    "po-1",
    8,
    "Cellular aktif, body ada baret halus di belakang",
  );
  addUnit(
    "m-ipad-air-4-v3",
    "TERSEDIA",
    "po-1",
    6,
    "Mulus, sudah pakai anti gores dari awal",
  );
  addUnit(
    "m-ipad-mini-6-v1",
    "TERSEDIA",
    "po-1",
    6,
    "Unit only, kondisi bagus",
  );
  // PO-2 and PO-3 (fresh): still waiting for QC, in two different warehouses,
  // which is what gives the Stock In page more than one accordion section.
  addUnit("m-ipad-pro11-m1-v3", "QC", "po-2", 1, "");
  addUnit("m-air-m2-v1", "QC", "po-2", 1, "");
  addUnit("m-air-m2-v4", "QC", "po-2", 1, "");
  addUnit("m-pro14-m1-v3", "QC", "po-2", 1, "");
  addUnit("m-pro13-m1-v3", "QC", "po-3", 1, "");
  addUnit("m-pro13-m1-v4", "QC", "po-3", 1, "");

  const referralSources: ReferralSource[] = [
    { id: "ref_instagram_ads", name: "Instagram Ads", active: true },
    { id: "ref_shopee_ads", name: "Shopee Ads", active: true },
    { id: "ref_facebook_ads", name: "Facebook Ads", active: true },
    { id: "ref_tiktok_ads", name: "TikTok Ads", active: true },
    { id: "ref_tokopedia_ads", name: "Tokopedia Ads", active: true },
    { id: "ref_friends", name: "Friends", active: true },
  ];
  const customers: Customer[] = [
    {
      id: "c-1",
      name: "Andi Wijaya",
      phone: "+62811223344",
      address: "Jl. Sudirman 12, Jakarta",
      referralSourceId: "ref_instagram_ads",
      createdAt: iso(30),
    },
    {
      id: "c-2",
      name: "Sari Puspita",
      phone: "+62812998877",
      referralSourceId: "ref_friends",
      createdAt: iso(20),
    },
    {
      id: "c-3",
      name: "Budi Santoso",
      phone: "+62813334455",
      address: "Jl. Diponegoro 8, Bandung",
      referralSourceId: "ref_shopee_ads",
      createdAt: iso(6),
    },
    {
      id: "c-4",
      name: "Rina Kartika",
      phone: "+62815667788",
      referralSourceId: "ref_tiktok_ads",
      createdAt: iso(3),
    },
  ];
  const skuOf = (serial: string) =>
    skus.find((k) => k.id === units.find((u) => u.serial === serial)!.skuId)!;
  const orders: Order[] = [
    {
      id: "o-1",
      code: "SI-2026/08-000201",
      ts: iso(5, 14),
      customerId: "c-1",
      // A machine and a mouse on one receipt: this is the row the add-on
      // recommender reads to learn that the two go together.
      serials: [s3, aMouseSold],
      prices: { [s3]: skuOf(s3).price, [aMouseSold]: skuOf(aMouseSold).price },
      discount: 300_000,
      discountId: "d-1",
      source: "OFFLINE",
      salesmanId: "sm-1",
      referralSourceId: "ref_instagram_ads",
      payMethod: "QRIS",
      settled: true,
      total: skuOf(s3).price + skuOf(aMouseSold).price - 300_000,
    },
    {
      id: "o-2",
      code: "SI-2026/08-000202",
      ts: iso(1, 13),
      customerId: "c-3",
      serials: [s4],
      prices: { [s4]: skuOf(s4).price - 200_000 },
      discount: 0,
      source: "SHOPEE",
      salesmanId: "sm-2",
      referralSourceId: "ref_shopee_ads",
      shippingAddress: "Jl. Diponegoro 8, Bandung",
      payMethod: "Shopee (escrow)",
      settled: false,
      total: skuOf(s4).price - 200_000,
    },
    {
      id: "o-3",
      code: "SI-2026/08-000203",
      ts: iso(4, 11),
      customerId: "c-4",
      serials: [sAirSold, aSleeveSold, aHubSold],
      prices: {
        [sAirSold]: skuOf(sAirSold).price,
        [aSleeveSold]: skuOf(aSleeveSold).price,
        [aHubSold]: skuOf(aHubSold).price,
      },
      discount: 0,
      source: "INSTAGRAM",
      salesmanId: "sm-3",
      referralSourceId: "ref_tiktok_ads",
      payMethod: "Transfer",
      settled: true,
      total:
        skuOf(sAirSold).price +
        skuOf(aSleeveSold).price +
        skuOf(aHubSold).price,
    },
    {
      // Tokopedia settles exactly as Shopee does (owner decision 2026-08-26),
      // and this row is here so the pending-by-channel breakdown on Income &
      // Expense has a second channel to break down. A list that only ever
      // shows one heading is a list nobody notices is grouped.
      id: "o-4",
      code: "SI-2026/08-000204",
      ts: iso(2, 16),
      customerId: "c-2",
      serials: [aKeyboardSold],
      prices: { [aKeyboardSold]: skuOf(aKeyboardSold).price },
      discount: 0,
      source: "TOKOPEDIA",
      salesmanId: "sm-1",
      referralSourceId: "ref_tokopedia_ads",
      shippingAddress: "Jl. Kebon Jeruk 12, Jakarta",
      payMethod: "Tokopedia (escrow)",
      settled: false,
      total: skuOf(aKeyboardSold).price,
    },
  ];
  const returns: ReturnRec[] = [
    {
      id: "r-1",
      code: "SP-2026/08-000007",
      kind: "SUPPLIER",
      serial: s7,
      reason: "Rejected at QC",
      date: iso(6).slice(0, 10),
      status: "DONE",
      fromQc: true,
      supplierId: "sup-1",
      expectedCredit: Math.round(skuOf(s7).price * 0.82),
    },
  ];
  const reservations: Reservation[] = [
    {
      id: "rsv-1",
      code: "RV-2026/08-000001",
      customerId: "c-2",
      when: iso(-1, 15),
      note: "Will pick up after payday — wants the charger checked before collection.",
      sourceId: "rsv-src-wa",
      items: [{ id: "rsvi-1", serial: s5 }],
      status: "ACTIVE",
    },
    {
      // Two machines held for one customer in one conversation — the shape the
      // flat one-row-per-serial model could not express, and the reason the
      // page groups by customer now.
      id: "rsv-2",
      code: "RV-2026/08-000002",
      customerId: "c-1",
      when: iso(-2, 11),
      note: "Buying for the office. Wants both invoiced together, collecting Saturday.",
      sourceId: "rsv-src-ig",
      items: [
        { id: "rsvi-2", serial: s6 },
        { id: "rsvi-3", serial: sHold2 },
      ],
      status: "ACTIVE",
    },
  ];
  const discounts: Discount[] = [
    {
      id: "d-1",
      code: "MERDEKA10",
      name: "Merdeka 10%",
      type: "PCT",
      pct: 10,
      maxRp: 500_000,
      usageLimit: 50,
      used: 12,
      fromDate: iso(14).slice(0, 10),
      toDate: iso(-16).slice(0, 10),
      active: true,
      scope: "All products",
    },
    {
      id: "d-2",
      code: "AIRHEMAT",
      name: "Rp300k off MacBook Air",
      type: "NOMINAL",
      amountRp: 300_000,
      usageLimit: 20,
      used: 3,
      fromDate: iso(7).slice(0, 10),
      toDate: iso(-23).slice(0, 10),
      active: true,
      scope: "MacBook Air",
    },
    {
      id: "d-3",
      code: "GEARUP2",
      name: "Any 2 accessories for Rp1.000.000",
      type: "BUNDLE",
      bundleQty: 2,
      bundlePriceRp: 1_000_000,
      used: 0,
      fromDate: iso(7).slice(0, 10),
      toDate: iso(-53).slice(0, 10),
      active: true,
      scope: "Accessory",
    },
  ];
  /**
   * Two hand-entered incomes, so the adjustment history and the balance are
   * not empty on a cold boot. One of each reason, because the pair is the
   * point: a transfer raises the balance without being revenue.
   */
  const incomes: ManualIncome[] = [
    {
      id: "mi-1",
      reason: "SALES",
      amount: 4_250_000,
      date: iso(6).slice(0, 10),
      note: "Walk-in paid cash while the till was down",
    },
    {
      id: "mi-2",
      reason: "TRANSFER",
      amount: 15_000_000,
      date: iso(11).slice(0, 10),
      note: "Topped up the shop float from the owner's account",
    },
  ];

  const expenses: Expense[] = [
    {
      id: "e-1",
      label: "Store rent August",
      kind: "RENT",
      amount: 7_500_000,
      date: iso(14).slice(0, 10),
    },
    {
      id: "e-2",
      label: "Cleaning kit + thermal paste",
      kind: "OPERATIONAL",
      amount: 240_000,
      date: iso(0).slice(0, 10),
    },
    {
      id: "e-3",
      label: "Instagram ads — August push",
      kind: "MARKETING",
      amount: 2_400_000,
      date: iso(12).slice(0, 10),
      referralSourceId: "ref_instagram_ads",
    },
    {
      id: "e-4",
      label: "Shopee ads credit",
      kind: "MARKETING",
      amount: 1_100_000,
      date: iso(10).slice(0, 10),
      referralSourceId: "ref_shopee_ads",
    },
    {
      id: "e-5",
      label: "TikTok ads trial",
      kind: "MARKETING",
      amount: 900_000,
      date: iso(4).slice(0, 10),
      referralSourceId: "ref_tiktok_ads",
    },
    {
      id: "e-6",
      label: "Staff salaries August",
      kind: "PAYROLL",
      amount: 12_000_000,
      date: iso(8).slice(0, 10),
    },
    {
      id: "e-7",
      label: "Accountant retainer",
      kind: "PROFESSIONAL",
      amount: 1_500_000,
      date: iso(7).slice(0, 10),
    },
    {
      id: "e-8",
      label: "Cloud hosting + POS licence",
      kind: "SOFTWARE",
      amount: 650_000,
      date: iso(2).slice(0, 10),
    },
  ];
  const chats: ChatThread[] = [
    {
      phone: "+62811223344",
      name: "Andi Wijaya",
      channel: "WHATSAPP",
      needsReply: true,
      summary:
        "Asking warranty status for MacBook Pro 14 bought last week; agent answered specs, needs staff for warranty claim detail.",
      messages: [
        {
          id: "wm1",
          dir: "IN",
          text: "Halo, MacBook Pro 14 kemarin kok kadang restart sendiri ya?",
          at: iso(0, 9),
        },
        {
          id: "wm2",
          dir: "AGENT",
          text: "Halo kak Andi! Maaf atas kendalanya. Boleh diinfokan kapan terakhir terjadi restart?",
          at: iso(0, 9.1),
        },
        {
          id: "wm3",
          dir: "IN",
          text: "Tadi pagi 2x. Masih garansi kan?",
          at: iso(0, 9.5),
        },
      ],
    },
    {
      phone: "+62899887766",
      name: "Prospek (unknown)",
      channel: "WHATSAPP",
      needsReply: false,
      summary:
        "Price inquiry for Air M2 16/512 — agent quoted and offered COD.",
      messages: [
        {
          id: "wm4",
          dir: "IN",
          text: "Air M2 16/512 ready? Berapa?",
          at: iso(1, 19),
        },
        {
          id: "wm5",
          dir: "AGENT",
          text: "Ready kak! Rp15.500.000, battery 88%, fullset. Bisa COD area Jakarta.",
          at: iso(1, 19.1),
        },
      ],
    },
  ];
  const knowledge: Knowledge[] = [
    {
      id: "k-1",
      question: "Do you accept trade-in?",
      answer:
        "Yes — bring the unit to the store for a quick check; the agreed value is cut from the new unit's price.",
      active: true,
      updatedAt: iso(10),
    },
    {
      id: "k-2",
      question: "What warranty do you give?",
      answer:
        "90-day store warranty on every unit, covering hardware faults not caused by damage.",
      active: true,
      updatedAt: iso(10),
    },
  ];
  const personas: Persona[] = [
    {
      id: "persona-admin",
      name: "Friendly shop admin",
      blurb: "Casual Indonesian, short messages, asks one question at a time.",
      builtIn: true,
      prompt: [
        "You are the shop admin at a second-hand Apple store in Indonesia, chatting on WhatsApp.",
        "Write casual Indonesian, the way a real person types on a phone.",
        "Keep it to one or two sentences. Ask at most one question per message.",
        "Never use bold, bullets, headings, or the characters — ; ! ( ).",
        "Get to know what the customer needs before recommending anything.",
      ].join("\n"),
    },
    {
      id: "persona-tech",
      name: "Straight-talking technician",
      blurb: "Answers specs and condition plainly, no small talk.",
      builtIn: true,
      prompt: [
        "You are a technician at a second-hand Apple store in Indonesia answering customer chats.",
        "Answer the question asked, plainly, in Indonesian. No small talk, no upselling.",
        "State battery health, condition and completeness whenever you name a unit.",
        "Keep it to two sentences.",
      ].join("\n"),
    },
    {
      id: "persona-english",
      name: "English concierge",
      blurb: "Polite English for expat and overseas buyers.",
      builtIn: true,
      prompt: [
        "You are a sales assistant at a second-hand Apple store in Indonesia.",
        "Reply in clear, polite English for an international customer.",
        "Two sentences maximum. Always state price in rupiah and the unit's condition.",
      ].join("\n"),
    },
  ];
  const corrections: Correction[] = [
    {
      id: "corr-1",
      threadPhone: "+62899887766",
      messageId: "wm5",
      original:
        "Ready kak! Rp15.500.000, battery 88%, fullset. Bisa COD area Jakarta.",
      corrected:
        "Ready kakk, harganya 15.500.000, batterynya 88 persen dan fullset. COD Jakarta bisa yaa",
      note: "No exclamation marks, and write the price as a plain number.",
      at: iso(1, 20),
      staff: "Michella",
    },
  ];
  const adjustments: Adjustment[] = [
    {
      id: "adj-1",
      serial: s1,
      description: "Mulus 95%, battery 91%, fullset box",
      reasonId: "rsn-adj-internal",
      at: iso(2, 11),
      staff: "Michella",
      kind: "OUT",
      batchId: "adjb-1",
    },
  ];
  const opnames: OpnameRec[] = [
    {
      id: "op-1",
      code: "SO-2026/08-000001",
      label: "Rak A–C, shift pagi",
      locationIds: ["wh-1"],
      rackIds: [],
      categories: [],
      conditions: [],
      date: iso(3, 18).slice(0, 10),
      at: iso(3, 18),
      counted: [s1],
      missing: [],
      unknown: [],
      notes: {},
      surplus: {},
      status: "POSTED",
    },
  ];

  return {
    settings: {
      batteryGoodMin: 80,
      batteryFairMin: 76,
      shopName: "NUSANTARA",
      shopTagline: "Second-hand Apple — sales, trade-in and service",
      shopAddress: "Jakarta, Indonesia",
      shopContact: "WhatsApp +62 811 2233 44 · @nusantara",
    },
    paymentMethods: [
      {
        id: "pm_tunai",
        code: "TUNAI",
        label: "Cash",
        builtIn: true,
        forPo: true,
        forSale: true,
        active: true,
      },
      {
        id: "pm_kartu_kredit",
        code: "KARTU_KREDIT",
        label: "Credit card",
        builtIn: true,
        forPo: true,
        forSale: true,
        active: true,
      },
      {
        id: "pm_deposit",
        code: "DEPOSIT",
        label: "Deposit",
        builtIn: true,
        forPo: true,
        forSale: false,
        active: true,
      },
      {
        id: "pm_qris",
        code: "QRIS",
        label: "QRIS",
        builtIn: true,
        forPo: false,
        forSale: true,
        active: true,
      },
      {
        id: "pm_transfer",
        code: "TRANSFER",
        label: "Bank transfer",
        builtIn: true,
        forPo: false,
        forSale: true,
        active: true,
      },
      {
        id: "pm_marketplace",
        code: "MARKETPLACE",
        label: "Marketplace escrow",
        builtIn: true,
        forPo: false,
        forSale: true,
        active: true,
      },
    ],
    warehouses,
    racks,
    suppliers,
    reasons,
    qcDescriptions,
    gradingCriteria,
    gradingRules,
    reservationSources,
    salesmen,
    models,
    appleDbHidden: [],
    skus,
    units,
    events,
    // Nothing seeded: a photograph is something a person took, and inventing
    // one would put a picture of nothing beside a real serial.
    unitNotes: [],
    pos,
    stockIns,
    customers,
    orders,
    returns,
    reservations,
    discounts,
    expenses,
    incomes,
    chats,
    knowledge,
    corrections,
    personas,
    activePersonaId: "persona-admin",
    adjustments,
    opnames,
    referralSources,
    myWarehouseId: "wh-1",
  };
}
