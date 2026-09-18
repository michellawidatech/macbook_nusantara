/**
 * GET /api/katalog/unit/:serial — one serial's whole life.
 *
 * The claim worth testing is not that the ledger reads back. It is that the
 * ENRICHMENT is right: the browser version searched each table for a row
 * mentioning this serial and took the first match, so a machine held, released,
 * and held again by somebody else narrated the wrong customer on both events.
 * Every join here is an id the event itself carries, and the last test in this
 * file is the one that would have caught the old bug.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaClient,
  appendUnitEvent,
  createHold,
  releaseHold,
  truncateAll,
} from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const PASSWORD = "rahasia-sekali";
const STAFF = "staff_tl_test";
const NOW = new Date("2026-08-20T03:00:00.000Z");

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
 * Empty the schema before this file writes its own fixtures.
 *
 * Was a hand-written chain of `deleteMany` calls in child-before-parent order.
 * That order is a property of the whole schema rather than of this file, and
 * it fell over the moment the seed grew a table the chain had not listed — a
 * `PurchaseOrderItem` holding the SKU it was trying to delete. `truncateAll`
 * asks Postgres to empty the schema instead, so it cannot fall behind it.
 */
async function clear() {
  await truncateAll(db);
}

const SERIAL = "TLA0000001";

async function seedShop(): Promise<void> {
  await db.reservationSource.createMany({
    data: [
      {
        id: "rsv-src-wa",
        name: "WhatsApp",
        sortOrder: 2,
        active: true,
        createdAt: NOW,
      },
      {
        id: "rsv-src-ig",
        name: "Instagram",
        sortOrder: 1,
        active: true,
        createdAt: NOW,
      },
    ],
    skipDuplicates: true,
  });
  await db.staff.upsert({
    where: { id: STAFF },
    update: { passwordHash: await hashPassword(PASSWORD), active: true },
    create: {
      id: STAFF,
      username: "kasir_tl",
      name: "Kasir Timeline",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: await hashPassword(PASSWORD),
      createdAt: NOW,
    },
  });
  await db.location.create({
    data: {
      id: "loc_tl",
      code: "T1",
      name: "Gudang Utama",
      kind: "GUDANG",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_tl",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await db.catalogModel.create({
    data: {
      id: "mdl_tl",
      categoryId: "cat_tl",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_tl",
      modelId: "mdl_tl",
      code: "AIR-M2-8-256",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  await db.unit.create({
    data: {
      id: "u_tl",
      serial: SERIAL,
      skuId: "sku_tl",
      status: "QC",
      locationId: "loc_tl",
      buy: 12_000_000n,
      landed: 12_400_000n,
      grade: "A",
      intakeAt: NOW,
      version: 1,
    },
  });
  await db.$transaction(async (tx) => {
    await appendUnitEvent(tx, {
      serial: SERIAL,
      type: "DITERIMA",
      staffId: STAFF,
      at: NOW,
      toLocationId: "loc_tl",
    });
    await appendUnitEvent(tx, {
      serial: SERIAL,
      type: "QC_SELESAI",
      staffId: STAFF,
      at: NOW,
    });
  });
}

const signIn = async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "kasir_tl", password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
};

beforeEach(async () => {
  await clear();
  await seedShop();
  cookie = await signIn();
});

const get = (path: string) =>
  request(app).get(`/api/katalog${path}`).set("Cookie", cookie);

/** Book a hold for one person, then let it go again. */
async function holdThenRelease(phone: string, name: string, channel: string) {
  const hold = await db.$transaction((tx) =>
    createHold(tx, {
      serials: [SERIAL],
      staffId: STAFF,
      customer: { phone, name },
      source: "STAF",
      reservationSourceId: channel,
      at: NOW,
    }),
  );
  await db.$transaction((tx) =>
    releaseHold(tx, {
      target: { reservationId: hold.id },
      staffId: STAFF,
      at: NOW,
    }),
  );
  return hold;
}

describe("GET /api/katalog/unit/:serial", () => {
  it("requires a session", async () => {
    expect((await request(app).get(`/api/katalog/unit/${SERIAL}`)).status).toBe(
      401,
    );
  });

  it("returns the machine's card with the variant's asking price", async () => {
    const res = await get(`/unit/${SERIAL}`);
    expect(res.status).toBe(200);
    expect(res.body.unit).toMatchObject({
      serial: SERIAL,
      status: "TERSEDIA",
      locationName: "Gudang Utama",
      grade: "A",
      productName: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      categoryName: "MacBook",
    });
    // Money crosses the wire as a decimal string, never as a JS number.
    expect(res.body.unit.buy).toBe("12000000");
    expect(res.body.unit.price).toBe("15500000");
    expect(typeof res.body.unit.intakeAt).toBe("string");
  });

  it("is explicit that description and rack are not stored yet", async () => {
    // Both are open owner decisions: `Unit` has no description column and there
    // is no Rack model. Null rather than invented, so the screen renders the
    // same "—" it renders for a machine nobody described.
    const res = await get(`/unit/${SERIAL}`);
    expect(res.body.unit.description).toBeNull();
    expect(res.body.unit.rackName).toBeNull();
  });

  it("reads the ledger newest first, with the ledger's own seq", async () => {
    const res = await get(`/unit/${SERIAL}`);
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual([
      "QC_SELESAI",
      "DITERIMA",
    ]);
    expect(res.body.events.map((e: { seq: number }) => e.seq)).toEqual([2, 1]);
    expect(res.body.events[0].staffName).toBe("Kasir Timeline");
  });

  it("says where a machine was shelved when it passed QC", async () => {
    const res = await get(`/unit/${SERIAL}`);
    const qc = res.body.events.find(
      (e: { type: string }) => e.type === "QC_SELESAI",
    );
    expect(qc.context).toMatchObject({
      kind: "SHELVED",
      locationName: "Gudang Utama",
    });
  });

  it("names the customer and the channel on a hold", async () => {
    await db.$transaction((tx) =>
      createHold(tx, {
        serials: [SERIAL],
        staffId: STAFF,
        customer: { phone: "+628111000111", name: "Budi Santoso" },
        source: "STAF",
        reservationSourceId: "rsv-src-wa",
        at: NOW,
      }),
    );

    const res = await get(`/unit/${SERIAL}`);
    const held = res.body.events.find(
      (e: { type: string }) => e.type === "DIRESERVASI",
    );
    expect(held.context).toMatchObject({
      kind: "HOLD",
      customerName: "Budi Santoso",
      channelName: "WhatsApp",
    });
    expect(held.refCode).toMatch(/^RV-/);
  });

  it("404s on a serial the shop has never seen, and names it", async () => {
    const res = await get("/unit/NOSUCH1");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TIDAK_DITEMUKAN");
    expect(res.body.error.message).toContain("NOSUCH1");
  });

  it("400s on a serial longer than a serial can be", async () => {
    const res = await get("/unit/THIS-IS-FAR-TOO-LONG-FOR-A-SERIAL");
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("serial");
  });

  /**
   * The bug this slice exists to fix.
   *
   * Two customers hold the same machine at different times. The browser version
   * searched `db.reservations` for a row mentioning this serial and took the
   * FIRST match, so BOTH holds narrated whichever customer happened to be first
   * in the array — and the release narrated them too.
   */
  it("tells two customers' holds apart on one machine", async () => {
    const first = await holdThenRelease(
      "+628111000111",
      "Budi Santoso",
      "rsv-src-wa",
    );
    const second = await holdThenRelease(
      "+628111000222",
      "Siti Rahayu",
      "rsv-src-ig",
    );
    expect(first.code).not.toBe(second.code);

    const res = await get(`/unit/${SERIAL}`);
    // Oldest first, so the pairs read in the order they happened.
    const holds = res.body.events
      .filter((e: { type: string }) => e.type === "DIRESERVASI")
      .reverse();
    const releases = res.body.events
      .filter((e: { type: string }) => e.type === "RESERVASI_BATAL")
      .reverse();

    expect(holds).toHaveLength(2);
    expect(holds[0].context).toMatchObject({
      customerName: "Budi Santoso",
      channelName: "WhatsApp",
      reservationCode: first.code,
    });
    expect(holds[1].context).toMatchObject({
      customerName: "Siti Rahayu",
      channelName: "Instagram",
      reservationCode: second.code,
    });

    // And the releases are attributed to their own holds, not both to the first.
    expect(releases[0].context).toMatchObject({ reservationCode: first.code });
    expect(releases[1].context).toMatchObject({ reservationCode: second.code });
  });

  it("adds no context to an event that names nothing, rather than guessing", async () => {
    await db.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial: SERIAL,
        type: "DICATAT",
        staffId: STAFF,
        at: NOW,
        note: "Charger checked",
      }),
    );
    const res = await get(`/unit/${SERIAL}`);
    const noted = res.body.events.find(
      (e: { type: string }) => e.type === "DICATAT",
    );
    expect(noted.context).toBeNull();
    expect(noted.note).toBe("Charger checked");
  });
});

describe("GET /api/katalog/unit", () => {
  it("offers serials to pick from, searched server-side", async () => {
    const res = await get("/unit?q=TLA");
    expect(res.status).toBe(200);
    expect(res.body.units).toEqual([
      {
        serial: SERIAL,
        productName: "MacBook Air M2 256GB",
        variantLabel: "8/256",
      },
    ]);
  });

  it("matches on the product name too, not only the serial", async () => {
    expect((await get("/unit?q=Air%20M2")).body.units).toHaveLength(1);
    expect((await get("/unit?q=nothingmatches")).body.units).toHaveLength(0);
  });

  it("caps what one request can ask for", async () => {
    expect((await get("/unit?limit=5000")).status).toBe(400);
  });
});
