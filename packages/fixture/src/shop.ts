/**
 * The demo shop — one coherent trading history, defined once.
 *
 * `apps/web/src/mock/seed.ts` renders it in the browser and
 * `packages/db/src/seed.ts` writes it into Postgres. Before 2026-09-07 those
 * two invented their own data, which is why the deployed app disagreed with
 * itself: Inventory listed `SC02…` serials out of the browser mock while S/N
 * Tracking asked the API and got `NUS0000001`, a serial the app's own
 * `validateSerial` would refuse. Two shops, one screen each.
 *
 * ## What "logical" means here, concretely
 *
 * Every one of these is a rule the old data broke, and each is worth keeping:
 *
 * - **A serial is a serial.** Every one below is Apple's barcode — `S` plus
 *   ten to twelve, no `I`, no `O` — so it can be scanned, printed on a label
 *   and scanned back. (A sealed unit taken in since 2026-09-21 is filed
 *   WITHOUT the `S`; these are the 2026-09-01 era's form, and every search box
 *   finds a unit by either — `resolveSerialQuery`.)
 * - **A description is a list of phrases from the QC vocabulary**, comma
 *   joined, exactly as CLAUDE.md's 2026-08-27 revision says. The old fixture
 *   wrote free sentences that no suggestion list contained.
 * - **The description and the numbers agree.** A machine described
 *   "Baterai lemah" carries a battery reading in the poor band; one described
 *   "Mulus" is graded A. The old fixture drew grade and battery from two
 *   unrelated ladders, so a unit could read "battery 91%" beside a stored 98.
 * - **Nothing exists before it arrived.** Every unit hangs off a purchase
 *   order line, is received onto that order's location, and gets graded after
 *   it was received rather than before.
 * - **Every sold serial is on exactly one order, every held serial on exactly
 *   one hold**, and the ledger says so in that order.
 * - **The money adds up.** An order's subtotal is its lines, its total is
 *   subtotal − discount + extra, and a settled order's payments equal its
 *   total. `Order_total_arithmetic_check` enforces the second in Postgres; the
 *   fixture has to satisfy it to be insertable at all.
 *
 * ## Time
 *
 * Dates are offsets from "now", not literals, so the shop is always a shop
 * that traded this week. Both seeds resolve them against their own clock with
 * `dateOf`, which is what keeps the two projections aligned to the minute.
 */
import {
  CATEGORIES,
  MODELS,
  SKUS,
  isAccessory,
  modelOf,
  skuOf,
  type FixtureCategory,
  type FixtureModel,
  type FixtureSku,
} from "./catalogue.js";

export {
  CATEGORIES,
  MODELS,
  SKUS,
  CATEGORY_ID,
  COST_RATIO,
  costOf,
  isAccessory,
  modelOf,
  skuOf,
} from "./catalogue.js";
export type {
  FixtureAxis,
  FixtureCategory,
  FixtureModel,
  FixtureSku,
} from "./catalogue.js";

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** A moment, as the fixture states it: so many days back, at this hour. */
export interface FixtureMoment {
  readonly daysAgo: number;
  /** Local hour, 0–23. Negative `daysAgo` is the future — a scheduled hold. */
  readonly hour: number;
}

export const at = (daysAgo: number, hour = 10): FixtureMoment => ({
  daysAgo,
  hour,
});

/**
 * Milliseconds from "now" to this moment.
 *
 * Hour 10 is the anchor rather than midnight, so `at(0, 10)` is now and a
 * day's events spread either side of it instead of all landing before
 * breakfast.
 */
export const offsetMs = (m: FixtureMoment): number =>
  -m.daysAgo * 86_400_000 + (m.hour - 10) * 3_600_000;

export const dateOf = (m: FixtureMoment, now = Date.now()): Date =>
  new Date(now + offsetMs(m));

export const isoOf = (m: FixtureMoment, now = Date.now()): string =>
  dateOf(m, now).toISOString();

/**
 * A document number, in the shop's own format — `PI-2026/09-000041`.
 *
 * Derived from the document's own date rather than hard-coded, because the
 * fixture's dates move with the clock and a purchase order dated last month
 * carrying this month's number is the kind of small lie that makes a demo
 * unusable for checking a report. Mirrors `next_doc_code` in migration
 * 20260815060658; the seeded numbers start above 40 so the live sequence, which
 * restarts at one every month, cannot collide with them. The two holds were
 * numbered 1 and 2 until 2026-09-18, so the month's first real booking took
 * the demo's number and failed; `test/shop.test.ts` now checks every one.
 */
export function docCode(
  prefix: string,
  m: FixtureMoment,
  n: number,
  now = Date.now(),
): string {
  const d = dateOf(m, now);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}/${month}-${String(n).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Where the shop keeps things, and who works there
// ---------------------------------------------------------------------------

export interface FixtureLocation {
  readonly id: string;
  /** `Location.code` in the schema — unique, and what a transfer prints. */
  readonly code: string;
  readonly name: string;
  readonly kind: "TOKO" | "GUDANG" | "SERVIS" | "TRANSIT";
  readonly address?: string;
  readonly sortOrder: number;
}

/**
 * Two rooms the shop actually uses and two it grew into.
 *
 * The ids stay `wh-1`…`wh-4` because the opname scope tests name them and
 * because a warehouse id is printed on nothing — the NAMES are what changed,
 * from "Warehouse 1" to a place a person could walk to. The codes are the
 * two-digit numbers the real shop has used for six years (01–04 in B2Soft),
 * printed beside the name on every screen since 2026-10-08.
 */
export const LOCATIONS: readonly FixtureLocation[] = [
  {
    id: "wh-1",
    code: "01",
    name: "Toko Kelapa Gading",
    kind: "TOKO",
    address: "Jl. Boulevard Raya Blok C2, Jakarta Utara",
    sortOrder: 1,
  },
  {
    id: "wh-2",
    code: "02",
    name: "Gudang Serpong",
    kind: "GUDANG",
    address: "Jl. Raya Serpong KM 8, Tangerang Selatan",
    sortOrder: 2,
  },
  {
    id: "wh-3",
    code: "03",
    name: "Gudang Bandung",
    kind: "GUDANG",
    address: "Jl. Soekarno Hatta 210, Bandung",
    sortOrder: 3,
  },
  {
    id: "wh-4",
    code: "04",
    name: "Meja Servis",
    kind: "SERVIS",
    sortOrder: 4,
  },
];

export interface FixtureRack {
  readonly id: string;
  readonly locationId: string;
  readonly name: string;
}

/** ⚠️ Mock-only: prisma has no Rack model. See CLAUDE.md's schema gaps. */
export const RACKS: readonly FixtureRack[] = LOCATIONS.flatMap((l) =>
  ["Rack 1", "Rack 2", "Rack 3"].map((name, i) => ({
    id: `${l.id}-rack-${i + 1}`,
    locationId: l.id,
    name,
  })),
);

export interface FixtureSupplier {
  readonly id: string;
  readonly name: string;
  /** ⚠️ Schema gap: `Supplier.code` does not exist in prisma yet. */
  readonly code?: string;
  readonly phone?: string;
  readonly address?: string;
}

export const SUPPLIERS: readonly FixtureSupplier[] = [
  {
    id: "sup-1",
    name: "PT Mac Jaya",
    code: "MJ",
    phone: "+62215550101",
    address: "Jl. Gajah Mada 40, Jakarta",
  },
  // Apel Segar is AS. The code once went in front of its serials; since
  // 2026-09-21 nothing files or prints it.
  {
    id: "sup-2",
    name: "CV Apel Segar",
    code: "AS",
    phone: "+62225550188",
    address: "Jl. Asia Afrika 88, Bandung",
  },
  // Deliberately without one, so the screen that has to cope with a supplier
  // predating the scheme is a screen somebody can actually see.
  { id: "sup-3", name: "Batam Importir", phone: "+62778550123" },
];

export interface FixtureStaff {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: "OWNER" | "STAFF";
  readonly canApprove: boolean;
  /** The same person in the mock's salesperson list. ⚠️ Mock-only list. */
  readonly salesmanId: string;
}

/**
 * The three people in the shop.
 *
 * They are one list here on purpose. `Staff` in prisma is a LOGIN, and the
 * salesperson credited on a sale is a separate mock-only list — but they are
 * the same three humans, so a timeline attributing a sale to "Kasir Toko" and
 * a commission report crediting "Dimas Pratama" were two names for one person.
 * The ids keep their old values because `apps/api`'s auth tests write rows
 * with them.
 */
export const STAFF: readonly FixtureStaff[] = [
  {
    id: "staff_owner",
    username: "pemilik",
    name: "Michella",
    role: "OWNER",
    canApprove: true,
    salesmanId: "sm-1",
  },
  {
    id: "staff_kasir",
    username: "kasir",
    name: "Dimas Pratama",
    role: "STAFF",
    canApprove: false,
    salesmanId: "sm-2",
  },
  {
    id: "staff_ayu",
    username: "ayu",
    name: "Ayu Lestari",
    role: "STAFF",
    canApprove: false,
    salesmanId: "sm-3",
  },
];

const STAFF_BY_SALESMAN = new Map(STAFF.map((s) => [s.salesmanId, s]));

export function staffOfSalesman(salesmanId: string): FixtureStaff {
  const found = STAFF_BY_SALESMAN.get(salesmanId);
  if (found === undefined) {
    throw new Error(`fixture: unknown salesperson ${salesmanId}`);
  }
  return found;
}

export interface FixtureNamed {
  readonly id: string;
  readonly name: string;
}

/** Where the shop's marketing says a customer came from. */
export const REFERRAL_SOURCES: readonly FixtureNamed[] = [
  { id: "ref_instagram_ads", name: "Instagram Ads" },
  { id: "ref_shopee_ads", name: "Shopee Ads" },
  { id: "ref_facebook_ads", name: "Facebook Ads" },
  { id: "ref_tiktok_ads", name: "TikTok Ads" },
  { id: "ref_tokopedia_ads", name: "Tokopedia Ads" },
  { id: "ref_friends", name: "Friends" },
];

/** How a hold reached the shop. Its own list — see CLAUDE.md 2026-08-28. */
export const RESERVATION_SOURCES: readonly FixtureNamed[] = [
  { id: "rsv-src-wa", name: "WhatsApp" },
  { id: "rsv-src-ig", name: "Instagram" },
  { id: "rsv-src-walkin", name: "Walk-in" },
  { id: "rsv-src-tokopedia", name: "Tokopedia" },
  { id: "rsv-src-shopee", name: "Shopee" },
  { id: "rsv-src-tiktok", name: "TikTok" },
];

/**
 * The payment methods this fixture actually spends through, by `code`.
 *
 * Codes, not rows: `PaymentMethod` is a real table with its own ids and its
 * own labels, and the browser mock keeps its own list. Naming a THIRD list
 * here would be a third answer to what the shop accepts. Each seed resolves
 * these codes against the list it owns, and `test/shop.test.ts` asserts the
 * fixture never spends through one that is not on this list.
 */
export const PAYMENT_METHOD_CODES = [
  "TUNAI",
  "TRANSFER",
  "QRIS",
  "KARTU_KREDIT",
  "MARKETPLACE",
  // Settles a debt and moves neither pot (owner ask 2026-09-23).
  "TRANSFER_LUAR",
  // A supplier return's credit against its invoice (owner 2026-10-26); no
  // pot, offered by no picker.
  "RETUR_SUPPLIER",
  // What a trade-in paid of a bill (owner 2026-10-31); no pot, no picker.
  "TUKAR_TAMBAH",
] as const;

export interface FixtureCustomer {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly address?: string;
  readonly referralSourceId: string;
  readonly since: FixtureMoment;
}

export const CUSTOMERS: readonly FixtureCustomer[] = [
  {
    id: "c-1",
    name: "Andi Wijaya",
    phone: "+62811223344",
    address: "Jl. Sudirman 12, Jakarta Pusat",
    referralSourceId: "ref_instagram_ads",
    since: at(120),
  },
  {
    id: "c-2",
    name: "Sari Puspita",
    phone: "+62812998877",
    address: "Jl. Kebon Jeruk 12, Jakarta Barat",
    referralSourceId: "ref_friends",
    since: at(84),
  },
  {
    id: "c-3",
    name: "Budi Santoso",
    phone: "+62813334455",
    address: "Jl. Diponegoro 8, Bandung",
    referralSourceId: "ref_shopee_ads",
    since: at(41),
  },
  {
    id: "c-4",
    name: "Rina Kartika",
    phone: "+62815667788",
    address: "Jl. Gatot Subroto 45, Jakarta Selatan",
    referralSourceId: "ref_tiktok_ads",
    since: at(19),
  },
  {
    id: "c-5",
    name: "Fajar Nugroho",
    phone: "+62817445566",
    address: "Jl. Pahlawan 3, Surabaya",
    referralSourceId: "ref_instagram_ads",
    since: at(6),
  },
];

// ---------------------------------------------------------------------------
// What the shop bought
// ---------------------------------------------------------------------------

export interface FixturePoLine {
  readonly id: string;
  readonly skuId: string;
  readonly qty: number;
  readonly unitCost: number;
  /** On the invoice, never turned up. Keeps the order short of "received". */
  readonly notReceived?: boolean;
}

/** A counted product's line: how many arrived, at what each. */
export interface FixtureCountedLine {
  readonly id: string;
  readonly skuId: string;
  readonly qty: number;
  /** Per piece. Defaults to the variant's landed cost. */
  readonly unitCost?: number;
}

export interface FixturePoPayment {
  readonly id: string;
  readonly method: string;
  /**
   * Whole rupiah, or a word meaning "all of it".
   *
   * `"GOODS"` and `"FEES"` resolve against what the order's own lines add up
   * to, which is the only way a settled invoice stays settled: the line total
   * is a sum over the units below, so a literal amount here would drift out of
   * agreement the moment a machine was added to the order.
   */
  readonly amount: number | "GOODS" | "FEES";
  readonly at: FixtureMoment;
  /** Which part of the invoice it settles. `PayTarget` in the schema. */
  readonly appliedTo: "BARANG" | "ONGKIR" | "PAJAK";
}

export interface FixturePurchaseOrder {
  readonly id: string;
  readonly seq: number;
  readonly supplierId: string;
  readonly invoice: string;
  readonly locationId: string;
  readonly ordered: FixtureMoment;
  readonly received?: FixtureMoment;
  readonly closed?: FixtureMoment;
  readonly shippingFee: number;
  readonly taxFee: number;
  /** Lines with no serial behind them — ordered, or ordered and not sent. */
  readonly extraLines: readonly FixturePoLine[];
  /**
   * Counted products — accessories — that ARRIVED on this invoice, by
   * quantity (2026-09-19). No unit is minted for them; each becomes a
   * `MASUK` stock move of `qty` pieces into the invoice's location.
   */
  readonly counted?: readonly FixtureCountedLine[];
  readonly payments: readonly FixturePoPayment[];
  readonly note?: string;
}

/**
 * Six invoices, covering every stage the Inbound list has to draw.
 *
 * There is deliberately no PO-level discount. `PurchaseOrder` in prisma has
 * subtotal / feesTaxPct / feesTotal / total and no discount column, and
 * `PurchaseOrderFee_amount_nonneg_check` forbids smuggling one in as a
 * negative fee — so a discount here would be a number only the browser could
 * hold, which is the exact class of divergence this file exists to end.
 */
export const PURCHASE_ORDERS: readonly FixturePurchaseOrder[] = [
  {
    // The bulk of the shelf: bought a fortnight ago, all graded, invoice
    // settled and the order closed.
    id: "po-1",
    seq: 41,
    supplierId: "sup-1",
    invoice: "INV/MJ/0812",
    locationId: "wh-1",
    ordered: at(16, 9),
    received: at(14, 10),
    closed: at(12, 16),
    shippingFee: 250_000,
    taxFee: 0,
    extraLines: [],
    // Accessories, on the same invoice as the units they get sold beside.
    // Some already gone, so "bought together" has history for the recommender
    // to read; the rest on the shelf so there is something to recommend.
    counted: [
      { id: "po-1-acc-1", skuId: "m-magic-mouse-v1", qty: 2 },
      { id: "po-1-acc-2", skuId: "m-magic-mouse-v2", qty: 1 },
      { id: "po-1-acc-3", skuId: "m-magic-keyboard-v1", qty: 2 },
      { id: "po-1-acc-4", skuId: "m-magic-keyboard-v2", qty: 1 },
      { id: "po-1-acc-5", skuId: "m-usbc-hub-v1", qty: 3 },
      { id: "po-1-acc-6", skuId: "m-sleeve-v1", qty: 3 },
    ],
    payments: [
      // Two transfers on one order, because that is how it goes: the supplier
      // is paid for the machines and the forwarder for the box they came in.
      {
        id: "pp-1",
        method: "TRANSFER",
        amount: "GOODS",
        at: at(15, 11),
        appliedTo: "BARANG",
      },
      {
        id: "pp-2",
        method: "TUNAI",
        amount: "FEES",
        at: at(14, 12),
        appliedTo: "ONGKIR",
      },
    ],
  },
  {
    id: "po-2",
    seq: 42,
    supplierId: "sup-2",
    invoice: "AS-118",
    locationId: "wh-2",
    ordered: at(11, 9),
    received: at(9, 13),
    shippingFee: 180_000,
    taxFee: 0,
    extraLines: [],
    payments: [
      {
        id: "pp-3",
        method: "TRANSFER",
        amount: "GOODS",
        at: at(10, 10),
        appliedTo: "BARANG",
      },
      {
        id: "pp-4",
        method: "TRANSFER",
        amount: "FEES",
        at: at(9, 15),
        appliedTo: "ONGKIR",
      },
    ],
  },
  {
    // Arrived the day before yesterday and still on the QC bench.
    id: "po-3",
    seq: 43,
    supplierId: "sup-2",
    invoice: "AS-131",
    locationId: "wh-1",
    ordered: at(3, 9),
    received: at(2, 11),
    shippingFee: 0,
    taxFee: 0,
    extraLines: [],
    payments: [
      {
        id: "pp-5",
        method: "TRANSFER",
        amount: "GOODS",
        at: at(3, 10),
        appliedTo: "BARANG",
      },
    ],
  },
  {
    // Yesterday's box, unpaid — the supplier without an origin code.
    id: "po-4",
    seq: 44,
    supplierId: "sup-3",
    invoice: "BTM-77",
    locationId: "wh-2",
    ordered: at(2, 14),
    received: at(1, 9),
    shippingFee: 320_000,
    taxFee: 0,
    extraLines: [],
    payments: [],
  },
  {
    // Lines entered from the invoice, a deposit paid, and one line that will
    // never turn up. The outstanding balance is what makes the deposit visible.
    id: "po-5",
    seq: 45,
    supplierId: "sup-2",
    invoice: "AS-140",
    locationId: "wh-1",
    ordered: at(0, 9),
    shippingFee: 150_000,
    taxFee: 0,
    extraLines: [
      { id: "poi-x1", skuId: "m-pro13-2016-v1", qty: 1, unitCost: 3_400_000 },
      {
        id: "poi-x2",
        skuId: "m-mb12-2016-v1",
        qty: 1,
        unitCost: 3_900_000,
        notReceived: true,
      },
    ],
    payments: [
      {
        id: "pp-6",
        method: "TRANSFER",
        amount: 2_000_000,
        at: at(0, 10),
        appliedTo: "BARANG",
      },
    ],
    note: "Deposit dibayar, menunggu kiriman.",
  },
  {
    // Money wired against an invoice with nobody told what it bought. The
    // Inbound list has to show this as pending rather than as an empty order.
    id: "po-6",
    seq: 46,
    supplierId: "sup-1",
    invoice: "INV/MJ/0880",
    locationId: "wh-1",
    ordered: at(0, 11),
    shippingFee: 0,
    taxFee: 0,
    extraLines: [],
    payments: [
      {
        id: "pp-7",
        method: "KARTU_KREDIT",
        amount: 18_500_000,
        at: at(0, 11),
        appliedTo: "BARANG",
      },
    ],
    note: "Sudah transfer, barang belum didata.",
  },
];

const PO_BY_ID = new Map(PURCHASE_ORDERS.map((p) => [p.id, p]));

export function poOf(id: string): FixturePurchaseOrder {
  const found = PO_BY_ID.get(id);
  if (found === undefined) throw new Error(`fixture: unknown PO ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// The machines
// ---------------------------------------------------------------------------

/**
 * Where a machine ended up. The status is a projection of this plus the
 * ledger — the fate is what a person would say happened to it.
 */
export type FixtureFate =
  /** Graded, on a shelf, sellable. */
  | "SHELF"
  /** Graded, on a shelf, and held for somebody. */
  | "HOLD"
  /** Graded and gone. */
  | "SOLD"
  /** Sold, brought back, re-graded and back on the shelf. */
  | "RETURNED"
  /** Arrived, not yet inspected. */
  | "QC"
  /** Counted as missing at the last stock take. */
  | "LOST"
  /** Failed inspection and went back to the supplier. */
  | "SUPPLIER_RETURN";

export interface FixtureIntake {
  /** Stable handle. Orders and holds name a machine by this, not by serial. */
  readonly ref: string;
  readonly skuId: string;
  readonly poId: string;
  readonly fate: FixtureFate;
  /** 1–3 for the rack it sits on; absent for a machine not on a shelf. */
  readonly rack?: 1 | 2 | 3;
  /** `Grade` in the schema. Absent while a machine is still in QC. */
  readonly grade?: "A" | "B" | "C" | "NEW";
  /**
   * How healthy the battery is, as a percentage of original capacity.
   *
   * The AUTHORED fact, and the only one written here even for a machine whose
   * era does not record percentages. A fixture entry is one description of one
   * machine — the grade, the words and the battery agree — and asking whoever
   * writes the next entry to also know that a 2017 Air is a cycles machine and
   * to invent a cycle count in the right band would be asking them to keep
   * that agreement by hand.
   *
   * `buildShop` translates it: a 2020-or-earlier machine comes out carrying
   * `cycleCount` and `fcc` and no percentage, a 2021-or-later one carries the
   * percentage. See `cyclesForHealth`.
   */
  readonly battery?: number;
  /** Comma-joined phrases from the QC vocabulary. Empty while in QC. */
  readonly description?: string;
  /** What this one cost. Defaults to the variant's landed cost. */
  readonly buy?: number;
  /** Moved after grading — a DIPINDAH on the timeline. */
  readonly movedTo?: {
    readonly locationId: string;
    readonly at: FixtureMoment;
  };
}

/**
 * Every machine the shop has handled, in the order it was taken in.
 *
 * The grade, the battery reading and the description are one description of
 * one machine and they agree: "Mulus" is an A, "Baterai lemah" carries a
 * reading under the 76% fair floor `AppSetting` holds, and a C says in words
 * why it is a C. That is not decoration — Inventory filters on the battery
 * band, the grading checklist computes the letter, and a fixture where the
 * three contradict each other demonstrates all three features wrongly.
 *
 * Accessories are sealed stock: grade `NEW`, no battery, nothing to inspect.
 */
export const INTAKE: readonly FixtureIntake[] = [
  // --- PO-1, PT Mac Jaya, the fortnight-old shelf ---------------------------
  {
    ref: "air15-tired",
    skuId: "m-air-2015-v2",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "C",
    battery: 68,
    description: "Baterai lemah, Lecet di casing bawah, Unit only",
  },
  {
    ref: "air15-ok",
    skuId: "m-air-2015-v4",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "B",
    battery: 84,
    description: "Lecet halus, Fullset dus",
  },
  {
    ref: "air17-clean",
    skuId: "m-air-2017-v2",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "A",
    battery: 91,
    description: "Mulus, Fullset dus, Charger original",
  },
  /*
   * Three of one variant, and this is the shape a second-hand shop actually
   * has (owner ask 2026-09-08). Until this the fixture held exactly one
   * machine of every variant, which was tidy and taught every screen the
   * wrong lesson: with a price per serial, Inventory shows a RANGE per
   * variant-grade, and a shelf of one-offs renders every range as a single
   * figure and demonstrates nothing.
   *
   * Two As at different battery health and one B, so the row spreads WITHIN a
   * grade as well as between grades — which is the case the range exists for.
   */
  {
    ref: "air17-clean-2",
    skuId: "m-air-2017-v2",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "A",
    battery: 95,
    description: "Mulus, Fullset dus",
  },
  {
    ref: "air17-clean-3",
    skuId: "m-air-2017-v2",
    poId: "po-1",
    fate: "SHELF",
    rack: 2,
    grade: "B",
    battery: 83,
    description: "Lecet halus, Unit only",
  },
  {
    ref: "air17-returned",
    skuId: "m-air-2017-v1",
    poId: "po-1",
    fate: "RETURNED",
    rack: 2,
    // Re-graded on the way back in: it went out as an A and the buyer had it
    // for four days. CLAUDE.md 2026-08-28 — a returned machine is second-hand.
    grade: "B",
    battery: 88,
    description: "Lecet halus, Unit only",
  },
  {
    ref: "pro13-2015-dent",
    skuId: "m-pro13-2015-v4",
    poId: "po-1",
    fate: "SHELF",
    rack: 2,
    grade: "B",
    battery: 82,
    description: "Dent di sudut, Charger original",
  },
  {
    ref: "pro13-2015-i7",
    skuId: "m-pro13-2015-v6",
    poId: "po-1",
    fate: "SHELF",
    rack: 2,
    grade: "A",
    battery: 88,
    description: "Mulus, Sudah ganti SSD, Unit only",
  },
  {
    ref: "pro13-2016-worn",
    skuId: "m-pro13-2016-v3",
    poId: "po-1",
    fate: "SHELF",
    rack: 3,
    grade: "C",
    battery: 74,
    description: "Keyboard aus, Baterai lemah, Unit only",
  },
  {
    ref: "pro15-2016-sold",
    skuId: "m-pro15-2016-v2",
    poId: "po-1",
    fate: "SOLD",
    grade: "B",
    battery: 80,
    description: "Lecet halus, Charger original",
  },
  {
    ref: "airm1-sold",
    skuId: "m-air-m1-v1",
    poId: "po-1",
    fate: "SOLD",
    grade: "A",
    battery: 93,
    description: "Mulus, Fullset dus, Charger original",
  },
  {
    ref: "airm1-shelf",
    skuId: "m-air-m1-v3",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "A",
    battery: 95,
    description: "Mulus, Fullset dus",
  },
  {
    ref: "airm2-hold",
    skuId: "m-air-m2-v1",
    poId: "po-1",
    fate: "HOLD",
    rack: 1,
    grade: "A",
    battery: 96,
    description: "Mulus, Fullset dus, Charger original",
  },
  {
    // The same duplication one era up, so the health side of the shelf has a
    // range too. `airm2-hold` is an A at 96; this one is an A at 88, and the
    // two ask different money.
    ref: "airm2-13-second",
    skuId: "m-air-m2-v1",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "A",
    battery: 88,
    description: "Mulus, Unit only",
  },
  {
    ref: "airm2-13-third",
    skuId: "m-air-m2-v1",
    poId: "po-1",
    fate: "SHELF",
    rack: 1,
    grade: "B",
    battery: 84,
    description: "Lecet di casing bawah, Fullset dus",
  },
  {
    ref: "airm2-sold",
    skuId: "m-air-m2-v2",
    poId: "po-1",
    fate: "SOLD",
    grade: "A",
    battery: 94,
    description: "Mulus, Charger original",
  },
  {
    ref: "pro14-hold",
    skuId: "m-pro14-m1-v1",
    poId: "po-1",
    fate: "HOLD",
    rack: 2,
    grade: "A",
    battery: 97,
    description: "Mulus, Fullset dus, Charger original",
  },
  {
    ref: "pro14-sold",
    skuId: "m-pro14-m1-v3",
    poId: "po-1",
    fate: "SOLD",
    grade: "A",
    battery: 92,
    description: "Mulus, Fullset dus, Charger original",
  },
  {
    // Failed inspection on arrival and went straight back. Its description is
    // the reason, which is what the supplier return quotes.
    ref: "mb12-rejected",
    skuId: "m-mb12-2016-v1",
    poId: "po-1",
    fate: "SUPPLIER_RETURN",
    description: "Layar ada garis",
  },
  // --- PO-2, CV Apel Segar, into the Serpong warehouse ----------------------
  {
    ref: "ipad9-wifi",
    skuId: "m-ipad-9-v1",
    poId: "po-2",
    fate: "SHELF",
    rack: 1,
    grade: "A",
    battery: 89,
    description: "Mulus, Fullset dus",
  },
  {
    // Deliberately in the FAIR band, and deliberately a 2021 body: the health
    // filter needs something to find, and after the 2026-09-08 era split every
    // pre-2021 machine answers the cycle filter instead. A shelf whose fair
    // band is populated only by 2017 Airs demonstrates half the feature.
    ref: "ipad9-cell",
    skuId: "m-ipad-9-v4",
    poId: "po-2",
    fate: "SHELF",
    rack: 1,
    grade: "B",
    battery: 78,
    description: "Lecet halus, Unit only",
  },
  {
    // Graded in Serpong, then driven to the shop because that is where iPads
    // sell. The DIPINDAH is the only transfer on the seeded ledger.
    ref: "ipadair4-moved",
    skuId: "m-ipad-air-4-v3",
    poId: "po-2",
    fate: "SHELF",
    rack: 2,
    grade: "A",
    battery: 93,
    description: "Mulus, Charger original",
    movedTo: { locationId: "wh-1", at: at(5, 15) },
  },
  {
    // The poor end of the health era, for the same reason as `ipad9-cell`. A
    // heavily-used 2021 iPad really does read here, and the words say so —
    // `shop.test.ts` holds the grade, the description and the reading to one
    // story.
    ref: "ipadmini-shelf",
    skuId: "m-ipad-mini-6-v1",
    poId: "po-2",
    fate: "SHELF",
    rack: 1,
    grade: "C",
    battery: 71,
    description: "Baterai lemah, Lecet di casing bawah, Unit only",
  },
  {
    ref: "pro13-2016-i7",
    skuId: "m-pro13-2016-v13",
    poId: "po-2",
    fate: "SHELF",
    rack: 2,
    grade: "B",
    battery: 79,
    description: "Lecet halus, Engsel longgar, Fullset dus",
  },
  {
    ref: "pro13m1-hold",
    skuId: "m-pro13-m1-v1",
    poId: "po-2",
    fate: "HOLD",
    rack: 2,
    grade: "A",
    battery: 95,
    description: "Mulus, Fullset dus",
  },
  {
    ref: "pro13m1-shelf",
    skuId: "m-pro13-m1-v3",
    poId: "po-2",
    fate: "SHELF",
    rack: 2,
    grade: "A",
    battery: 96,
    description: "Mulus, Fullset dus, Charger original",
  },
  {
    ref: "airm2-shelf",
    skuId: "m-air-m2-v3",
    poId: "po-2",
    fate: "SHELF",
    rack: 3,
    grade: "A",
    battery: 94,
    description: "Mulus, Charger original",
  },
  {
    ref: "airm2-shelf-big",
    skuId: "m-air-m2-v4",
    poId: "po-2",
    fate: "SHELF",
    rack: 3,
    grade: "A",
    battery: 97,
    description: "Mulus, Fullset dus, Charger original",
  },
  {
    // Graded onto a shelf and not on it at the last count. A shop this size
    // loses one occasionally, and a demo with nothing missing cannot show the
    // stock take doing its job.
    ref: "ipad9-missing",
    skuId: "m-ipad-9-v3",
    poId: "po-2",
    fate: "LOST",
    grade: "B",
    battery: 85,
    description: "Lecet halus, Unit only",
  },
  // --- PO-3, arrived two days ago, still on the bench -----------------------
  { ref: "qc-ipadpro", skuId: "m-ipad-pro11-m1-v3", poId: "po-3", fate: "QC" },
  { ref: "qc-airm2-16", skuId: "m-air-m2-v3", poId: "po-3", fate: "QC" },
  { ref: "qc-airm2-512", skuId: "m-air-m2-v4", poId: "po-3", fate: "QC" },
  { ref: "qc-pro14-1tb", skuId: "m-pro14-m1-v2", poId: "po-3", fate: "QC" },
  // --- PO-4, yesterday's box, in the other warehouse ------------------------
  { ref: "qc-pro13m1-512", skuId: "m-pro13-m1-v2", poId: "po-4", fate: "QC" },
  { ref: "qc-pro13m1-16", skuId: "m-pro13-m1-v4", poId: "po-4", fate: "QC" },
  { ref: "qc-ipadair4", skuId: "m-ipad-air-4-v1", poId: "po-4", fate: "QC" },
];

// ---------------------------------------------------------------------------
// What the shop sold, held and took back
// ---------------------------------------------------------------------------

export interface FixtureOrderLine {
  /** A machine from `INTAKE`. */
  readonly ref: string;
  /**
   * What it was actually charged, when that is not the asking price.
   *
   * Absent means "the list price". A number below it is a bargain and a number
   * above it an upsell — both are derived against `listPrice`, which is
   * snapshotted at the sale rather than read from `Sku.price` later, because
   * `Sku.price` is what the shop asks TODAY and deriving it after a repricing
   * would invent bargains that never happened.
   */
  readonly price?: number;
}

/** One part of a split bill. See `FixtureOrder.split`. */
export interface FixtureSplitPart {
  /** A `PaymentMethod` code — TUNAI, TRANSFER, QRIS, MARKETPLACE. */
  readonly method: string;
  /** Whole rupiah. Omit on exactly one part to give it the remainder. */
  readonly amount?: number;
  /** SETTLED = the shop has it, PENDING = a marketplace does, DUE = unpaid. */
  readonly state: "SETTLED" | "PENDING" | "DUE";
  /** PENDING only: which marketplace is holding it. */
  readonly channel?: string;
  /** DUE only: how many days from the sale the customer promised to pay. */
  readonly dueInDays?: number;
  readonly note?: string;
}

/** Some pieces of a counted product on a sale (2026-09-19). */
export interface FixtureCountedSale {
  readonly skuId: string;
  readonly qty: number;
  /** Per piece. Absent means the list price. */
  readonly price?: number;
}

export interface FixtureOrder {
  readonly id: string;
  readonly seq: number;
  readonly at: FixtureMoment;
  readonly customerId: string;
  readonly lines: readonly FixtureOrderLine[];
  /** Accessories sold on this receipt, by quantity. */
  readonly counted?: readonly FixtureCountedSale[];
  /** A promotion off the goods. Whole rupiah. */
  readonly discount: number;
  readonly discountId?: string;
  /** A charge on top — delivery, packing. `Order.extra` in the schema. */
  readonly extra?: number;
  readonly extraNote?: string;
  /**
   * ⚠️ Only the four channels `Platform` can hold. The till offers Tokopedia
   * and TikTok as well, and the schema cannot store either — widening the enum
   * is a migration and an owner decision (see `lib/channels.ts`). A seeded
   * sale on one would be a sale only the browser could show.
   */
  readonly channel: "OFFLINE" | "SHOPEE" | "INSTAGRAM" | "WHATSAPP";
  readonly fulfil: "PICKUP" | "SHIP";
  readonly salesmanId: string;
  readonly referralSourceId: string;
  readonly payMethod: string;
  /** False while a marketplace still holds the money. */
  readonly settled: boolean;
  /**
   * How the bill was actually paid, in parts (owner ask 2026-09-08).
   *
   * Absent means the whole bill in one payment, in the state `settled`
   * implies — which is what every order here meant before this existed. A
   * split sale, a deposit with a promise, or a marketplace payout that has not
   * landed all say so here instead.
   *
   * Whole rupiah, and ONE part may leave `amount` off: that one takes the
   * remainder of the bill. It is written that way because a fixture with
   * hand-added parts stops summing to the total the first time a price
   * changes, and a demo shop whose payments do not add up to its bills is
   * worse than one with no payments at all.
   */
  readonly split?: readonly FixtureSplitPart[];
  readonly shippingAddress?: string;
  /** Set when the whole sale came back. See `RETURNS`. */
  readonly returnedAt?: FixtureMoment;
  readonly returnReason?: string;
}

export const ORDERS: readonly FixtureOrder[] = [
  {
    // A unit and a mouse on one receipt: the row the add-on recommender
    // reads to learn that the two go together.
    id: "o-1",
    seq: 201,
    at: at(11, 15),
    customerId: "c-1",
    lines: [{ ref: "pro15-2016-sold" }],
    counted: [{ skuId: "m-magic-mouse-v1", qty: 1 }],
    discount: 300_000,
    discountId: "d-1",
    channel: "OFFLINE",
    fulfil: "PICKUP",
    salesmanId: "sm-1",
    referralSourceId: "ref_instagram_ads",
    payMethod: "QRIS",
    settled: true,
  },
  {
    // Sold, and brought back four days later. The refund is a second payment
    // out rather than an edit to the first, so the ledger still says what was
    // taken and what was given back.
    id: "o-2",
    seq: 202,
    at: at(8, 13),
    customerId: "c-1",
    lines: [{ ref: "air17-returned" }],
    discount: 0,
    channel: "OFFLINE",
    fulfil: "PICKUP",
    salesmanId: "sm-2",
    referralSourceId: "ref_instagram_ads",
    payMethod: "TRANSFER",
    settled: true,
    returnedAt: at(4, 11),
    returnReason: "Ganti ke model yang lebih baru",
  },
  {
    // The owner's own split example (2026-09-08): part of the bill in cash at
    // the counter, the rest on Shopee PayLater. The cash is the shop's today
    // and the PayLater money is with Shopee — which is exactly why one method
    // and one flag could not describe this sale.
    id: "o-3",
    seq: 203,
    at: at(6, 11),
    customerId: "c-4",
    lines: [{ ref: "airm2-sold" }],
    counted: [
      { skuId: "m-sleeve-v1", qty: 1 },
      { skuId: "m-usbc-hub-v1", qty: 1 },
    ],
    discount: 0,
    channel: "INSTAGRAM",
    fulfil: "PICKUP",
    salesmanId: "sm-3",
    referralSourceId: "ref_tiktok_ads",
    payMethod: "TRANSFER",
    settled: false,
    split: [
      { method: "TUNAI", amount: 5_000_000, state: "SETTLED" },
      {
        method: "MARKETPLACE",
        state: "PENDING",
        channel: "SHOPEE",
        note: "Shopee PayLater",
      },
    ],
  },
  {
    // Shopee still holds the money: `settled: false` is what puts this on the
    // pending-withdrawal card rather than in the balance.
    id: "o-4",
    seq: 204,
    at: at(3, 16),
    customerId: "c-3",
    // Haggled down by 650k — a bargain against the list price, not a discount
    // code. The salesperson's report reads the gap off `listPrice`, which is
    // snapshotted at the sale rather than looked up later.
    lines: [{ ref: "pro14-sold", price: 17_100_000 }],
    discount: 0,
    channel: "SHOPEE",
    fulfil: "SHIP",
    salesmanId: "sm-2",
    referralSourceId: "ref_shopee_ads",
    payMethod: "MARKETPLACE",
    settled: false,
    shippingAddress: "Jl. Diponegoro 8, Bandung",
  },
  {
    id: "o-5",
    seq: 205,
    at: at(2, 14),
    customerId: "c-2",
    lines: [],
    counted: [{ skuId: "m-magic-keyboard-v1", qty: 1 }],
    discount: 0,
    extra: 30_000,
    extraNote: "Delivery",
    channel: "WHATSAPP",
    fulfil: "SHIP",
    salesmanId: "sm-1",
    referralSourceId: "ref_friends",
    payMethod: "TRANSFER",
    // A deposit and a promise — the other half of the 2026-09-08 ask. The
    // shop is owed the rest, and Customer management has to be able to say so.
    settled: false,
    split: [
      { method: "TRANSFER", amount: 500_000, state: "SETTLED", note: "DP" },
      { method: "TRANSFER", state: "DUE", dueInDays: 10 },
    ],
    shippingAddress: "Jl. Kebon Jeruk 12, Jakarta Barat",
  },
  {
    // This morning, in cash, over the counter — the sale the open shift holds.
    id: "o-6",
    seq: 206,
    at: at(0, 9),
    customerId: "c-5",
    lines: [{ ref: "airm1-sold" }],
    discount: 0,
    channel: "OFFLINE",
    fulfil: "PICKUP",
    salesmanId: "sm-1",
    referralSourceId: "ref_instagram_ads",
    payMethod: "TUNAI",
    settled: true,
  },
];

export interface FixtureReservation {
  readonly id: string;
  readonly seq: number;
  readonly customerId: string;
  readonly created: FixtureMoment;
  /** When the customer said they would come. In the future, hence negative. */
  readonly scheduledFor: FixtureMoment;
  readonly sourceId: string;
  readonly note: string;
  readonly refs: readonly string[];
}

export const RESERVATIONS: readonly FixtureReservation[] = [
  {
    id: "rsv-1",
    seq: 101,
    customerId: "c-2",
    created: at(2, 10),
    scheduledFor: at(-1, 15),
    sourceId: "rsv-src-wa",
    note: "Ambil setelah gajian. Minta charger dicek dulu sebelum diambil.",
    refs: ["airm2-hold"],
  },
  {
    // Two machines held for one customer in one conversation — the shape a
    // flat one-row-per-serial model could not express.
    id: "rsv-2",
    seq: 102,
    customerId: "c-1",
    created: at(1, 11),
    scheduledFor: at(-2, 11),
    sourceId: "rsv-src-ig",
    note: "Untuk kantor. Minta difakturkan sekaligus, diambil hari Sabtu.",
    refs: ["pro14-hold", "pro13m1-hold"],
  },
];

export interface FixtureSupplierReturn {
  readonly id: string;
  readonly seq: number;
  readonly supplierId: string;
  readonly poId: string;
  readonly ref: string;
  readonly reason: string;
  readonly at: FixtureMoment;
}

export const SUPPLIER_RETURNS: readonly FixtureSupplierReturn[] = [
  {
    id: "ret-1",
    seq: 107,
    supplierId: "sup-1",
    poId: "po-1",
    ref: "mb12-rejected",
    reason: "Layar ada garis — ditolak saat QC",
    at: at(13, 15),
  },
];

/** Two promotions. The bundle the mock also carries is mock-only: `DiscType`
 * in prisma is PCT or NOMINAL and has no BUNDLE member. */
export const DISCOUNTS: readonly {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: "PCT" | "NOMINAL";
  readonly pct?: number;
  readonly amountRp?: number;
  readonly maxRp?: number;
  readonly usageLimit: number;
  readonly used: number;
  readonly from: FixtureMoment;
  readonly to: FixtureMoment;
  readonly scope: string;
}[] = [
  {
    id: "d-1",
    code: "MERDEKA10",
    name: "Merdeka 10%",
    type: "PCT",
    pct: 10,
    maxRp: 500_000,
    usageLimit: 50,
    used: 12,
    from: at(30),
    to: at(-16),
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
    from: at(7),
    to: at(-23),
    scope: "MacBook Air",
  },
];

// ---------------------------------------------------------------------------
// Building it — the part both seeds call
// ---------------------------------------------------------------------------

/**
 * A serial in Apple's barcode shape: `S`, then twelve.
 *
 * The 2026-09-01 era's form of `Unit.serial` — Apple's barcode, marker and
 * all. Since 2026-09-21 a sealed unit is filed without the `S`; the seed keeps
 * this form, which every lookup still finds (CLAUDE.md, 2026-09-21). The tail
 * pairs avoid `I` and `O` because Apple prints neither, so a scanner reading
 * one is misreading a `1` or a `0`; a seeded serial that tripped that rule
 * would be data the app refuses to re-scan.
 *
 * Deterministic in the intake index, so the same machine has the same serial
 * in the browser and in Postgres. That equality is the entire point of this
 * package: it is what lets S/N Tracking find a serial Inventory is showing.
 */
/**
 * When the last stock take was walked.
 *
 * Exported because the browser mock's opname record has to be the SAME count
 * that lost the machine below — a session dated differently from the event
 * that came out of it is two stock takes, one of them invisible.
 */
export const STOCK_TAKE_AT: FixtureMoment = at(3, 18);

/**
 * The serial slot of the `index`-th intake.
 *
 * Eight slots after `mb12-rejected` were accessories until 2026-09-19, when
 * counted products stopped being units. The units after them keep the serials
 * they had, so every test, screenshot and story that names one still does.
 */
const RETIRED_SLOTS_AFTER = "mb12-rejected";
const RETIRED_SLOTS = 8;
function serialSlotOf(index: number): number {
  const cut = INTAKE.findIndex((it) => it.ref === RETIRED_SLOTS_AFTER);
  return index + 1 + (cut >= 0 && index > cut ? RETIRED_SLOTS : 0);
}

export function serialAt(index: number): string {
  const digits = String(7_400_000 + index * 137).slice(0, 7);
  const tail = ["JK", "LM", "QX", "PN"][index % 4]!;
  return `SC02${digits}${tail}`;
}

const STATUS_OF_FATE = {
  SHELF: "TERSEDIA",
  LOST: "HILANG",
  HOLD: "DIRESERVASI",
  SOLD: "TERJUAL",
  RETURNED: "TERSEDIA",
  QC: "QC",
  SUPPLIER_RETURN: "RETUR_SUPPLIER",
} as const;

export type FixtureUnitStatus =
  (typeof STATUS_OF_FATE)[keyof typeof STATUS_OF_FATE];

export interface BuiltUnit {
  readonly ref: string;
  readonly serial: string;
  readonly skuId: string;
  readonly poId: string;
  readonly poLineId: string;
  readonly status: FixtureUnitStatus;
  readonly grade?: "A" | "B" | "C" | "NEW";
  /**
   * Health percentage. Present only on a **2021-or-later** machine, since
   * 2026-09-08 — those are the ones whose batteries report one.
   */
  readonly battery?: number;
  /** Charge cycles. Present only on a **2020-or-earlier** machine. */
  readonly cycleCount?: number;
  /** Full charge capacity in mAh, beside the cycle count. Same machines. */
  readonly fcc?: number;
  readonly description: string;
  /**
   * What the shop asks for THIS machine (owner revision 2026-09-08).
   *
   * Derived from the variant's asking price, the grade and the battery, so the
   * fixture's prices tell the same story its words do: the C with the tired
   * battery is the cheap one, and two A-grade machines of one variant can
   * still differ because one of them has a better cell. That within-grade
   * spread is deliberate — Inventory shows a RANGE per variant-grade, and a
   * fixture where every A costs the same would render every range as a single
   * figure and demonstrate nothing.
   *
   * Absent on a machine still in QC: nothing has been priced until somebody
   * has looked at it.
   */
  readonly price?: number;
  /** What this machine cost. Whole rupiah. */
  readonly buy: number;
  /** Cost plus its share of the freight on its invoice. Whole rupiah. */
  readonly landed: number;
  readonly locationId: string;
  readonly rackId?: string;
  readonly intakeAt: FixtureMoment;
  readonly gradedAt?: FixtureMoment;
}

export interface BuiltEvent {
  readonly serial: string;
  readonly seq: number;
  readonly type: string;
  readonly at: FixtureMoment;
  readonly fromStatus: FixtureUnitStatus | null;
  readonly toStatus: FixtureUnitStatus;
  readonly fromLocationId: string | null;
  readonly toLocationId: string;
  readonly orderId?: string;
  readonly purchaseOrderId?: string;
  readonly reservationId?: string;
  readonly note?: string;
  readonly staffId: string;
}

export interface BuiltPoLine {
  readonly id: string;
  readonly poId: string;
  readonly skuId: string;
  readonly produk: string;
  readonly spec: string;
  readonly qty: number;
  readonly unitCost: number;
  readonly lineTotal: number;
  readonly allocatedFee: number;
  readonly notReceived: boolean;
  /** Serials booked against this line — one, or none for an unreceived line. */
  readonly serials: readonly string[];
  /**
   * A counted product's line (2026-09-19): it arrived as `qty` pieces on a
   * `MASUK` stock move, and no serial will ever be booked against it.
   */
  readonly counted: boolean;
}

/**
 * One movement of a counted product — a `StockMove` row. Signed `qty`;
 * `cost` is one piece's.
 */
export interface BuiltStockMove {
  readonly id: string;
  readonly skuId: string;
  readonly locationId: string;
  readonly qty: number;
  readonly cost: number;
  readonly type: "MASUK" | "TERJUAL";
  readonly at: FixtureMoment;
  readonly poId?: string;
  readonly poLineId?: string;
  readonly orderId?: string;
  readonly orderLineId?: string;
  readonly staffId: string;
}

/**
 * One expense of an invoice — a `PurchaseOrderFee` row (owner ask
 * 2026-09-18: expenses are a list, and each one says whether it joins the
 * machines' cost). Every fixture expense does: shipping and tax always have.
 */
export interface BuiltPoFee {
  /** `${po.id}-fee-${n}`, which both seeds write. */
  readonly id: string;
  readonly kind: "ONGKIR" | "PAJAK";
  readonly label: string;
  readonly amount: number;
}

export interface BuiltPo extends FixturePurchaseOrder {
  readonly code: string;
  readonly status: "DIPESAN" | "SEBAGIAN" | "DITERIMA";
  readonly lines: readonly BuiltPoLine[];
  readonly fees: readonly BuiltPoFee[];
  readonly subtotal: number;
  readonly feesTotal: number;
  readonly total: number;
  readonly payments: readonly (FixturePoPayment & {
    readonly rupiah: number;
    /** The expense a shipping or tax payment settled — `Payment.poFeeId`. */
    readonly feeId?: string;
  })[];
}

export interface BuiltOrderLine {
  readonly id: string;
  readonly ref: string;
  readonly serial: string;
  readonly skuId: string;
  readonly name: string;
  readonly variant: string;
  readonly qty: number;
  readonly price: number;
  /** What the shop was asking on the day. Snapshot, not derived later. */
  readonly listPrice: number;
  readonly sub: number;
  readonly cogs: number;
  readonly warrantyUntil?: FixtureMoment;
}

/** One part of a bill, with its amount resolved and its dates real. */
export interface BuiltSalePayment {
  readonly id: string;
  readonly method: string;
  readonly amount: number;
  readonly state: "SETTLED" | "PENDING" | "DUE";
  readonly channel?: string;
  readonly at: FixtureMoment;
  readonly dueAt?: FixtureMoment;
  readonly note?: string;
}

export interface BuiltPayment {
  readonly id: string;
  readonly direction: "MASUK" | "KELUAR";
  readonly method: string;
  readonly amount: number;
  readonly status: "LUNAS" | "BELUM";
  readonly at: FixtureMoment;
}

/** Some pieces of a counted product on a sale, priced and costed. */
export interface BuiltCountedLine {
  readonly id: string;
  readonly skuId: string;
  readonly name: string;
  readonly variant: string;
  readonly qty: number;
  /** Per piece. */
  readonly price: number;
  /** Per piece, what the shop was asking on the day. */
  readonly listPrice: number;
  readonly sub: number;
  /** For the whole line: the moving average at the sale, times qty. */
  readonly cogs: number;
}

export interface BuiltOrder extends FixtureOrder {
  readonly code: string;
  readonly status: "LUNAS" | "BELUM" | "RETUR";
  readonly builtLines: readonly BuiltOrderLine[];
  /** Accessories on the receipt, by quantity. */
  readonly countedLines: readonly BuiltCountedLine[];
  readonly subtotal: number;
  readonly total: number;
  readonly paidTotal: number;
  readonly cogs: number;
  readonly payments: readonly BuiltPayment[];
  /** The bill in parts. One entry unless the order declares a `split`. */
  readonly parts: readonly BuiltSalePayment[];
}

export interface BuiltReservation extends FixtureReservation {
  readonly code: string;
  readonly serials: readonly string[];
}

export interface BuiltSupplierReturn extends FixtureSupplierReturn {
  readonly code: string;
  readonly serial: string;
  readonly amount: number;
}

export interface BuiltShop {
  readonly now: number;
  readonly categories: readonly FixtureCategory[];
  readonly models: readonly FixtureModel[];
  readonly skus: readonly FixtureSku[];
  readonly locations: readonly FixtureLocation[];
  readonly racks: readonly FixtureRack[];
  readonly suppliers: readonly FixtureSupplier[];
  readonly staff: readonly FixtureStaff[];
  readonly customers: readonly FixtureCustomer[];
  readonly purchaseOrders: readonly BuiltPo[];
  readonly units: readonly BuiltUnit[];
  readonly events: readonly BuiltEvent[];
  /** The counted products' ledger, in time order. */
  readonly stockMoves: readonly BuiltStockMove[];
  readonly orders: readonly BuiltOrder[];
  readonly reservations: readonly BuiltReservation[];
  readonly supplierReturns: readonly BuiltSupplierReturn[];
  /** ref → serial, for anything that wants to name a seeded machine. */
  readonly serialOfRef: ReadonlyMap<string, string>;
}

/**
 * Spread a freight charge over an invoice's lines, in whole rupiah.
 *
 * The remainder goes on the first line rather than being dropped, so the
 * allocated fees add back up to the fee. A landed cost that is 3 rupiah short
 * of the invoice is a reconciliation somebody has to do by hand.
 */
function allocate(total: number, count: number): number[] {
  if (count === 0) return [];
  const each = Math.floor(total / count);
  const rest = total - each * count;
  return Array.from({ length: count }, (_, i) => each + (i === 0 ? rest : 0));
}

/**
 * The whole shop, resolved.
 *
 * `now` is a parameter so a test can pin the clock; both seeds pass their own
 * `Date.now()`. Nothing here reads the clock on its own — this package has no
 * I/O and no ambient time, the same rule `packages/domain` follows.
 */
/**
 * The last model year recorded as cycles rather than health (owner ask
 * 2026-09-08).
 *
 * Duplicated from `apps/web/src/lib/battery.ts` rather than imported, because
 * this package imports nothing — it is the shop, and both the browser seed and
 * the Postgres seed project it. `test/shop.test.ts` asserts the two agree.
 */
export const CYCLE_ERA_MAX_YEAR = 2020;

/**
 * Does a model carry an M-series chip? An M1 of 2020 records health like
 * every Apple silicon Mac after it (owner 2026-09-19), whatever its year.
 * The same test as `namesAppleSilicon` in `apps/web/src/lib/battery.ts`,
 * duplicated for the reason `CYCLE_ERA_MAX_YEAR` gives.
 */
const M_CHIP = /(?<![A-Za-z0-9])(?<!core[\s-]*)m[1-9]\d?(?![A-Za-z0-9])/i;

/** Which reading a model's batteries are recorded in. */
export function recordsBatteryHealth(model: {
  readonly name: string;
  readonly releaseYear: number;
}): boolean {
  return model.releaseYear > CYCLE_ERA_MAX_YEAR || M_CHIP.test(model.name);
}

/**
 * Nominal design capacity in mAh, by category, for deriving a plausible FCC.
 *
 * Round numbers in the right neighbourhood rather than Apple's exact figures
 * per body — this is demo data, and what a screen has to show is a capacity
 * that shrinks with the battery beside it, not a spec sheet. Zero means the
 * category has no cell to report one, and such a machine comes out with a
 * cycle count and no capacity rather than with a capacity of nothing.
 */
const DESIGN_MAH: Readonly<Record<string, number>> = {
  "cat-macbook-air": 5200,
  "cat-macbook-pro": 6800,
  "cat-macbook": 5000,
  "cat-ipad": 7600,
  "cat-accessory": 0,
};

/**
 * A cycle count that lands in the same band the health percentage does.
 *
 * Piecewise-linear through the band boundaries the app's defaults use — 80%
 * meets 400 cycles, 76% meets 800 — so a machine the fixture calls healthy
 * reads good in either era and one described "Baterai lemah" reads poor in
 * either. That agreement is the point: `test/shop.test.ts` checks the words,
 * the grade and the battery tell one story, and it has to keep checking it now
 * that half the shelf tells that story in different units.
 *
 * Monotone decreasing, so no two machines swap places when the shelf is sorted
 * by battery.
 */
export function cyclesForHealth(health: number): number {
  if (health >= 80) return Math.round((400 * (100 - health)) / 20);
  if (health >= 76) return 400 + Math.round((400 * (80 - health)) / 4);
  return 800 + Math.round((76 - health) * 40);
}

/** The capacity a battery of this health would report, for this category. */
export function fccForHealth(health: number, categoryId: string): number {
  const design = DESIGN_MAH[categoryId] ?? 0;
  if (design === 0) return 0;
  return Math.round((design * health) / 100);
}

/**
 * What the shop asks for one machine, from what the fixture says about it.
 *
 * `Sku.price` is the ASKING price of the variant — what a customer is quoted
 * before anybody picks a machine — and this is what one particular machine is
 * worth against it. Two factors, both of them things a customer can see:
 *
 * - the **grade**, which is the shop's summary of the body, and
 * - the **battery**, because a tired cell is the one fault a buyer will
 *   discover on the first afternoon.
 *
 * Sealed stock asks the full price, which is what sealed means.
 *
 * Deterministic, and it has to be: the fixture is projected into two databases
 * and a test asserts they agree.
 */
export function askingPriceOf(
  skuPrice: number,
  grade: "A" | "B" | "C" | "NEW" | undefined,
  health: number | undefined,
): number {
  const byGrade = { NEW: 1, A: 0.98, B: 0.92, C: 0.82 } as const;
  const g = byGrade[grade ?? "A"];
  // A healthy battery costs nothing; a poor one costs up to a tenth. Linear
  // between the two so that two A-grade machines with different cells land on
  // different numbers, which is the spread Inventory's range exists to show.
  const b =
    health === undefined
      ? 1
      : 1 - Math.min(0.1, Math.max(0, (92 - health) / 200));
  // Sealed stock in perfect health asks the catalogue price EXACTLY, rather
  // than the catalogue price rounded — a variant priced at Rp7.990.000 must
  // not become Rp8.000.000 just because its unit went through here.
  if (g * b === 1) return skuPrice;
  // Floored, never rounded: a machine may ask less than the variant's asking
  // price and must never ask more, and rounding to the nearest 50k can push a
  // 98% factor back over 100%.
  return Math.floor((skuPrice * g * b) / 50_000) * 50_000;
}

/**
 * One machine's battery, in whichever units its era reports.
 *
 * Spread into the unit rather than returned as a value, so a machine with no
 * battery at all — an accessory, a machine still in QC — carries no key
 * instead of three undefined ones.
 */
function batteryOf(
  it: FixtureIntake,
): { battery?: number } | { cycleCount?: number; fcc?: number } {
  if (it.battery === undefined) return {};
  const model = modelOf(skuOf(it.skuId).modelId);
  if (recordsBatteryHealth(model)) return { battery: it.battery };
  const fcc = fccForHealth(it.battery, model.categoryId);
  return {
    cycleCount: cyclesForHealth(it.battery),
    ...(fcc === 0 ? {} : { fcc }),
  };
}

/**
 * A bill in parts, with the remainder resolved.
 *
 * Exactly one part may leave its amount off, and it takes whatever the bill
 * does not otherwise account for. Written that way so the fixture's payments
 * still add up to its bills after a price changes — a demo shop whose money
 * does not balance teaches every finance screen the wrong lesson.
 *
 * An order with no `split` gets the one payment it always had: the whole bill,
 * in the state `settled` implies.
 */
function partsOf(o: FixtureOrder, total: number): BuiltSalePayment[] {
  if (!o.split || o.split.length === 0) {
    return [
      {
        id: `${o.id}-part-1`,
        method: o.payMethod,
        amount: total,
        state: o.settled ? "SETTLED" : "PENDING",
        ...(o.settled ? {} : { channel: o.channel }),
        at: o.at,
      },
    ];
  }
  const named = o.split.reduce((n, p) => n + (p.amount ?? 0), 0);
  const rest = Math.max(0, total - named);
  return o.split.map((p, i) => ({
    id: `${o.id}-part-${i + 1}`,
    method: p.method,
    amount: p.amount ?? rest,
    state: p.state,
    ...(p.channel === undefined ? {} : { channel: p.channel }),
    at: o.at,
    ...(p.dueInDays === undefined
      ? {}
      : { dueAt: at(o.at.daysAgo - p.dueInDays, 12) }),
    ...(p.note === undefined ? {} : { note: p.note }),
  }));
}

export function buildShop(now: number = Date.now()): BuiltShop {
  const serialOfRef = new Map<string, string>();
  const units: BuiltUnit[] = [];
  const events: BuiltEvent[] = [];

  // Which hold or sale claims each machine — resolved first, because a unit's
  // ledger has to name the document that moved it.
  const holdOfRef = new Map<string, FixtureReservation>();
  for (const r of RESERVATIONS) {
    for (const ref of r.refs) holdOfRef.set(ref, r);
  }
  const orderOfRef = new Map<string, FixtureOrder>();
  for (const o of ORDERS) {
    for (const l of o.lines) orderOfRef.set(l.ref, o);
  }
  const returnOfRef = new Map<string, FixtureSupplierReturn>();
  for (const r of SUPPLIER_RETURNS) returnOfRef.set(r.ref, r);

  // --- purchase order lines, one per machine -------------------------------
  const linesByPo = new Map<string, BuiltPoLine[]>();
  const poLineOfRef = new Map<string, string>();
  const intakeIndexOfRef = new Map<string, number>();

  INTAKE.forEach((it, i) => {
    const serial = serialAt(serialSlotOf(i));
    serialOfRef.set(it.ref, serial);
    intakeIndexOfRef.set(it.ref, i);
  });

  for (const po of PURCHASE_ORDERS) {
    const mine = INTAKE.filter((it) => it.poId === po.id);
    const lines: BuiltPoLine[] = mine.map((it, i) => {
      const sku = skuOf(it.skuId);
      const unitCost = it.buy ?? sku.landed;
      const id = `${po.id}-line-${i + 1}`;
      poLineOfRef.set(it.ref, id);
      return {
        id,
        poId: po.id,
        skuId: it.skuId,
        produk: sku.name,
        spec: sku.variantLabel,
        qty: 1,
        unitCost,
        lineTotal: unitCost,
        allocatedFee: 0,
        notReceived: false,
        serials: [serialOfRef.get(it.ref)!],
        counted: false,
      };
    });
    for (const extra of po.extraLines) {
      lines.push({
        id: extra.id,
        poId: po.id,
        skuId: extra.skuId,
        produk: skuOf(extra.skuId).name,
        spec: skuOf(extra.skuId).variantLabel,
        qty: extra.qty,
        unitCost: extra.unitCost,
        lineTotal: extra.unitCost * extra.qty,
        allocatedFee: 0,
        notReceived: extra.notReceived === true,
        serials: [],
        counted: false,
      });
    }
    for (const c of po.counted ?? []) {
      const sku = skuOf(c.skuId);
      const unitCost = c.unitCost ?? sku.landed;
      lines.push({
        id: c.id,
        poId: po.id,
        skuId: c.skuId,
        produk: sku.name,
        spec: sku.variantLabel,
        qty: c.qty,
        unitCost,
        lineTotal: unitCost * c.qty,
        allocatedFee: 0,
        notReceived: false,
        serials: [],
        counted: true,
      });
    }
    // Evenly by PIECE, as the app splits it (`lib/landedCost.ts`): a line of
    // three hubs is three boxes in the parcel. A line's fee is its pieces'.
    const pieces = lines.reduce((n, l) => n + l.qty, 0);
    const shares = allocate(po.shippingFee + po.taxFee, pieces);
    let next = 0;
    linesByPo.set(
      po.id,
      lines.map((l) => {
        let fee = 0;
        for (let k = 0; k < l.qty; k += 1) fee += shares[next++] ?? 0;
        return { ...l, allocatedFee: fee };
      }),
    );
  }

  // --- counted products arriving: one MASUK per line -------------------------
  const stockMoves: BuiltStockMove[] = [];
  for (const po of PURCHASE_ORDERS) {
    if (po.received === undefined) continue;
    for (const l of linesByPo.get(po.id)!) {
      if (!l.counted) continue;
      stockMoves.push({
        id: `${l.id}-in`,
        skuId: l.skuId,
        locationId: po.locationId,
        qty: l.qty,
        cost: l.unitCost,
        type: "MASUK",
        at: po.received,
        poId: po.id,
        poLineId: l.id,
        staffId: "staff_owner",
      });
    }
  }

  // --- the machines, and their ledgers -------------------------------------
  INTAKE.forEach((it, i) => {
    const po = poOf(it.poId);
    const serial = serialOfRef.get(it.ref)!;
    const lineId = poLineOfRef.get(it.ref)!;
    const line = linesByPo.get(po.id)!.find((l) => l.id === lineId)!;
    const arrived = po.received!;
    // Graded the day after it arrived, spread across the working afternoon so
    // one invoice's machines do not all carry the same timestamp.
    const graded = at(arrived.daysAgo - 1, 11 + (i % 5));
    const home = it.movedTo?.locationId ?? po.locationId;
    const onShelf = it.fate !== "QC" && it.fate !== "SUPPLIER_RETURN";

    units.push({
      ref: it.ref,
      serial,
      skuId: it.skuId,
      poId: po.id,
      poLineId: lineId,
      status: STATUS_OF_FATE[it.fate],
      ...(it.grade === undefined ? {} : { grade: it.grade }),
      // Priced at QC, so a machine still on the bench has no price.
      ...(it.fate === "QC"
        ? {}
        : {
            price: askingPriceOf(skuOf(it.skuId).price, it.grade, it.battery),
          }),
      ...batteryOf(it),
      description: it.description ?? "",
      buy: line.unitCost,
      landed: line.unitCost + line.allocatedFee,
      locationId: home,
      ...(onShelf && it.rack !== undefined
        ? { rackId: `${home}-rack-${it.rack}` }
        : {}),
      intakeAt: arrived,
      ...(it.fate === "QC" ? {} : { gradedAt: graded }),
    });

    let seq = 0;
    let status: FixtureUnitStatus | null = null;
    let where: string | null = null;
    const push = (
      type: string,
      to: FixtureUnitStatus,
      when: FixtureMoment,
      extra: Partial<BuiltEvent> = {},
      toLocation = po.locationId,
    ) => {
      events.push({
        serial,
        seq: ++seq,
        type,
        at: when,
        fromStatus: status,
        toStatus: to,
        fromLocationId: where,
        toLocationId: toLocation,
        staffId: "staff_owner",
        ...extra,
      });
      status = to;
      where = toLocation;
    };

    push("DITERIMA", "QC", at(arrived.daysAgo, arrived.hour + (i % 3)), {
      purchaseOrderId: po.id,
      note: `Tiba dari ${SUPPLIERS.find((s) => s.id === po.supplierId)!.name}`,
    });

    if (it.fate === "SUPPLIER_RETURN") {
      const ret = returnOfRef.get(it.ref);
      push("RETUR_SUPPLIER", "RETUR_SUPPLIER", ret?.at ?? graded, {
        purchaseOrderId: po.id,
        note: it.description ?? "Ditolak saat QC",
      });
    } else if (it.fate !== "QC") {
      push("QC_SELESAI", "TERSEDIA", graded, {
        purchaseOrderId: po.id,
        // A returned machine's first grading described the machine as it was
        // then; the RETUR_PELANGGAN below carries the re-grade.
        note:
          it.ref === "air17-returned"
            ? "Mulus, Fullset dus, Charger original"
            : it.description,
      });
    }

    if (it.movedTo !== undefined) {
      push(
        "DIPINDAH",
        "TERSEDIA",
        it.movedTo.at,
        {
          note: `Pindah ke ${LOCATIONS.find((l) => l.id === it.movedTo!.locationId)!.name}`,
        },
        it.movedTo.locationId,
      );
    }

    if (it.fate === "LOST") {
      push(
        "OPNAME_HILANG",
        "HILANG",
        STOCK_TAKE_AT,
        {
          note: "Tidak ditemukan saat stock opname",
        },
        home,
      );
    }

    const hold = holdOfRef.get(it.ref);
    if (hold !== undefined) {
      push(
        "DIRESERVASI",
        "DIRESERVASI",
        hold.created,
        {
          reservationId: hold.id,
        },
        home,
      );
    }

    const order = orderOfRef.get(it.ref);
    if (order !== undefined) {
      push("TERJUAL", "TERJUAL", order.at, { orderId: order.id }, home);
      if (order.returnedAt !== undefined) {
        push(
          "RETUR_PELANGGAN",
          "TERSEDIA",
          order.returnedAt,
          {
            orderId: order.id,
            note: `Retur pelanggan — dinilai ulang: ${it.description}`,
          },
          home,
        );
      }
    }
  });

  const unitOfRef = new Map(units.map((u) => [u.ref, u]));

  // --- purchase orders, totalled -------------------------------------------
  const purchaseOrders: BuiltPo[] = PURCHASE_ORDERS.map((po) => {
    const lines = linesByPo.get(po.id)!;
    const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
    const fees: BuiltPoFee[] = [
      ...(po.shippingFee > 0
        ? [
            {
              kind: "ONGKIR" as const,
              label: "Ongkir",
              amount: po.shippingFee,
            },
          ]
        : []),
      ...(po.taxFee > 0
        ? [{ kind: "PAJAK" as const, label: "Pajak", amount: po.taxFee }]
        : []),
    ].map((f, i) => ({ id: `${po.id}-fee-${i + 1}`, ...f }));
    const feesTotal = fees.reduce((n, f) => n + f.amount, 0);
    const received = lines.filter(
      (l) =>
        !l.notReceived &&
        (l.serials.length > 0 || (l.counted && po.received !== undefined)),
    );
    return {
      ...po,
      code: docCode("PI", po.ordered, po.seq, now),
      status:
        received.length === 0
          ? "DIPESAN"
          : received.length === lines.length
            ? "DITERIMA"
            : "SEBAGIAN",
      lines,
      fees,
      subtotal,
      feesTotal,
      total: subtotal + feesTotal,
      payments: po.payments.map((p) => {
        // A shipping or tax payment settles THE expense of that kind — the
        // fixture never gives an invoice two of one kind.
        const fee =
          p.appliedTo === "BARANG"
            ? undefined
            : fees.find((f) => f.kind === p.appliedTo);
        return {
          ...p,
          rupiah:
            p.amount === "GOODS"
              ? subtotal
              : p.amount === "FEES"
                ? feesTotal
                : p.amount,
          ...(fee === undefined ? {} : { feeId: fee.id }),
        };
      }),
    };
  });

  // --- sales ----------------------------------------------------------------
  const orders: BuiltOrder[] = ORDERS.map((o) => {
    const builtLines: BuiltOrderLine[] = o.lines.map((l, i) => {
      const unit = unitOfRef.get(l.ref);
      if (unit === undefined) {
        throw new Error(
          `fixture: order ${o.id} names unknown machine ${l.ref}`,
        );
      }
      const sku = skuOf(unit.skuId);
      const price = l.price ?? sku.price;
      return {
        id: `${o.id}-item-${i + 1}`,
        ref: l.ref,
        serial: unit.serial,
        skuId: unit.skuId,
        name: sku.name,
        variant: sku.variantLabel,
        qty: 1,
        price,
        listPrice: sku.price,
        sub: price,
        cogs: unit.landed,
        // Three months on a second-hand machine, none on a sealed accessory.
        ...(isAccessory(unit.skuId)
          ? {}
          : { warrantyUntil: at(o.at.daysAgo - 90, o.at.hour) }),
      };
    });
    const countedLines: BuiltCountedLine[] = (o.counted ?? []).map((c, i) => {
      const sku = skuOf(c.skuId);
      const price = c.price ?? sku.price;
      const id = `${o.id}-qty-${i + 1}`;
      // What one piece cost the shop, landed: the fixture buys each counted
      // variant on ONE line, so its average is that line's.
      const bought = [...linesByPo.values()]
        .flat()
        .find((l) => l.counted && l.skuId === c.skuId);
      if (bought === undefined) {
        throw new Error(
          `fixture: order ${o.id} sells ${c.skuId}, never bought`,
        );
      }
      const each = Math.round(
        (bought.unitCost * bought.qty + bought.allocatedFee) / bought.qty,
      );
      stockMoves.push({
        id: `${id}-out`,
        skuId: c.skuId,
        locationId: poOf(bought.poId).locationId,
        qty: -c.qty,
        cost: each,
        type: "TERJUAL",
        at: o.at,
        orderId: o.id,
        orderLineId: id,
        staffId: "staff_owner",
      });
      return {
        id,
        skuId: c.skuId,
        name: sku.name,
        variant: sku.variantLabel,
        qty: c.qty,
        price,
        listPrice: sku.price,
        sub: price * c.qty,
        cogs: each * c.qty,
      };
    });
    if (o.returnedAt !== undefined && countedLines.length > 0) {
      throw new Error(`fixture: order ${o.id} returns counted products`);
    }
    const subtotal =
      builtLines.reduce((n, l) => n + l.sub, 0) +
      countedLines.reduce((n, l) => n + l.sub, 0);
    const extra = o.extra ?? 0;
    const total = subtotal - o.discount + extra;
    const returned = o.returnedAt !== undefined;
    const payments: BuiltPayment[] = [
      {
        id: `${o.id}-pay-1`,
        direction: "MASUK",
        method: o.payMethod,
        amount: total,
        status: o.settled ? "LUNAS" : "BELUM",
        at: o.at,
      },
    ];
    if (returned) {
      payments.push({
        id: `${o.id}-pay-2`,
        direction: "KELUAR",
        method: o.payMethod,
        amount: total,
        status: "LUNAS",
        at: o.returnedAt!,
      });
    }
    return {
      ...o,
      code: docCode("SI", o.at, o.seq, now),
      status: returned ? "RETUR" : o.settled ? "LUNAS" : "BELUM",
      builtLines,
      countedLines,
      subtotal,
      total,
      // What the shop is actually holding: nothing while a marketplace has it,
      // and nothing once it has been given back.
      paidTotal: o.settled && !returned ? total : 0,
      cogs:
        builtLines.reduce((n, l) => n + l.cogs, 0) +
        countedLines.reduce((n, l) => n + l.cogs, 0),
      payments,
      parts: partsOf(o, total),
    };
  });

  const reservations: BuiltReservation[] = RESERVATIONS.map((r) => ({
    ...r,
    code: docCode("RV", r.created, r.seq, now),
    serials: r.refs.map((ref) => serialOfRef.get(ref)!),
  }));

  const supplierReturns: BuiltSupplierReturn[] = SUPPLIER_RETURNS.map((r) => ({
    ...r,
    code: docCode("SP", r.at, r.seq, now),
    serial: serialOfRef.get(r.ref)!,
    amount: unitOfRef.get(r.ref)!.buy,
  }));

  return {
    now,
    categories: CATEGORIES,
    models: MODELS,
    skus: SKUS,
    locations: LOCATIONS,
    racks: RACKS,
    suppliers: SUPPLIERS,
    staff: STAFF,
    customers: CUSTOMERS,
    purchaseOrders,
    units,
    events,
    stockMoves: [...stockMoves].sort(
      (a, b) => b.at.daysAgo - a.at.daysAgo || a.at.hour - b.at.hour,
    ),
    orders,
    reservations,
    supplierReturns,
    serialOfRef,
  };
}
