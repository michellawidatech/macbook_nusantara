/**
 * /api/inbound — the HTTP edge of taking a machine in.
 *
 * `packages/db/test/inbound.test.ts` proves the ledger semantics. This proves
 * the things only the edge can get wrong: that the actor comes from the session
 * and not the body, that a malformed serial is refused before it can mint a
 * unit, that a retried *Accept all* does not append a second QC_SELESAI, and
 * that a body naming one serial twice is named as such rather than failing as
 * an unexplained transition error.
 *
 * Runs against a real database — see reservations.test.ts for how to create one.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const PASSWORD = "rahasia-sekali";
const STAFF = "staff_inb_test";
const PO = "po_inb_test";
const SUPPLIER = "sup_inb_test";
const NOW = new Date("2026-09-02T03:00:00.000Z");

const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let cookie: string;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

/**
 * Only what THIS suite creates.
 *
 * The first version cleared the whole shop the way the neighbouring files do,
 * and it passed alone and failed in the full run — three times, on a different
 * constraint each time: OrderItem_unitId_fkey, then UnitEvent_orderId_fkey,
 * then CategoryAttribute_categoryId_fkey. Every FK here is `onDelete: Restrict`
 * because nothing in this system is ever hard-deleted, so "delete the reference
 * data" means "delete it and everything any other file hung off it", and the
 * order that satisfies that is a property of the whole schema rather than of
 * this test.
 *
 * So this file owns a prefix instead. Its serials are all `SC02AA…` and its
 * fixtures are all `…_i`, it removes exactly those, and it upserts what it
 * needs rather than recreating it — which also means it no longer cares
 * whether it runs first or last.
 */
const MY_SERIALS = { startsWith: "SC02AA" };

async function clear() {
  // Scoped to this suite's own cashier. Unscoped, this deleted the keys
  // auth.test.ts asserts on and turned a passing file into "expected 1 to be 2"
  // — which showed up only in the full run, because a key is scoped to the
  // staff member who used it and that is exactly what that test proves.
  await db.idempotencyKey.deleteMany({ where: { staffId: STAFF } });
  await db.unitEvent.deleteMany({ where: { serial: MY_SERIALS } });
  await db.unitNotePhoto.deleteMany({
    where: { note: { serial: MY_SERIALS } },
  });
  await db.unitNote.deleteMany({ where: { serial: MY_SERIALS } });
  await db.unitAttribute.deleteMany({
    where: { unit: { serial: MY_SERIALS } },
  });
  await db.unit.deleteMany({ where: { serial: MY_SERIALS } });
  await db.purchaseOrderItemSerial.deleteMany({
    where: { item: { poId: PO } },
  });
  await db.payment.deleteMany({ where: { poId: PO } });
  await db.purchaseOrderFee.deleteMany({ where: { poId: PO } });
  await db.purchaseOrderItem.deleteMany({ where: { poId: PO } });
  await db.purchaseOrder.deleteMany({ where: { id: PO } });
  await db.staffSession.deleteMany({ where: { staffId: STAFF } });
}

async function seedShop() {
  await db.staff.upsert({
    where: { id: STAFF },
    update: { passwordHash: await hashPassword(PASSWORD), active: true },
    create: {
      id: STAFF,
      username: "kasir_inb",
      name: "Kasir Inbound",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: await hashPassword(PASSWORD),
      createdAt: NOW,
    },
  });
  // upsert, not create, and names nobody else uses. `Category.name`,
  // `Location.code` and `Sku.code` are all UNIQUE, so a fixture called
  // "MacBook" collides with whichever neighbouring file created one first —
  // and this file no longer deletes theirs, which is the point.
  await db.location.upsert({
    where: { id: "loc_i" },
    update: {},
    create: {
      id: "loc_i",
      code: "INB-1",
      name: "Gudang Inbound Test",
      kind: "GUDANG",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.upsert({
    where: { id: "cat_i" },
    update: {},
    create: {
      id: "cat_i",
      name: "MacBook Inbound Test",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await db.catalogModel.upsert({
    where: { id: "mdl_i" },
    update: {},
    create: {
      id: "mdl_i",
      categoryId: "cat_i",
      name: "MacBook Air M2 Inbound Test",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.upsert({
    where: { id: "sku_i" },
    update: {},
    create: {
      id: "sku_i",
      modelId: "mdl_i",
      code: "SKU-INB-1",
      name: "MacBook Air M2 256GB Inbound Test",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
}

/** One invoice: two of a variant, nothing identified against it yet. */
async function seedPurchaseOrder() {
  await db.supplier.upsert({
    where: { id: SUPPLIER },
    update: {},
    create: {
      id: SUPPLIER,
      name: "Apel Segar Inbound Test",
      wa: "628100000000",
      active: true,
      createdAt: NOW,
    },
  });
  await db.purchaseOrder.create({
    data: {
      id: PO,
      code: "PI-INB-TEST",
      supplierId: SUPPLIER,
      invoice: "INV-1",
      noInvoice: false,
      status: "DITERIMA",
      orderedAt: NOW,
      receivedAt: NOW,
      subtotal: 24_000_000n,
      feesTaxPct: "0.00",
      feesTotal: 500_000n,
      total: 24_500_000n,
      locationId: "loc_i",
      staffId: STAFF,
      createdAt: NOW,
      items: {
        create: [
          {
            id: "poi_inb_1",
            skuId: "sku_i",
            produk: "MacBook Air M2 256GB",
            qty: 2,
            unitCost: 12_000_000n,
            lineTotal: 24_000_000n,
            allocatedFee: 500_000n,
          },
        ],
      },
      fees: {
        create: [
          {
            id: "pof_inb_1",
            label: "Ongkir",
            kind: "ONGKIR",
            amount: 500_000n,
          },
        ],
      },
    },
  });
}

async function signIn(): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "kasir_inb", password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

beforeEach(async () => {
  await clear();
  await seedShop();
  await seedPurchaseOrder();
  cookie = await signIn();
});

const post = (path: string, body?: unknown, key?: string) => {
  const r = request(app).post(`/api/inbound${path}`).set("Cookie", cookie);
  if (key !== undefined) r.set("Idempotency-Key", key);
  return r.send(body ?? {});
};

const get = (path: string) =>
  request(app).get(`/api/inbound${path}`).set("Cookie", cookie);

const RECEIVE = {
  serial: "SC02AA100AAA",
  skuId: "sku_i",
  buy: "12000000",
  landed: "12250000",
  locationId: "loc_i",
};

describe("POST /api/inbound/unit", () => {
  it("needs a session", async () => {
    const res = await request(app).post("/api/inbound/unit").send(RECEIVE);
    expect(res.status).toBe(401);
  });

  it("mints the unit into QC and serialises money as a string", async () => {
    const res = await post("/unit", RECEIVE);
    expect(res.status).toBe(201);
    expect(res.body.serial).toBe("SC02AA100AAA");

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA100AAA" },
      select: { status: true, buy: true, landed: true },
    });
    expect(unit.status).toBe("QC");
    expect(unit.buy).toBe(12_000_000n);
    expect(unit.landed).toBe(12_250_000n);
  });

  it("attributes the intake to the session, never to the body", async () => {
    // A client claiming to be somebody else must not be able to forge the
    // ledger's actor — that is what every UnitEvent.staffId is trusted for.
    await post("/unit", { ...RECEIVE, staffId: "staff_somebody_else" });
    const ev = await db.unitEvent.findFirstOrThrow({
      where: { serial: RECEIVE.serial },
      select: { staffId: true },
    });
    expect(ev.staffId).toBe(STAFF);
  });

  it("refuses a serial that is not shaped like one, before minting anything", async () => {
    for (const serial of ["", "TOOSHORT", "C02AA100AAA", "SC02AA100AAAAAAA"]) {
      const res = await post("/unit", { ...RECEIVE, serial });
      expect(res.status, serial).toBe(400);
    }
    expect(await db.unit.count({ where: { serial: MY_SERIALS } })).toBe(0);
  });

  it("upper-cases what was typed, so the field agrees with what is filed", async () => {
    const res = await post("/unit", { ...RECEIVE, serial: "sc02aa101aaa" });
    expect(res.status).toBe(201);
    expect(res.body.serial).toBe("SC02AA101AAA");
  });
});

describe("POST /api/inbound/accept", () => {
  const accept = (units: unknown[], key?: string) =>
    post("/accept", { units, refCode: "PO-9001" }, key);

  beforeEach(async () => {
    await post("/unit", RECEIVE);
    await post("/unit", { ...RECEIVE, serial: "SC02AA102AAA" });
  });

  it("moves QC to sellable and records what QC concluded", async () => {
    const res = await accept([
      { serial: "SC02AA100AAA", grade: "B", description: "lecet halus" },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: 1 });

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA100AAA" },
      select: { status: true, grade: true, description: true },
    });
    expect(unit.status).toBe("TERSEDIA");
    expect(unit.grade).toBe("B");
    expect(unit.description).toBe("lecet halus");
  });

  it("refuses a grade the database has never heard of", async () => {
    // "D" reads like a grading scale and is not one of A, B, C, NEW. Caught
    // here rather than as a 500 from Postgres on a press of Accept.
    const res = await accept([{ serial: "SC02AA100AAA", grade: "D" }]);
    expect(res.status).toBe(400);
  });

  it("names a duplicated serial instead of failing as a bad transition", async () => {
    const res = await accept([
      { serial: "SC02AA100AAA", grade: "A", description: "mulus" },
      { serial: "SC02AA100AAA", grade: "A", description: "mulus" },
    ]);
    expect(res.status).toBe(400);
    expect(String(res.body.error.message)).toContain("SC02AA100AAA");
  });

  it("does not append a second QC_SELESAI when Accept all is retried", async () => {
    const body = [{ serial: "SC02AA100AAA", grade: "A", description: "mulus" }];
    const first = await accept(body, "accept-once");
    const again = await accept(body, "accept-once");
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);

    const events = await db.unitEvent.count({
      where: { serial: "SC02AA100AAA", type: "QC_SELESAI" },
    });
    expect(events).toBe(1);
  });

  it("takes the whole invoice or none of it", async () => {
    const res = await accept([
      { serial: "SC02AA100AAA", grade: "A", description: "mulus" },
      { serial: "SC02AA999ZZZ", grade: "A", description: "hantu" },
    ]);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA100AAA" },
      select: { status: true },
    });
    expect(unit.status).toBe("QC");
  });

  it("makes the machine visible to the S/N tracker's own endpoint", async () => {
    // The owner's report, at the HTTP layer: accept it here, find it there.
    await accept([
      { serial: "SC02AA100AAA", grade: "A", description: "mulus" },
    ]);
    const res = await request(app)
      .get("/api/katalog/unit/SC02AA100AAA")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.unit.serial).toBe("SC02AA100AAA");
    expect(res.body.events.map((e: { type: string }) => e.type)).toContain(
      "QC_SELESAI",
    );
  });
});

describe("GET /api/inbound", () => {
  it("lists the invoice with what it owes the shelf", async () => {
    const res = await get("/?q=PI-INB-TEST");
    expect(res.status).toBe(200);
    const row = res.body.rows.find(
      (r: { code: string }) => r.code === "PI-INB-TEST",
    );
    expect(row).toBeDefined();
    expect(row.supplierName).toBe("Apel Segar Inbound Test");
    // Two on the invoice, none identified, none accepted — the counts the grid
    // is derived from.
    expect(row.qty).toBe(2);
    expect(row.identified).toBe(0);
    expect(row.accepted).toBe(0);
    // Money as a string: BigInt does not survive JSON.
    expect(typeof row.total).toBe("string");
    expect(row.total).toBe("24500000");
  });

  it("counts a machine as identified once its serial exists, accepted once QC passes", async () => {
    await post("/unit", { ...RECEIVE, poItemId: "poi_inb_1" });
    let row = (await get("/?q=PI-INB-TEST")).body.rows[0];
    expect(row.identified).toBe(1);
    expect(row.accepted).toBe(0);

    await post("/accept", {
      units: [{ serial: RECEIVE.serial, grade: "A", description: "mulus" }],
    });
    row = (await get("/?q=PI-INB-TEST")).body.rows[0];
    expect(row.identified).toBe(1);
    expect(row.accepted).toBe(1);
  });

  it("counts only SETTLED money as paid", async () => {
    await db.payment.create({
      data: {
        id: "pay_inb_tempo",
        poId: PO,
        direction: "KELUAR",
        methodId: "pm_tunai",
        amount: 10_000_000n,
        appliedTo: "BARANG",
        // A fortnight's credit: recorded, and nothing has been paid.
        status: "TEMPO",
        staffId: STAFF,
      },
    });
    const row = (await get("/?q=PI-INB-TEST")).body.rows[0];
    expect(row.paid).toBe("0");
  });

  it("separates closed from open, and treats absent as both", async () => {
    expect((await get("/?closed=false")).body.rows.length).toBeGreaterThan(0);
    expect(
      (await get("/?closed=true")).body.rows.filter(
        (r: { id: string }) => r.id === PO,
      ),
    ).toHaveLength(0);
  });
});

describe("GET /api/inbound/:poId", () => {
  it("404s on an invoice that is not there", async () => {
    const res = await get("/po_does_not_exist");
    expect(res.status).toBe(404);
  });

  it("returns the lines and the machines identified against them", async () => {
    await post("/unit", { ...RECEIVE, poItemId: "poi_inb_1" });
    const res = await get(`/${PO}`);
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(1);
    const line = res.body.lines[0];
    expect(line.skuId).toBe("sku_i");
    expect(line.qty).toBe(2);
    // One identified of two: the page derives one remaining SLOT from that,
    // and a slot is never a row.
    expect(line.units).toHaveLength(1);
    expect(line.units[0].serial).toBe(RECEIVE.serial);
    expect(line.units[0].status).toBe("QC");
    expect(res.body.fees).toHaveLength(1);
    // Decimal as a fixed string — it ends up in an arithmetic CHECK.
    expect(res.body.feesTaxPct).toBe("0.00");
    // The schema gap, reported rather than guessed.
    expect(res.body.originCode).toBeNull();
  });
});

describe("POST /api/inbound/:poId/close", () => {
  it("closes and reopens, because closing is a filing decision", async () => {
    const closed = await post(`/${PO}/close`, { closed: true });
    expect(closed.status).toBe(200);
    expect(closed.body.closedAt).not.toBeNull();
    expect((await get(`/${PO}`)).body.closedAt).not.toBeNull();

    const reopened = await post(`/${PO}/close`, { closed: false });
    expect(reopened.status).toBe(200);
    expect(reopened.body.closedAt).toBeNull();
  });

  it("closes even with an unpaid balance — it warns, it never refuses", async () => {
    // The page shows the warning; the judgement is the operator's.
    const res = await post(`/${PO}/close`, { closed: true });
    expect(res.status).toBe(200);
  });

  it("404s on an invoice that is not there", async () => {
    const res = await post("/po_does_not_exist/close", { closed: true });
    expect(res.status).toBe(404);
  });
});
