/**
 * The POS store on PostgreSQL — does every field of every screen survive the
 * trip? (docs/store-on-postgres.md)
 *
 * The demo shop the web suite runs on (`apps/web/src/mock/seed.ts`) is
 * committed into an empty database through `commitStore`, read back through
 * `snapshotStore`, and compared row by row. A field a mapper forgot, a list
 * that comes back in another order, a money figure that loses a rupiah — each
 * is a row that does not match, named here.
 *
 * Runs against its own database so it cannot truncate anybody else's:
 *
 *   createdb -U nusantara nusantara_store_test
 *   DATABASE_URL=postgresql://nusantara@localhost:5432/nusantara_store_test \
 *     pnpm --filter @nusantara/db exec prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://nusantara@localhost:5432/nusantara_store_test \
 *     pnpm --filter @nusantara/db exec vitest run test/store.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  COLLECTION_NAMES,
  COLLECTIONS,
  comparable,
  decodeRow,
  decodeStore,
  diffStore,
  encodeChangeset,
  keyOf,
  type Row,
  type StoreShape,
} from "@nusantara/store";
import {
  PrismaClient,
  StoreConflictError,
  StoreValidationError,
  commitStore,
  snapshotStore,
  truncateAll,
} from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_store_test";

const ACTOR = "staff_store_test";
const NOW = new Date("2026-09-13T03:00:00.000Z");

let db: PrismaClient;

/** The demo shop, loaded from the web app without teaching tsc to follow it. */
async function demoShop(): Promise<Record<string, unknown>> {
  const path = new globalThis.URL(
    "../../../apps/web/src/mock/seed.ts",
    import.meta.url,
  ).href;
  const mod = (await import(/* @vite-ignore */ path)) as {
    buildSeed: () => Record<string, unknown>;
  };
  return mod.buildSeed();
}

function empty(shop: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(shop)) {
    out[k] = Array.isArray(v) ? [] : v;
  }
  // Read-only here: the chatbot's own API writes these.
  out["chats"] = shop["chats"];
  out["corrections"] = shop["corrections"];
  out["personas"] = shop["personas"];
  // What an empty database projects, so a till's conflict check agrees.
  out["settings"] = { batteryGoodMin: 80, batteryFairMin: 76 };
  out["appleDbHidden"] = [];
  out["myWarehouseId"] = "";
  return out;
}

async function people(): Promise<void> {
  const names = ["Michella", "Dimas Pratama", "Ayu Lestari"];
  await db.staff.create({
    data: {
      id: ACTOR,
      username: "store_test",
      name: "Store Test",
      role: "OWNER",
      canApprove: true,
      active: true,
      passwordHash: "x",
      createdAt: NOW,
    },
  });
  for (const [i, name] of names.entries()) {
    await db.staff.create({
      data: {
        id: `staff_store_${i}`,
        username: `store_${i}`,
        name,
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "x",
        createdAt: NOW,
      },
    });
  }
}

async function loadDemo(): Promise<Record<string, unknown>> {
  const shop = await demoShop();
  const changes = encodeChangeset(
    diffStore(empty(shop) as StoreShape, shop as StoreShape),
  );
  await commitStore(db, { staffId: ACTOR, changes, mode: "import", now: NOW });
  return shop;
}

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
  // TRUNCATE takes the migration's reference rows with it.
  await people();
}, 60_000);

describe("the demo shop, through PostgreSQL and back", () => {
  it("comes back row for row", async () => {
    const shop = await loadDemo();
    const snapshot = await snapshotStore(db, { staffId: ACTOR });
    const back = decodeStore(snapshot.db) as unknown as Record<string, unknown>;

    const mismatches: string[] = [];
    for (const name of COLLECTION_NAMES) {
      if (!COLLECTIONS[name].writable) continue;
      const want = new Map(
        ((shop[name] as Row[]) ?? []).map((r) => [keyOf(name, r), r]),
      );
      const got = new Map(
        ((back[name] as Row[]) ?? []).map((r) => [keyOf(name, r), r]),
      );
      for (const [key, row] of want) {
        const other = got.get(key);
        if (other === undefined) {
          mismatches.push(`${name} ${key}: missing`);
        } else if (comparable(row) !== comparable(other)) {
          mismatches.push(
            `${name} ${key}:\n   want ${comparable(row)}\n   got  ${comparable(other)}`,
          );
        }
      }
      for (const key of got.keys()) {
        if (!want.has(key)) mismatches.push(`${name} ${key}: unexpected`);
      }
      if (COLLECTIONS[name].ordered) {
        const wantOrder = ((shop[name] as Row[]) ?? []).map((r) =>
          keyOf(name, r),
        );
        const gotOrder = ((back[name] as Row[]) ?? []).map((r) =>
          keyOf(name, r),
        );
        if (comparable(wantOrder) !== comparable(gotOrder)) {
          mismatches.push(
            `${name}: order ${gotOrder.join(",")} ≠ ${wantOrder.join(",")}`,
          );
        }
      }
    }
    for (const name of [
      "settings",
      "appleDbHidden",
      "myWarehouseId",
    ] as const) {
      if (comparable(shop[name]) !== comparable(back[name])) {
        mismatches.push(
          `${name}:\n   want ${comparable(shop[name])}\n   got  ${comparable(back[name])}`,
        );
      }
    }
    expect(mismatches.slice(0, 25).join("\n")).toBe("");
  }, 180_000);
});

describe("a till's commit", () => {
  it("refuses a change based on a row somebody else has changed since", async () => {
    const shop = await loadDemo();
    const customer = (shop["customers"] as Row[])[0]!;
    const renamed = { ...customer, name: "Nama Lain" };
    const first = encodeChangeset(
      diffStore({ customers: [customer] }, { customers: [renamed] }),
    );
    await commitStore(db, { staffId: ACTOR, changes: first });
    // Same base, different edit — the base is stale now.
    const second = encodeChangeset(
      diffStore(
        { customers: [customer] },
        { customers: [{ ...customer, name: "Ketiga" }] },
      ),
    );
    await expect(
      commitStore(db, { staffId: ACTOR, changes: second }),
    ).rejects.toBeInstanceOf(StoreConflictError);
  }, 180_000);

  it("never lets an event be edited", async () => {
    const shop = await loadDemo();
    const event = (shop["events"] as Row[])[0]!;
    const changes = encodeChangeset(
      diffStore(
        { events: [event] },
        { events: [{ ...event, note: "diubah" }] },
      ),
    );
    await expect(
      commitStore(db, { staffId: ACTOR, changes }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  }, 180_000);

  it("refuses a status change that no event explains", async () => {
    const shop = await loadDemo();
    const unit = (shop["units"] as Row[]).find(
      (u) => u["status"] === "TERSEDIA",
    )!;
    const changes = encodeChangeset(
      diffStore({ units: [unit] }, { units: [{ ...unit, status: "TERJUAL" }] }),
    );
    await expect(commitStore(db, { staffId: ACTOR, changes })).rejects.toThrow(
      /riwayatnya/,
    );
  }, 180_000);

  it("numbers a new document and rewrites the provisional code everywhere", async () => {
    const shop = await loadDemo();
    const unit = (shop["units"] as Row[]).find(
      (u) => u["status"] === "TERSEDIA",
    )!;
    const serial = unit["serial"] as string;
    const events = (shop["events"] as Row[]).filter(
      (e) => e["serial"] === serial,
    );
    const code = "SI-2026/09-Tabc1234";
    const sale = {
      id: "o_store_test",
      code,
      ts: NOW.toISOString(),
      customerId: null,
      serials: [serial],
      prices: { [serial]: 5_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      payments: [
        {
          id: "p_store_test",
          method: "TUNAI",
          amount: 5_000_000,
          state: "SETTLED",
          at: NOW.toISOString(),
        },
      ],
      total: 5_000_000,
    };
    const sold = { ...unit, status: "TERJUAL" };
    const event = {
      id: "ev_store_test",
      serial,
      seq: events.length + 1,
      type: "TERJUAL",
      at: NOW.toISOString(),
      fromStatus: "TERSEDIA",
      toStatus: "TERJUAL",
      locationId: unit["locationId"],
      note: `Sold on ${code}`,
      refCode: code,
      staff: "Michella",
    };
    const changes = encodeChangeset(
      diffStore(
        { orders: [], units: [unit], events: [] },
        { orders: [sale], units: [sold], events: [event] },
      ),
    );
    const result = await commitStore(db, { staffId: ACTOR, changes });
    const real = result.codes[code];
    expect(real).toMatch(/^SI-\d{4}\/\d{2}-\d{6}$/);
    const order = (result.rows.orders as Row[])[0]!;
    expect(order["code"]).toBe(real);
    const written = (result.rows.events as Row[]).find(
      (e) => e["id"] === "ev_store_test",
    )!;
    expect(written["refCode"]).toBe(real);
    expect(written["note"]).toBe(`Sold on ${real}`);
    // The row is attributed to the session, not to the name the browser typed.
    expect(written["staff"]).toBe("Store Test");
  }, 180_000);

  it("keeps a purchase line whose product has not been picked yet", async () => {
    // Owner report 2026-09-15: this line used to refuse the whole commit.
    const shop = await loadDemo();
    const po = (shop["pos"] as Row[])[0]!;
    const next = {
      ...po,
      items: [
        ...(po["items"] as Row[]),
        { id: "poi_blank", skuId: "", serial: null, qty: 1, unitCost: 0 },
      ],
    };
    const changes = encodeChangeset(diffStore({ pos: [po] }, { pos: [next] }));
    const result = await commitStore(db, { staffId: ACTOR, changes });
    const back = decodeRow("pos", (result.rows.pos as Row[])[0]!);
    expect(
      (back["items"] as Row[]).find((i) => i["id"] === "poi_blank"),
    ).toMatchObject({
      skuId: "",
      qty: 1,
    });
  }, 180_000);

  it("cancels a deleted invoice, voiding its payments and releasing its deposit money", async () => {
    // Owner ask 2026-09-15: "Make the inbound deletable, with right click."
    const shop = await loadDemo();
    const fresh = {
      id: "po_store_delete",
      code: "PI-2026/09-Tdel1234",
      supplierId: (shop["suppliers"] as Row[])[0]!["id"],
      invoice: "INV-DEL",
      date: "2026-09-15",
      locationId: (shop["warehouses"] as Row[])[0]!["id"],
      items: [
        {
          id: "poi_store_delete",
          skuId: (shop["skus"] as Row[])[0]!["id"],
          serial: null,
          qty: 2,
          unitCost: 1_000_000,
        },
      ],
      payments: [
        {
          id: "pp_store_delete",
          method: "TUNAI",
          amount: 500_000,
          at: NOW.toISOString(),
          appliedTo: "ORDER",
        },
      ],
      shippingFee: 0,
      taxFee: 0,
      discount: 0,
      status: "ORDERED",
    };
    const created = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(diffStore({ pos: [] }, { pos: [fresh] })),
    });
    const saved = decodeRow("pos", (created.rows.pos as Row[])[0]!);
    const removal = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(diffStore({ pos: [saved] }, { pos: [] })),
    });
    expect(removal.removed.pos).toEqual([saved["id"]]);
    const row = await db.purchaseOrder.findUnique({
      where: { id: saved["id"] as string },
      include: { payments: true, items: true },
    });
    expect(row?.status).toBe("BATAL");
    expect(row?.payments.every((p) => p.voidedAt !== null)).toBe(true);
    expect(row?.items.every((i) => i.removedAt !== null)).toBe(true);
    const snapshot = await snapshotStore(db, { staffId: ACTOR });
    expect(
      (snapshot.db["pos"] as Row[]).some((p) => p["id"] === saved["id"]),
    ).toBe(false);
  }, 180_000);

  it("refuses to delete an invoice whose machines have left QC", async () => {
    const shop = await loadDemo();
    const units = shop["units"] as Row[];
    const po = (shop["pos"] as Row[]).find((p) =>
      units.some((u) => u["poId"] === p["id"] && u["status"] === "TERSEDIA"),
    )!;
    const changes = encodeChangeset(diffStore({ pos: [po] }, { pos: [] }));
    await expect(commitStore(db, { staffId: ACTOR, changes })).rejects.toThrow(
      /masih punya unit/,
    );
  }, 180_000);

  it("cancels a draft stock take instead of deleting it", async () => {
    const shop = await loadDemo();
    const draft = (shop["opnames"] as Row[]).find(
      (o) => o["status"] === "DRAFT",
    );
    if (draft === undefined) return;
    const changes = encodeChangeset(
      diffStore({ opnames: [draft] }, { opnames: [] }),
    );
    await commitStore(db, { staffId: ACTOR, changes });
    const row = await db.opnameSession.findUnique({
      where: { id: draft["id"] as string },
    });
    expect(row?.status).toBe("BATAL");
  }, 180_000);
});
