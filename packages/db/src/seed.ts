/**
 * Seed — realistic data for developing and demoing against.
 *
 * Two rules shape the whole file:
 *
 *   1. **Every unit's history is written through `appendUnitEvent`.** Nothing
 *      here inserts a UnitEvent or sets Unit.status directly. That is not
 *      pedantry: it means the seeded data is coherent by construction rather
 *      than by a developer remembering to keep two columns in step, and it
 *      exercises the S4 helpers on 5 000 units before any screen does.
 *   2. **Re-running resets cleanly.** The seed truncates first, so it is
 *      idempotent in the only sense that matters — the same command twice
 *      leaves the same database.
 *
 * Randomness is a seeded PRNG, never Math.random: the same seed produces the
 * same shop, so a bug found against seeded data can be reproduced.
 */

import { appendUnitEvent } from "./appendUnitEvent.js";
import { type PrismaClient, type Tx } from "./client.js";

export interface SeedOptions {
  /** 5 000 in the real seed; smaller in tests that only need shape. */
  readonly units?: number;
  readonly skus?: number;
  readonly models?: number;
  readonly seed?: number;
  readonly onProgress?: (message: string) => void;
}

/** mulberry32 — small, fast, and deterministic given a seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  {
    name: "MacBook",
    axes: ["RAM", "Penyimpanan"],
    attrs: ["prosesor", "layar", "siklus"],
  },
  {
    name: "iPhone",
    axes: ["Penyimpanan", "Warna"],
    attrs: ["baterai", "imei", "kondisi"],
  },
  {
    name: "iPad",
    axes: ["Penyimpanan", "Konektivitas"],
    attrs: ["generasi", "layar"],
  },
  {
    name: "Apple Watch",
    axes: ["Ukuran", "Konektivitas"],
    attrs: ["baterai", "casing"],
  },
  { name: "Aksesori", axes: ["Warna"], attrs: ["garansi"] },
] as const;

const MODEL_NAMES: Record<string, readonly string[]> = {
  MacBook: [
    "Air M1",
    "Air M2",
    "Air M3",
    "Pro 13 M1",
    "Pro 13 M2",
    "Pro 14 M1 Pro",
    "Pro 14 M3 Pro",
    "Pro 16 M2 Max",
    "Pro 16 M3 Max",
  ],
  iPhone: [
    "11",
    "12",
    "12 Pro",
    "13",
    "13 Pro",
    "14",
    "14 Pro",
    "15",
    "15 Pro",
    "16",
  ],
  iPad: [
    "Air 4",
    "Air 5",
    "Air 6",
    "Pro 11",
    "Pro 12.9",
    "Gen 9",
    "Gen 10",
    "mini 6",
  ],
  "Apple Watch": [
    "SE",
    "SE 2",
    "Series 6",
    "Series 7",
    "Series 8",
    "Series 9",
    "Ultra",
    "Ultra 2",
  ],
  Aksesori: [
    "Magic Keyboard",
    "Magic Mouse",
    "Apple Pencil 2",
    "AirPods Pro 2",
    "AirPods 4",
    "Adapter 67W",
    "Adapter 96W",
  ],
};

const LOCATIONS = [
  {
    id: "loc_toko",
    code: "TOKO-1",
    name: "Toko Bandung",
    kind: "TOKO" as const,
    sortOrder: 1,
  },
  {
    id: "loc_gudang",
    code: "GDG-1",
    name: "Gudang Pusat",
    kind: "GUDANG" as const,
    sortOrder: 2,
  },
  {
    id: "loc_servis",
    code: "SRV-1",
    name: "Meja Servis",
    kind: "SERVIS" as const,
    sortOrder: 3,
  },
];

export const SYSTEM_STAFF_ID = "staff_system";

/**
 * A placeholder Argon2id hash.
 *
 * Deliberately not a hash of a real password: seeded accounts must not be
 * usable until someone sets a password through the API. It is a syntactically
 * valid hash of a random value, so nothing can log in as them.
 */
const UNUSABLE_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c2VlZGVkbm9sb2dpbnNhbHQ$Zm9yY2VkdG9mYWlsdmVyaWZpY2F0aW9u";

export interface SeedResult {
  readonly units: number;
  readonly events: number;
  readonly orders: number;
  readonly ms: number;
}

export async function seed(
  db: PrismaClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const unitCount = options.units ?? 5_000;
  const skuCount = options.skus ?? 300;
  const modelCount = options.models ?? 40;
  const log = options.onProgress ?? (() => undefined);
  const rand = rng(options.seed ?? 20260815);
  const started = Date.now();

  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(rand() * xs.length)] as T;
  const between = (lo: number, hi: number): number =>
    lo + Math.floor(rand() * (hi - lo + 1));

  // --- reset ---------------------------------------------------------------
  // TRUNCATE rather than DELETE: it is the only thing that resets cleanly in
  // the presence of the FK graph, and the seed runs as the owner role.
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT quote_ident(tablename) AS t FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`,
  );
  log("reset");

  // --- reference data ------------------------------------------------------
  const now = new Date();

  await db.location.createMany({
    data: LOCATIONS.map((l) => ({ ...l, active: true })),
  });

  await db.staff.createMany({
    data: [
      {
        id: "staff_owner",
        username: "pemilik",
        name: "Pemilik Toko",
        role: "OWNER",
        canApprove: true,
        active: true,
        passwordHash: UNUSABLE_HASH,
        createdAt: now,
      },
      {
        id: "staff_kasir",
        username: "kasir",
        name: "Kasir Toko",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: UNUSABLE_HASH,
        createdAt: now,
      },
      {
        // 08 §8: backfilled history is attributable to a reserved system row,
        // so a report can always separate real history from reconstructed.
        id: SYSTEM_STAFF_ID,
        username: "system",
        name: "Sistem (migrasi)",
        role: "STAFF",
        canApprove: false,
        active: false,
        passwordHash: UNUSABLE_HASH,
        createdAt: now,
      },
    ],
  });

  // --- catalogue -----------------------------------------------------------
  const categoryIds: string[] = [];
  for (const [i, c] of CATEGORIES.entries()) {
    const id = `cat_${i}`;
    categoryIds.push(id);
    await db.category.create({
      data: {
        id,
        name: c.name,
        sortOrder: i + 1,
        marginMode: "PCT",
        marginMin: 8n,
        marginMax: 25n,
        createdAt: now,
      },
    });
    await db.categoryAttribute.createMany({
      data: c.attrs.map((key, j) => ({
        id: `attr_${i}_${j}`,
        categoryId: id,
        key,
        label: key[0]!.toUpperCase() + key.slice(1),
        type: "TEXT" as const,
        sortOrder: j + 1,
      })),
    });
    await db.categoryVariantAxis.createMany({
      data: c.axes.map((name, j) => ({
        id: `axis_${i}_${j}`,
        categoryId: id,
        name,
        sortOrder: j + 1,
      })),
    });
  }
  log("kategori");

  const models: { id: string; categoryId: string; name: string }[] = [];
  let m = 0;
  outer: for (const [i, c] of CATEGORIES.entries()) {
    for (const name of MODEL_NAMES[c.name] ?? []) {
      if (m >= modelCount) break outer;
      models.push({
        id: `model_${m}`,
        categoryId: `cat_${i}`,
        name: `${c.name} ${name}`,
      });
      m += 1;
    }
  }
  await db.catalogModel.createMany({
    data: models.map((mm, i) => ({
      ...mm,
      year: String(2019 + (i % 6)),
      archived: false,
      createdAt: now,
    })),
  });

  const skus = Array.from({ length: skuCount }, (_, i) => {
    const model = models[i % models.length]!;
    const landed = BigInt(between(2_000, 28_000) * 1_000);
    return {
      id: `sku_${i}`,
      modelId: model.id,
      code: `SKU-${String(i + 1).padStart(4, "0")}`,
      name: `${model.name} ${between(128, 512)}GB`,
      variantLabel: `${between(8, 32)}/${between(128, 512)}`,
      grade: pick(["A", "B", "C"] as const),
      // Price above landed, so margins are positive and the CHECKs hold.
      price: landed + BigInt(between(500, 4_000) * 1_000),
      landed,
      archived: false,
      createdAt: now,
    };
  });
  await db.sku.createMany({ data: skus });
  log(`katalog: ${models.length} model, ${skus.length} sku`);

  // --- customers and a shift ----------------------------------------------
  const customers = Array.from(
    { length: Math.max(20, Math.floor(unitCount / 40)) },
    (_, i) => ({
      id: `cust_${i}`,
      name: `Pelanggan ${i + 1}`,
      phone: `+62812${String(10_000_000 + i).padStart(8, "0")}`,
      createdAt: now,
    }),
  );
  await db.customer.createMany({ data: customers });

  const SHIFT_ID = "shift_1";
  const OPEN_FLOAT = 500_000n;
  await db.shift.create({
    data: {
      id: SHIFT_ID,
      staffId: "staff_kasir",
      locationId: "loc_toko",
      status: "TUTUP",
      openedAt: new Date(now.getTime() - 8 * 3_600_000),
      closedAt: now,
      openFloat: OPEN_FLOAT,
      // Filled in once the sales are known — it must equal what the till saw.
      expected: 0n,
      declared: 0n,
      variance: 0n,
    },
  });

  // --- units, and their histories -----------------------------------------
  const units = Array.from({ length: unitCount }, (_, i) => {
    const sku = skus[i % skus.length]!;
    return {
      id: `unit_${i}`,
      // Zero-padded so ascending string order matches creation order, which
      // keeps the ordered-locking story easy to reason about.
      serial: `NUS${String(i + 1).padStart(7, "0")}`,
      skuId: sku.id,
      status: "TERSEDIA" as const,
      locationId: "loc_gudang",
      buy: sku.landed,
      landed: sku.landed,
      grade: sku.grade,
      intakeAt: now,
      version: 1,
    };
  });
  await db.unit.createMany({ data: units });
  log(`unit: ${units.length}`);

  let events = 0;
  let orders = 0;
  let cashIn = 0n;

  // Batched: one transaction per chunk rather than per unit. Per-unit
  // transactions would spend most of the runtime on transaction overhead, and
  // per-run would hold 5 000 row locks at once.
  const CHUNK = 200;

  for (let start = 0; start < units.length; start += CHUNK) {
    const chunk = units.slice(start, start + CHUNK);

    const written = await db.$transaction(
      async (tx: Tx) => {
        let n = 0;
        let ordersHere = 0;
        let cashHere = 0n;

        for (const unit of chunk) {
          // Arrival. Every unit has one, so check 6 (orphan units) is clean.
          await appendUnitEvent(tx, {
            serial: unit.serial,
            type: "DITERIMA",
            staffId: SYSTEM_STAFF_ID,
            toLocationId: "loc_gudang",
            costDelta: unit.landed,
            note: "backfill: migrasi",
          });
          n += 1;

          const roll = rand();

          // ~45% move to the shop floor before anything else happens.
          const onFloor = roll < 0.45;
          if (onFloor) {
            await appendUnitEvent(tx, {
              serial: unit.serial,
              type: "DIPINDAH",
              staffId: "staff_kasir",
              toLocationId: "loc_toko",
            });
            n += 1;
          }

          // ~35% of the stock has sold.
          if (roll < 0.35) {
            const sku = skus.find((s) => s.id === unit.skuId)!;
            const price = sku.price;
            const discount =
              rand() < 0.15 ? BigInt(between(50, 400) * 1_000) : 0n;
            const extra = 0n;
            const total = price - discount + extra;
            const cash = rand() < 0.55;

            const order = await tx.order.create({
              data: {
                ts: now,
                customerId: pick(customers).id,
                platform: pick(["OFFLINE", "WA", "IG"] as const),
                fulfill: "PICKUP",
                status: "LUNAS",
                subtotal: price,
                discount,
                extra,
                // 08 §2 invariant 5: total is derived, never taken on trust.
                total,
                paidTotal: total,
                cogs: unit.landed,
                tradeCredit: 0n,
                belowFloor: false,
                soldById: "staff_kasir",
                shiftId: SHIFT_ID,
                locationId: "loc_toko",
              },
              select: { id: true },
            });
            ordersHere += 1;

            await tx.orderItem.create({
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
            });

            await tx.payment.create({
              data: {
                orderId: order.id,
                direction: "MASUK",
                method: cash ? "TUNAI" : "TRANSFER",
                amount: total,
                status: "LUNAS",
                paidAt: now,
                staffId: "staff_kasir",
                shiftId: cash ? SHIFT_ID : null,
              },
            });
            if (cash) cashHere += total;

            await appendUnitEvent(tx, {
              serial: unit.serial,
              type: "TERJUAL",
              staffId: "staff_kasir",
              orderId: order.id,
            });
            n += 1;

            // ~4% of sold units come back under warranty and are resolved to
            // stock, which exercises the longest path in the state machine.
            if (rand() < 0.04) {
              const claim = await tx.warrantyClaim.create({
                data: {
                  unitId: unit.id,
                  status: "SELESAI",
                  resolution: "STOK",
                  openedAt: now,
                  resolvedAt: now,
                  staffId: "staff_kasir",
                },
                select: { id: true },
              });
              await appendUnitEvent(tx, {
                serial: unit.serial,
                type: "KLAIM_DIBUKA",
                staffId: "staff_kasir",
                claimId: claim.id,
                toLocationId: "loc_servis",
              });
              await appendUnitEvent(tx, {
                serial: unit.serial,
                type: "KLAIM_SELESAI",
                resolution: "STOK",
                staffId: "staff_kasir",
                claimId: claim.id,
                toLocationId: "loc_toko",
              });
              n += 2;

              // The unit is back in stock, so its sale must be released or
              // invariant 3 would see one serial on two open lines later.
              await tx.orderItem.updateMany({
                where: { unitId: unit.id, returnedAt: null },
                data: {
                  returnedAt: now,
                  returnedQty: 1,
                  returnReason: "Klaim garansi",
                },
              });
            }
          } else if (roll > 0.97) {
            // A couple of units are missing at the last opname.
            await appendUnitEvent(tx, {
              serial: unit.serial,
              type: "OPNAME_HILANG",
              staffId: "staff_kasir",
            });
            n += 1;
          }
        }

        return { n, ordersHere, cashHere };
      },
      // Seeding is a bulk job, not a checkout: the production 10 s ceiling
      // (08 §3) is deliberately not applied here.
      { maxWait: 10_000, timeout: 120_000 },
    );

    events += written.n;
    orders += written.ordersHere;
    cashIn += written.cashHere;

    if ((start / CHUNK) % 5 === 0)
      log(`riwayat: ${start + chunk.length}/${units.length}`);
  }

  // The till must reconcile: check 8 compares expected against float + net cash.
  await db.shift.update({
    where: { id: SHIFT_ID },
    data: {
      expected: OPEN_FLOAT + cashIn,
      declared: OPEN_FLOAT + cashIn,
      variance: 0n,
    },
  });

  // Singletons.
  await db.finSettings.create({
    data: {
      id: "singleton",
      cash: cashIn,
      equipment: 25_000_000n,
      updatedAt: now,
    },
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

  const ms = Date.now() - started;
  log(`selesai dalam ${ms} ms`);

  return { units: units.length, events, orders, ms };
}
