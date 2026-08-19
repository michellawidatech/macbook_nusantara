/** Deterministic demo data. All money = whole rupiah numbers. */

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
  code: string;
  name: string;
  variantLabel: string;
  price: number;
}
export interface CatalogModel {
  id: string;
  name: string;
  category: string;
  releaseYear: number;
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
  price: number | null;
  description: string;
  poId: string | null;
  grade?: string;
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
}
export interface Po {
  id: string;
  code: string;
  supplierId: string;
  invoice: string;
  date: string;
  locationId: string;
  items: PoItem[];
  /** No `amount` — the owner dropped "amount paid"; a PO's total IS its lines. */
  payments: { method: string; fee: number }[];
  status: "DRAFT" | "ORDERED" | "RECEIVED";
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
  price?: number;
  description?: string;
  at: string;
  staff: string;
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  referralSourceId?: string;
  createdAt: string;
}
export interface Order {
  id: string;
  code: string;
  ts: string;
  customerId: string | null;
  serials: string[];
  prices: Record<string, number>;
  discount: number;
  discountId?: string;
  source: "OFFLINE" | "SHOPEE" | "INSTAGRAM" | "WHATSAPP";
  /** Who made the sale — a row in `salesmen`. The basis of per-staff KPI. */
  salesmanId?: string;
  referralSourceId?: string;
  shippingAddress?: string;
  payMethod: string;
  /** SHOPEE money arrives pending until withdrawal is confirmed. */
  settled: boolean;
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
  status: "PENDING" | "ARRIVED" | "DONE";
  /** Set on a supplier return that came out of a QC rejection. */
  fromQc?: boolean;
  exchangeSerial?: string;
  fee?: number;
  supplierId?: string;
  expectedCredit?: number;
}
export interface Reservation {
  id: string;
  serial: string;
  customerId: string;
  when: string;
  note: string;
  /** Which channel the customer reserved through. */
  sourceId?: string;
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
export interface Expense {
  id: string;
  label: string;
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
}
export interface OpnameRec {
  id: string;
  locationId: string;
  at: string;
  counted: string[];
  missing: string[];
  unknown: string[];
  /** serial → what the counter wrote about a missing or unknown unit. */
  notes: Record<string, string>;
  status: "OPEN" | "POSTED";
}
export interface ReferralSource {
  id: string;
  name: string;
  active: boolean;
}

export interface MockDb {
  warehouses: Warehouse[];
  racks: RackLocation[];
  suppliers: Supplier[];
  reasons: Reason[];
  reservationSources: ReservationSource[];
  salesmen: Salesman[];
  models: CatalogModel[];
  skus: Sku[];
  units: Unit[];
  events: UnitEvent[];
  pos: Po[];
  stockIns: StockInRec[];
  customers: Customer[];
  orders: Order[];
  returns: ReturnRec[];
  reservations: Reservation[];
  discounts: Discount[];
  expenses: Expense[];
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
    },
    { id: "sup-2", name: "CV Apel Segar", phone: "+62225550188" },
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
      source: "MANUAL",
      axes: [
        { name: "RAM", values: ["8GB", "16GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    },
  ];
  const skus: Sku[] = [];
  const basePrice: Record<string, number> = {
    "m-air-m2": 11_500_000,
    "m-pro14-m1": 16_500_000,
    "m-pro13-m1": 9_800_000,
  };
  for (const m of models) {
    let i = 0;
    for (const ram of m.axes[0]!.values) {
      for (const ssd of m.axes[1]!.values) {
        i += 1;
        skus.push({
          id: `${m.id}-v${i}`,
          modelId: m.id,
          code: `${m.id.toUpperCase().replace(/-/g, "")}${i}`,
          name: m.name,
          variantLabel: `${ram} / ${ssd}`,
          price:
            basePrice[m.id]! +
            (ram.startsWith("1") || ram.startsWith("3") ? 2_500_000 : 0) +
            (ssd === "512GB" || ssd === "1TB" ? 1_500_000 : 0),
        });
      }
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
        price: accessoryPrice[m.id]!,
      });
    });
  }
  models.push(...accessoryModels);

  const pos: Po[] = [
    {
      id: "po-1",
      code: "PI-2026/08-000041",
      supplierId: "sup-1",
      invoice: "INV/MJ/0812",
      date: iso(9).slice(0, 10),
      locationId: "wh-1",
      items: [],
      payments: [{ method: "Transfer BCA", fee: 0 }],
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
      status: "RECEIVED",
    },
  ];

  const units: Unit[] = [];
  const events: UnitEvent[] = [];
  const stockIns: StockInRec[] = [];
  let seq = 0;
  const addUnit = (
    skuId: string,
    status: UnitStatus,
    poId: string,
    daysAgo: number,
    desc: string,
  ) => {
    seq += 1;
    const serial = `C02${String(7_400_000 + seq * 137).slice(0, 7)}${["JK", "LM", "QX", "PN"][seq % 4]}`;
    const sku = skus.find((s) => s.id === skuId)!;
    const buy = Math.round(sku.price * 0.82);
    const inStock = status !== "QC";
    const po = pos.find((p) => p.id === poId)!;
    const locationId = po.locationId;
    const rackId = inStock ? `${locationId}-rack-${(seq % 3) + 1}` : undefined;
    units.push({
      serial,
      skuId,
      status,
      locationId,
      rackId,
      buy,
      price: inStock ? sku.price : null,
      description: inStock ? desc : "",
      poId,
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
        price: sku.price,
        description: desc,
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
  addUnit(
    "m-pro13-m1-v2",
    "TERSEDIA",
    "po-1",
    7,
    "Dent kiri bawah, battery 90%",
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
  // PO-2 and PO-3 (fresh): still waiting for QC, in two different warehouses,
  // which is what gives the Stock In page more than one accordion section.
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
      serial: s5,
      customerId: "c-2",
      when: iso(-1, 15),
      note: "Will pick up after payday",
      sourceId: "rsv-src-wa",
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
    },
  ];
  const opnames: OpnameRec[] = [
    {
      id: "op-1",
      locationId: "wh-1",
      at: iso(3, 18),
      counted: [s1],
      missing: [],
      unknown: [],
      notes: {},
      status: "POSTED",
    },
  ];

  return {
    warehouses,
    racks,
    suppliers,
    reasons,
    reservationSources,
    salesmen,
    models,
    skus,
    units,
    events,
    pos,
    stockIns,
    customers,
    orders,
    returns,
    reservations,
    discounts,
    expenses,
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
