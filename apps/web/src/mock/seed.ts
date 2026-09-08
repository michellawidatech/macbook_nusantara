/**
 * The demo shop, as the browser sees it.
 *
 * The shop ITSELF lives in `@nusantara/fixture` — locations, the catalogue,
 * the invoices, the machines, the ledger, the sales and the holds — because
 * `packages/db`'s seed writes the same rows into Postgres and the two must be
 * the same shop. Before 2026-09-07 they were not, and that is exactly what the
 * bug looked like from the outside: Inventory reads this store, S/N Tracking
 * reads the API, and neither had heard of the other's serials.
 *
 * What is still written out here is everything Postgres has no table for —
 * grading rules, the chatbot inbox, expenses, stock opname, the AppleDB import
 * list, adjustment reasons. Each of those is marked ⚠️ mock-only where it is
 * declared, and each is a schema gap CLAUDE.md already names.
 *
 * All money = whole rupiah numbers.
 */
import {
  REFERRAL_SOURCES,
  STOCK_TAKE_AT,
  buildShop,
  docCode,
  isoOf,
} from "@nusantara/fixture";
import { holdsFunds, marketplacePayMethod } from "../lib/channels.js";
import type { SaleSource } from "../lib/channels.js";
import type { GradingCriterion, GradingRule } from "../lib/grading.js";
import type { UnitCondition } from "../lib/condition.js";

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

const iso = (daysAgo: number, h = 10) =>
  new Date(
    Date.now() - daysAgo * 86_400_000 + h * 3_600_000 - 10 * 3_600_000,
  ).toISOString();

export function buildSeed(): MockDb {
  /*
   * Everything below comes from `@nusantara/fixture`, which is the shop
   * itself — the same rows `packages/db`'s seed writes into Postgres.
   *
   * It used to be written out here, and Postgres generated its own. That is
   * why the deployed app disagreed with itself: 26 of the 31 screens read this
   * store and three read the API, so Inventory listed serials S/N Tracking had
   * never heard of. One definition, two projections, and the two agree by
   * construction rather than by two people remembering to.
   *
   * What stays hand-written in this file is everything the fixture cannot
   * carry, because the schema has no table for it: grading rules, the chat
   * inbox, expenses, opname sessions, the AppleDB import list. Those are
   * marked ⚠️ mock-only where they are declared.
   */
  const shop = buildShop();
  const warehouses: Warehouse[] = shop.locations.map((l) => ({
    id: l.id,
    name: l.name,
    active: true,
  }));
  const racks: RackLocation[] = shop.racks.map((r) => ({
    id: r.id,
    warehouseId: r.locationId,
    name: r.name,
    active: true,
  }));
  const suppliers: Supplier[] = shop.suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    ...(s.phone === undefined ? {} : { phone: s.phone }),
    ...(s.address === undefined ? {} : { address: s.address }),
    ...(s.code === undefined ? {} : { code: s.code }),
  }));
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
      // What a posted stock take writes its shortfall out under. The seeded
      // count uses it, which is also the only way a managed list demonstrates
      // the usage counter Settings shows beside each reason.
      id: "rsn-adj-opname",
      activity: "ADJUSTMENT",
      label: "Selisih Stock Opname",
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
  // The shop's three people. One list with `staff` in the fixture, because
  // `Staff` in prisma is a LOGIN and this is who gets credited on a sale —
  // two lists for the same three humans is how a timeline ends up attributing
  // a sale to "Kasir Toko" while the commission report credits Dimas Pratama.
  const salesmen: Salesman[] = shop.staff.map((s) => ({
    id: s.salesmanId,
    name: s.name,
    active: true,
  }));
  const models: CatalogModel[] = shop.models.map((m) => ({
    id: m.id,
    name: m.name,
    category: shop.categories.find((c) => c.id === m.categoryId)!.name,
    releaseYear: m.releaseYear,
    ...(m.line === undefined ? {} : { line: m.line }),
    ...(m.sizeInch === undefined ? {} : { sizeInch: m.sizeInch }),
    source: "MANUAL",
    axes: m.axes.map((a) => ({ name: a.name, values: [...a.values] })),
  }));
  const skus: Sku[] = shop.skus.map((s) => ({
    id: s.id,
    modelId: s.modelId,
    code: s.code,
    name: s.name,
    variantLabel: s.variantLabel,
    axisValues: { ...s.axisValues },
    price: s.price,
  }));

  const PO_PAYMENT_TARGET: Record<string, PoPaymentFor> = {
    BARANG: "ORDER",
    ONGKIR: "SHIPPING",
    PAJAK: "TAX",
  };
  const pos: Po[] = shop.purchaseOrders.map((p) => ({
    id: p.id,
    code: p.code,
    supplierId: p.supplierId,
    invoice: p.invoice,
    date: isoOf(p.ordered, shop.now).slice(0, 10),
    locationId: p.locationId,
    // Filled in below, as the machines are read off the fixture — the same
    // order the shop itself learns them in.
    items: [],
    payments: p.payments.map((pay) => ({
      id: pay.id,
      method: pay.method,
      amount: pay.rupiah,
      at: isoOf(pay.at, shop.now),
      appliedTo: PO_PAYMENT_TARGET[pay.appliedTo]!,
    })),
    shippingFee: p.shippingFee,
    taxFee: p.taxFee,
    // No PO-level discount in the fixture: `PurchaseOrder` in prisma has no
    // column for one, so a number here would be money only the browser knows
    // about. See the fixture's own note.
    discount: 0,
    status: p.status === "DIPESAN" ? "ORDERED" : "RECEIVED",
    ...(p.closed === undefined
      ? {}
      : { closedAt: isoOf(p.closed, shop.now) }),
  }));

  /*
   * The machines, their PO lines, their ledgers and their QC decisions — all
   * read off the fixture rather than minted here.
   *
   * The grade, the battery reading and the description are ONE description of
   * one machine and they agree with each other. They used to come from three
   * independent sources: a description typed into this file, a grade off a
   * rotating ladder and a battery figure off another, so a unit could read
   * "battery 91%" beside a stored 98 and be graded A while described as worn.
   * Every screen that shows two of the three showed a contradiction.
   */
  const units: Unit[] = shop.units.map((u) => ({
    serial: u.serial,
    skuId: u.skuId,
    status: u.status as UnitStatus,
    locationId: u.locationId,
    ...(u.rackId === undefined ? {} : { rackId: u.rackId }),
    buy: u.buy,
    description: u.description,
    poId: u.poId,
    ...(u.grade === undefined ? {} : { grade: u.grade }),
    ...(u.battery === undefined ? {} : { batteryHealth: u.battery }),
  }));
  /*
   * The document each event belongs to, as its CODE.
   *
   * `refCode` rather than three nullable id columns, because a code is unique
   * across every document the shop numbers — SI, RV, PI, SP — and because it
   * is what every screen that appends an event already passes. S/N Tracking
   * resolves an event's context through it, so a machine held, released and
   * held again by a different customer narrates the right person on both: the
   * hold is named by the event rather than guessed at by searching for a
   * reservation that mentions the serial.
   */
  const docCodeOf = (e: (typeof shop.events)[number]): string | undefined => {
    if (e.orderId !== undefined) {
      return shop.orders.find((o) => o.id === e.orderId)?.code;
    }
    if (e.reservationId !== undefined) {
      return shop.reservations.find((r) => r.id === e.reservationId)?.code;
    }
    if (e.type === "RETUR_SUPPLIER") {
      const ret = shop.supplierReturns.find((r) => r.serial === e.serial);
      if (ret !== undefined) return ret.code;
    }
    if (e.purchaseOrderId !== undefined) {
      return shop.purchaseOrders.find((p) => p.id === e.purchaseOrderId)?.code;
    }
    return undefined;
  };
  const events: UnitEvent[] = shop.events.map((e, i) => {
    const refCode = docCodeOf(e);
    return {
      id: `sev-${i + 1}`,
      serial: e.serial,
      seq: e.seq,
      type: e.type,
      at: isoOf(e.at, shop.now),
      fromStatus: e.fromStatus ?? "-",
      toStatus: e.toStatus,
      locationId: e.toLocationId,
      ...(e.note === undefined ? {} : { note: e.note }),
      ...(refCode === undefined ? {} : { refCode }),
      staff: shop.staff.find((s) => s.id === e.staffId)?.name ?? "Michella",
    };
  });
  for (const po of pos) {
    const built = shop.purchaseOrders.find((p) => p.id === po.id)!;
    po.items = built.lines.map((l) => ({
      id: l.id,
      skuId: l.skuId,
      serial: l.serials[0] ?? null,
      qty: l.qty,
      unitCost: l.unitCost,
      ...(l.notReceived ? { notReceived: true } : {}),
    }));
  }
  /*
   * The QC decision behind every machine that has one.
   *
   * Derived from the ledger rather than written beside it: a `QC_SELESAI` is
   * an acceptance and a `RETUR_SUPPLIER` raised from QC is a rejection, and
   * those events are the record. Writing this list by hand was how the old
   * seed ended up with stock-in rows for machines whose timeline said
   * something else.
   */
  const stockIns: StockInRec[] = shop.units.flatMap((u): StockInRec[] => {
    const mine = shop.events.filter((e) => e.serial === u.serial);
    const accepted = mine.find((e) => e.type === "QC_SELESAI");
    const rejected = mine.find((e) => e.type === "RETUR_SUPPLIER");
    const staff = (id: string) =>
      shop.staff.find((s) => s.id === id)?.name ?? "Michella";
    if (accepted !== undefined) {
      return [
        {
          id: `si-${u.ref}`,
          serial: u.serial,
          skuId: u.skuId,
          poId: u.poId,
          locationId: u.locationId,
          ...(u.rackId === undefined ? {} : { rackId: u.rackId }),
          decision: "ACCEPTED" as const,
          buy: u.buy,
          description: u.description,
          ...(u.battery === undefined ? {} : { batteryHealth: u.battery }),
          at: isoOf(accepted.at, shop.now),
          staff: staff(accepted.staffId),
        },
      ];
    }
    if (rejected !== undefined) {
      return [
        {
          id: `si-${u.ref}`,
          serial: u.serial,
          skuId: u.skuId,
          poId: u.poId,
          locationId: u.locationId,
          decision: "REJECTED" as const,
          rejectKind: "SUPPLIER" as const,
          reason: u.description,
          buy: u.buy,
          at: isoOf(rejected.at, shop.now),
          staff: staff(rejected.staffId),
        },
      ];
    }
    return [];
  });

  const referralSources: ReferralSource[] = REFERRAL_SOURCES.map((r) => ({
    id: r.id,
    name: r.name,
    active: true,
  }));
  const customers: Customer[] = shop.customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    ...(c.address === undefined
      ? {}
      : {
          address: c.address,
          addresses: [{ id: `${c.id}-addr-1`, label: "Rumah", line: c.address }],
        }),
    referralSourceId: c.referralSourceId,
    createdAt: isoOf(c.since, shop.now),
  }));
  /**
   * What the shop accepts, matching `PaymentMethod` in the schema by `code`.
   *
   * Hoisted out of the returned object so a seeded sale can quote a LABEL —
   * an invoice printing "MARKETPLACE" where it should read "Shopee (escrow)"
   * is the till's own vocabulary leaking out of the database's.
   */
  const paymentMethods: PaymentMethodRec[] = [
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
  ];
  const payLabel = (code: string) =>
    paymentMethods.find((m) => m.code === code)?.label ?? code;

  const orders: Order[] = shop.orders.map((o) => ({
    id: o.id,
    code: o.code,
    ts: isoOf(o.at, shop.now),
    customerId: o.customerId,
    serials: o.builtLines.map((l) => l.serial),
    prices: Object.fromEntries(o.builtLines.map((l) => [l.serial, l.price])),
    // The snapshot the salesperson's report reads: what the shop was asking on
    // the day, so a repricing later cannot invent a bargain that never was.
    listPrices: Object.fromEntries(
      o.builtLines.map((l) => [l.serial, l.listPrice]),
    ),
    discount: o.discount,
    ...(o.discountId === undefined ? {} : { discountId: o.discountId }),
    source: o.channel as SaleSource,
    salesmanId: o.salesmanId,
    referralSourceId: o.referralSourceId,
    ...(o.shippingAddress === undefined
      ? {}
      : { shippingAddress: o.shippingAddress }),
    // The till writes a human label here, not a `PaymentMethod` code, and a
    // marketplace writes its own escrow wording — so the seed does too.
    payMethod: holdsFunds(o.channel as SaleSource)
      ? marketplacePayMethod(o.channel)
      : payLabel(o.payMethod),
    settled: o.settled,
    ...(o.extra === undefined
      ? {}
      : {
          extra: o.extra,
          extraNote: o.extraNote ?? "Delivery",
          fees: [
            { id: `${o.id}-fee-1`, label: o.extraNote ?? "Delivery", amount: o.extra },
          ],
        }),
    total: o.total,
  }));
  /*
   * What came back, and from whom.
   *
   * Both kinds, because they are genuinely different jobs: a supplier return
   * is a machine that failed QC and never reached the shelf, and a customer
   * return is one that did, went out, and came back to be graded again.
   */
  const returns: ReturnRec[] = [
    ...shop.supplierReturns.map((r) => ({
      id: r.id,
      code: r.code,
      kind: "SUPPLIER" as const,
      serial: r.serial,
      reason: r.reason,
      date: isoOf(r.at, shop.now).slice(0, 10),
      status: "DONE" as const,
      fromQc: true,
      supplierId: r.supplierId,
      expectedCredit: r.amount,
    })),
    ...shop.orders
      .filter((o) => o.returnedAt !== undefined)
      .map((o, i) => ({
        id: `ret-c-${i + 1}`,
        code: docCode("SR", o.returnedAt!, 3 + i, shop.now),
        kind: "CUSTOMER" as const,
        serial: o.builtLines[0]!.serial,
        reason: o.returnReason ?? "Retur pelanggan",
        date: isoOf(o.returnedAt!, shop.now).slice(0, 10),
        status: "DONE" as const,
      })),
  ];
  const reservations: Reservation[] = shop.reservations.map((r) => ({
    id: r.id,
    code: r.code,
    customerId: r.customerId,
    when: isoOf(r.scheduledFor, shop.now),
    note: r.note,
    sourceId: r.sourceId,
    items: r.serials.map((serial, i) => ({
      id: `${r.id}-item-${i + 1}`,
      serial,
    })),
    status: "ACTIVE" as const,
  }));
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
  /*
   * The one stock movement in this shop with no document behind it.
   *
   * Everything else that moved a machine has a purchase order, a receipt, a
   * hold or a supplier return to point at — which is the shape a shop's ledger
   * should have. What is left is the write-out after a stock take found a
   * machine missing, and that is genuinely an adjustment: nothing sold it and
   * nobody returned it, it simply was not on the rack. The opname below is the
   * same count, so the two agree about which machine and when.
   */
  const missingSerial = shop.serialOfRef.get("ipad9-missing")!;
  const adjustments: Adjustment[] = [
    {
      id: "adj-1",
      serial: missingSerial,
      description: "Lecet halus, Unit only",
      reasonId: "rsn-adj-opname",
      at: isoOf(STOCK_TAKE_AT, shop.now),
      staff: "Michella",
      kind: "OUT",
      batchId: "adjb-1",
    },
  ];
  /*
   * The count that lost the iPad.
   *
   * Scoped to the Serpong warehouse, so what it EXPECTED to find is every
   * machine shelved there — and `counted` is exactly that list minus the one
   * that was not on the rack. A posted count whose counted list was one
   * hand-picked serial could not demonstrate the thing the screen exists for,
   * which is the difference between what the shelves hold and what the
   * database thinks they hold.
   */
  const opnameScope = shop.units.filter(
    (u) => u.locationId === "wh-2" && u.rackId !== undefined,
  );
  const opnames: OpnameRec[] = [
    {
      id: "op-1",
      code: docCode("SO", STOCK_TAKE_AT, 1, shop.now),
      label: "Gudang Serpong, shift pagi",
      locationIds: ["wh-2"],
      rackIds: [],
      categories: [],
      conditions: [],
      date: isoOf(STOCK_TAKE_AT, shop.now).slice(0, 10),
      at: isoOf(STOCK_TAKE_AT, shop.now),
      counted: opnameScope.map((u) => u.serial),
      missing: [missingSerial],
      unknown: [],
      notes: { [missingSerial]: "Tidak ada di rak, sudah dicari dua kali." },
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
      shopAddress: "Jl. Boulevard Raya Blok C2, Jakarta Utara",
      shopContact: "WhatsApp +62 811 2233 44 · @nusantara",
    },
    paymentMethods,
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
