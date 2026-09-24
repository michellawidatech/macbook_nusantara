/**
 * Seed — the shop, written into Postgres.
 *
 * ## What changed on 2026-09-07, and why
 *
 * This file used to GENERATE a shop: 5 000 units with serials like
 * `NUS0000001`, SKUs called "MacBook Air M1 129GB" with a variant label of
 * "24/180", and customers named "Pelanggan 1" through "Pelanggan 125". None of
 * it was wrong in a way a test could see — the ledger was gapless, the totals
 * added up, all eight reconciliation checks passed — and all of it was wrong
 * in the way that matters: Apple has never made a 24GB/180GB MacBook Air, an
 * M1 was priced at five times an M3, and `NUS0000001` is a string the
 * application's own `validateSerial` refuses.
 *
 * It was also a DIFFERENT shop from the one the browser showed. `apps/web`
 * renders a hand-written fixture and only three of its screens read this
 * database, so the deployed app disagreed with itself: Inventory listed
 * `SC02…` serials and S/N Tracking, asking the API, could not find a single
 * one of them. That is the bug this rewrite fixes, and the fix is not better
 * generation — it is one shop, defined once, in `@nusantara/fixture`, and
 * projected twice.
 *
 * ## The two rules that did not change
 *
 *   1. **Every unit's history is written through `appendUnitEvent`.** Nothing
 *      here inserts a `UnitEvent` or sets `Unit.status` directly. The seeded
 *      data is coherent by construction rather than by a developer keeping two
 *      columns in step, and the S4 helpers are exercised before any screen is.
 *   2. **Re-running resets cleanly.** The seed truncates first, so it is
 *      idempotent in the only sense that matters — the same command twice
 *      leaves the same database.
 *
 * ## `seedVolume`
 *
 * The generator survives, renamed, at the bottom of this file. It exists for
 * the load tests that need five thousand rows and assert on the count, and it
 * now builds them out of the fixture's real catalogue with serials the app
 * would accept. It is a PILE, not a shop: no purchase orders, no holds, no
 * returns. Never point a demo or a deployment at it.
 */

import {
  DISCOUNTS,
  REFERRAL_SOURCES,
  RESERVATION_SOURCES,
  buildShop,
  dateOf,
  type BuiltShop,
  type FixtureMoment,
} from "@nusantara/fixture";
import { appendUnitEvent } from "./appendUnitEvent.js";
import { type PrismaClient, type Tx } from "./client.js";
import { UNUSABLE_PASSWORD_HASH } from "./staffAccounts.js";

export interface SeedOptions {
  /**
   * Reference data only — locations, the catalogue, staff and the lookup
   * lists — with no units, no orders and no ledger.
   *
   * That is what a real shop starts from: its stock arrives through Inbound &
   * QC rather than out of a fixture, and thirty-seven invented serials in a
   * live database are thirty-seven things somebody has to know to ignore.
   */
  readonly referenceOnly?: boolean;
  /** Pin the clock. The fixture's dates are all relative to it. */
  readonly now?: number;
  readonly onProgress?: (message: string) => void;
}

/** mulberry32 — small, fast, and deterministic given a seed. Volume only. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Payment methods, recreated by every seed.
 *
 * The ids are fixed rather than generated so a fixture can name one — the
 * migration that introduced this table inserted the same rows under the same
 * ids. Deliberately restated here rather than read from the database: a
 * migration is a historical snapshot and never changes again, while this list
 * is the live one, and several test files truncate the whole schema before
 * calling `seed()`.
 *
 * `forPo` is true for the two ways a supplier is paid — cash and a transfer
 * (owner revision 2026-09-21). A card left the list on 2026-09-15 and
 * MARKETPLACE, which replaced it then, left on 2026-09-21: a supplier payment
 * asks how the SHOP's own money moved, and an escrow balance is not an answer
 * to that. Migrations `20260915090000_po_payment_methods` and
 * `20260921090000_po_payment_methods_cash_and_transfer` say the same to a
 * database that already exists, and `apps/web/src/mock/seed.ts` says it to the
 * browser — all three have to agree, or the till and the API offer different
 * lists.
 *
 * `builtIn` marks the rows application code reads by `code` (MARKETPLACE
 * drives Shopee escrow), which staff may rename or deactivate but never drop.
 */
const PAYMENT_METHODS = [
  { id: "pm_tunai", code: "TUNAI", label: "Cash", forPo: true, forSale: true },
  {
    id: "pm_kartu_kredit",
    code: "KARTU_KREDIT",
    label: "Credit card",
    forPo: false,
    forSale: true,
  },
  // DEPOSIT was a row here until 2026-09-09 (owner decision): a deposit is the
  // RESULT of a payment, not a way of making one. Money paid in advance is
  // paid by cash, transfer or card, and the allocation that later puts it
  // against an invoice carries that same method.
  { id: "pm_qris", code: "QRIS", label: "QRIS", forPo: false, forSale: true },
  {
    /*
     * Money that settles a debt without passing through either of the shop's
     * pots (owner ask 2026-09-23): *"Transfer from other bank for
     * expense/deposit to supplier, which does not reduce the bank balance in
     * the POS."* The owner pays a supplier from an account this app does not
     * keep, so the invoice is settled and the balance must not move.
     * `lib/accounts.ts` maps it to no pot, which is what makes that true.
     */
    id: "pm_transfer_luar",
    code: "TRANSFER_LUAR",
    label: "Transfer from another bank",
    forPo: true,
    forSale: false,
  },
  {
    // `forPo`, because a supplier deposit is nearly always a transfer.
    id: "pm_transfer",
    code: "TRANSFER",
    label: "Bank transfer",
    forPo: true,
    forSale: true,
  },
  {
    id: "pm_debit",
    code: "DEBIT",
    label: "Debit card",
    forPo: false,
    forSale: true,
  },
  {
    id: "pm_cicilan",
    code: "CICILAN",
    label: "Instalment",
    forPo: false,
    forSale: true,
  },
  {
    id: "pm_cod",
    code: "COD",
    label: "Cash on delivery",
    forPo: false,
    forSale: true,
  },
  {
    id: "pm_bayar_toko",
    code: "BAYAR_TOKO",
    label: "Pay in store",
    forPo: false,
    forSale: true,
  },
  {
    id: "pm_tempo",
    code: "TEMPO",
    label: "Terms",
    forPo: false,
    forSale: true,
  },
  {
    // NOT `forPo` since 2026-09-21 (owner revision): the invoice form offers
    // Cash and Bank transfer and nothing else. An escrow balance is not a way
    // of moving the shop's own money, which is the only question a supplier
    // payment asks. Still `forSale` — it is what a marketplace sale is written
    // with. Migration `20260921090000_po_payment_methods_cash_and_transfer`
    // says the same to a database that already exists.
    id: "pm_marketplace",
    code: "MARKETPLACE",
    label: "Marketplace escrow",
    forPo: false,
    forSale: true,
  },
] as const;

export const SYSTEM_STAFF_ID = "staff_system";

/** The chat agent's principal, so a bot-created UnitEvent is attributable. */
export const AGENT_STAFF_ID = "staff_agent";

/**
 * Seeded accounts carry no usable password.
 *
 * Deliberately: a seeded database must not be something anyone can sign in
 * to. `pnpm --filter @nusantara/api accounts` is the step that opens the door —
 * it gives every human account still carrying this hash the shop's initial
 * password, which the person must replace at first sign-in (2026-09-18).
 */
const UNUSABLE_HASH = UNUSABLE_PASSWORD_HASH;

const PAYMENT_METHOD_ID = new Map<string, string>(
  PAYMENT_METHODS.map((m) => [m.code, m.id]),
);

function methodId(code: string): string {
  const id = PAYMENT_METHOD_ID.get(code);
  if (id === undefined) throw new Error(`seed: no PaymentMethod ${code}`);
  return id;
}

const SHIFT_ID = "shift_1";
const OPEN_FLOAT = 500_000n;

/** Whole rupiah as the schema stores it. Money is never a JS number here. */
const rp = (n: number): bigint => BigInt(Math.round(n));

/**
 * The category attributes that hold a NUMBER, and what that number is in.
 *
 * Three of them since the battery split of 2026-09-08 — a percentage, a charge
 * count and a capacity in mAh — because `CategoryAttribute` is where a fact
 * that only some categories have belongs, and a machine's battery is exactly
 * that. Anything not named here is text.
 */
const NUMERIC_ATTRS: Readonly<Record<string, string | null>> = {
  baterai: "%",
  siklus: null,
  kapasitas: "mAh",
};

export interface SeedResult {
  readonly units: number;
  readonly events: number;
  readonly orders: number;
  readonly ms: number;
}

/**
 * Empty every table.
 *
 * TRUNCATE rather than DELETE, and that is not an optimisation: every foreign
 * key in this schema is `onDelete: Restrict` because nothing here is ever
 * hard-deleted, so "delete the reference data" means "delete it and everything
 * hanging off it, in an order that is a property of the whole schema". Several
 * test files used to write that order by hand, and every one of them fell over
 * the first time the fixture grew a table they had not listed — a purchase
 * order line, in September 2026, holding a SKU they were trying to delete.
 * Asking Postgres to empty the schema cannot fall behind the schema.
 *
 * Exported for exactly those tests. It runs as the owner role; the API's role
 * cannot truncate, which is the point of the three roles.
 *
 * ⚠️ It empties EVERY table. Never call it against a database holding a shop's
 * real ledger.
 */
export async function truncateAll(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT quote_ident(tablename) AS t FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Everything a shop has before it has any stock.
 *
 * Shared by both entry points, because a load test and a demo need the same
 * catalogue — that is the whole reason the pile stopped inventing its own.
 */
async function writeReference(
  db: PrismaClient,
  shop: BuiltShop,
  now: Date,
): Promise<void> {
  await db.location.createMany({
    data: shop.locations.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      kind: l.kind,
      address: l.address ?? null,
      active: true,
      sortOrder: l.sortOrder,
    })),
  });

  await db.appSetting.createMany({
    data: [
      // The battery bands Inventory filters on. 80 and up is healthy, 76–79
      // fair, below that tired — and the fixture's readings are chosen to sit
      // either side of those lines on purpose.
      { key: "battery.goodMin", value: "80", updatedAt: now },
      { key: "battery.fairMin", value: "76", updatedAt: now },
      // Who the shop is, as printed at the top of every faktur.
      { key: "shop.name", value: "NUSANTARA", updatedAt: now },
      {
        key: "shop.tagline",
        value: "Second-hand Apple — sales, trade-in and service",
        updatedAt: now,
      },
      {
        key: "shop.address",
        value: "Jl. Boulevard Raya Blok C2, Jakarta Utara",
        updatedAt: now,
      },
      {
        key: "shop.contact",
        value: "WhatsApp +62 811 2233 44 · @nusantara",
        updatedAt: now,
      },
    ],
  });

  // Several test files truncate the whole schema before calling this, so
  // reference data cannot assume it survived — including the rows that arrived
  // in a migration. `Reservation.reservationSourceId` is a Restrict FK at
  // these, so without them a hold cannot record which channel it came in over.
  await db.paymentMethod.createMany({
    data: PAYMENT_METHODS.map((m, i) => ({
      ...m,
      builtIn: true,
      active: true,
      sortOrder: i + 1,
      createdAt: now,
    })),
  });

  await db.reservationSource.createMany({
    data: RESERVATION_SOURCES.map((s, i) => ({
      id: s.id,
      name: s.name,
      active: true,
      sortOrder: i + 1,
      createdAt: now,
    })),
  });

  await db.referralSource.createMany({
    data: REFERRAL_SOURCES.map((s) => ({
      id: s.id,
      name: s.name,
      active: true,
      createdAt: now,
    })),
  });

  await db.staff.createMany({
    data: [
      ...shop.staff.map((s) => ({
        id: s.id,
        username: s.username,
        name: s.name,
        role: s.role,
        canApprove: s.canApprove,
        active: true,
        passwordHash: UNUSABLE_HASH,
        createdAt: now,
      })),
      {
        // The chat agent's principal. `UnitEvent.staffId` is NOT NULL, so a
        // reservation the bot creates needs a row to point at — and it must
        // NOT be SYSTEM_STAFF_ID, which is reserved for backfilled history and
        // would stop a report separating the two.
        id: AGENT_STAFF_ID,
        username: "agent",
        name: "Agen WhatsApp",
        role: "STAFF" as const,
        canApprove: false,
        active: false,
        passwordHash: UNUSABLE_HASH,
        createdAt: now,
      },
      {
        // 08 §8: backfilled history is attributable to a reserved system row,
        // so a report can always separate real history from reconstructed.
        id: SYSTEM_STAFF_ID,
        username: "system",
        name: "Sistem (migrasi)",
        role: "STAFF" as const,
        canApprove: false,
        active: false,
        passwordHash: UNUSABLE_HASH,
        createdAt: now,
      },
    ],
  });

  // --- the catalogue -------------------------------------------------------
  for (const [i, c] of shop.categories.entries()) {
    await db.category.create({
      data: {
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        // Absent in the fixture means yes, which is the column's own default:
        // every category that existed before 2026-09-15 was tracked by serial.
        tracksSerial: c.tracksSerial ?? true,
        marginMode: "PCT",
        marginMin: 8n,
        marginMax: 25n,
        createdAt: now,
      },
    });
    await db.categoryAttribute.createMany({
      data: c.attributes.map((key, j) => ({
        id: `attr_${i}_${j}`,
        categoryId: c.id,
        key,
        label: key[0]!.toUpperCase() + key.slice(1),
        // The three battery attributes are numbers and Inventory bands them,
        // so saying so here is what lets each column sort as one. Their units
        // differ, which is the whole point of the 2026-09-08 split: a
        // percentage, a count, and a capacity in mAh.
        type:
          NUMERIC_ATTRS[key] === undefined
            ? ("TEXT" as const)
            : ("NUMBER" as const),
        unit: NUMERIC_ATTRS[key] ?? null,
        sortOrder: j + 1,
      })),
    });
    // The axes this category's models actually vary along, de-duplicated —
    // an Intel Pro adds Chip and Touch Bar to the RAM x SSD every Mac has.
    const axes = [
      ...new Set(
        shop.models
          .filter((m) => m.categoryId === c.id)
          .flatMap((m) => m.axes.map((a) => a.name)),
      ),
    ];
    await db.categoryVariantAxis.createMany({
      data: axes.map((name, j) => ({
        id: `axis_${i}_${j}`,
        categoryId: c.id,
        name,
        sortOrder: j + 1,
      })),
    });
  }

  await db.catalogModel.createMany({
    data: shop.models.map((m) => ({
      id: m.id,
      categoryId: m.categoryId,
      name: m.name,
      year: String(m.releaseYear),
      line: m.line ?? null,
      sizeInch: m.sizeInch ?? null,
      archived: false,
      createdAt: now,
    })),
  });

  for (const m of shop.models) {
    for (const [j, axis] of m.axes.entries()) {
      const axisId = `maxis_${m.id}_${j}`;
      await db.modelAxis.create({
        data: { id: axisId, modelId: m.id, name: axis.name, sortOrder: j + 1 },
      });
      await db.modelAxisValue.createMany({
        data: axis.values.map((value, k) => ({
          id: `${axisId}_${k}`,
          axisId,
          value,
          sortOrder: k + 1,
        })),
      });
    }
  }

  await db.sku.createMany({
    data: shop.skus.map((s) => ({
      id: s.id,
      modelId: s.modelId,
      code: s.code,
      name: s.name,
      variantLabel: s.variantLabel,
      // No grade on the variant: since 2026-08-27 the grade is a fact about a
      // SERIAL, and `Sku.price` is the only sellable price.
      grade: null,
      price: rp(s.price),
      landed: rp(s.landed),
      archived: false,
      createdAt: now,
    })),
  });

  await db.customer.createMany({
    data: shop.customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      street: c.address ?? null,
      referralSourceId: c.referralSourceId,
      createdAt: dateOf(c.since, shop.now),
    })),
  });

  await db.discount.createMany({
    data: DISCOUNTS.map((d) => ({
      id: d.id,
      code: d.code,
      type: d.type,
      pct: d.pct ?? null,
      amountRp: d.amountRp === undefined ? null : rp(d.amountRp),
      maxRp: d.maxRp === undefined ? null : rp(d.maxRp),
      description: d.name,
      usageLimit: d.usageLimit,
      used: d.used,
      fromDate: dateOf(d.from, shop.now),
      toDate: dateOf(d.to, shop.now),
      active: true,
      scope: "SEMUA" as const,
    })),
  });

  await db.finSettings.create({
    data: { id: "singleton", cash: 0n, equipment: 25_000_000n, updatedAt: now },
  });
  await db.pettyCash.create({
    data: { id: "singleton", opening: 1_000_000n, updatedAt: now },
  });
  await db.igSettings.create({
    data: {
      id: "singleton",
      autoReply: false,
      replyTemplate: "Halo kak, stok ready ya. Cek DM 🙌",
      dmTemplate: "Halo kak, terima kasih sudah menghubungi Nusantara.",
      updatedAt: now,
    },
  });
}

/**
 * The shop, written into Postgres.
 *
 * Order matters and is driven by the foreign keys: an invoice before the
 * machines on it, the machines before the sale that names them, the sale
 * before the ledger row that points at it. The ledger is replayed LAST, per
 * machine and in sequence, because `appendUnitEvent` derives each transition
 * from the one before it — which is exactly the property that makes the
 * seeded history coherent rather than merely consistent.
 */
export async function seed(
  db: PrismaClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const log = options.onProgress ?? (() => undefined);
  const started = Date.now();
  const shop = buildShop(options.now ?? Date.now());
  const now = new Date(shop.now);
  const when = (m: FixtureMoment) => dateOf(m, shop.now);

  await truncateAll(db);
  log("reset");

  await writeReference(db, shop, now);
  log(
    `referensi: ${shop.locations.length} lokasi, ${shop.models.length} model, ${shop.skus.length} sku`,
  );

  if (options.referenceOnly === true) {
    const ms = Date.now() - started;
    log(`selesai dalam ${ms} ms`);
    return { units: 0, events: 0, orders: 0, ms };
  }

  // --- suppliers and their invoices ----------------------------------------
  await db.supplier.createMany({
    data: shop.suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      wa: s.phone ?? null,
      // ⚠️ `Supplier.code` does not exist in prisma. The two-letter origin code
      // the store barcode is built from lives in the fixture and in the
      // browser mock only; carrying it here needs a migration and an owner
      // decision (CLAUDE.md, 2026-09-01).
      note: s.address ?? null,
      active: true,
      createdAt: now,
    })),
  });

  for (const po of shop.purchaseOrders) {
    await db.purchaseOrder.create({
      data: {
        id: po.id,
        code: po.code,
        supplierId: po.supplierId,
        invoice: po.invoice,
        noInvoice: false,
        status: po.status,
        orderedAt: when(po.ordered),
        receivedAt: po.received === undefined ? null : when(po.received),
        closedAt: po.closed === undefined ? null : when(po.closed),
        subtotal: rp(po.subtotal),
        feesTaxPct: 0,
        feesTotal: rp(po.feesTotal),
        total: rp(po.total),
        locationId: po.locationId,
        staffId: "staff_owner",
        note: po.note ?? null,
        createdAt: when(po.ordered),
      },
    });
    await db.purchaseOrderItem.createMany({
      data: po.lines.map((l) => ({
        id: l.id,
        poId: po.id,
        skuId: l.skuId,
        produk: l.produk,
        spec: l.spec,
        qty: l.qty,
        unitCost: rp(l.unitCost),
        lineTotal: rp(l.lineTotal),
        allocatedFee: rp(l.allocatedFee),
      })),
    });
    await db.purchaseOrderFee.createMany({
      data: po.fees.map((f) => ({
        id: f.id,
        poId: po.id,
        label: f.label,
        kind: f.kind,
        amount: rp(f.amount),
      })),
    });
  }
  log(`pembelian: ${shop.purchaseOrders.length} faktur`);

  // --- the machines ---------------------------------------------------------
  //
  // Created in QC at the invoice's own location, because that is where every
  // one of them genuinely started. The ledger replay below moves each to where
  // it actually is; `Unit.status` is a projection and never written by hand.
  await db.unit.createMany({
    data: shop.units.map((u) => ({
      id: `u_${u.ref}`,
      serial: u.serial,
      skuId: u.skuId,
      status: "QC" as const,
      locationId: shop.purchaseOrders.find((p) => p.id === u.poId)!.locationId,
      buy: rp(u.buy),
      landed: rp(u.landed),
      grade: u.grade ?? null,
      description: u.description === "" ? null : u.description,
      poItemId: u.poLineId,
      intakeAt: when(u.intakeAt),
      version: 1,
    })),
  });

  // The serial as the invoice line recorded it — what a receiving clerk typed
  // or scanned against that line, and what ties a machine to the paper.
  await db.purchaseOrderItemSerial.createMany({
    data: shop.units.map((u) => ({
      id: `pois_${u.ref}`,
      itemId: u.poLineId,
      serial: u.serial,
      unitId: `u_${u.ref}`,
    })),
  });

  /*
   * A machine's battery, as per-unit values of its category's attributes.
   *
   * It has no column on `Unit` — `CategoryAttribute` is where a fact that only
   * some categories have belongs, which is also what makes it a column
   * Inventory can render without anything being hardcoded. That turns out to
   * be exactly the right shape for the 2026-09-08 era split: a 2020-or-earlier
   * machine writes `siklus` and `kapasitas`, a later one writes `baterai`, and
   * neither needs a migration.
   *
   * ⚠️ This wrote NOTHING at all until 2026-09-08. The lookup asked for the
   * key `baterai` and the fixture's categories declared `siklus`, so the query
   * matched no attribute and every unit silently got no reading. Both sides
   * now name all three.
   */
  const batteryAttr = await db.categoryAttribute.findMany({
    where: { key: { in: ["baterai", "siklus", "kapasitas"] } },
    select: { id: true, categoryId: true, key: true },
  });
  const attrIdOf = new Map(
    batteryAttr.map((a) => [`${a.categoryId}/${a.key}`, a.id]),
  );
  const categoryOfSku = new Map(
    shop.skus.map((s) => [
      s.id,
      shop.models.find((m) => m.id === s.modelId)!.categoryId,
    ]),
  );
  await db.unitAttribute.createMany({
    data: shop.units.flatMap((u) => {
      const category = categoryOfSku.get(u.skuId)!;
      const readings: [string, number | undefined][] = [
        ["baterai", u.battery],
        ["siklus", u.cycleCount],
        ["kapasitas", u.fcc],
      ];
      return readings.flatMap(([key, value]) => {
        if (value === undefined) return [];
        const attributeId = attrIdOf.get(`${category}/${key}`);
        if (attributeId === undefined) return [];
        return [
          {
            id: `uattr_${u.ref}_${key}`,
            unitId: `u_${u.ref}`,
            attributeId,
            value: String(value),
          },
        ];
      });
    }),
  });
  log(`unit: ${shop.units.length}`);

  // --- the till, open since this morning -----------------------------------
  await db.shift.create({
    data: {
      id: SHIFT_ID,
      staffId: "staff_kasir",
      locationId: "wh-1",
      status: "BUKA",
      openedAt: when({ daysAgo: 0, hour: 8 }),
      closedAt: null,
      openFloat: OPEN_FLOAT,
      // Filled in once the sales are known — check 8 compares this against the
      // float plus the cash that actually passed through.
      expected: OPEN_FLOAT,
      declared: 0n,
      variance: 0n,
    },
  });

  // --- holds ----------------------------------------------------------------
  for (const r of shop.reservations) {
    const customer = shop.customers.find((c) => c.id === r.customerId)!;
    await db.reservation.create({
      data: {
        id: r.id,
        code: r.code,
        customerId: r.customerId,
        custName: customer.name,
        phone: customer.phone,
        scheduledFor: when(r.scheduledFor),
        status: "TERJADWAL",
        source: "STAF",
        reservationSourceId: r.sourceId,
        note: r.note,
        createdAt: when(r.created),
      },
    });
    await db.reservationItem.createMany({
      data: r.serials.map((serial, i) => {
        const unit = shop.units.find((u) => u.serial === serial)!;
        return {
          id: `${r.id}-item-${i + 1}`,
          reservationId: r.id,
          skuId: unit.skuId,
          unitId: `u_${unit.ref}`,
          qty: 1,
        };
      }),
    });
  }
  log(`reservasi: ${shop.reservations.length}`);

  // --- sales ----------------------------------------------------------------
  let cashIn = 0n;
  for (const o of shop.orders) {
    const customer = shop.customers.find((c) => c.id === o.customerId)!;
    const staff = shop.staff.find((s) => s.salesmanId === o.salesmanId)!;
    // Only today's sales pass through the open till; the older ones were rung
    // up on shifts that have long since been counted and closed.
    const onShift = o.at.daysAgo === 0;
    await db.order.create({
      data: {
        id: o.id,
        code: o.code,
        ts: when(o.at),
        customerId: o.customerId,
        custName: customer.name,
        phone: customer.phone,
        platform:
          o.channel === "INSTAGRAM"
            ? "IG"
            : o.channel === "WHATSAPP"
              ? "WA"
              : o.channel,
        fulfill: o.fulfil,
        status: o.status,
        subtotal: rp(o.subtotal),
        discountId: o.discountId ?? null,
        discount: rp(o.discount),
        extra: rp(o.extra ?? 0),
        extraNote: o.extraNote ?? null,
        total: rp(o.total),
        paidTotal: rp(o.paidTotal),
        cogs: rp(o.cogs),
        tradeCredit: 0n,
        belowFloor: false,
        soldById: staff.id,
        shiftId: onShift ? SHIFT_ID : null,
        locationId: "wh-1",
        referralSourceId: o.referralSourceId,
      },
    });

    for (const l of o.builtLines) {
      const unit = shop.units.find((u) => u.serial === l.serial)!;
      await db.orderItem.create({
        data: {
          id: l.id,
          orderId: o.id,
          unitId: `u_${unit.ref}`,
          skuId: l.skuId,
          name: l.name,
          variant: l.variant,
          qty: 1,
          price: rp(l.price),
          sub: rp(l.sub),
          cogs: rp(l.cogs),
          garansiUntil:
            l.warrantyUntil === undefined ? null : when(l.warrantyUntil),
          // A returned line is closed on the way back in, so invariant 3 never
          // sees one serial on two open lines.
          returnedQty: o.returnedAt === undefined ? 0 : 1,
          returnedAt: o.returnedAt === undefined ? null : when(o.returnedAt),
          returnReason: o.returnReason ?? null,
        },
      });
      // Only a machine that is actually gone points at the line that took it.
      if (o.returnedAt === undefined) {
        await db.unit.update({
          where: { id: `u_${unit.ref}` },
          data: { soldOrderItemId: l.id },
        });
      }
    }

    // Accessories on the receipt, by quantity — lines with no unit
    // (2026-09-19). Their cost is the moving average the TERJUAL stock moves
    // below carry.
    for (const [i, l] of o.countedLines.entries()) {
      await db.orderItem.create({
        data: {
          id: l.id,
          orderId: o.id,
          unitId: null,
          skuId: l.skuId,
          name: l.name,
          variant: l.variant,
          qty: l.qty,
          price: rp(l.price),
          sub: rp(l.sub),
          cogs: rp(l.cogs),
          listPrice: rp(l.listPrice),
          returnedQty: 0,
          sortOrder: o.builtLines.length + i,
        },
      });
    }

    for (const p of o.payments) {
      const cash = p.method === "TUNAI";
      await db.payment.create({
        data: {
          id: p.id,
          orderId: o.id,
          direction: p.direction,
          methodId: methodId(p.method),
          amount: rp(p.amount),
          status: p.status,
          paidAt: p.status === "LUNAS" ? when(p.at) : null,
          staffId: staff.id,
          shiftId: onShift && cash ? SHIFT_ID : null,
        },
      });
      if (onShift && cash && p.status === "LUNAS") {
        cashIn += p.direction === "KELUAR" ? -rp(p.amount) : rp(p.amount);
      }
    }
  }
  log(`penjualan: ${shop.orders.length} order`);

  // --- counted products: the stock ledger ----------------------------------
  // Accessories have no units (2026-09-19); what a shelf holds of one is the
  // sum of these rows.
  await db.stockMove.createMany({
    data: shop.stockMoves.map((m) => ({
      id: m.id,
      skuId: m.skuId,
      locationId: m.locationId,
      qty: m.qty,
      unitCost: rp(m.cost),
      type: m.type,
      at: when(m.at),
      refCode:
        m.orderId !== undefined
          ? shop.orders.find((o) => o.id === m.orderId)!.code
          : m.poId !== undefined
            ? shop.purchaseOrders.find((p) => p.id === m.poId)!.code
            : null,
      purchaseOrderId: m.poId ?? null,
      poItemId: m.poLineId ?? null,
      orderId: m.orderId ?? null,
      orderItemId: m.orderLineId ?? null,
      staffId: m.staffId,
    })),
  });
  log(`stok per jumlah: ${shop.stockMoves.length} pergerakan`);

  // --- what was paid to suppliers ------------------------------------------
  for (const po of shop.purchaseOrders) {
    for (const p of po.payments) {
      await db.payment.create({
        data: {
          id: p.id,
          poId: po.id,
          direction: "KELUAR",
          methodId: methodId(p.method),
          amount: rp(p.rupiah),
          appliedTo: p.appliedTo,
          poFeeId: p.feeId ?? null,
          status: "LUNAS",
          paidAt: when(p.at),
          staffId: "staff_owner",
        },
      });
    }
  }

  // --- what went back to a supplier ----------------------------------------
  for (const r of shop.supplierReturns) {
    const unit = shop.units.find((u) => u.serial === r.serial)!;
    await db.supplierReturn.create({
      data: {
        id: r.id,
        code: r.code,
        supplierId: r.supplierId,
        poId: r.poId,
        status: "SELESAI",
        reason: r.reason,
        staffId: "staff_owner",
        createdAt: when(r.at),
      },
    });
    await db.supplierReturnItem.create({
      data: {
        id: `${r.id}-item-1`,
        returnId: r.id,
        unitId: `u_${unit.ref}`,
        amount: rp(r.amount),
        note: r.reason,
      },
    });
  }

  // --- the ledger, replayed ------------------------------------------------
  //
  // Small transactions on purpose. Each `appendUnitEvent` is several round
  // trips — a row lock, a MAX(seq), an insert and the projection — and the
  // production ceiling is ten seconds. A few machines per transaction is what
  // makes this survivable over the internet, which is the only way a hosted
  // database ever gets this fixture.
  const CHUNK = 2;
  let events = 0;
  for (let start = 0; start < shop.units.length; start += CHUNK) {
    const chunk = shop.units.slice(start, start + CHUNK);
    const written = await db.$transaction(
      async (tx: Tx) => {
        let n = 0;
        for (const unit of chunk) {
          for (const e of shop.events.filter((x) => x.serial === unit.serial)) {
            await appendUnitEvent(tx, {
              serial: e.serial,
              type: e.type as Parameters<typeof appendUnitEvent>[1]["type"],
              staffId: e.staffId,
              at: when(e.at),
              toLocationId: e.toLocationId,
              orderId: e.orderId ?? null,
              purchaseOrderId: e.purchaseOrderId ?? null,
              reservationId: e.reservationId ?? null,
              // What the machine cost the shop, recorded once, on arrival.
              costDelta: e.type === "DITERIMA" ? rp(unit.landed) : 0n,
              note: e.note ?? null,
            });
            n += 1;
          }
        }
        return n;
      },
      // Seeding is a bulk job, not a checkout: the production ceiling is
      // deliberately not applied here.
      { maxWait: 10_000, timeout: 120_000 },
    );
    events += written;
    if ((start / CHUNK) % 5 === 0) {
      log(
        `riwayat: ${Math.min(start + CHUNK, shop.units.length)}/${shop.units.length}`,
      );
    }
  }

  // The till must reconcile: check 8 compares expected against float plus net
  // cash. Nothing has been counted yet, so `declared` and `variance` stay at
  // zero — this shift is open.
  await db.shift.update({
    where: { id: SHIFT_ID },
    data: { expected: OPEN_FLOAT + cashIn },
  });
  await db.finSettings.update({
    where: { id: "singleton" },
    data: { cash: OPEN_FLOAT + cashIn },
  });

  const ms = Date.now() - started;
  log(`selesai dalam ${ms} ms`);
  return {
    units: shop.units.length,
    events,
    orders: shop.orders.length,
    ms,
  };
}

export interface VolumeOptions {
  /** How many machines to pile up. */
  readonly units?: number;
  readonly seed?: number;
  readonly now?: number;
  readonly onProgress?: (message: string) => void;
}

/**
 * A pile of stock, for the tests that need thousands of rows.
 *
 * This is NOT a shop and must never be what a demo or a deployment holds. It
 * has no purchase orders, no holds, no returns and no supplier — it exists so
 * that pagination, sorting and filtering can be exercised at the scale the
 * Inventory screen states, which thirty-seven machines cannot do.
 *
 * What it no longer does is invent a catalogue. It draws its variants from
 * `@nusantara/fixture`, so a machine in the pile is a machine Apple made at a
 * price the shop might ask, and its serial is one the application would
 * accept. A load fixture full of impossible products is how a demo ends up
 * showing a 24GB/180GB MacBook Air.
 */
export async function seedVolume(
  db: PrismaClient,
  options: VolumeOptions = {},
): Promise<SeedResult> {
  const log = options.onProgress ?? (() => undefined);
  const started = Date.now();
  const count = options.units ?? 5_000;
  const rand = rng(options.seed ?? 20260815);
  const shop = buildShop(options.now ?? Date.now());
  const now = new Date(shop.now);

  await truncateAll(db);
  await writeReference(db, shop, now);
  log(`referensi: ${shop.skus.length} sku`);

  await db.shift.create({
    data: {
      id: SHIFT_ID,
      staffId: "staff_kasir",
      locationId: "wh-1",
      status: "TUTUP",
      openedAt: new Date(now.getTime() - 8 * 3_600_000),
      closedAt: now,
      openFloat: OPEN_FLOAT,
      expected: OPEN_FLOAT,
      declared: OPEN_FLOAT,
      variance: 0n,
    },
  });

  const GRADES = ["A", "B", "C", "NEW"] as const;
  const units = Array.from({ length: count }, (_, i) => {
    const sku = shop.skus[i % shop.skus.length]!;
    return {
      id: `unit_${i}`,
      // A different band from the shop's own serials, so a pile and a fixture
      // can never be confused for one another — and still `S` plus twelve, so
      // the app would scan it.
      serial: `SC03${String(i + 1).padStart(7, "0")}${["JK", "LM", "QX", "PN"][i % 4]!}`,
      skuId: sku.id,
      status: "QC" as const,
      // Every location carries stock: the inventory filter tests take the
      // first two rows of `Location` and expect both to be non-empty.
      locationId: shop.locations[i % shop.locations.length]!.id,
      buy: rp(sku.landed),
      landed: rp(sku.landed),
      grade: GRADES[i % GRADES.length]!,
      description: null,
      intakeAt: now,
      version: 1,
    };
  });
  await db.unit.createMany({ data: units });
  log(`unit: ${units.length}`);

  let events = 0;
  let orders = 0;
  const CHUNK = 200;
  for (let start = 0; start < units.length; start += CHUNK) {
    const chunk = units.slice(start, start + CHUNK);
    const written = await db.$transaction(
      async (tx: Tx) => {
        let n = 0;
        let sales = 0;
        for (const unit of chunk) {
          await appendUnitEvent(tx, {
            serial: unit.serial,
            type: "DITERIMA",
            staffId: SYSTEM_STAFF_ID,
            toLocationId: unit.locationId,
            costDelta: unit.landed,
            note: "backfill: migrasi",
          });
          await appendUnitEvent(tx, {
            serial: unit.serial,
            type: "QC_SELESAI",
            staffId: SYSTEM_STAFF_ID,
            note: "backfill: QC lulus",
          });
          n += 2;

          // A third of the pile has sold, so the status filter has something
          // to filter and the order checks have something to check.
          if (rand() < 0.35) {
            const sku = shop.skus.find((s) => s.id === unit.skuId)!;
            const price = rp(sku.price);
            const order = await tx.order.create({
              data: {
                ts: now,
                customerId: shop.customers[sales % shop.customers.length]!.id,
                platform: "OFFLINE",
                fulfill: "PICKUP",
                status: "LUNAS",
                subtotal: price,
                discount: 0n,
                extra: 0n,
                // Invariant 5: total is derived, never taken on trust.
                total: price,
                paidTotal: price,
                cogs: unit.landed,
                tradeCredit: 0n,
                belowFloor: false,
                soldById: "staff_kasir",
                locationId: unit.locationId,
              },
              select: { id: true },
            });
            const item = await tx.orderItem.create({
              data: {
                orderId: order.id,
                unitId: unit.id,
                skuId: sku.id,
                name: sku.name,
                variant: sku.variantLabel,
                qty: 1,
                price,
                sub: price,
                cogs: unit.landed,
                garansiUntil: new Date(now.getTime() + 90 * 86_400_000),
                returnedQty: 0,
              },
              select: { id: true },
            });
            await tx.payment.create({
              data: {
                orderId: order.id,
                direction: "MASUK",
                methodId: methodId("TRANSFER"),
                amount: price,
                status: "LUNAS",
                paidAt: now,
                staffId: "staff_kasir",
              },
            });
            await appendUnitEvent(tx, {
              serial: unit.serial,
              type: "TERJUAL",
              staffId: "staff_kasir",
              orderId: order.id,
            });
            await tx.unit.update({
              where: { id: unit.id },
              data: { soldOrderItemId: item.id },
            });
            n += 1;
            sales += 1;
          }
        }
        return { n, sales };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    events += written.n;
    orders += written.sales;
    if ((start / CHUNK) % 5 === 0) {
      log(`riwayat: ${start + chunk.length}/${units.length}`);
    }
  }

  const ms = Date.now() - started;
  log(`selesai dalam ${ms} ms`);
  return { units: units.length, events, orders, ms };
}
