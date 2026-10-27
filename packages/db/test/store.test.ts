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
import { ADAPTERS } from "../src/store/adapters/index.js";

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

  it("ends the customer's chatbot lead when they buy (chatbot v2)", async () => {
    const shop = await loadDemo();
    const unit = (shop["units"] as Row[]).find(
      (u) => u["status"] === "TERSEDIA",
    )!;
    const buyer = (shop["customers"] as Row[]).find(
      (c) => typeof c["phone"] === "string" && c["phone"] !== "",
    )!;
    const waId = String(buyer["phone"]).replace(/\D/g, "");
    await db.waThreadMemory.deleteMany({ where: { from: waId } });
    await db.waThreadMemory.create({
      data: {
        from: waId,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: NOW,
        leadScore: 90,
        leadAt: new Date(NOW.getTime() - 3_600_000),
      },
    });
    const serial = unit["serial"] as string;
    const seq = (shop["events"] as Row[]).filter(
      (e) => e["serial"] === serial,
    ).length;
    const code = "SI-2026/09-Tlead123";
    const sale = {
      id: "o_lead_test",
      code,
      ts: NOW.toISOString(),
      customerId: buyer["id"],
      serials: [serial],
      prices: { [serial]: 5_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      payments: [
        {
          id: "p_lead_test",
          method: "TUNAI",
          amount: 5_000_000,
          state: "SETTLED",
          at: NOW.toISOString(),
        },
      ],
      total: 5_000_000,
    };
    const event = {
      id: "ev_lead_test",
      serial,
      seq: seq + 1,
      type: "TERJUAL",
      at: NOW.toISOString(),
      fromStatus: "TERSEDIA",
      toStatus: "TERJUAL",
      locationId: unit["locationId"],
      note: `Sold on ${code}`,
      refCode: code,
      staff: "Michella",
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [], units: [unit], events: [] },
          {
            orders: [sale],
            units: [{ ...unit, status: "TERJUAL" }],
            events: [event],
          },
        ),
      ),
    });
    const mem = await db.waThreadMemory.findUniqueOrThrow({
      where: { from: waId },
    });
    expect(mem.leadClearedAt).not.toBeNull();
    expect(mem.leadClearedAt!.getTime()).toBeGreaterThan(mem.leadAt!.getTime());
    await db.waThreadMemory.deleteMany({ where: { from: waId } });
  }, 180_000);

  /*
   * Counted products are quantities on `StockMove` (2026-09-19): a sale is an
   * `OrderItem` with no unit plus a TERJUAL move, and its cost reaches the
   * line and the order from the move.
   */
  function accessorySale(shop: Record<string, unknown>, qty: number) {
    const moves = shop["stockMoves"] as Row[];
    const held = new Map<string, number>();
    for (const m of moves) {
      const k = `${m["skuId"] as string}|${m["locationId"] as string}`;
      held.set(k, (held.get(k) ?? 0) + (m["qty"] as number));
    }
    const [key, onHand] = [...held].find(([, n]) => n > 0)!;
    const [skuId, locationId] = key.split("|") as [string, string];
    const code = "SI-2026/09-Tqty1234";
    const sale = {
      id: "o_qty_test",
      code,
      ts: NOW.toISOString(),
      customerId: null,
      serials: [],
      prices: {},
      lines: [{ id: "ol_qty_test", skuId, qty, price: 300_000 }],
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      payments: [
        {
          id: "p_qty_test",
          method: "TUNAI",
          amount: 300_000 * qty,
          state: "SETTLED",
          at: NOW.toISOString(),
        },
      ],
      total: 300_000 * qty,
    };
    const move = {
      id: "sm_qty_test",
      skuId,
      locationId,
      qty: -qty,
      cost: 120_000,
      type: "TERJUAL",
      at: NOW.toISOString(),
      refCode: code,
      orderId: "o_qty_test",
      orderLineId: "ol_qty_test",
      staff: "Michella",
    };
    return { sale, move, onHand, skuId, code };
  }

  it("sells a counted product by quantity, costing it off its stock move", async () => {
    const shop = await loadDemo();
    const { sale, move, code } = accessorySale(shop, 1);
    const result = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [], stockMoves: [] },
          { orders: [sale], stockMoves: [move] },
        ),
      ),
    });
    const real = result.codes[code]!;
    const item = await db.orderItem.findUniqueOrThrow({
      where: { id: "ol_qty_test" },
    });
    expect(item).toMatchObject({ unitId: null, qty: 1, cogs: 120_000n });
    const order = await db.order.findUniqueOrThrow({
      where: { id: "o_qty_test" },
    });
    expect(order.cogs).toBe(120_000n);
    expect(order.subtotal).toBe(300_000n);
    const written = await db.stockMove.findUniqueOrThrow({
      where: { id: "sm_qty_test" },
    });
    expect(written).toMatchObject({ refCode: real, orderItemId: item.id });
    const back = (result.rows.orders as Row[])[0]!;
    expect(back["lines"]).toEqual([
      {
        id: "ol_qty_test",
        skuId: sale.lines[0]!.skuId,
        qty: 1,
        price: "300000",
      },
    ]);
  }, 180_000);

  it("refuses to sell more of a counted product than the shelf holds", async () => {
    const shop = await loadDemo();
    const { sale, move, onHand } = accessorySale(shop, 1);
    const tooMany = { ...move, qty: -(onHand + 1) };
    const big = {
      ...sale,
      lines: [{ ...sale.lines[0]!, qty: onHand + 1 }],
      payments: [{ ...sale.payments[0]!, amount: 300_000 * (onHand + 1) }],
      total: 300_000 * (onHand + 1),
    };
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { orders: [], stockMoves: [] },
            { orders: [big], stockMoves: [tooMany] },
          ),
        ),
      }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  }, 180_000);

  it("refuses a quantity of a product that is tracked by serial", async () => {
    const shop = await loadDemo();
    const unit = (shop["units"] as Row[])[0]!;
    const move = {
      id: "sm_tracked_test",
      skuId: unit["skuId"],
      locationId: unit["locationId"],
      qty: 1,
      cost: 0,
      type: "KOREKSI",
      at: NOW.toISOString(),
      staff: "Michella",
    };
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ stockMoves: [] }, { stockMoves: [move] }),
        ),
      }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  }, 180_000);

  it("never lets a stock move be edited", async () => {
    const shop = await loadDemo();
    const move = (shop["stockMoves"] as Row[])[0]!;
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { stockMoves: [move] },
            { stockMoves: [{ ...move, qty: 99 }] },
          ),
        ),
      }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  }, 180_000);

  /*
   * The stock movement history is editable (owner ask 2026-09-24): a
   * correction may change when, why and what was said — never what the row
   * IS. `CORRECTABLE` in commit.ts lets the edit through to the adapter,
   * which judges its fields; the app role's UPDATE is per column.
   */
  // Decoded: a snapshot is the wire form, money as strings, and a changeset is
  // built from browser rows.
  const stored = async (collection: string, id: string): Promise<Row> =>
    decodeRow(
      collection as (typeof COLLECTION_NAMES)[number],
      (
        (await snapshotStore(db, { staffId: ACTOR })).db[collection] as Row[]
      ).find((r) => r["id"] === id)!,
    );
  const correct = (collection: string, base: Row, next: Row) =>
    commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ [collection]: [base] }, { [collection]: [next] }),
      ),
    });

  it("corrects a stock adjustment's when, why, sentence and reading — never its unit", async () => {
    const shop = await loadDemo();
    const adj = (shop["adjustments"] as Row[])[0]!;
    const other = (shop["reasons"] as Row[]).find(
      (r) => r["activity"] === "ADJUSTMENT" && r["id"] !== adj["reasonId"],
    )!;
    const corrected = {
      ...adj,
      at: "2026-09-10T02:00:00.000Z",
      reasonId: other["id"],
      description: "Lecet di sudut kanan",
      batteryHealth: 88,
    };
    await correct("adjustments", adj, corrected);
    const back = await stored("adjustments", adj["id"] as string);
    expect(back).toMatchObject({
      at: "2026-09-10T02:00:00.000Z",
      reasonId: other["id"],
      description: "Lecet di sudut kanan",
      batteryHealth: 88,
      serial: adj["serial"],
      kind: adj["kind"],
      batchId: adj["batchId"],
      staff: adj["staff"],
    });

    // What the row IS does not move: its unit, its direction — and nothing
    // removes one.
    const otherUnit = (shop["units"] as Row[]).find(
      (u) => u["serial"] !== adj["serial"],
    )!;
    await expect(
      correct("adjustments", back, { ...back, serial: otherUnit["serial"] }),
    ).rejects.toBeInstanceOf(StoreValidationError);
    await expect(
      correct("adjustments", back, {
        ...back,
        kind: back["kind"] === "IN" ? "OUT" : "IN",
      }),
    ).rejects.toBeInstanceOf(StoreValidationError);
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ adjustments: [back] }, { adjustments: [] }),
        ),
      }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  }, 180_000);

  it("corrects a counted product's correction — when, why and note — and never its quantity", async () => {
    const shop = await loadDemo();
    const reasons = (shop["reasons"] as Row[]).filter(
      (r) => r["activity"] === "ADJUSTMENT",
    );
    const sample = (shop["stockMoves"] as Row[])[0]!;
    const move: Row = {
      id: "sm_history_test",
      skuId: sample["skuId"],
      locationId: sample["locationId"],
      qty: 2,
      cost: sample["cost"],
      type: "KOREKSI",
      at: NOW.toISOString(),
      reasonId: reasons[0]!["id"],
      note: "Adjusted in — found in the drawer",
      staff: "Michella",
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ stockMoves: [] }, { stockMoves: [move] }),
      ),
    });
    // As the store now holds it — a till's write carries the session's name.
    const written = await stored("stockMoves", "sm_history_test");
    const corrected = {
      ...written,
      at: "2026-09-12T01:00:00.000Z",
      reasonId: reasons[1]!["id"],
      note: "Found behind the till",
    };
    await correct("stockMoves", written, corrected);
    expect(await stored("stockMoves", "sm_history_test")).toMatchObject({
      at: "2026-09-12T01:00:00.000Z",
      reasonId: reasons[1]!["id"],
      note: "Found behind the till",
      qty: 2,
    });

    // The quantity is the ledger.
    await expect(
      correct("stockMoves", corrected, { ...corrected, qty: 5 }),
    ).rejects.toBeInstanceOf(StoreValidationError);
    // A move of any other type is not a row of the history.
    await expect(
      correct("stockMoves", sample, { ...sample, note: "x" }),
    ).rejects.toBeInstanceOf(StoreValidationError);
  }, 180_000);

  it("records a return on the sale it undid — credit, refund and reference", async () => {
    // Owner brief 2026-09-19: a marketplace sale carries its order number
    // (`Payment.ref`), and a return takes its credit off the bill
    // (`OrderAdjustment` RETUR, carrying the SG code) and hands money back
    // (`Payment`, direction KELUAR).
    const shop = await loadDemo();
    const unit = (shop["units"] as Row[]).find(
      (u) => u["status"] === "TERSEDIA",
    )!;
    const serial = unit["serial"] as string;
    const events = (shop["events"] as Row[]).filter(
      (e) => e["serial"] === serial,
    );
    const sale = {
      id: "o_return_test",
      code: "SI-2026/09-000901",
      ts: NOW.toISOString(),
      customerId: null,
      serials: [serial],
      prices: { [serial]: 5_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TRANSFER",
      settled: true,
      payments: [
        {
          id: "p_return_test",
          method: "TRANSFER",
          amount: 5_000_000,
          state: "SETTLED",
          at: NOW.toISOString(),
          ref: "240919ABCDEF",
        },
      ],
      total: 5_000_000,
    };
    const sold = { ...unit, status: "TERJUAL" };
    const event = {
      id: "ev_return_test",
      serial,
      seq: events.length + 1,
      type: "TERJUAL",
      at: NOW.toISOString(),
      fromStatus: "TERSEDIA",
      toStatus: "TERJUAL",
      locationId: unit["locationId"],
      note: "Sold",
      refCode: sale.code,
      staff: "Michella",
    };
    const first = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [], units: [unit], events: [] },
          { orders: [sale], units: [sold], events: [event] },
        ),
      ),
    });
    const written = decodeRow(
      "orders",
      (first.rows.orders as Row[])[0]!,
    ) as Row;
    expect((written["payments"] as Row[])[0]!["ref"]).toBe("240919ABCDEF");

    const later = new Date(NOW.getTime() + 60_000).toISOString();
    const returned = {
      ...written,
      adjustments: [
        {
          id: "adj_return_test",
          type: "RETUR",
          code: "SG-2026/09-000901",
          amount: 5_000_000,
          reason: `Returned ${serial}`,
          at: later,
        },
      ],
      refunds: [
        {
          id: "rf_return_test",
          method: "TRANSFER",
          amount: 5_000_000,
          at: later,
          note: "Bought back",
        },
      ],
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ orders: [written] }, { orders: [returned] }),
      ),
    });

    const back = decodeStore(
      (await snapshotStore(db, { staffId: ACTOR })).db,
    ) as unknown as Record<string, Row[]>;
    const order = back["orders"]!.find((o) => o["id"] === "o_return_test")!;
    expect(order["adjustments"]).toMatchObject([
      { type: "RETUR", code: "SG-2026/09-000901", amount: 5_000_000 },
    ]);
    expect(order["refunds"]).toMatchObject([
      { method: "TRANSFER", amount: 5_000_000, note: "Bought back" },
    ]);
    // The refund is its own list, not a payment the customer made.
    expect(order["payments"]).toHaveLength(1);
    const row = await db.order.findUniqueOrThrow({
      where: { id: "o_return_test" },
      include: { payments: true },
    });
    expect(row.paidTotal).toBe(0n);
    expect(row.payments.map((p) => [p.direction, p.amount]).sort()).toEqual([
      ["KELUAR", 5_000_000n],
      ["MASUK", 5_000_000n],
    ]);
  }, 180_000);

  it("hands a unit over in an exchange: costed onto the sale, its sale entry naming the return", async () => {
    // Owner ask 2026-09-21: the replacements go out on the SAME sale. A unit
    // joining a sale already in the database adds what it cost to
    // `Order.cogs`, and its TERJUAL names the RETURN it went out for — the
    // event's foreign key to it, which is how the return lists every
    // replacement with no schema change. The code is provisional, as the
    // browser writes it, so the renumbering has to reach the event too.
    const shop = await loadDemo();
    const [back, out] = (shop["units"] as Row[]).filter(
      (u) => u["status"] === "TERSEDIA",
    );
    const serialBack = back!["serial"] as string;
    const serialOut = out!["serial"] as string;
    const seqOf = (serial: string) =>
      (shop["events"] as Row[]).filter((e) => e["serial"] === serial).length;
    const sale = {
      id: "o_exchange_test",
      code: "SI-2026/09-000902",
      ts: NOW.toISOString(),
      customerId: null,
      serials: [serialBack],
      prices: { [serialBack]: 5_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: true,
      payments: [
        {
          id: "p_exchange_test",
          method: "TUNAI",
          amount: 5_000_000,
          state: "SETTLED",
          at: NOW.toISOString(),
        },
      ],
      total: 5_000_000,
    };
    const soldBack = { ...back!, status: "TERJUAL" };
    const first = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [], units: [back!], events: [] },
          {
            orders: [sale],
            units: [soldBack],
            events: [
              {
                id: "ev_exchange_sold",
                serial: serialBack,
                seq: seqOf(serialBack) + 1,
                type: "TERJUAL",
                at: NOW.toISOString(),
                fromStatus: "TERSEDIA",
                toStatus: "TERJUAL",
                locationId: back!["locationId"],
                note: "Sold",
                refCode: sale.code,
                staff: "Michella",
              },
            ],
          },
        ),
      ),
    });
    const written = decodeRow(
      "orders",
      (first.rows.orders as Row[])[0]!,
    ) as Row;

    const later = new Date(NOW.getTime() + 60_000).toISOString();
    const code = "SG-2026/09-Tex4mpl3";
    const exchanged = {
      ...written,
      serials: [serialBack, serialOut],
      prices: { [serialBack]: 5_000_000, [serialOut]: 6_000_000 },
      total: 11_000_000,
      adjustments: [
        {
          id: "adj_exchange_test",
          type: "RETUR",
          code,
          amount: 5_000_000,
          reason: `Returned ${serialBack}`,
          at: later,
        },
      ],
      payments: [
        ...(written["payments"] as Row[]),
        {
          id: "p_exchange_topup",
          method: "TUNAI",
          amount: 1_000_000,
          state: "SETTLED",
          at: later,
          note: "Exchange top-up",
        },
      ],
    };
    const ret = {
      id: "r_exchange_test",
      code,
      kind: "CUSTOMER",
      serial: serialBack,
      reason: "Rusak",
      date: later.slice(0, 10),
      status: "PENDING",
      exchangeSerial: serialOut,
      fee: 1_000_000,
    };
    const soldOut = { ...out!, status: "TERJUAL" };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [written], returns: [], units: [out!], events: [] },
          {
            orders: [exchanged],
            returns: [ret],
            units: [soldOut],
            events: [
              {
                id: "ev_exchange_out",
                serial: serialOut,
                seq: seqOf(serialOut) + 1,
                type: "TERJUAL",
                at: later,
                fromStatus: "TERSEDIA",
                toStatus: "TERJUAL",
                locationId: out!["locationId"],
                note: `Exchange for ${serialBack} (${code})`,
                refCode: code,
                staff: "Michella",
              },
            ],
          },
        ),
      ),
    });

    const order = await db.order.findUniqueOrThrow({
      where: { id: "o_exchange_test" },
    });
    const units = await db.unit.findMany({
      where: { serial: { in: [serialBack, serialOut] } },
      select: { buy: true },
    });
    expect(order.cogs).toBe(units.reduce((n, u) => n + u.buy, 0n));

    const returnRow = await db.unitReturn.findFirstOrThrow({
      where: { exchangeUnit: { serial: serialOut } },
    });
    expect(returnRow.code).not.toBe(code); // numbered for real
    const handedOver = await db.unitEvent.findFirstOrThrow({
      where: { serial: serialOut, type: "TERJUAL" },
    });
    expect(handedOver.unitReturnId).toBe(returnRow.id);
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

  it("keeps each invoice expense as a row, and the payment that settled it", async () => {
    // Owner ask 2026-09-18: "Add Expense" — an expense can stay out of COGS,
    // and marking it paid records a payment that names it.
    const shop = await loadDemo();
    const fresh = {
      id: "po_store_fees",
      code: "PI-2026/09-Tfee1234",
      supplierId: (shop["suppliers"] as Row[])[0]!["id"],
      invoice: "INV-FEE",
      date: "2026-09-18",
      locationId: (shop["warehouses"] as Row[])[0]!["id"],
      items: [
        {
          id: "poi_store_fees",
          skuId: (shop["skus"] as Row[])[0]!["id"],
          serial: null,
          qty: 1,
          unitCost: 1_000_000,
        },
      ],
      payments: [
        {
          id: "pp_store_fees",
          method: "TUNAI",
          amount: 150_000,
          at: NOW.toISOString(),
          appliedTo: "SHIPPING",
          feeId: "fee_store_ship",
        },
      ],
      fees: [
        {
          id: "fee_store_ship",
          kind: "SHIPPING",
          label: "JNE",
          amount: 150_000,
          inCogs: true,
        },
        {
          id: "fee_store_pack",
          kind: "OTHER",
          label: "Packing",
          amount: 25_000,
          inCogs: false,
        },
      ],
      discount: 0,
      status: "RECEIVED",
    };
    const created = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(diffStore({ pos: [] }, { pos: [fresh] })),
    });
    const saved = decodeRow("pos", (created.rows.pos as Row[])[0]!);
    expect(saved["fees"]).toEqual(fresh.fees);
    expect(saved["payments"]).toMatchObject([{ feeId: "fee_store_ship" }]);
    const header = await db.purchaseOrder.findUnique({
      where: { id: fresh.id },
    });
    expect(header?.feesTotal).toBe(175_000n);
    expect(header?.total).toBe(1_175_000n);
    const paid = await db.payment.findUnique({
      where: { id: "pp_store_fees" },
    });
    expect(paid?.poFeeId).toBe("fee_store_ship");

    // Taking the packing charge off keeps its row, marked removed.
    const without: Row = {
      ...saved,
      fees: (saved["fees"] as Row[]).filter(
        (f) => f["id"] !== "fee_store_pack",
      ),
    };
    const after = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(diffStore({ pos: [saved] }, { pos: [without] })),
    });
    expect(
      decodeRow("pos", (after.rows.pos as Row[])[0]!)["fees"],
    ).toMatchObject([{ id: "fee_store_ship" }]);
    const gone = await db.purchaseOrderFee.findUnique({
      where: { id: "fee_store_pack" },
    });
    expect(gone?.removedAt).not.toBeNull();

    // A payment may only name an expense of its own invoice.
    const wrong = {
      ...without,
      payments: [
        ...(without["payments"] as Row[]),
        {
          id: "pp_store_wrong",
          method: "TUNAI",
          amount: 1_000,
          at: NOW.toISOString(),
          appliedTo: "TAX",
          feeId: "fee_store_pack",
        },
      ],
    };
    const latest = decodeRow("pos", (after.rows.pos as Row[])[0]!);
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ pos: [latest] }, { pos: [wrong] }),
        ),
      }),
    ).rejects.toThrow(/tidak ada di faktur ini/);
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
      fees: [],
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

  it("deletes a discount no sale has used, and refuses one that has been", async () => {
    await loadDemo();
    const fresh = (id: string, code: string, used: number): Row => ({
      id,
      code,
      name: code,
      type: "NOMINAL",
      amountRp: 100_000,
      used,
      active: true,
      scope: "All products",
    });
    const created = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { discounts: [] },
          {
            discounts: [
              fresh("disc_store_unused", "ZZUNUSED", 0),
              fresh("disc_store_used", "ZZUSED", 1),
            ],
          },
        ),
      ),
    });
    const [unused, used] = (created.rows.discounts as Row[]).map((r) =>
      decodeRow("discounts", r),
    );

    const removal = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ discounts: [unused!] }, { discounts: [] }),
      ),
    });
    expect(removal.removed.discounts).toEqual(["disc_store_unused"]);
    expect(
      await db.discount.findUnique({ where: { id: "disc_store_unused" } }),
    ).toBeNull();

    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ discounts: [used!] }, { discounts: [] }),
        ),
      }),
    ).rejects.toThrow(/sudah dipakai/);
    expect(
      await db.discount.findUnique({ where: { id: "disc_store_used" } }),
    ).not.toBeNull();
  }, 180_000);

  it("renames SKU codes onto a code an archived variant held, and swaps within a batch (2026-10-21)", async () => {
    const shop = await loadDemo();
    const modelId = (shop["models"] as Row[])[0]!["id"] as string;
    const sku = (id: string, code: string, label: string): Row => ({
      id,
      modelId,
      code,
      name: "ZZ",
      variantLabel: label,
      price: 0,
    });
    const created = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { skus: [] },
          {
            skus: [
              sku("sku_zz_old", 'ZZ AIR 13" 2020 I7 8/128', "old"),
              sku("sku_zz_a", "SKU_ZZRANDOMA", "i7 / 8GB / 128GB"),
              sku("sku_zz_b", "ZZ CODE B", "b"),
              sku("sku_zz_c", "ZZ CODE C", "c"),
            ],
          },
        ),
      ),
    });
    const byId = new Map(
      (created.rows.skus as Row[])
        .map((r) => decodeRow("skus", r))
        .map((r) => [r["id"] as string, r]),
    );
    const [old, a, b, c] = [
      "sku_zz_old",
      "sku_zz_a",
      "sku_zz_b",
      "sku_zz_c",
    ].map((id) => byId.get(id));
    // "Replace all variants" archives the old row; it keeps its code.
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(diffStore({ skus: [old!] }, { skus: [] })),
    });
    // The rename takes the archived row's code, and B and C swap theirs.
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { skus: [a!, b!, c!] },
          {
            skus: [
              { ...a!, code: 'ZZ AIR 13" 2020 I7 8/128' },
              { ...b!, code: "ZZ CODE C" },
              { ...c!, code: "ZZ CODE B" },
            ],
          },
        ),
      ),
    });
    const code = async (id: string) =>
      (await db.sku.findUnique({ where: { id } }))!.code;
    expect(await code("sku_zz_a")).toBe('ZZ AIR 13" 2020 I7 8/128');
    expect(await code("sku_zz_b")).toBe("ZZ CODE C");
    expect(await code("sku_zz_c")).toBe("ZZ CODE B");
    expect(await code("sku_zz_old")).toBe(
      'ZZ AIR 13" 2020 I7 8/128 [archived sku_zz_old]',
    );

    // A LIVE holder is still a conflict.
    const [a2, b2] = await Promise.all(
      ["sku_zz_a", "sku_zz_b"].map(async (id) => {
        const row = await db.sku.findUnique({ where: { id } });
        return id === "sku_zz_a"
          ? { ...a!, code: row!.code }
          : { ...b!, code: row!.code };
      }),
    );
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ skus: [b2!] }, { skus: [{ ...b2!, code: a2!.code }] }),
        ),
      }),
    ).rejects.toThrow();
  }, 180_000);

  it("deletes a product by archiving it with its variants, and refuses a variant with history (2026-10-21)", async () => {
    const shop = await loadDemo();
    const model: Row = {
      id: "m_zz_delete",
      name: 'MacBook Air 13" 2031',
      category: (shop["models"] as Row[])[0]!["category"],
      releaseYear: 2031,
      axes: [
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["256GB"] },
      ],
      source: "MANUAL",
    };
    const variant: Row = {
      id: "sku_zz_delete",
      modelId: "m_zz_delete",
      code: 'AIR 13" 2031 8/256',
      name: 'MacBook Air 13" 2031',
      variantLabel: "8GB / 256GB",
      price: 0,
    };
    const created = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { models: [], skus: [] },
          { models: [model], skus: [variant] },
        ),
      ),
    });
    const m = decodeRow("models", (created.rows.models as Row[])[0]!);
    const v = decodeRow("skus", (created.rows.skus as Row[])[0]!);

    // A product cannot go while a variant of it is still live.
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(diffStore({ models: [m] }, { models: [] })),
      }),
    ).rejects.toThrow(/masih punya varian/);

    const removal = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ models: [m], skus: [v] }, { models: [], skus: [] }),
      ),
    });
    expect(removal.removed.models).toEqual(["m_zz_delete"]);
    expect(
      (await db.catalogModel.findUnique({ where: { id: "m_zz_delete" } }))!
        .archived,
    ).toBe(true);
    expect(
      (await db.sku.findUnique({ where: { id: "sku_zz_delete" } }))!.archived,
    ).toBe(true);

    // A counted variant with a stock movement is history, not litter.
    const moved = (shop["stockMoves"] as Row[])[0]!;
    const counted = (shop["skus"] as Row[]).find(
      (k) => k["id"] === moved["skuId"],
    )!;
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(diffStore({ skus: [counted] }, { skus: [] })),
      }),
    ).rejects.toThrow(/riwayat stok atau penjualan/);
  }, 180_000);

  it("deletes a supplier or customer nothing names, and refuses a used one (2026-10-21)", async () => {
    const shop = await loadDemo();
    const created = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { suppliers: [], customers: [] },
          {
            suppliers: [{ id: "sup_store_unused", name: "ZZ Unused supplier" }],
            customers: [
              {
                id: "cus_store_unused",
                name: "ZZ Unused customer",
                phone: "",
                addresses: [{ id: "adr_store_unused", line: "Jl. Uji 1" }],
                createdAt: new Date().toISOString(),
              },
            ],
          },
        ),
      ),
    });
    const sup = decodeRow("suppliers", (created.rows.suppliers as Row[])[0]!);
    const cus = decodeRow("customers", (created.rows.customers as Row[])[0]!);

    const removal = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { suppliers: [sup], customers: [cus] },
          { suppliers: [], customers: [] },
        ),
      ),
    });
    expect(removal.removed.suppliers).toEqual(["sup_store_unused"]);
    expect(removal.removed.customers).toEqual(["cus_store_unused"]);
    expect(
      await db.supplier.findUnique({ where: { id: "sup_store_unused" } }),
    ).toBeNull();
    expect(
      await db.customer.findUnique({ where: { id: "cus_store_unused" } }),
    ).toBeNull();
    expect(
      await db.customerAddress.count({
        where: { customerId: "cus_store_unused" },
      }),
    ).toBe(0);

    const usedSupplier = (shop["suppliers"] as Row[]).find((s) =>
      (shop["pos"] as Row[]).some((p) => p["supplierId"] === s["id"]),
    )!;
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ suppliers: [usedSupplier] }, { suppliers: [] }),
        ),
      }),
    ).rejects.toThrow(/punya transaksi/);

    const buyer = (shop["customers"] as Row[]).find((c) =>
      (shop["orders"] as Row[]).some((o) => o["customerId"] === c["id"]),
    )!;
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ customers: [buyer] }, { customers: [] }),
        ),
      }),
    ).rejects.toThrow(/punya transaksi/);
    expect(
      await db.customer.findUnique({ where: { id: buyer["id"] as string } }),
    ).not.toBeNull();
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

  /*
   * The ledger's two admitted edits (owner decision 2026-09-23), reachable
   * since 2026-09-24. Until then the append-only gate in commit.ts refused
   * both before the events adapter saw them: every serial correction at
   * Inbound & QC and every unit swap in Transaction History was "Not saved".
   */
  it("carries a unit's history, notes and invoice line to a corrected serial", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const unit = (shop["units"] as Row[]).find(
      (u) =>
        u["status"] === "QC" && events.some((e) => e["serial"] === u["serial"]),
    )!;
    const from = unit["serial"] as string;
    const to = `${from}X`;
    const mine = events.filter((e) => e["serial"] === from);
    const po = (shop["pos"] as Row[]).find((p) =>
      (p["items"] as Row[]).some((i) => i["serial"] === from),
    )!;
    // A QC note under the old serial, and not sent again: the Inbound & QC
    // correction renames the unit, its events and its invoice line, nothing
    // else — the database carries the rest.
    const note = {
      id: "note-rename-1",
      serial: from,
      body: "Goresan tipis di tutup",
      staff: "Michella",
      at: "2026-09-13T04:00:00.000Z",
      photos: [],
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ unitNotes: [] }, { unitNotes: [note] }),
      ),
    });
    const before = await db.unit.findUniqueOrThrow({
      where: { serial: from },
      select: { id: true },
    });

    // What the browser sends (InboundDetailPage's `renameUnit`): the old key
    // removed, the new one inserted, the ledger and the invoice line renamed.
    const result = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { units: [unit], events: mine, pos: [po] },
          {
            units: [{ ...unit, serial: to }],
            events: mine.map((e) => ({ ...e, serial: to })),
            pos: [
              {
                ...po,
                items: (po["items"] as Row[]).map((i) =>
                  i["serial"] === from ? { ...i, serial: to } : i,
                ),
              },
            ],
          },
        ),
      ),
    });

    // One unit, renamed in place — not an archive and a fresh unit.
    const after = await db.unit.findUniqueOrThrow({
      where: { serial: to },
      select: { id: true, archivedAt: true },
    });
    expect(after.id).toBe(before.id);
    expect(after.archivedAt).toBeNull();
    expect(await db.unit.count({ where: { serial: from } })).toBe(0);
    // Its history is still its own: the same rows, under the new name.
    const ledger = await db.unitEvent.findMany({
      where: { unitId: before.id },
      orderBy: { seq: "asc" },
      select: { id: true, serial: true },
    });
    expect(ledger.map((e) => e.id)).toEqual(mine.map((e) => e["id"]));
    expect(new Set(ledger.map((e) => e.serial))).toEqual(new Set([to]));
    // The copies the database keeps beside the unit follow it.
    expect(
      (await db.unitNote.findUniqueOrThrow({ where: { id: note.id } })).serial,
    ).toBe(to);
    expect(
      await db.purchaseOrderItemSerial.count({ where: { serial: from } }),
    ).toBe(0);
    expect(
      await db.purchaseOrderItemSerial.count({ where: { serial: to } }),
    ).toBe(1);

    // Every till is told: the old serial is gone; the unit, its note and its
    // invoice are redrawn.
    expect(result.removed["units"]).toEqual([from]);
    expect((result.rows["units"] as Row[]).map((u) => u["serial"])).toEqual([
      to,
    ]);
    expect((result.rows["unitNotes"] as Row[]).map((n) => n["serial"])).toEqual(
      [to],
    );
    expect((result.rows["pos"] as Row[]).map((r) => r["id"])).toEqual([
      po["id"],
    ]);

    // And the shop reads back as one unit with the same facts.
    const back = decodeStore(
      (await snapshotStore(db, { staffId: ACTOR })).db,
    ) as unknown as Record<string, Row[]>;
    expect(back["units"]!.some((u) => u["serial"] === from)).toBe(false);
    const renamed = back["units"]!.find((u) => u["serial"] === to)!;
    expect(comparable(renamed)).toBe(comparable({ ...unit, serial: to }));
    expect(back["events"]!.filter((e) => e["serial"] === to)).toHaveLength(
      mine.length,
    );
    expect(back["events"]!.some((e) => e["serial"] === from)).toBe(false);
  }, 180_000);

  it("refuses to move a unit's history onto another unit, or a serial another unit holds", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const units = shop["units"] as Row[];
    const unit = units.find(
      (u) =>
        u["status"] === "QC" && events.some((e) => e["serial"] === u["serial"]),
    )!;
    const other = units.find((u) => u["serial"] !== unit["serial"])!;
    const mine = events.filter((e) => e["serial"] === unit["serial"]);
    const commit = (
      before: Record<string, Row[]>,
      after: Record<string, Row[]>,
    ) =>
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(diffStore(before, after)),
      });

    // The ledger rows renamed onto a unit that exists, without the unit row:
    // two units' histories would merge.
    await expect(
      commit(
        { events: mine },
        { events: mine.map((e) => ({ ...e, serial: other["serial"] })) },
      ),
    ).rejects.toThrow(/dipindahkan/);
    // A serial the shop already holds is a row somebody else has.
    await expect(
      commit(
        { units: [unit], events: mine },
        {
          units: [{ ...unit, serial: other["serial"] }],
          events: mine.map((e) => ({ ...e, serial: other["serial"] })),
        },
      ),
    ).rejects.toBeInstanceOf(StoreConflictError);
    // Anything beside the serial is still a rewrite of the ledger.
    const to = `${unit["serial"]}X`;
    await expect(
      commit(
        { units: [unit], events: mine },
        {
          units: [{ ...unit, serial: to }],
          events: mine.map((e) => ({ ...e, serial: to, note: "diubah" })),
        },
      ),
    ).rejects.toThrow(/tidak bisa diubah/);
  }, 180_000);

  it("takes any history row back (2026-10-22) — never a live sale's sold row, never the last one standing", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const historyOf = (serial: string) =>
      events
        .filter((e) => e["serial"] === serial)
        .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const sold = (shop["units"] as Row[]).find(
      (u) =>
        u["status"] === "TERJUAL" &&
        historyOf(u["serial"] as string).length >= 3,
    )!;
    const serial = sold["serial"] as string;
    const mine = historyOf(serial);
    const last = mine[mine.length - 1]!;
    const previous = mine[mine.length - 2]!;
    const commit = (
      before: Record<string, Row[]>,
      after: Record<string, Row[]>,
    ) =>
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(diffStore(before, after)),
      });

    // A live sale's sold row: deleting the transaction is the way to that.
    await expect(
      commit(
        { units: [sold], events: mine },
        {
          units: [
            {
              ...sold,
              status: previous["toStatus"],
              locationId: previous["locationId"],
            },
          ],
          events: mine.slice(0, -1),
        },
      ),
    ).rejects.toThrow(/transaksi yang masih ada/);
    // In the middle: the row goes and the unit stays where it is.
    await commit(
      { events: mine },
      { events: mine.filter((e) => e !== previous) },
    );
    expect(
      await db.unitEvent.count({ where: { id: previous["id"] as string } }),
    ).toBe(0);
    const still = await db.unit.findUniqueOrThrow({
      where: { serial },
      select: { status: true },
    });
    expect(still.status).toBe(sold["status"]);
    expect(
      await db.unitEvent.count({ where: { id: last["id"] as string } }),
    ).toBe(1);

    // The last row of a unit on no sale, with the unit still saying what that
    // row said: the projection must follow the ledger, in the same commit.
    const shelf = (shop["units"] as Row[]).find(
      (u) =>
        u["status"] !== "TERJUAL" &&
        historyOf(u["serial"] as string).length >= 2 &&
        historyOf(u["serial"] as string).at(-1)!["type"] !== "TERJUAL",
    )!;
    const its = historyOf(shelf["serial"] as string);
    const before = its[its.length - 2]!;
    await expect(
      commit({ events: its }, { events: its.slice(0, -1) }),
    ).rejects.toThrow(/riwayatnya/);
    await commit(
      { units: [shelf], events: its },
      {
        units: [
          {
            ...shelf,
            status: before["toStatus"],
            locationId: before["locationId"],
          },
        ],
        events: its.slice(0, -1),
      },
    );
    const row = await db.unit.findUniqueOrThrow({
      where: { serial: shelf["serial"] as string },
      select: { status: true, locationId: true },
    });
    expect(row.status).toBe(before["toStatus"]);
    expect(row.locationId).toBe(before["locationId"]);
    // Never the last one standing.
    const left = its.slice(0, -1);
    await expect(commit({ events: left }, { events: [] })).rejects.toThrow(
      /harus punya riwayat/,
    );
  }, 180_000);

  it("deletes a sale (2026-10-22): cancelled, its units back, sellable again", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const units = shop["units"] as Row[];
    const lastOf = (serial: string) =>
      events
        .filter((e) => e["serial"] === serial)
        .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const order = (shop["orders"] as Row[]).find((o) => {
      const serials = o["serials"] as string[];
      return (
        serials.length > 0 &&
        o["adjustments"] === undefined &&
        o["refunds"] === undefined &&
        o["tradeIns"] === undefined &&
        o["lines"] === undefined &&
        serials.every((s) => {
          const h = lastOf(s);
          return (
            h.length >= 2 &&
            h.at(-1)!["type"] === "TERJUAL" &&
            h.at(-1)!["refCode"] === o["code"]
          );
        })
      );
    })!;
    const serials = order["serials"] as string[];
    const settlements = await db.settlement.count({
      where: { orderId: order["id"] as string },
    });
    const linked =
      (await db.expense.count({ where: { orderId: order["id"] as string } })) +
      (await db.manualIncome.count({
        where: { orderId: order["id"] as string },
      }));
    expect(settlements + linked).toBe(0);
    const mineUnits = units.filter((u) =>
      serials.includes(u["serial"] as string),
    );
    const mineEvents = serials.flatMap(lastOf);
    const back = mineUnits.map((u) => {
      const h = lastOf(u["serial"] as string);
      const prev = h[h.length - 2]!;
      return { ...u, status: prev["toStatus"], locationId: prev["locationId"] };
    });
    const sold = new Set(serials.map((s) => lastOf(s).at(-1)!["id"]));
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [order], units: mineUnits, events: mineEvents },
          {
            orders: [],
            units: back,
            events: mineEvents.filter((e) => !sold.has(e["id"])),
          },
        ),
      ),
    });
    const row = await db.order.findUniqueOrThrow({
      where: { id: order["id"] as string },
      select: {
        status: true,
        payments: { select: { voidedAt: true } },
        items: { select: { returnedAt: true, returnReason: true } },
      },
    });
    expect(row.status).toBe("BATAL");
    expect(row.payments.every((p) => p.voidedAt !== null)).toBe(true);
    expect(
      row.items.every(
        (i) => i.returnedAt !== null && i.returnReason === "Transaksi dihapus",
      ),
    ).toBe(true);
    for (const s of serials) {
      const u = await db.unit.findUniqueOrThrow({
        where: { serial: s },
        select: { status: true, soldOrderItemId: true },
      });
      expect(u.status).not.toBe("TERJUAL");
      expect(u.soldOrderItemId).toBeNull();
    }
    // Gone from the projection, so every screen drops it.
    const reread = (await snapshotStore(db, { staffId: ACTOR })).db;
    expect(
      (reread["orders"] as Row[]).some((o) => o["id"] === order["id"]),
    ).toBe(false);
  }, 180_000);

  it("deletes a sale with nothing but the order (2026-10-23): the server puts its units back", async () => {
    // Owner report: a deleted sale left C02D503ZM6KJ Sold. A browser that
    // sends only the order's removal must still get the unit back on the shelf
    // and its sold row gone.
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const historyOf = (serial: string) =>
      events
        .filter((e) => e["serial"] === serial)
        .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const order = (shop["orders"] as Row[]).find((o) => {
      const serials = o["serials"] as string[];
      return (
        serials.length > 0 &&
        o["adjustments"] === undefined &&
        o["refunds"] === undefined &&
        o["tradeIns"] === undefined &&
        o["lines"] === undefined &&
        serials.every((s) => {
          const h = historyOf(s);
          return (
            h.length >= 2 &&
            h.at(-1)!["type"] === "TERJUAL" &&
            h.at(-1)!["refCode"] === o["code"]
          );
        })
      );
    })!;
    const serials = order["serials"] as string[];
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(diffStore({ orders: [order] }, { orders: [] })),
    });
    for (const s of serials) {
      const prev = historyOf(s).at(-2)!;
      const u = await db.unit.findUniqueOrThrow({
        where: { serial: s },
        select: { status: true, soldOrderItemId: true, id: true },
      });
      expect(u.status).toBe(prev["toStatus"]);
      expect(u.soldOrderItemId).toBeNull();
      expect(
        await db.unitEvent.count({
          where: { unitId: u.id, orderId: order["id"] as string },
        }),
      ).toBe(0);
    }
    // The projection agrees: no sold row left, status off the last row.
    const reread = (await snapshotStore(db, { staffId: ACTOR })).db;
    for (const s of serials) {
      const rows = (reread["events"] as Row[]).filter((e) => e["serial"] === s);
      expect(rows.some((e) => e["refCode"] === order["code"])).toBe(false);
      const unit = (reread["units"] as Row[]).find((u) => u["serial"] === s)!;
      expect(unit["status"]).not.toBe("TERJUAL");
    }
  }, 180_000);

  it("takes a unit off a sale with nothing but the order (2026-10-23): the server puts it back", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const historyOf = (serial: string) =>
      events
        .filter((e) => e["serial"] === serial)
        .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const order = (shop["orders"] as Row[]).find((o) => {
      const serials = o["serials"] as string[];
      return (
        serials.length >= 1 &&
        o["adjustments"] === undefined &&
        o["refunds"] === undefined &&
        o["tradeIns"] === undefined &&
        o["lines"] === undefined &&
        serials.every((s) => {
          const h = historyOf(s);
          return (
            h.length >= 2 &&
            h.at(-1)!["type"] === "TERJUAL" &&
            h.at(-1)!["refCode"] === o["code"]
          );
        })
      );
    })!;
    const first = (await snapshotStore(db, { staffId: ACTOR })).db;
    const sale = decodeRow(
      "orders",
      (first["orders"] as Row[]).find((o) => o["id"] === order["id"])!,
    ) as Row;
    const serials = sale["serials"] as string[];
    const off = serials[0]!;
    const { [off]: offPrice, ...prices } = sale["prices"] as Record<
      string,
      number
    >;
    const listPrices = sale["listPrices"] as Record<string, number> | undefined;
    const { [off]: _offList, ...restList } = listPrices ?? {};
    const after: Row = {
      ...sale,
      serials: serials.slice(1),
      prices,
      ...(listPrices ? { listPrices: restList } : {}),
      total: (sale["total"] as number) - offPrice!,
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore({ orders: [sale] }, { orders: [after] }),
      ),
    });
    const prev = historyOf(off).at(-2)!;
    const u = await db.unit.findUniqueOrThrow({
      where: { serial: off },
      select: { id: true, status: true, soldOrderItemId: true },
    });
    expect(u.status).toBe(prev["toStatus"]);
    expect(u.soldOrderItemId).toBeNull();
    expect(
      await db.unitEvent.count({
        where: { unitId: u.id, orderId: order["id"] as string },
      }),
    ).toBe(0);
    // A unit still on the sale keeps its sold row.
    if (serials[1] !== undefined) {
      const kept = await db.unit.findUniqueOrThrow({
        where: { serial: serials[1] },
        select: { status: true },
      });
      expect(kept.status).toBe("TERJUAL");
    }
  }, 180_000);

  it("takes a customer return back (2026-10-23): the adjustment is withdrawn, the line reopens, the unit is the sale's again", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const historyOf = (serial: string) =>
      events
        .filter((e) => e["serial"] === serial)
        .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const order = (shop["orders"] as Row[]).find((o) => {
      const serials = o["serials"] as string[];
      return (
        serials.length >= 1 &&
        o["adjustments"] === undefined &&
        o["refunds"] === undefined &&
        o["tradeIns"] === undefined &&
        o["lines"] === undefined &&
        serials.every((s) => {
          const h = historyOf(s);
          return (
            h.length >= 2 &&
            h.at(-1)!["type"] === "TERJUAL" &&
            h.at(-1)!["refCode"] === o["code"]
          );
        })
      );
    })!;
    const decoded = (snap: Record<string, unknown>, c: string) =>
      (snap[c] as Row[]).map((r) => decodeRow(c as never, r) as Row);
    let snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    const sale = decoded(snap, "orders").find((o) => o["id"] === order["id"])!;
    const serial = (sale["serials"] as string[])[0]!;
    const price = (sale["prices"] as Record<string, number>)[serial]!;
    const unit = decoded(snap, "units").find((u) => u["serial"] === serial)!;
    const sold = decoded(snap, "events")
      .filter((e) => e["serial"] === serial)
      .sort((a, b) => (a["seq"] as number) - (b["seq"] as number))
      .at(-1)!;
    const code = "SG-2026/10-Tundo123";
    const at = new Date(Date.now() + 60_000).toISOString();

    // The return.
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [sale], returns: [], units: [unit], events: [] },
          {
            orders: [
              {
                ...sale,
                adjustments: [
                  {
                    id: "adj_undo_test",
                    type: "RETUR",
                    code,
                    amount: price,
                    reason: `Returned ${serial}`,
                    at,
                  },
                ],
              },
            ],
            returns: [
              {
                id: "r_undo_test",
                code,
                kind: "CUSTOMER",
                serial,
                reason: "Rusak",
                date: at.slice(0, 10),
                status: "ARRIVED",
              },
            ],
            units: [{ ...unit, status: "TERSEDIA" }],
            events: [
              {
                id: "ev_undo_ret",
                serial,
                seq: (sold["seq"] as number) + 1,
                type: "RETUR_PELANGGAN",
                at,
                fromStatus: "TERJUAL",
                toStatus: "TERSEDIA",
                locationId: sold["locationId"],
                note: "Returned",
                refCode: code,
                staff: "Michella",
              },
            ],
          },
        ),
      ),
    });
    const closed = await db.orderItem.findFirstOrThrow({
      where: { orderId: order["id"] as string, unit: { serial } },
    });
    expect(closed.returnReason).toBe("Retur pelanggan");

    // The undo, exactly as Returns → Delete writes it.
    snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    const sale2 = decoded(snap, "orders").find((o) => o["id"] === order["id"])!;
    const ret2 = decoded(snap, "returns").find(
      (r) => r["id"] === "r_undo_test",
    )!;
    const unit2 = decoded(snap, "units").find((u) => u["serial"] === serial)!;
    const realCode = ret2["code"] as string;
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [sale2], returns: [ret2], units: [unit2], events: [] },
          {
            orders: [{ ...sale2, adjustments: undefined }],
            returns: [{ ...ret2, status: "CANCELLED" }],
            units: [{ ...unit2, status: "TERJUAL" }],
            events: [
              {
                id: "ev_undo_back",
                serial,
                seq: (sold["seq"] as number) + 2,
                type: "KOREKSI",
                at: new Date(Date.now() + 120_000).toISOString(),
                fromStatus: "TERSEDIA",
                toStatus: "TERJUAL",
                locationId: sold["locationId"],
                note: `Return ${realCode} taken back`,
                refCode: realCode,
                staff: "Michella",
              },
            ],
          },
        ),
      ),
    });
    const line = await db.orderItem.findUniqueOrThrow({
      where: { id: closed.id },
    });
    expect(line.returnedAt).toBeNull();
    expect(line.returnReason).toBeNull();
    const u = await db.unit.findUniqueOrThrow({
      where: { serial },
      select: { status: true, soldOrderItemId: true },
    });
    expect(u.status).toBe("TERJUAL");
    expect(u.soldOrderItemId).toBe(closed.id);
    const adj = await db.orderAdjustment.findUniqueOrThrow({
      where: { id: "adj_undo_test" },
    });
    expect(adj.amount).toBe(0n);
    // Gone from what the tills read.
    snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    const reread = decoded(snap, "orders").find(
      (o) => o["id"] === order["id"],
    )!;
    expect(reread["adjustments"]).toBeUndefined();
  }, 180_000);

  it("refuses a unit off the shelf on a sale, and a hold's row in history (2026-10-23)", async () => {
    await loadDemo();
    let snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    const decoded = (c: string) =>
      (snap[c] as Row[]).map((r) => decodeRow(c as never, r) as Row);
    const sale = decoded("orders").find(
      (o) =>
        (o["serials"] as string[]).length >= 1 &&
        o["lines"] === undefined &&
        o["adjustments"] === undefined,
    )!;
    const inQc = decoded("units").find(
      (u) =>
        u["status"] !== "TERSEDIA" &&
        u["status"] !== "TERJUAL" &&
        u["status"] !== "DIRESERVASI",
    )!;
    expect(inQc).toBeDefined();
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { orders: [sale] },
            {
              orders: [
                {
                  ...sale,
                  serials: [...(sale["serials"] as string[]), inQc["serial"]],
                  prices: {
                    ...(sale["prices"] as Record<string, number>),
                    [inQc["serial"] as string]: 1_000_000,
                  },
                  total: (sale["total"] as number) + 1_000_000,
                },
              ],
            },
          ),
        ),
      }),
    ).rejects.toThrow(/tidak tersedia untuk dijual/);

    // A hold row on top of a unit's history goes with its hold, not here.
    const unit = decoded("units").find((u) => u["status"] === "TERSEDIA")!;
    const last = decoded("events")
      .filter((e) => e["serial"] === unit["serial"])
      .sort((a, b) => (a["seq"] as number) - (b["seq"] as number))
      .at(-1)!;
    const hold = {
      id: "ev_hold_doc",
      serial: unit["serial"],
      seq: (last["seq"] as number) + 1,
      type: "DIRESERVASI",
      at: new Date().toISOString(),
      fromStatus: "TERSEDIA",
      toStatus: "DIRESERVASI",
      locationId: last["locationId"],
      note: "Held",
      staff: "Michella",
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { units: [unit], events: [] },
          { units: [{ ...unit, status: "DIRESERVASI" }], events: [hold] },
        ),
      ),
    });
    snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    const held = decoded("units").find((u) => u["serial"] === unit["serial"])!;
    const row = decoded("events").find((e) => e["id"] === "ev_hold_doc")!;
    await expect(
      commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { units: [held], events: [row] },
            { units: [{ ...held, status: "TERSEDIA" }], events: [] },
          ),
        ),
      }),
    ).rejects.toThrow(/milik dokumennya/);
  }, 180_000);

  it("corrects a sale (2026-10-22): a unit off, a price changed, an accessory added and taken off", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const historyOf = (serial: string) =>
      events
        .filter((e) => e["serial"] === serial)
        .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const lastIsSaleOf = (o: Row, s: string) => {
      const h = historyOf(s);
      return (
        h.length >= 2 &&
        h.at(-1)!["type"] === "TERJUAL" &&
        h.at(-1)!["refCode"] === o["code"]
      );
    };
    const order = (shop["orders"] as Row[]).find(
      (o) =>
        (o["serials"] as string[]).length >= 1 &&
        o["adjustments"] === undefined &&
        o["tradeIns"] === undefined &&
        (o["serials"] as string[]).some((s) => lastIsSaleOf(o, s)),
    )!;
    expect(order).toBeDefined();
    // The database's own reading of the sale is the base a till would hold.
    const first = (await snapshotStore(db, { staffId: ACTOR })).db;
    const sale = decodeRow(
      "orders",
      (first["orders"] as Row[]).find((o) => o["id"] === order["id"])!,
    ) as Row;
    const serials = sale["serials"] as string[];
    const prices = sale["prices"] as Record<string, number>;
    const off = serials.find((s) => lastIsSaleOf(order, s))!;
    const keep = serials.find((s) => s !== off);
    const offBase = decodeRow(
      "units",
      (first["units"] as Row[]).find((u) => u["serial"] === off)!,
    ) as Row;
    const offEvents = (first["events"] as Row[])
      .map((e) => decodeRow("events", e) as Row)
      .filter((e) => e["serial"] === off)
      .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
    const prev = offEvents.at(-2)!;
    const cogsBefore = (
      await db.order.findUniqueOrThrow({
        where: { id: order["id"] as string },
        select: { cogs: true },
      })
    ).cogs;

    const { [off]: _gone, ...restPrices } = prices;
    const listPrices = sale["listPrices"] as Record<string, number> | undefined;
    const { [off]: _goneList, ...restList } = listPrices ?? {};
    const corrected: Row = {
      ...sale,
      serials: serials.filter((s) => s !== off),
      prices:
        keep === undefined
          ? restPrices
          : { ...restPrices, [keep]: prices[keep]! + 100_000 },
      ...(listPrices ? { listPrices: restList } : {}),
      total:
        (sale["total"] as number) -
        prices[off]! +
        (keep === undefined ? 0 : 100_000),
    };
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          {
            orders: [sale],
            units: [offBase],
            events: offEvents,
          },
          {
            orders: [corrected],
            units: [
              {
                ...offBase,
                status: prev["toStatus"],
                locationId: prev["locationId"],
              },
            ],
            events: offEvents.slice(0, -1),
          },
        ),
      ),
    });
    let snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    let row = decodeRow(
      "orders",
      (snap["orders"] as Row[]).find((o) => o["id"] === order["id"])!,
    ) as Row;
    expect(row["serials"]).toEqual(serials.filter((s) => s !== off));
    if (keep !== undefined)
      expect((row["prices"] as Record<string, number>)[keep]).toBe(
        prices[keep]! + 100_000,
      );
    const offRow = await db.unit.findUniqueOrThrow({
      where: { serial: off },
      select: { status: true, soldOrderItemId: true, buy: true },
    });
    expect(offRow.status).toBe(prev["toStatus"]);
    expect(offRow.soldOrderItemId).toBeNull();
    const cogsAfter = (
      await db.order.findUniqueOrThrow({
        where: { id: order["id"] as string },
        select: { cogs: true },
      })
    ).cogs;
    expect(cogsAfter).toBe(cogsBefore - offRow.buy);

    // An accessory: a counted variant the demo holds stock of.
    const moves = shop["stockMoves"] as Row[];
    const held = new Map<string, number>();
    for (const m of moves) {
      const k = `${m["skuId"]}|${m["locationId"]}`;
      held.set(k, (held.get(k) ?? 0) + (m["qty"] as number));
    }
    const [key] = [...held.entries()].find(([, n]) => n > 0)!;
    const [skuId, locationId] = key.split("|") as [string, string];
    const withLine: Row = {
      ...corrected,
      lines: [
        ...(((corrected["lines"] as Row[] | undefined) ?? []) as Row[]),
        { id: "ol_store_edit", skuId, qty: 1, price: 50_000 },
      ],
      total: (corrected["total"] as number) + 50_000,
    };
    const sold = {
      id: "sm_store_edit_out",
      skuId,
      locationId,
      qty: -1,
      cost: 20_000,
      type: "TERJUAL",
      at: NOW.toISOString(),
      refCode: order["code"],
      orderId: order["id"],
      orderLineId: "ol_store_edit",
      staff: "Test",
    };
    const base = (await snapshotStore(db, { staffId: ACTOR })).db;
    const baseOrder = decodeRow(
      "orders",
      (base["orders"] as Row[]).find((o) => o["id"] === order["id"])!,
    ) as Row;
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [baseOrder], stockMoves: [] },
          {
            orders: [
              {
                ...baseOrder,
                lines: withLine["lines"],
                total: withLine["total"],
              },
            ],
            stockMoves: [sold],
          },
        ),
      ),
    });
    snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    row = decodeRow(
      "orders",
      (snap["orders"] as Row[]).find((o) => o["id"] === order["id"])!,
    ) as Row;
    expect(
      ((row["lines"] as Row[]) ?? []).some((l) => l["id"] === "ol_store_edit"),
    ).toBe(true);

    // …and taken off again: the line closes and the piece goes back.
    const { lines: _l, ...noLine } = row;
    const back = {
      ...sold,
      id: "sm_store_edit_back",
      qty: 1,
      type: "KOREKSI",
    };
    const keptLines = ((row["lines"] as Row[]) ?? []).filter(
      (l) => l["id"] !== "ol_store_edit",
    );
    await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { orders: [row], stockMoves: [] },
          {
            orders: [
              {
                ...noLine,
                ...(keptLines.length > 0 ? { lines: keptLines } : {}),
                total: (row["total"] as number) - 50_000,
              },
            ],
            stockMoves: [back],
          },
        ),
      ),
    });
    snap = (await snapshotStore(db, { staffId: ACTOR })).db;
    row = decodeRow(
      "orders",
      (snap["orders"] as Row[]).find((o) => o["id"] === order["id"])!,
    ) as Row;
    expect(
      ((row["lines"] as Row[] | undefined) ?? []).some(
        (l) => l["id"] === "ol_store_edit",
      ),
    ).toBe(false);
    const item = await db.orderItem.findUniqueOrThrow({
      where: { id: "ol_store_edit" },
      select: { returnReason: true },
    });
    expect(item.returnReason).toBe("Dikoreksi");
    const finalCogs = (
      await db.order.findUniqueOrThrow({
        where: { id: order["id"] as string },
        select: { cogs: true },
      })
    ).cogs;
    expect(finalCogs).toBe(cogsAfter);
  }, 180_000);

  it("deletes a settled sale inside a book closed before the close was retired (2026-10-27)", async () => {
    const shop = await loadDemo();
    // A settled one: that is what the old close locked (2026-10-22).
    const order = (shop["orders"] as Row[]).find(
      (o) => o["adjustments"] === undefined && o["settled"] === true,
    )!;
    await db.appSetting.upsert({
      where: { key: "finance.booksClosedAt" },
      create: {
        key: "finance.booksClosedAt",
        value: new Date(Date.now() + 86_400_000).toISOString(),
        updatedAt: new Date(),
      },
      update: { value: new Date(Date.now() + 86_400_000).toISOString() },
    });
    try {
      await commitStore(db, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ orders: [order] }, { orders: [] }),
        ),
      });
      const row = await db.order.findUniqueOrThrow({
        where: { id: order["id"] as string },
        select: { status: true },
      });
      expect(row.status).toBe("BATAL");
    } finally {
      await db.appSetting.delete({ where: { key: "finance.booksClosedAt" } });
    }
  }, 180_000);
});

describe("money that settles a debt without moving the balance (2026-09-22)", () => {
  /** Commit `base` → `next` for one collection, and read the row back. */
  async function commitRow(
    name: "pos" | "orders" | "deposits" | "suppliers" | "customers",
    base: Row | undefined,
    next: Row,
    extra: { base: Record<string, Row[]>; next: Record<string, Row[]> } = {
      base: {},
      next: {},
    },
  ): Promise<Row> {
    const result = await commitStore(db, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(
          { [name]: base === undefined ? [] : [base], ...extra.base },
          { [name]: [next], ...extra.next },
        ),
      ),
    });
    const row = (result.rows[name] as Row[]).find(
      (r) => r["id"] === next["id"],
    );
    if (row === undefined) throw new Error(`${name} ${next["id"]} not written`);
    return decodeRow(name, row) as Row;
  }

  it("keeps the switch on an invoice payment, a sale payment and a deposit", async () => {
    const shop = await loadDemo();
    const supplierId = (shop["suppliers"] as Row[])[0]!["id"] as string;

    // An invoice paid partly by the owner from his own account.
    const po = {
      id: "po_store_balance",
      code: "PI-2026/09-Tbal1234",
      supplierId,
      invoice: "INV-BAL",
      date: "2026-09-22",
      locationId: (shop["warehouses"] as Row[])[0]!["id"],
      items: [
        {
          id: "poi_store_balance",
          skuId: (shop["skus"] as Row[])[0]!["id"],
          serial: null,
          qty: 1,
          unitCost: 2_000_000,
        },
      ],
      payments: [
        {
          id: "pp_store_owner",
          method: "TRANSFER",
          amount: 1_500_000,
          at: NOW.toISOString(),
          appliedTo: "ORDER",
          inBalance: false,
        },
        {
          id: "pp_store_shop",
          method: "TUNAI",
          amount: 500_000,
          at: NOW.toISOString(),
          appliedTo: "ORDER",
        },
      ],
      fees: [],
      discount: 0,
      status: "ORDERED",
    };
    const savedPo = await commitRow("pos", undefined, po);
    const [owner, shopPaid] = savedPo["payments"] as Row[];
    expect(owner!["inBalance"]).toBe(false);
    // True is the absent key, or every row would diff against the browser's.
    expect(shopPaid!["inBalance"]).toBeUndefined();
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: "pp_store_owner" } }))
        .inBalance,
    ).toBe(false);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: "pp_store_shop" } }))
        .inBalance,
    ).toBe(true);

    // Switched back on, from the row the commit answered with — which is also
    // proof the projection passes a till's conflict check.
    const flipped = {
      ...savedPo,
      payments: (savedPo["payments"] as Row[]).map((p) => {
        const { inBalance: _dropped, ...rest } = p;
        return rest;
      }),
    };
    const againPo = await commitRow("pos", savedPo, flipped);
    expect(
      (againPo["payments"] as Row[]).every((p) => p["inBalance"] === undefined),
    ).toBe(true);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: "pp_store_owner" } }))
        .inBalance,
    ).toBe(true);

    // A sale whose payment never reached the drawer or the bank.
    const unit = (shop["units"] as Row[]).find(
      (u) => u["status"] === "TERSEDIA",
    )!;
    const serial = unit["serial"] as string;
    const seq =
      (shop["events"] as Row[]).filter((e) => e["serial"] === serial).length +
      1;
    const sale = {
      id: "o_store_balance",
      code: "SI-2026/09-000922",
      ts: NOW.toISOString(),
      customerId: null,
      serials: [serial],
      prices: { [serial]: 5_000_000 },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TRANSFER",
      settled: true,
      payments: [
        {
          id: "p_store_balance",
          method: "TRANSFER",
          amount: 5_000_000,
          state: "SETTLED",
          at: NOW.toISOString(),
          inBalance: false,
        },
      ],
      total: 5_000_000,
    };
    const event = {
      id: "ev_store_balance",
      serial,
      seq,
      type: "TERJUAL",
      at: NOW.toISOString(),
      fromStatus: "TERSEDIA",
      toStatus: "TERJUAL",
      locationId: unit["locationId"],
      note: "Sold",
      refCode: sale.code,
      staff: "Michella",
    };
    const savedSale = await commitRow("orders", undefined, sale, {
      base: { units: [unit], events: [] },
      next: { units: [{ ...unit, status: "TERJUAL" }], events: [event] },
    });
    expect((savedSale["payments"] as Row[])[0]!["inBalance"]).toBe(false);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: "p_store_balance" } }))
        .inBalance,
    ).toBe(false);

    // A deposit — the remainder of a payment the owner made personally.
    const deposit = {
      id: "dep_store_balance",
      supplierId,
      amount: 3_000_000,
      method: "TRANSFER",
      at: NOW.toISOString(),
      inBalance: false,
      staff: "Michella",
      allocations: [],
    };
    const savedDeposit = await commitRow("deposits", undefined, deposit);
    expect(savedDeposit["inBalance"]).toBe(false);
    expect(
      (
        await db.supplierDeposit.findUniqueOrThrow({
          where: { id: "dep_store_balance" },
        })
      ).inBalance,
    ).toBe(false);
    const { inBalance: _off, ...depositOn } = savedDeposit;
    const againDeposit = await commitRow("deposits", savedDeposit, depositOn);
    expect(againDeposit["inBalance"]).toBeUndefined();
    // A deposit the browser never switched is the default, and says nothing.
    const plain = (
      decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>
    )["deposits"]!.find((d) => d["id"] !== "dep_store_balance")!;
    expect(plain["inBalance"]).toBeUndefined();
  }, 180_000);

  it("refuses a supplier's opening balance — the column is gone", async () => {
    // Owner ask 2026-09-24: *"remove the column 'Utang lama' … we don't track
    // it anymore (remove from database schema)"*. `Supplier.openingBalance`,
    // `openingBalanceAt` and `Payment.supplierId` went with it, so the store
    // contract refuses the keys rather than dropping them silently.
    const shop = await loadDemo();
    const supplier = (shop["suppliers"] as Row[])[0]!;
    await expect(
      commitRow("suppliers", supplier, {
        ...supplier,
        openingBalance: 10_000_000,
      }),
    ).rejects.toThrow();
    // And a payment can no longer name a supplier at all.
    await expect(
      db.$queryRaw`SELECT "supplierId" FROM "Payment" LIMIT 1`,
    ).rejects.toThrow();
  }, 180_000);

  it("records a customer's payment against their opening balance, as money in", async () => {
    const shop = await loadDemo();
    const customer = (shop["customers"] as Row[])[0]!;
    const paid = {
      ...customer,
      openingBalance: 2_500_000,
      openingPayments: [
        {
          id: "op_cus_1",
          method: "TUNAI",
          amount: 1_000_000,
          at: NOW.toISOString(),
          note: "Bayar sebagian",
        },
      ],
    };
    const saved = await commitRow("customers", customer, paid);
    expect(saved["openingPayments"]).toEqual(paid.openingPayments);
    expect(
      await db.payment.findUniqueOrThrow({ where: { id: "op_cus_1" } }),
    ).toMatchObject({
      customerId: customer["id"],
      orderId: null,
      poId: null,
      direction: "MASUK",
      status: "LUNAS",
      inBalance: true,
    });

    // A customer created with the payment in the same commit.
    const fresh = {
      id: "cus_store_opening",
      name: "Pelanggan Lama",
      phone: "",
      createdAt: NOW.toISOString(),
      openingBalance: 800_000,
      openingPayments: [
        {
          id: "op_cus_new",
          method: "TRANSFER",
          amount: 300_000,
          at: NOW.toISOString(),
          inBalance: false,
        },
      ],
    };
    const created = await commitRow("customers", undefined, fresh);
    expect(created["openingPayments"]).toEqual(fresh.openingPayments);
    expect(
      await db.payment.findUniqueOrThrow({ where: { id: "op_cus_new" } }),
    ).toMatchObject({
      customerId: "cus_store_opening",
      direction: "MASUK",
      inBalance: false,
    });
  }, 180_000);
});

describe("as nusantara_app, the role the API commits as (2026-10-21)", () => {
  /**
   * Every other test here commits as the owner, who may do anything — which
   * is how Receive on Pending Payment shipped broken: the commit locks the
   * rows it touches with `SELECT … FOR UPDATE`, PostgreSQL wants UPDATE on at
   * least one column for that, and the app role holds none on an append-only
   * log. "permission denied for table SettlementLog", and only in production.
   */
  const asRole = (role: string): string => {
    const u = new globalThis.URL(URL);
    u.username = role;
    u.password = "";
    return u.toString();
  };

  it("can take every collection's lock", async () => {
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      const refused: string[] = [];
      for (const name of COLLECTION_NAMES) {
        const adapter = ADAPTERS[name] as unknown as {
          lock: (tx: unknown, keys: readonly string[]) => Promise<void>;
        };
        await app
          .$transaction((tx) => adapter.lock(tx, ["no-such-row"]))
          .catch((err: unknown) => {
            refused.push(`${name}: ${String(err).split("\n").at(-1)}`);
          });
      }
      expect(refused).toEqual([]);
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  /*
   * The activity log (owner ask 2026-10-22): every row a till saves is a line
   * in AuditLog — who, when, what — written in the commit's own transaction,
   * as the role the API commits as.
   */
  it("writes who changed what, field by field, as nusantara_app", async () => {
    const shop = await loadDemo();
    // The import above wrote none: a migration's rows are not activity.
    expect(await db.auditLog.count()).toBe(0);
    const unit = (shop["units"] as Row[]).find(
      (u) => u["status"] === "TERSEDIA",
    )!;
    const regraded = unit["grade"] === "B" ? "C" : "B";
    const note = {
      id: "note-activity-1",
      serial: unit["serial"],
      body: "",
      tag: "QC",
      staff: "Store Test",
      at: "2026-09-13T04:00:00.000Z",
      photos: [
        {
          id: "ph-activity-1",
          url: "data:image/jpeg;base64," + "A".repeat(4000),
          sortOrder: 0,
        },
      ],
    };
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      await commitStore(app, {
        staffId: ACTOR,
        ip: "100.64.0.7",
        changes: encodeChangeset(
          diffStore(
            { units: [unit], unitNotes: [] },
            {
              units: [{ ...unit, price: 7_250_000, grade: regraded }],
              unitNotes: [note],
            },
          ),
        ),
      });
      // Removed as the server now holds it: the photo's url is its own.
      const held = (
        decodeStore((await snapshotStore(db, { staffId: ACTOR })).db) as {
          unitNotes: Row[];
        }
      ).unitNotes.find((n) => n["id"] === note.id)!;
      await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ unitNotes: [held] }, { unitNotes: [] }),
        ),
      });
    } finally {
      await app.$disconnect();
    }

    const lines = await db.auditLog.findMany({ orderBy: { at: "asc" } });
    const edit = lines.find((l) => l.entity === "units")!;
    expect(edit).toMatchObject({
      staffId: ACTOR,
      action: "UPDATE",
      entityId: unit["serial"],
      ip: "100.64.0.7",
    });
    expect(edit.field?.split(", ").sort()).toEqual(["grade", "price"]);
    expect(JSON.parse(edit.after!)).toEqual({
      price: "7250000",
      grade: regraded,
    });
    expect(JSON.parse(edit.before!)).toMatchObject({
      price: String(unit["price"]),
    });

    const notes = lines.filter((l) => l.entity === "unitNotes");
    expect(notes.map((l) => l.action)).toEqual(["CREATE", "DELETE"]);
    // A photo is not copied into the log.
    expect(
      notes.every((l) => !(l.after ?? l.before ?? "").includes("AAAA")),
    ).toBe(true);
    expect(JSON.parse(notes[0]!.after!)).toMatchObject({
      serial: unit["serial"],
    });
  });

  it("deletes an unused supplier and customer, and refuses a used customer", async () => {
    const shop = await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      const created = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { suppliers: [], customers: [] },
            {
              suppliers: [{ id: "sup_app_unused", name: "ZZ App supplier" }],
              customers: [
                {
                  id: "cus_app_unused",
                  name: "ZZ App customer",
                  phone: "",
                  addresses: [{ id: "adr_app_unused", line: "Jl. Uji 2" }],
                  createdAt: new Date().toISOString(),
                },
              ],
            },
          ),
        ),
      });
      const sup = decodeRow("suppliers", (created.rows.suppliers as Row[])[0]!);
      const cus = decodeRow("customers", (created.rows.customers as Row[])[0]!);
      const removal = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { suppliers: [sup], customers: [cus] },
            { suppliers: [], customers: [] },
          ),
        ),
      });
      expect(removal.removed.suppliers).toEqual(["sup_app_unused"]);
      expect(removal.removed.customers).toEqual(["cus_app_unused"]);

      const buyer = (shop["customers"] as Row[]).find((c) =>
        (shop["orders"] as Row[]).some((o) => o["customerId"] === c["id"]),
      )!;
      await expect(
        commitStore(app, {
          staffId: ACTOR,
          changes: encodeChangeset(
            diffStore({ customers: [buyer] }, { customers: [] }),
          ),
        }),
      ).rejects.toThrow(/punya transaksi/);
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("deletes an Income & Expense adjustment, and refuses one inside a closed book (2026-10-24)", async () => {
    await loadDemo(); // the payment methods an expense names
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    const today = new Date().toISOString().slice(0, 10);
    const add = async (id: string): Promise<Row> => {
      const created = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { expenses: [] },
            {
              expenses: [
                {
                  id,
                  kind: "OPERATIONAL",
                  amount: 60_200,
                  date: today,
                  method: "TRANSFER",
                  note: "ZZ test input",
                },
              ],
            },
          ),
        ),
      });
      return decodeRow("expenses", (created.rows.expenses as Row[])[0]!);
    };
    const remove = (row: Row) =>
      commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore({ expenses: [row] }, { expenses: [] }),
        ),
      });
    try {
      const first = await add("exp_app_delete");
      const removal = await remove(first);
      expect(removal.removed.expenses).toEqual(["exp_app_delete"]);
      expect(
        await db.expense.findUnique({ where: { id: "exp_app_delete" } }),
      ).toBeNull();

      const second = await add("exp_app_closed");
      await db.appSetting.upsert({
        where: { key: "finance.booksClosedAt" },
        create: {
          key: "finance.booksClosedAt",
          value: new Date(Date.now() + 86_400_000).toISOString(),
          updatedAt: new Date(),
        },
        update: { value: new Date(Date.now() + 86_400_000).toISOString() },
      });
      // The book close is retired (2026-10-27): a stored close is ignored.
      const removed = await remove(second);
      expect(removed.removed.expenses).toEqual(["exp_app_closed"]);
    } finally {
      await db.appSetting.deleteMany({
        where: { key: "finance.booksClosedAt" },
      });
      await db.expense.deleteMany({
        where: { id: { in: ["exp_app_delete", "exp_app_closed"] } },
      });
      await app.$disconnect();
    }
  }, 180_000);

  it("files an expense as a bank / marketplace fee and reads it back (2026-10-27)", async () => {
    await loadDemo(); // the payment methods an expense names
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      const created = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { expenses: [] },
            {
              expenses: [
                {
                  id: "exp_app_fee",
                  kind: "BIAYA_ADMIN",
                  amount: 6_500,
                  date: new Date().toISOString().slice(0, 10),
                  method: "TRANSFER",
                  label: "ZZ BIAYA ADM",
                },
              ],
            },
          ),
        ),
      });
      expect(
        decodeRow("expenses", (created.rows.expenses as Row[])[0]!),
      ).toMatchObject({ kind: "BIAYA_ADMIN", amount: 6_500 });
      const row = await db.expense.findUnique({ where: { id: "exp_app_fee" } });
      expect(row?.kind).toBe("BIAYA_ADMIN");
      const back = decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
      expect(
        back["expenses"]!.find((e) => e["id"] === "exp_app_fee"),
      ).toMatchObject({ kind: "BIAYA_ADMIN", amount: 6_500 });
    } finally {
      await db.expense.deleteMany({ where: { id: "exp_app_fee" } });
      await app.$disconnect();
    }
  }, 180_000);

  it("merges a duplicate product: units move, the old variant is kept and marked, a third copy is refused (2026-10-21)", async () => {
    const shop = await loadDemo();
    const category = (shop["models"] as Row[])[0]!["category"];
    const model = (id: string, name: string): Row => ({
      id,
      name,
      category,
      releaseYear: 2031,
      axes: [
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["512GB"] },
      ],
      source: "MANUAL",
    });
    const variant = (id: string, modelId: string, code: string): Row => ({
      id,
      modelId,
      code,
      name: "x",
      variantLabel: "8GB / 512GB",
      price: 0,
    });
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      // The shop's duplicates are from before this rule: made in import mode,
      // which lets one through keyless rather than failing a replay.
      const created = await commitStore(db, {
        staffId: ACTOR,
        mode: "import",
        changes: encodeChangeset(
          diffStore(
            { models: [], skus: [] },
            {
              models: [
                model("m_full", 'MacBook Air 13" 2031'),
                { ...model("m_dup", 'AIR 13" 2031'), identifiers: ["ZZ99,1"] },
              ],
              skus: [
                variant("s_full", "m_full", 'AIR 13" 2031 8/512'),
                variant("s_dup", "m_dup", "SKU_ZZDUP"),
              ],
            },
          ),
        ),
      });
      const rows = (name: "models" | "skus") =>
        new Map(
          (created.rows[name] as Row[])
            .map((r) => decodeRow(name, r))
            .map((r) => [r["id"] as string, r]),
        );
      const models = rows("models");
      const skus = rows("skus");
      // The second copy is keyless: the first holds the product's key.
      expect(
        (await db.catalogModel.findUnique({ where: { id: "m_dup" } }))!
          .productKey,
      ).toBeNull();

      // Put a unit on the shelf under the duplicate.
      const snap = decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
      const unit = snap["units"]!.find((u) => u["status"] === "TERSEDIA")!;
      await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { units: [unit] },
            { units: [{ ...unit, skuId: "s_dup" }] },
          ),
        ),
      });

      // The merge, as the browser sends it.
      const merged = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            {
              models: [models.get("m_full")!, models.get("m_dup")!],
              skus: [skus.get("s_dup")!],
              units: [{ ...unit, skuId: "s_dup" }],
            },
            {
              models: [
                {
                  ...models.get("m_full")!,
                  family: "MacBook Air",
                  sizeInch: 13,
                  identifiers: ["ZZ99,1"],
                },
              ],
              skus: [
                {
                  ...skus.get("s_dup")!,
                  modelId: "m_full",
                  mergedIntoId: "s_full",
                },
              ],
              units: [{ ...unit, skuId: "s_full" }],
            },
          ),
        ),
      });
      expect(merged.removed.models).toEqual(["m_dup"]);
      const dup = await db.sku.findUnique({ where: { id: "s_dup" } });
      expect(dup).toMatchObject({ archived: true, mergedIntoId: "s_full" });
      expect(
        (await db.unit.findUnique({
          where: { serial: unit["serial"] as string },
        }))!.skuId,
      ).toBe("s_full");
      expect(
        (await db.modelIdentifier.findUnique({
          where: { identifier: "ZZ99,1" },
        }))!.modelId,
      ).toBe("m_full");
      const full = await db.catalogModel.findUnique({
        where: { id: "m_full" },
      });
      expect(full!.productKey).toBe("MACBOOK AIR|13|2031|");
      // Still projected, for the receipts that name it.
      const after = decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
      expect(after["skus"]!.find((s) => s["id"] === "s_dup")).toMatchObject({
        mergedIntoId: "s_full",
      });

      // A third copy of the product is refused…
      await expect(
        commitStore(app, {
          staffId: ACTOR,
          changes: encodeChangeset(
            diffStore(
              { models: [] },
              { models: [model("m_third", 'MacBook Air 13" 2031')] },
            ),
          ),
        }),
      ).rejects.toThrow(/sudah ada/);
      // …and so is a second copy of a variant on its product.
      await expect(
        commitStore(app, {
          staffId: ACTOR,
          changes: encodeChangeset(
            diffStore(
              { skus: [] },
              { skus: [variant("s_again", "m_full", 'AIR 13" 2031 8/512 X')] },
            ),
          ),
        }),
      ).rejects.toThrow(/sudah ada/);
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  /*
   * Service charges become money, and can be taken out (owner 2026-10-26,
   * migration 20261026090000): a paid charge is an Expense of kind UNIT naming
   * it; a charge goes only together with its expense; a whole visit can go;
   * nothing inside a closed book.
   */
  it("removes a service charge with its expense, and a whole visit — never in a closed book (2026-10-26)", async () => {
    await loadDemo();
    const snap = decodeStore(
      (await snapshotStore(db, { staffId: ACTOR })).db,
    ) as unknown as Record<string, Row[]>;
    const unit = snap["units"]!.find((u) => u["status"] === "TERSEDIA")!;
    const at = "2026-10-26T03:00:00.000Z";
    const visit = (id: string, feeIds: string[]): Row => ({
      id,
      serial: unit["serial"],
      fromLocationId: unit["locationId"],
      openedAt: at,
      arrivedAt: at,
      fees: feeIds.map((f, i) => ({
        id: f,
        kind: i === 0 ? "LABOUR" : "SHIPPING",
        label: f,
        amount: 100_000 * (i + 1),
        at,
        staff: "Store Test",
      })),
      raisedBy: "ADJUSTMENT",
      staff: "Store Test",
    });
    const expenseFor = (id: string, feeId: string, amount: number): Row => ({
      id,
      kind: "UNIT",
      amount,
      date: "2026-10-26",
      method: "TRANSFER",
      note: `${unit["serial"]} · ${feeId}`,
      serviceFeeId: feeId,
    });
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    const commit = (before: Partial<StoreShape>, after: Partial<StoreShape>) =>
      commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(before as StoreShape, after as StoreShape),
        ),
      });
    try {
      // A visit with two charges, the first paid.
      const created = await commit({ services: [], expenses: [] }, {
        services: [visit("svc-app-1", ["sf-app-1", "sf-app-2"])],
        expenses: [expenseFor("exp-app-sf-1", "sf-app-1", 100_000)],
      } as unknown as Partial<StoreShape>);
      let svc = decodeRow("services", (created.rows.services as Row[])[0]!);
      const exp = decodeRow("expenses", (created.rows.expenses as Row[])[0]!);
      expect(exp).toMatchObject({ kind: "UNIT", serviceFeeId: "sf-app-1" });
      // The visit says which charge is paid — derived from the expense, for
      // the tills that are sent no expenses.
      expect((svc["fees"] as Row[]).map((f) => f["paid"])).toEqual([
        true,
        undefined,
      ]);
      const back = decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
      expect(
        back["expenses"]!.find((e) => e["id"] === "exp-app-sf-1"),
      ).toMatchObject({ serviceFeeId: "sf-app-1" });

      // A second expense on the same charge is refused in words.
      await expect(
        commit({ expenses: [] }, {
          expenses: [{ ...exp, id: "exp-app-sf-1b" }],
        } as unknown as Partial<StoreShape>),
      ).rejects.toThrow(/sudah dibayar/);

      // Paying the second charge on its own changes the VISIT's projection
      // too, so the commit answers with it.
      const paidLater = await commit({ expenses: [] }, {
        expenses: [expenseFor("exp-app-sf-2", "sf-app-2", 200_000)],
      } as unknown as Partial<StoreShape>);
      svc = decodeRow("services", (paidLater.rows.services as Row[])[0]!);
      expect((svc["fees"] as Row[]).map((f) => f["paid"])).toEqual([
        true,
        true,
      ]);

      const without = (v: Row, feeId: string): Row => ({
        ...v,
        fees: (v["fees"] as Row[]).filter((f) => f["id"] !== feeId),
      });

      // A charge's amount corrected by somebody who cannot see expenses:
      // the fee alone is sent, and the server moves its expense with it.
      const corrected = await commit(
        { services: [svc] },
        {
          services: [
            {
              ...svc,
              fees: (svc["fees"] as Row[]).map((f) =>
                f["id"] === "sf-app-2" ? { ...f, amount: 250_000 } : f,
              ),
            },
          ],
        },
      );
      expect(
        (await db.expense.findUniqueOrThrow({ where: { id: "exp-app-sf-2" } }))
          .amount,
      ).toBe(250_000n);
      expect(
        decodeRow("expenses", (corrected.rows.expenses as Row[])[0]!),
      ).toMatchObject({ id: "exp-app-sf-2", amount: 250_000 });
      svc = decodeRow("services", (corrected.rows.services as Row[])[0]!);

      // The paid charge taken off by somebody who cannot see expenses — the
      // fee alone is sent: the charge owns its expense, and both go.
      const byStaff = await commit(
        { services: [svc] },
        { services: [without(svc, "sf-app-2")] },
      );
      expect(byStaff.removed.expenses).toEqual(["exp-app-sf-2"]);
      expect(
        await db.serviceFee.findUnique({ where: { id: "sf-app-2" } }),
      ).toBeNull();
      expect(
        await db.expense.findUnique({ where: { id: "exp-app-sf-2" } }),
      ).toBeNull();
      svc = decodeRow("services", (byStaff.rows.services as Row[])[0]!);

      // Taken off by a finance account, which removes the expense itself in
      // the same changeset: both gone, nothing refused.
      const removed = await commit(
        { services: [svc], expenses: [exp] } as unknown as Partial<StoreShape>,
        {
          services: [without(svc, "sf-app-1")],
          expenses: [],
        } as unknown as Partial<StoreShape>,
      );
      expect(removed.removed.expenses).toEqual(["exp-app-sf-1"]);
      expect(
        await db.serviceFee.findUnique({ where: { id: "sf-app-1" } }),
      ).toBeNull();
      expect(
        await db.expense.findUnique({ where: { id: "exp-app-sf-1" } }),
      ).toBeNull();
      svc = decodeRow("services", (removed.rows.services as Row[])[0]!);
      expect(svc["fees"]).toEqual([]);

      // The whole visit, with a paid charge on it, by somebody who cannot see
      // expenses: the visit, the charge and the expense all go.
      const third = decodeRow(
        "services",
        (
          (
            await commit({ services: [], expenses: [] }, {
              services: [visit("svc-app-3", ["sf-app-4"])],
              expenses: [expenseFor("exp-app-sf-4", "sf-app-4", 100_000)],
            } as unknown as Partial<StoreShape>)
          ).rows.services as Row[]
        )[0]!,
      );
      const gone3 = await commit({ services: [third] }, { services: [] });
      expect(gone3.removed.services).toEqual(["svc-app-3"]);
      expect(gone3.removed.expenses).toEqual(["exp-app-sf-4"]);
      expect(
        await db.expense.findUnique({ where: { id: "exp-app-sf-4" } }),
      ).toBeNull();

      // The whole (now chargeless) first visit.
      const gone = await commit({ services: [svc] }, { services: [] });
      expect(gone.removed.services).toEqual(["svc-app-1"]);
      expect(
        await db.serviceVisit.findUnique({ where: { id: "svc-app-1" } }),
      ).toBeNull();
      expect(
        await db.serviceFee.count({ where: { visitId: "svc-app-1" } }),
      ).toBe(0);

      // Inside a book closed before the close was retired (2026-10-27): a
      // charge and the visit go anyway — the stored close is ignored.
      const kept = decodeRow(
        "services",
        (
          (
            await commit(
              { services: [] },
              { services: [visit("svc-app-2", ["sf-app-3"])] },
            )
          ).rows.services as Row[]
        )[0]!,
      );
      await db.appSetting.upsert({
        where: { key: "finance.booksClosedAt" },
        create: {
          key: "finance.booksClosedAt",
          value: "2026-10-31T16:59:59.999Z",
          updatedAt: new Date(),
        },
        update: { value: "2026-10-31T16:59:59.999Z" },
      });
      const lighter = decodeRow(
        "services",
        (
          (
            await commit(
              { services: [kept] },
              { services: [without(kept, "sf-app-3")] },
            )
          ).rows.services as Row[]
        )[0]!,
      );
      expect(lighter["fees"] as Row[]).toHaveLength(0);
      const keptGone = await commit({ services: [lighter] }, { services: [] });
      expect(keptGone.removed.services).toEqual(["svc-app-2"]);
      expect(
        await db.serviceVisit.findUnique({ where: { id: "svc-app-2" } }),
      ).toBeNull();

      // It once judged the book on the charge's JAKARTA day (closed to 26 Oct
      // 16:59:59.999Z, a charge at 18:00Z on the 26th was the 27th and could
      // go). With the close retired the evening charge goes all the same.
      await db.appSetting.update({
        where: { key: "finance.booksClosedAt" },
        data: { value: "2026-10-26T16:59:59.999Z" },
      });
      const late = "2026-10-26T18:00:00.000Z";
      const evening = decodeRow(
        "services",
        (
          (
            await commit(
              { services: [] },
              {
                services: [
                  {
                    ...visit("svc-app-5", ["sf-app-5"]),
                    openedAt: late,
                    arrivedAt: late,
                    fees: [
                      {
                        id: "sf-app-5",
                        kind: "LABOUR",
                        amount: 50_000,
                        at: late,
                        staff: "Store Test",
                      },
                    ],
                  },
                ],
              },
            )
          ).rows.services as Row[]
        )[0]!,
      );
      const eveningGone = await commit(
        { services: [evening] },
        { services: [] },
      );
      expect(eveningGone.removed.services).toEqual(["svc-app-5"]);
    } finally {
      await db.appSetting.deleteMany({
        where: { key: "finance.booksClosedAt" },
      });
      await app.$disconnect();
    }
  }, 180_000);

  /*
   * A supplier return's credit comes off its invoice as a RETUR_SUPPLIER
   * payment, and the rest is a refund income; both name the return
   * (2026-10-26). The return is written AFTER the invoice in a commit, so the
   * payment's link has to wait for it.
   */
  it("links a supplier-return credit and its refund to the return, in the commit that records it (2026-10-26)", async () => {
    await loadDemo();
    const snap = decodeStore(
      (await snapshotStore(db, { staffId: ACTOR })).db,
    ) as unknown as Record<string, Row[]>;
    const po = snap["pos"]!.find((p) => p["status"] !== "DRAFT")!;
    const unit = snap["units"]!.find((u) => u["status"] === "TERSEDIA")!;
    const at = "2026-10-26T03:00:00.000Z";
    const ret = {
      id: "ret-app-sup-1",
      code: "SP-2026/10-000901",
      kind: "SUPPLIER",
      serial: unit["serial"],
      reason: "Defect",
      date: "2026-10-26",
      status: "PENDING",
      supplierId: po["supplierId"],
      expectedCredit: 5_000_000,
    };
    const credit = {
      id: "pay-app-retur-1",
      method: "RETUR_SUPPLIER",
      amount: 3_000_000,
      at,
      appliedTo: "ORDER",
      inBalance: false,
      returnId: ret.id,
    };
    const refund = {
      id: "inc-app-retur-1",
      reason: "REFUND",
      amount: 2_000_000,
      date: "2026-10-26",
      method: "TRANSFER",
      returnId: ret.id,
    };
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      const done = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { pos: [po], returns: [], incomes: [] } as unknown as StoreShape,
            {
              pos: [
                {
                  ...po,
                  payments: [...(po["payments"] as Row[]), credit],
                },
              ],
              returns: [ret],
              incomes: [refund],
            } as unknown as StoreShape,
          ),
        ),
      });
      const back = decodeRow("pos", (done.rows.pos as Row[])[0]!);
      expect(
        (back["payments"] as Row[]).find((p) => p["id"] === credit.id),
      ).toEqual(credit);
      expect(
        decodeRow("incomes", (done.rows.incomes as Row[])[0]!),
      ).toMatchObject({ returnId: ret.id });
      expect(
        await db.payment.findUniqueOrThrow({ where: { id: credit.id } }),
      ).toMatchObject({ unitReturnId: ret.id, inBalance: false });
      expect(
        await db.manualIncome.findUniqueOrThrow({ where: { id: refund.id } }),
      ).toMatchObject({ unitReturnId: ret.id });
      // The return carries what the supplier has paid back, DERIVED from the
      // incomes naming it (2026-10-26) — so a till sent no incomes can tell a
      // refund received from one awaited.
      expect(
        decodeRow(
          "returns",
          (done.rows.returns as Row[]).find((x) => x["id"] === ret.id)!,
        ),
      ).toMatchObject({ refundReceived: 2_000_000 });

      // And it survives a reload.
      const again = decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
      expect(
        (
          again["pos"]!.find((p) => p["id"] === po["id"])!["payments"] as Row[]
        ).find((p) => p["id"] === credit.id),
      ).toEqual(credit);
      expect(
        again["incomes"]!.find((i) => i["id"] === refund.id),
      ).toMatchObject({ returnId: ret.id });
      const retAgain = again["returns"]!.find((x) => x["id"] === ret.id)!;
      expect(retAgain).toMatchObject({ refundReceived: 2_000_000 });

      // A second refund on the same return moves the derived figure, and the
      // commit hands the return back to every till.
      const more = { ...refund, id: "inc-app-retur-2", amount: 500_000 };
      const second = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { incomes: [] } as unknown as StoreShape,
            { incomes: [more] } as unknown as StoreShape,
          ),
        ),
      });
      expect(
        decodeRow(
          "returns",
          (second.rows.returns as Row[]).find((x) => x["id"] === ret.id)!,
        ),
      ).toMatchObject({ refundReceived: 2_500_000 });

      // A credit naming no supplier return is refused in words.
      const now = again["pos"]!.find((p) => p["id"] === po["id"])!;
      await expect(
        commitStore(app, {
          staffId: ACTOR,
          changes: encodeChangeset(
            diffStore(
              { pos: [now] } as unknown as StoreShape,
              {
                pos: [
                  {
                    ...now,
                    payments: [
                      ...(now["payments"] as Row[]),
                      { ...credit, id: "pay-app-retur-2", returnId: "nope" },
                    ],
                  },
                ],
              } as unknown as StoreShape,
            ),
          ),
        }),
      ).rejects.toThrow(/retur ke supplier yang tidak ada/);

      // Withdrawing the return voids its credit and keeps the refunds.
      const fresh = decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
      const nowPo = fresh["pos"]!.find((p) => p["id"] === po["id"])!;
      const nowRet = fresh["returns"]!.find((x) => x["id"] === ret.id)!;
      const withdrawn = await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { pos: [nowPo], returns: [nowRet] } as unknown as StoreShape,
            {
              pos: [
                {
                  ...nowPo,
                  payments: (nowPo["payments"] as Row[]).filter(
                    (p) => p["returnId"] !== ret.id,
                  ),
                },
              ],
              returns: [{ ...nowRet, status: "CANCELLED" }],
            } as unknown as StoreShape,
          ),
        ),
      });
      expect(
        (await db.payment.findUniqueOrThrow({ where: { id: credit.id } }))
          .voidedAt,
      ).not.toBeNull();
      expect(
        decodeRow(
          "returns",
          (withdrawn.rows.returns as Row[]).find((x) => x["id"] === ret.id)!,
        ),
      ).toMatchObject({ status: "CANCELLED", refundReceived: 2_500_000 });
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("records a marketplace payout: the payment, the settlement and its log", async () => {
    await loadDemo();
    const snap = decodeStore(
      (await snapshotStore(db, { staffId: ACTOR })).db,
    ) as unknown as Record<string, Row[]>;
    const order = snap["orders"]!.find((o) =>
      ((o["payments"] as Row[] | undefined) ?? []).some(
        (p) => p["state"] === "PENDING",
      ),
    )!;
    const pay = (order["payments"] as Row[]).find(
      (p) => p["state"] === "PENDING",
    )!;
    const at = "2026-09-13T04:00:00.000Z";
    const fee = 500_000;
    const received = (pay["amount"] as number) - fee;
    const next = {
      ...order,
      payments: (order["payments"] as Row[]).map((p) =>
        p === pay ? { ...p, state: "SETTLED", at } : p,
      ),
      settled: true,
    };
    const settlement = {
      id: "stl-app-1",
      paymentId: pay["id"],
      orderId: order["id"],
      channel: pay["channel"],
      gross: pay["amount"],
      fees: [{ id: "fee-app-1", kind: "OTHER", label: "Admin", amount: fee }],
      received,
      at,
      staff: "Store Test",
    };
    const log = {
      id: "slog-app-1",
      settlementId: "stl-app-1",
      at,
      staff: "Store Test",
      action: "RECORDED",
      after: { received, deducted: fee },
    };
    const app = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
    try {
      await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            {
              orders: [order],
              settlements: [],
              settlementLog: [],
            } as unknown as StoreShape,
            {
              orders: [next],
              settlements: [settlement],
              settlementLog: [log],
            } as unknown as StoreShape,
          ),
        ),
      });
    } finally {
      await app.$disconnect();
    }
    expect(
      await db.payment.findUniqueOrThrow({
        where: { id: pay["id"] as string },
      }),
    ).toMatchObject({ status: "LUNAS" });
    expect(await db.settlementLog.count()).toBe(1);
  }, 180_000);
});

describe("reconciliation, as nusantara_app (2026-10-27)", () => {
  const asApp = (): string => {
    const u = new globalThis.URL(URL);
    u.username = "nusantara_app";
    u.password = "";
    return u.toString();
  };
  const AT = "2026-10-27T05:00:00.000Z";
  const expense = (id: string, amount: number): Row => ({
    id,
    kind: "OPERATIONAL",
    amount,
    date: "2026-10-27",
    method: "TRANSFER",
    note: "ZZ recon test",
  });

  it("writes a day, a month and its lines, and keeps what the bank printed fixed", async () => {
    await loadDemo();
    const snap = decodeStore(
      (await snapshotStore(db, { staffId: ACTOR })).db,
    ) as unknown as Record<string, Row[]>;
    const sale = snap["orders"]!.find((o) =>
      ((o["payments"] as Row[] | undefined) ?? []).some(
        (p) => p["state"] === "SETTLED",
      ),
    )!;
    const pay = (sale["payments"] as Row[]).find(
      (p) => p["state"] === "SETTLED",
    )!;
    const app = new PrismaClient({ datasourceUrl: asApp() });
    const commit = (before: Partial<StoreShape>, after: Partial<StoreShape>) =>
      commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(before as StoreShape, after as StoreShape),
        ),
      });
    const read = async (): Promise<Record<string, Row[]>> =>
      decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
    try {
      // A day: one correction of a sale payment, one transaction added — the
      // expense in the same commit.
      const day: Row = {
        id: "rc-day",
        kind: "DAILY",
        pot: "BANK",
        periodStart: "2026-10-27",
        periodEnd: "2026-10-27",
        posBalance: 1_000_000,
        actualBalance: 1_000_000,
        status: "ADJUSTED",
        note: "ZZ",
        staff: "Store Test",
        createdAt: AT,
        updatedAt: AT,
        asides: [],
        edits: [
          {
            id: "re-1",
            paymentId: pay["id"],
            action: "EDITED",
            before: pay["amount"],
            after: (pay["amount"] as number) - 1,
            staff: "Store Test",
            at: AT,
          },
          {
            id: "re-2",
            expenseId: "exp-recon-1",
            action: "ADDED",
            after: 60_200,
            staff: "Store Test",
            at: AT,
          },
        ],
      };
      await commit(
        { reconciliations: [], expenses: [] },
        { reconciliations: [day], expenses: [expense("exp-recon-1", 60_200)] },
      );
      let back = (await read())["reconciliations"]!.find(
        (r) => r["id"] === "rc-day",
      )!;
      expect(back).toMatchObject({
        kind: "DAILY",
        pot: "BANK",
        status: "ADJUSTED",
        posBalance: 1_000_000,
        staff: "Store Test",
      });
      expect(
        (back["edits"] as Row[]).map((e) => [e["id"], e["action"]]),
      ).toEqual([
        ["re-1", "EDITED"],
        ["re-2", "ADDED"],
      ]);

      // Reopened with a note: the status and note move; what it IS does not.
      const reopened = { ...back, status: "OPEN", note: "Recount" };
      await commit(
        { reconciliations: [back] },
        { reconciliations: [reopened] },
      );
      back = (await read())["reconciliations"]!.find(
        (r) => r["id"] === "rc-day",
      )!;
      expect(back).toMatchObject({ status: "OPEN", note: "Recount" });
      await expect(
        commit(
          { reconciliations: [back] },
          {
            reconciliations: [
              { ...back, periodStart: "2026-10-26", periodEnd: "2026-10-26" },
            ],
          },
        ),
      ).rejects.toThrow(/tidak bisa diubah/);
      await expect(
        commit(
          { reconciliations: [] },
          { reconciliations: [{ ...day, id: "rc-day-2", edits: [] }] },
        ),
      ).rejects.toThrow(/sudah direkonsiliasi/);
      await expect(
        commit(
          { reconciliations: [back] },
          {
            reconciliations: [
              {
                ...back,
                edits: (back["edits"] as Row[]).map((e) =>
                  e["id"] === "re-1" ? { ...e, after: 1 } : e,
                ),
              },
            ],
          },
        ),
      ).rejects.toThrow(/tidak bisa diubah setelah tersimpan/);

      // A month, two lines: one matched to the sale payment, one to an
      // expense created in the same commit.
      const month: Row = {
        ...day,
        id: "rc-sep",
        kind: "MONTHLY",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        statementOpening: 150_000_000,
        statementClosing: 167_637_655,
        statementFile: "bca-sep.pdf",
        status: "OPEN",
        edits: [],
      };
      const line = (id: string, lineNo: number, matches: Row[]): Row => ({
        id,
        reconciliationId: "rc-sep",
        lineNo,
        date: "2026-09-01",
        description: `ZZ LINE ${lineNo}`,
        amount: lineNo === 1 ? 18_450_000 : -812_345,
        ...(lineNo === 1 ? { balance: 168_450_000 } : {}),
        status: matches.length > 0 ? "MATCHED" : "UNMATCHED",
        matches,
      });
      const l1 = line("bl-1", 1, [
        { id: "bm-1", paymentId: pay["id"], reason: "EXACT" },
      ]);
      const l2 = line("bl-2", 2, [
        { id: "bm-2", expenseId: "exp-recon-2", reason: "MANUAL" },
      ]);
      await commit(
        { reconciliations: [], statementLines: [], expenses: [] },
        {
          reconciliations: [month],
          statementLines: [l1, l2],
          expenses: [expense("exp-recon-2", 812_345)],
        },
      );
      let lines = (await read())["statementLines"]!.filter(
        (l) => l["reconciliationId"] === "rc-sep",
      );
      expect(lines.map((l) => [l["lineNo"], l["amount"], l["status"]])).toEqual(
        [
          [1, 18_450_000, "MATCHED"],
          [2, -812_345, "MATCHED"],
        ],
      );
      expect(lines[0]!["balance"]).toBe(168_450_000);
      expect(lines[1]!["balance"]).toBeUndefined();

      // The shop's half of a line moves; the bank's does not.
      const b1 = lines[0]!;
      const b2 = lines[1]!;
      await commit(
        { statementLines: [b1, b2] },
        {
          statementLines: [
            { ...b1, status: "UNMATCHED", matches: [] },
            {
              ...b2,
              matches: [
                ...(b2["matches"] as Row[]),
                { id: "bm-3", expenseId: "exp-recon-1", reason: "SPLIT" },
              ],
            },
          ],
        },
      );
      lines = (await read())["statementLines"]!.filter(
        (l) => l["reconciliationId"] === "rc-sep",
      );
      expect(lines[0]).toMatchObject({ status: "UNMATCHED", matches: [] });
      expect((lines[1]!["matches"] as Row[]).map((m) => m["id"])).toEqual([
        "bm-2",
        "bm-3",
      ]);
      await expect(
        commit(
          { statementLines: [lines[0]!] },
          { statementLines: [{ ...lines[0]!, amount: 21_700_001 }] },
        ),
      ).rejects.toThrow(/milik bank/);

      // Re-upload in ONE commit: every old line out, the new ones in,
      // numbered from 1 again.
      const fresh = [
        { ...line("bl-n1", 1, []), description: "ZZ NEW 1" },
        { ...line("bl-n2", 2, []), description: "ZZ NEW 2" },
      ];
      await commit({ statementLines: lines }, { statementLines: fresh });
      lines = (await read())["statementLines"]!.filter(
        (l) => l["reconciliationId"] === "rc-sep",
      );
      expect(lines.map((l) => l["id"])).toEqual(["bl-n1", "bl-n2"]);
      expect(await db.bankStatementMatch.count()).toBe(0);

      // A RECONCILED month keeps its lines until it is reopened.
      const sep = (await read())["reconciliations"]!.find(
        (r) => r["id"] === "rc-sep",
      )!;
      await commit(
        { reconciliations: [sep] },
        { reconciliations: [{ ...sep, status: "RECONCILED" }] },
      );
      await expect(
        commit({ statementLines: lines }, { statementLines: [] }),
      ).rejects.toThrow(/buka kembali dulu/);
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("refuses to delete an adjustment a closed reconciliation names, and takes its edit and match once it is reopened", async () => {
    await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    const commit = (before: Partial<StoreShape>, after: Partial<StoreShape>) =>
      commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(before as StoreShape, after as StoreShape),
        ),
      });
    const read = async (): Promise<Record<string, Row[]>> =>
      decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
    try {
      const day: Row = {
        id: "rc-del",
        kind: "DAILY",
        pot: "BANK",
        periodStart: "2026-10-27",
        periodEnd: "2026-10-27",
        posBalance: 0,
        actualBalance: 0,
        status: "ADJUSTED",
        staff: "Store Test",
        createdAt: AT,
        updatedAt: AT,
        asides: [],
        edits: [
          {
            id: "re-del",
            expenseId: "exp-del",
            action: "ADDED",
            after: 50_000,
            staff: "Store Test",
            at: AT,
          },
        ],
      };
      const month: Row = {
        ...day,
        id: "rc-del-m",
        kind: "MONTHLY",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        status: "OPEN",
        edits: [],
      };
      await commit(
        { reconciliations: [], statementLines: [], expenses: [] },
        {
          expenses: [expense("exp-del", 50_000)],
          reconciliations: [day, month],
          statementLines: [
            {
              id: "bl-del",
              reconciliationId: "rc-del-m",
              lineNo: 1,
              date: "2026-10-27",
              description: "ZZ BIAYA",
              amount: -50_000,
              status: "MATCHED",
              matches: [
                { id: "bm-del", expenseId: "exp-del", reason: "ADDED" },
              ],
            },
          ],
        },
      );
      let snap = await read();
      const exp = snap["expenses"]!.find((e) => e["id"] === "exp-del")!;
      await expect(
        commit({ expenses: [exp] }, { expenses: [] }),
      ).rejects.toThrow(
        "Rekonsiliasi Bank 2026-10-27 mencatat baris ini — buka kembali rekonsiliasinya dulu.",
      );

      const rec = snap["reconciliations"]!.find((r) => r["id"] === "rc-del")!;
      await commit(
        { reconciliations: [rec] },
        { reconciliations: [{ ...rec, status: "OPEN" }] },
      );
      const removal = await commit({ expenses: [exp] }, { expenses: [] });
      expect(removal.removed.expenses).toEqual(["exp-del"]);
      expect(
        await db.expense.findUnique({ where: { id: "exp-del" } }),
      ).toBeNull();
      snap = await read();
      expect(
        snap["reconciliations"]!.find((r) => r["id"] === "rc-del")!["edits"],
      ).toEqual([]);
      expect(
        snap["statementLines"]!.find((l) => l["id"] === "bl-del"),
      ).toMatchObject({ status: "UNMATCHED", matches: [] });
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("sets a POS entry aside on a month, withdraws it, and never rewrites or removes one (owner-approved 2026-10-27)", async () => {
    await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    const commit = (before: Partial<StoreShape>, after: Partial<StoreShape>) =>
      commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(before as StoreShape, after as StoreShape),
        ),
      });
    const read = async (): Promise<Record<string, Row[]>> =>
      decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
    const month = async () =>
      (await read())["reconciliations"]!.find((r) => r["id"] === "rc-as")!;
    const asidesOf = (r: Row) => r["asides"] as Row[];
    const aside = (id: string, expenseId: string, note: string): Row => ({
      id,
      expenseId,
      note,
      staff: "Store Test",
      at: AT,
    });
    const LATER = "2026-10-27T06:00:00.000Z";
    try {
      await commit(
        { reconciliations: [], expenses: [] },
        {
          expenses: [expense("exp-as-1", 70_000), expense("exp-as-2", 80_000)],
          reconciliations: [
            {
              id: "rc-as",
              kind: "MONTHLY",
              pot: "BANK",
              periodStart: "2026-08-01",
              periodEnd: "2026-08-31",
              posBalance: 0,
              actualBalance: 0,
              status: "OPEN",
              staff: "Store Test",
              createdAt: AT,
              updatedAt: AT,
              edits: [],
              asides: [
                aside("ra-1", "exp-as-1", "Paid on the owner's card"),
                aside("ra-2", "exp-as-2", "Cash, filed as transfer"),
              ],
            },
          ],
        },
      );
      let rec = await month();
      expect(asidesOf(rec)).toEqual([
        {
          id: "ra-1",
          expenseId: "exp-as-1",
          note: "Paid on the owner's card",
          staff: "Store Test",
          at: AT,
        },
        {
          id: "ra-2",
          expenseId: "exp-as-2",
          note: "Cash, filed as transfer",
          staff: "Store Test",
          at: AT,
        },
      ]);

      // Written once: the note does not move, one is never removed, and a
      // second active one on the same movement is refused.
      await expect(
        commit(
          { reconciliations: [rec] },
          {
            reconciliations: [
              {
                ...rec,
                asides: [
                  { ...asidesOf(rec)[0]!, note: "Something else" },
                  asidesOf(rec)[1]!,
                ],
              },
            ],
          },
        ),
      ).rejects.toThrow(/tidak bisa diubah setelah tersimpan/);
      await expect(
        commit(
          { reconciliations: [rec] },
          { reconciliations: [{ ...rec, asides: [asidesOf(rec)[1]!] }] },
        ),
      ).rejects.toThrow(/tidak dihapus/);
      await expect(
        commit(
          { reconciliations: [rec] },
          {
            reconciliations: [
              {
                ...rec,
                asides: [...asidesOf(rec), aside("ra-x", "exp-as-1", "Twice")],
              },
            ],
          },
        ),
      ).rejects.toThrow(/sudah diberi catatan/);

      // A day has no statement to set anything aside against.
      await expect(
        commit(
          { reconciliations: [] },
          {
            reconciliations: [
              {
                ...rec,
                id: "rc-as-day",
                kind: "DAILY",
                periodStart: "2026-08-02",
                periodEnd: "2026-08-02",
                asides: [aside("ra-d", "exp-as-1", "Day")],
              },
            ],
          },
        ),
      ).rejects.toThrow(/hanya untuk rekonsiliasi bulanan/);

      // Undo: withdrawn and kept; never un-withdrawn.
      await commit(
        { reconciliations: [rec] },
        {
          reconciliations: [
            {
              ...rec,
              asides: [
                asidesOf(rec)[0]!,
                { ...asidesOf(rec)[1]!, withdrawnAt: LATER },
              ],
            },
          ],
        },
      );
      rec = await month();
      expect(asidesOf(rec)[1]).toMatchObject({
        id: "ra-2",
        withdrawnAt: LATER,
      });
      await expect(
        commit(
          { reconciliations: [rec] },
          {
            reconciliations: [
              {
                ...rec,
                asides: [
                  asidesOf(rec)[0]!,
                  { ...asidesOf(rec)[1]!, withdrawnAt: undefined },
                ],
              },
            ],
          },
        ),
      ).rejects.toThrow(/tidak bisa diubah setelah tersimpan/);

      // Reconciled: an active aside keeps its expense; a withdrawn one never
      // blocks, and leaves with it.
      await commit(
        { reconciliations: [rec] },
        { reconciliations: [{ ...rec, status: "RECONCILED" }] },
      );
      rec = await month();
      await expect(
        commit(
          { reconciliations: [rec] },
          {
            reconciliations: [
              {
                ...rec,
                asides: [
                  ...asidesOf(rec),
                  aside("ra-3", "exp-as-2", "Too late"),
                ],
              },
            ],
          },
        ),
      ).rejects.toThrow(/buka kembali dulu/);
      let snap = await read();
      const exp1 = snap["expenses"]!.find((e) => e["id"] === "exp-as-1")!;
      const exp2 = snap["expenses"]!.find((e) => e["id"] === "exp-as-2")!;
      await expect(
        commit({ expenses: [exp1] }, { expenses: [] }),
      ).rejects.toThrow(
        "Rekonsiliasi Bank 2026-08-01 mencatat baris ini — buka kembali rekonsiliasinya dulu.",
      );
      // The browser's half (`forgetRecord`) drops the withdrawn aside from
      // the closed month's list in the same commit.
      await commit(
        { expenses: [exp2], reconciliations: [rec] },
        {
          expenses: [],
          reconciliations: [
            {
              ...rec,
              asides: asidesOf(rec).filter((a) => a["id"] !== "ra-2"),
            },
          ],
        },
      );
      rec = await month();
      expect(asidesOf(rec).map((a) => a["id"])).toEqual(["ra-1"]);
      expect(rec["status"]).toBe("RECONCILED");

      // Reopened: the active aside is withdrawn and goes with its expense —
      // the browser's half (`forgetRecord`) drops it from the list in the
      // same commit.
      await commit(
        { reconciliations: [rec] },
        { reconciliations: [{ ...rec, status: "OPEN" }] },
      );
      rec = await month();
      await commit(
        { expenses: [exp1], reconciliations: [rec] },
        { expenses: [], reconciliations: [{ ...rec, asides: [] }] },
      );
      snap = await read();
      expect(asidesOf(await month())).toEqual([]);
      expect(snap["expenses"]!.some((e) => e["id"] === "exp-as-1")).toBe(false);
      expect(await db.reconciliationAside.count()).toBe(0);
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("deletes a day or a month whole — log, lines, matches, asides — keeps the corrections, and writes ONE activity line (2026-10-27)", async () => {
    await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    const commit = (before: Partial<StoreShape>, after: Partial<StoreShape>) =>
      commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(before as StoreShape, after as StoreShape),
        ),
      });
    const read = async (): Promise<Record<string, Row[]>> =>
      decodeStore(
        (await snapshotStore(db, { staffId: ACTOR })).db,
      ) as unknown as Record<string, Row[]>;
    try {
      const exp = expense("exp-recdel-1", 60_200);
      const day: Row = {
        id: "rc-gone-day",
        kind: "DAILY",
        pot: "BANK",
        periodStart: "2026-10-26",
        periodEnd: "2026-10-26",
        posBalance: 0,
        actualBalance: 0,
        status: "ADJUSTED",
        staff: "Store Test",
        createdAt: AT,
        updatedAt: AT,
        asides: [],
        edits: [
          {
            id: "re-gone-1",
            expenseId: "exp-recdel-1",
            action: "ADDED",
            after: 60_200,
            staff: "Store Test",
            at: AT,
          },
        ],
      };
      const month: Row = {
        ...day,
        id: "rc-gone-month",
        kind: "MONTHLY",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "OPEN",
        edits: [],
        asides: [
          {
            id: "ra-gone-1",
            expenseId: "exp-recdel-1",
            note: "Owner's account",
            staff: "Store Test",
            at: AT,
          },
        ],
      };
      const line = (id: string, lineNo: number, matches: Row[]): Row => ({
        id,
        reconciliationId: "rc-gone-month",
        lineNo,
        date: "2026-07-02",
        description: `ZZ GONE ${lineNo}`,
        amount: -60_200,
        status: matches.length > 0 ? "MATCHED" : "UNMATCHED",
        matches,
      });
      const lines = [
        line("bl-gone-1", 1, [
          { id: "bm-gone-1", expenseId: "exp-recdel-1", reason: "EXACT" },
        ]),
        line("bl-gone-2", 2, []),
      ];
      await commit(
        { reconciliations: [], statementLines: [], expenses: [] },
        {
          reconciliations: [day, month],
          statementLines: lines,
          expenses: [exp],
        },
      );
      let snap = await read();
      const dayRow = snap["reconciliations"]!.find(
        (r) => r["id"] === "rc-gone-day",
      )!;
      const monthRow = snap["reconciliations"]!.find(
        (r) => r["id"] === "rc-gone-month",
      )!;
      // A RECONCILED month is deleted as readily as an open one: the
      // re-upload's "reopen it first" does not apply to a deletion.
      await commit(
        { reconciliations: [monthRow] },
        { reconciliations: [{ ...monthRow, status: "RECONCILED" }] },
      );
      snap = await read();
      const closedMonth = snap["reconciliations"]!.find(
        (r) => r["id"] === "rc-gone-month",
      )!;
      const lineRows = snap["statementLines"]!.filter(
        (l) => l["reconciliationId"] === "rc-gone-month",
      );
      expect(lineRows).toHaveLength(2);

      const before = await db.storeChange.aggregate({ _max: { id: true } });

      // The day: the browser removes the row.
      const dayDelta = await commit(
        { reconciliations: [dayRow] },
        { reconciliations: [] },
      );
      expect(dayDelta.removed["reconciliations"]).toEqual(["rc-gone-day"]);
      // The month: the browser removes the row AND its lines in one commit.
      const monthDelta = await commit(
        { reconciliations: [closedMonth], statementLines: lineRows },
        { reconciliations: [], statementLines: [] },
      );
      expect(monthDelta.removed["reconciliations"]).toEqual(["rc-gone-month"]);
      expect([...(monthDelta.removed["statementLines"] ?? [])].sort()).toEqual([
        "bl-gone-1",
        "bl-gone-2",
      ]);

      snap = await read();
      expect(
        snap["reconciliations"]!.some((r) =>
          ["rc-gone-day", "rc-gone-month"].includes(r["id"] as string),
        ),
      ).toBe(false);
      expect(
        await db.reconciliationEdit.count({
          where: { reconciliationId: "rc-gone-day" },
        }),
      ).toBe(0);
      expect(
        await db.bankStatementLine.count({
          where: { reconciliationId: "rc-gone-month" },
        }),
      ).toBe(0);
      expect(
        await db.bankStatementMatch.count({ where: { id: "bm-gone-1" } }),
      ).toBe(0);
      expect(
        await db.reconciliationAside.count({ where: { id: "ra-gone-1" } }),
      ).toBe(0);
      // What was corrected stays: the expense the day added is still there.
      expect(
        snap["expenses"]!.find((e) => e["id"] === "exp-recdel-1"),
      ).toMatchObject({ amount: 60_200 });
      // The day can be reconciled afresh.
      await commit(
        { reconciliations: [] },
        { reconciliations: [{ ...day, id: "rc-again", edits: [] }] },
      );

      // ONE activity line per reconciliation, and none per statement line.
      const audit = await db.auditLog.findMany({
        where: {
          OR: [
            { entity: "Reconciliation" },
            {
              entity: { in: ["reconciliations", "statementLines"] },
              action: "DELETE",
            },
          ],
        },
        orderBy: { entityId: "asc" },
      });
      expect(
        audit.map((a) => [a.entity, a.entityId, a.action, a.staffId]),
      ).toEqual([
        ["Reconciliation", "rc-gone-day", "DELETE", ACTOR],
        ["Reconciliation", "rc-gone-month", "DELETE", ACTOR],
      ]);
      expect(JSON.parse(audit[0]!.before!)).toEqual({
        kind: "DAILY",
        pot: "BANK",
        periodStart: "2026-10-26",
        rows: 2,
      });
      expect(JSON.parse(audit[1]!.before!)).toEqual({
        kind: "MONTHLY",
        pot: "BANK",
        periodStart: "2026-07-01",
        rows: 5,
      });

      // Other tills hear about it.
      const changes = await db.storeChange.findMany({
        where: { id: { gt: before._max.id ?? 0n } },
        select: { collection: true, rowKey: true },
      });
      const keys = changes.map((c) => `${c.collection}:${c.rowKey}`);
      for (const k of [
        "reconciliations:rc-gone-day",
        "reconciliations:rc-gone-month",
        "statementLines:bl-gone-1",
        "statementLines:bl-gone-2",
      ])
        expect(keys).toContain(k);
    } finally {
      await app.$disconnect();
    }
  }, 180_000);
});

/*
 * A DP holds a unit (owner, 2026-10-27, "yes to DP"). The DP is ONE Payment
 * for its whole life: the reservation is its parent before the sale, and the
 * sale adopts the same row — so the money is counted once. As nusantara_app.
 */
describe("a DP on a reservation, as nusantara_app (2026-10-27)", () => {
  const asApp = (): string => {
    const u = new globalThis.URL(URL);
    u.username = "nusantara_app";
    u.password = "";
    return u.toString();
  };

  /** One commit as the app role; returns the result. */
  async function commitAs(
    app: PrismaClient,
    before: Record<string, Row[]>,
    after: Record<string, Row[]>,
  ) {
    return commitStore(app, {
      staffId: ACTOR,
      changes: encodeChangeset(
        diffStore(before as StoreShape, after as StoreShape),
      ),
    });
  }

  /** The browser's next ledger row for a unit. */
  function eventFor(
    shop: Record<string, unknown>,
    unit: Row,
    id: string,
    type: string,
    from: string,
    to: string,
    refCode: string,
    extra = 0,
  ): Row {
    const seq = (shop["events"] as Row[]).filter(
      (e) => e["serial"] === unit["serial"],
    ).length;
    return {
      id,
      serial: unit["serial"],
      seq: seq + 1 + extra,
      type,
      at: NOW.toISOString(),
      fromStatus: from,
      toStatus: to,
      locationId: unit["locationId"],
      refCode,
      staff: "Michella",
    };
  }

  async function soft(
    app: PrismaClient,
    shop: Record<string, unknown>,
    tag: string,
  ) {
    const unit = (shop["units"] as Row[]).filter(
      (u) => u["status"] === "TERSEDIA",
    )[tag === "b" ? 1 : tag === "c" ? 2 : 0]!;
    const customer = (shop["customers"] as Row[]).find(
      (c) => typeof c["phone"] === "string" && c["phone"] !== "",
    )!;
    const hold: Row = {
      id: `rv_dp_${tag}`,
      code: `RV-2026/09-Tdp${tag}1234`,
      customerId: customer["id"],
      when: NOW.toISOString(),
      note: "",
      items: [{ id: `rvi_dp_${tag}`, serial: unit["serial"] }],
      status: "ACTIVE",
    };
    const made = await commitAs(
      app,
      { reservations: [] },
      { reservations: [hold] },
    );
    const code = made.codes[hold["code"] as string]!;
    const saved: Row = { ...hold, code };
    // Nobody paid: the unit is still on sale.
    expect(
      (
        await db.unit.findUniqueOrThrow({
          where: { serial: unit["serial"] as string },
        })
      ).status,
    ).toBe("TERSEDIA");
    return { unit, customer, hold: saved };
  }

  async function recordDp(
    app: PrismaClient,
    shop: Record<string, unknown>,
    s: { unit: Row; hold: Row },
    dpId: string,
  ) {
    const at = "2026-09-13T04:00:00.000Z";
    const dp = { id: dpId, method: "TRANSFER", amount: 500_000, at };
    const firm = {
      ...s.hold,
      heldUntil: "2026-09-20T04:00:00.000Z",
      dp,
    };
    await commitAs(
      app,
      { reservations: [s.hold], units: [s.unit], events: [] },
      {
        reservations: [firm],
        units: [{ ...s.unit, status: "DIRESERVASI" }],
        events: [
          eventFor(
            shop,
            s.unit,
            `ev_${dpId}`,
            "DIRESERVASI",
            "TERSEDIA",
            "DIRESERVASI",
            s.hold["code"] as string,
          ),
        ],
      },
    );
    return { firm, dp };
  }

  it("is written against the reservation alone, holds the unit, and the sale takes the same payment", async () => {
    const shop = await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    try {
      const s = await soft(app, shop, "a");
      const { firm, dp } = await recordDp(app, shop, s, "dp_store_a");
      const row = await db.payment.findUniqueOrThrow({ where: { id: dp.id } });
      expect(row).toMatchObject({
        reservationId: s.hold["id"],
        orderId: null,
        direction: "MASUK",
        amount: 500_000n,
        status: "LUNAS",
      });
      const rv = await db.reservation.findUniqueOrThrow({
        where: { id: s.hold["id"] as string },
      });
      expect(rv.heldUntil?.toISOString()).toBe("2026-09-20T04:00:00.000Z");
      const held = await db.unit.findUniqueOrThrow({
        where: { serial: s.unit["serial"] as string },
      });
      expect(held.status).toBe("DIRESERVASI");

      // The sale: the DP counts toward the bill, only the rest is collected.
      const serial = s.unit["serial"] as string;
      const code = "SI-2026/09-Tdpsale1";
      const sale = {
        id: "o_dp_a",
        code,
        ts: NOW.toISOString(),
        customerId: s.customer["id"],
        serials: [serial],
        prices: { [serial]: 5_000_000 },
        discount: 0,
        source: "OFFLINE",
        payMethod: "TUNAI",
        settled: true,
        payments: [
          { ...dp, state: "SETTLED", reservationId: s.hold["id"] },
          {
            id: "p_dp_rest",
            method: "TUNAI",
            amount: 4_500_000,
            state: "SETTLED",
            at: NOW.toISOString(),
          },
        ],
        total: 5_000_000,
        reservationId: s.hold["id"],
      };
      const done = {
        ...firm,
        status: "DONE",
        dp: { ...firm.dp, orderId: "o_dp_a" },
      };
      const result = await commitAs(
        app,
        {
          orders: [],
          reservations: [firm],
          units: [{ ...s.unit, status: "DIRESERVASI" }],
          events: [],
        },
        {
          orders: [sale],
          reservations: [done],
          units: [{ ...s.unit, status: "TERJUAL" }],
          events: [
            eventFor(
              shop,
              s.unit,
              "ev_dp_sold",
              "TERJUAL",
              "DIRESERVASI",
              "TERJUAL",
              code,
              1,
            ),
          ],
        },
      );
      // ONE row for the DP, now with both parents.
      const rows = await db.payment.findMany({
        where: { OR: [{ id: dp.id }, { orderId: "o_dp_a" }] },
        orderBy: { id: "asc" },
      });
      expect(rows.map((p) => [p.id, p.orderId, p.reservationId])).toEqual([
        ["dp_store_a", "o_dp_a", s.hold["id"]],
        ["p_dp_rest", "o_dp_a", null],
      ]);
      // Never counted twice: what the sale was paid is its total.
      expect(rows.reduce((n, p) => n + p.amount, 0n)).toBe(5_000_000n);
      const order = (result.rows.orders as Row[]).find(
        (o) => o["id"] === "o_dp_a",
      )!;
      expect(
        (order["payments"] as Row[]).find((p) => p["id"] === dp.id)?.[
          "reservationId"
        ],
      ).toBe(s.hold["id"]);
      const back = (
        decodeStore((await snapshotStore(db, { staffId: ACTOR })).db) as {
          reservations: Row[];
        }
      ).reservations.find((r) => r["id"] === s.hold["id"])!;
      expect(back["dp"]).toMatchObject({ id: dp.id, orderId: "o_dp_a" });
      expect(back["status"]).toBe("DONE");
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("refunds a DP as money out naming the reservation, and keeps one as nothing new", async () => {
    const shop = await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    try {
      const a = await soft(app, shop, "b");
      const { firm } = await recordDp(app, shop, a, "dp_store_b");
      const refunded = {
        ...firm,
        status: "CANCELLED",
        heldUntil: NOW.toISOString(),
        dp: {
          ...firm.dp,
          refund: {
            id: "dp_store_b_back",
            method: "TUNAI",
            amount: 500_000,
            at: NOW.toISOString(),
          },
        },
      };
      await commitAs(
        app,
        {
          reservations: [firm],
          units: [{ ...a.unit, status: "DIRESERVASI" }],
          events: [],
        },
        {
          reservations: [refunded],
          units: [{ ...a.unit, status: "TERSEDIA" }],
          events: [
            eventFor(
              shop,
              a.unit,
              "ev_dp_b_back",
              "RESERVASI_BATAL",
              "DIRESERVASI",
              "TERSEDIA",
              a.hold["code"] as string,
              1,
            ),
          ],
        },
      );
      const money = await db.payment.findMany({
        where: { reservationId: a.hold["id"] as string },
        orderBy: { direction: "asc" },
        include: { method: { select: { code: true } } },
      });
      expect(
        money.map((p) => [p.direction, p.amount, p.method.code, p.orderId]),
      ).toEqual([
        ["MASUK", 500_000n, "TRANSFER", null],
        ["KELUAR", 500_000n, "TUNAI", null],
      ]);

      // Kept: the reservation closes with the DP still on it — no new row.
      const c = await soft(app, shop, "c");
      const kept = await recordDp(app, shop, c, "dp_store_c");
      const before = await db.payment.count();
      await commitAs(
        app,
        {
          reservations: [kept.firm],
          units: [{ ...c.unit, status: "DIRESERVASI" }],
          events: [],
        },
        {
          reservations: [{ ...kept.firm, status: "CANCELLED" }],
          units: [{ ...c.unit, status: "TERSEDIA" }],
          events: [
            eventFor(
              shop,
              c.unit,
              "ev_dp_c_keep",
              "RESERVASI_BATAL",
              "DIRESERVASI",
              "TERSEDIA",
              c.hold["code"] as string,
              1,
            ),
          ],
        },
      );
      expect(await db.payment.count()).toBe(before);
      const rv = await db.reservation.findUniqueOrThrow({
        where: { id: c.hold["id"] as string },
      });
      expect(rv.status).toBe("BATAL");
    } finally {
      await app.$disconnect();
    }
  }, 180_000);

  it("keeps the DP rule in AppSetting, defaulting when unset", async () => {
    const before = (await snapshotStore(db, { staffId: ACTOR })).db as {
      settings: Record<string, unknown>;
    };
    const settings = decodeStore(
      before as unknown as StoreShape,
    ) as unknown as {
      settings: Record<string, unknown>;
    };
    expect(settings.settings["dpAmount"]).toBeUndefined();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    try {
      await commitStore(app, {
        staffId: ACTOR,
        changes: encodeChangeset(
          diffStore(
            { settings: settings.settings } as unknown as StoreShape,
            {
              settings: { ...settings.settings, dpAmount: 750_000, dpDays: 5 },
            } as unknown as StoreShape,
          ),
        ),
      });
    } finally {
      await app.$disconnect();
    }
    const rows = await db.appSetting.findMany({
      where: { key: { in: ["sales.dpAmount", "sales.dpDays"] } },
      orderBy: { key: "asc" },
    });
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["sales.dpAmount", "750000"],
      ["sales.dpDays", "5"],
    ]);
  }, 180_000);

  it("leaves a colleague the task when a unit reserved unpaid is sold to somebody else", async () => {
    const shop = await loadDemo();
    const app = new PrismaClient({ datasourceUrl: asApp() });
    try {
      const s = await soft(app, shop, "a");
      const phone = String(s.customer["phone"]);
      const from = phone.replace(/^\+/, "");
      await db.waMessage.create({
        data: {
          id: "wa_dp_store",
          waMessageId: "wamid.dp_store",
          from,
          direction: "IN",
          ts: NOW,
          text: "kak tolong keep ya",
          msgType: "text",
          status: "DIJAWAB_AGEN",
          entities: {},
          answeredByAgent: true,
        },
      });
      const serial = s.unit["serial"] as string;
      const code = "SI-2026/09-Tsoldovr";
      const sale = {
        id: "o_soldover",
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
            id: "p_soldover",
            method: "TUNAI",
            amount: 5_000_000,
            state: "SETTLED",
            at: NOW.toISOString(),
          },
        ],
        total: 5_000_000,
      };
      await commitAs(
        app,
        {
          orders: [],
          reservations: [s.hold],
          units: [s.unit],
          events: [],
        },
        {
          orders: [sale],
          reservations: [
            {
              ...s.hold,
              items: [],
              status: "CANCELLED",
              note: `${serial} was sold to another buyer on ${code}.`,
            },
          ],
          units: [{ ...s.unit, status: "TERJUAL" }],
          events: [
            eventFor(
              shop,
              s.unit,
              "ev_soldover",
              "TERJUAL",
              "TERSEDIA",
              "TERJUAL",
              code,
            ),
          ],
        },
      );
      const tasks = await db.chatAction.findMany({ where: { from } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        kind: "RESERVATION",
        status: "OPEN",
        topic: "hold",
      });
      expect(tasks[0]!.summary).toMatch(
        /^Perlu kabari — .+ sudah terjual ke pembeli lain$/,
      );
      await db.chatAction.deleteMany({ where: { from } });
      await db.waMessage.deleteMany({ where: { from } });
    } finally {
      await app.$disconnect();
    }
  }, 180_000);
});
