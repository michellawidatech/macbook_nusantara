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

  it("takes a sold unit's last event back — never one in the middle, never the last one standing", async () => {
    const shop = await loadDemo();
    const events = shop["events"] as Row[];
    const unit = (shop["units"] as Row[]).find(
      (u) =>
        u["status"] === "TERJUAL" &&
        events.filter((e) => e["serial"] === u["serial"]).length >= 3,
    )!;
    const serial = unit["serial"] as string;
    const mine = events
      .filter((e) => e["serial"] === serial)
      .sort((a, b) => (a["seq"] as number) - (b["seq"] as number));
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

    // In the middle: the chain is not rebuilt around a hole.
    await expect(
      commit({ events: mine }, { events: mine.filter((e) => e !== previous) }),
    ).rejects.toThrow(/terakhir/);
    // The last row, with the unit still saying what that row said: the
    // projection must follow the ledger, in the same commit.
    await expect(
      commit({ events: mine }, { events: mine.slice(0, -1) }),
    ).rejects.toThrow(/riwayatnya/);
    // The last row, the unit put back where its history now leaves it —
    // Transaction History's swap, `removeLastEvent` in the browser.
    await commit(
      { units: [unit], events: mine },
      {
        units: [
          {
            ...unit,
            status: previous["toStatus"],
            locationId: previous["locationId"],
          },
        ],
        events: mine.slice(0, -1),
      },
    );
    const row = await db.unit.findUniqueOrThrow({
      where: { serial },
      select: { status: true, locationId: true },
    });
    expect(row.status).toBe(previous["toStatus"]);
    expect(row.locationId).toBe(previous["locationId"]);
    expect(
      await db.unitEvent.count({ where: { id: last["id"] as string } }),
    ).toBe(0);
    expect(await db.unitEvent.count({ where: { serial } })).toBe(
      mine.length - 1,
    );
    // Never the last one standing.
    await expect(
      commit({ events: mine.slice(0, -1) }, { events: [] }),
    ).rejects.toThrow(/harus punya riwayat/);
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
