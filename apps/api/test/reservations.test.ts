/**
 * /api/reservations, against a real database.
 *
 * The first POS capability to leave the browser mock. What these tests are
 * really asserting is that the authoritative decisions moved with it: the
 * document number comes from the database, the ledger's `seq` comes from the
 * ledger, the actor comes from the session, and two cashiers cannot hold the
 * same machine.
 *
 * The concurrency cases are the point of the exercise. Under the mock both
 * browsers had their own copy of the world and both succeeded.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { dispatchTool, type ToolContext } from "@nusantara/agent";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const PASSWORD = "rahasia-sekali";
const STAFF = "staff_rsv_test";
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

/**
 * The channel list. Inserted by migration 20260828120000 and recreated by
 * `seed()` — but `seed()` TRUNCATES first, and other suites in this database
 * call it, so a test owns its own fixtures rather than depending on what
 * another file left behind. `Reservation.reservationSourceId` is a Restrict FK
 * at these rows.
 */
const CHANNELS = [
  { id: "rsv-src-ig", name: "Instagram", sortOrder: 1 },
  { id: "rsv-src-wa", name: "WhatsApp", sortOrder: 2 },
  { id: "rsv-src-tiktok", name: "TikTok", sortOrder: 3 },
  { id: "rsv-src-shopee", name: "Shopee", sortOrder: 4 },
  { id: "rsv-src-tokopedia", name: "Tokopedia", sortOrder: 5 },
  { id: "rsv-src-walkin", name: "Walk-in", sortOrder: 6 },
];

/** A shop with `count` sellable machines, and a cashier who can sign in. */
async function seedShop(count = 2): Promise<string[]> {
  await db.reservationSource.createMany({
    data: CHANNELS.map((c) => ({ ...c, active: true, createdAt: NOW })),
    skipDuplicates: true,
  });
  await db.staff.upsert({
    where: { id: STAFF },
    update: { passwordHash: await hashPassword(PASSWORD), active: true },
    create: {
      id: STAFF,
      username: "kasir_rsv",
      name: "Kasir Reservasi",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: await hashPassword(PASSWORD),
      createdAt: NOW,
    },
  });
  await db.location.create({
    data: {
      id: "loc_r",
      code: "R1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_r",
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
      id: "mdl_r",
      categoryId: "cat_r",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_r",
      modelId: "mdl_r",
      code: "SKU-R1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });

  const serials: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const serial = `RSV${i}`;
    serials.push(serial);
    await db.unit.create({
      data: {
        id: `ur_${i}`,
        serial,
        skuId: "sku_r",
        status: "QC",
        locationId: "loc_r",
        buy: 12_000_000n,
        landed: 12_000_000n,
        grade: "A",
        intakeAt: NOW,
        version: 1,
      },
    });
    // A unit reaches TERSEDIA through the ledger, never by an UPDATE.
    await db.$transaction(async (tx) => {
      await appendUnitEvent(tx, {
        serial,
        type: "DITERIMA",
        staffId: STAFF,
        at: NOW,
        toLocationId: "loc_r",
      });
      await appendUnitEvent(tx, {
        serial,
        type: "QC_SELESAI",
        staffId: STAFF,
        at: NOW,
      });
    });
  }
  return serials;
}

async function signIn(): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "kasir_rsv", password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

beforeEach(async () => {
  await clear();
  await seedShop(3);
  cookie = await signIn();
});

const post = (path: string, body?: unknown, key?: string) => {
  const r = request(app).post(`/api/reservations${path}`).set("Cookie", cookie);
  if (key !== undefined) r.set("Idempotency-Key", key);
  return r.send(body ?? {});
};
const get = (path = "") =>
  request(app).get(`/api/reservations${path}`).set("Cookie", cookie);

/** The ordinary create body: one machine, a customer the shop has not met. */
const newHold = (serials: string[], over: Record<string, unknown> = {}) => ({
  serials,
  phone: "+628111000999",
  name: "Budi",
  scheduledFor: "2026-08-21T08:00:00.000Z",
  reservationSourceId: "rsv-src-wa",
  ...over,
});

describe("POST /api/reservations", () => {
  it("holds the machine, and the unit and the ledger agree", async () => {
    const res = await post("/", newHold(["RSV0"]));
    expect(res.status).toBe(201);

    const unit = await db.unit.findUniqueOrThrow({ where: { serial: "RSV0" } });
    expect(unit.status).toBe("DIRESERVASI");

    const ev = await db.unitEvent.findFirstOrThrow({
      where: { serial: "RSV0", type: "DIRESERVASI" },
    });
    expect(ev.toStatus).toBe("DIRESERVASI");
    expect(ev.fromStatus).toBe("TERSEDIA");
    // seq comes from the ledger under the row lock, not from a browser's count.
    expect(ev.seq).toBe(3);
    // The actor is the session's, never the body's.
    expect(ev.staffId).toBe(STAFF);
  });

  it("takes the document number from the database, never from the client", async () => {
    const res = await post(
      "/",
      newHold(["RSV0"], { code: "RV-9999/99-999999" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.reservation.code).toMatch(/^RV-\d{4}\/\d{2}-\d{6}$/);
    expect(res.body.reservation.code).not.toBe("RV-9999/99-999999");
  });

  it("links the event to the hold, so the timeline cannot narrate the wrong customer", async () => {
    const res = await post("/", newHold(["RSV0"]));
    const ev = await db.unitEvent.findFirstOrThrow({
      where: { serial: "RSV0", type: "DIRESERVASI" },
    });
    expect(ev.reservationId).toBe(res.body.reservation.id);
    // And the audit correlation the caller can actually quote back.
    expect(ev.requestId).toBe(res.headers["x-request-id"]);
  });

  it("stores a staff member's note as written — the [agen] marker is for quoted input", async () => {
    await post("/", newHold(["RSV0"], { note: "bawa dus ya" }));
    const r = await db.reservation.findFirstOrThrow();
    expect(r.note).toBe("bawa dus ya");
    expect(r.source).toBe("STAF");
  });

  it("holds several machines in one act", async () => {
    const res = await post("/", newHold(["RSV0", "RSV1", "RSV2"]));
    expect(res.status).toBe(201);
    expect(res.body.reservation.items).toHaveLength(3);
    expect(await db.unit.count({ where: { status: "DIRESERVASI" } })).toBe(3);
  });

  describe("refuses", () => {
    it("a request with no session", async () => {
      const res = await request(app)
        .post("/api/reservations")
        .send(newHold(["RSV0"]));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("TIDAK_LOGIN");
    });

    it("an empty serial list, naming the field", async () => {
      const res = await post("/", newHold([]));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: "VALIDASI",
        field: "serials",
      });
    });

    it("more machines than one transaction should hold", async () => {
      const res = await post(
        "/",
        newHold(Array.from({ length: 21 }, (_, i) => `X${i}`)),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.field).toBe("serials");
    });

    it("a body that names both an existing customer and a new one", async () => {
      const res = await post("/", newHold(["RSV0"], { customerId: "cust_x" }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDASI");
    });

    it("a serial the shop has never seen, and says which", async () => {
      const res = await post("/", newHold(["RSV0", "NOSUCH"]));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("TIDAK_DITEMUKAN");
      expect(res.body.error.message).toContain("NOSUCH");
      // Nothing was written: the whole hold is one transaction.
      expect(await db.reservation.count()).toBe(0);
      const unit = await db.unit.findUniqueOrThrow({
        where: { serial: "RSV0" },
      });
      expect(unit.status).toBe("TERSEDIA");
    });

    it("a machine somebody is already holding", async () => {
      await post("/", newHold(["RSV0"]));
      const res = await post(
        "/",
        newHold(["RSV0"], { phone: "+628111000888" }),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("KONFLIK");
      expect(res.body.error.message).toContain("RSV0");
    });

    it("names EVERY unavailable machine, not just the first", async () => {
      await post("/", newHold(["RSV0", "RSV1"]));
      const res = await post(
        "/",
        newHold(["RSV0", "RSV1"], { phone: "+628111000888" }),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain("RSV0");
      expect(res.body.error.message).toContain("RSV1");
    });
  });
});

describe("two cashiers at once", () => {
  /**
   * The whole reason this moved off the mock. Both browsers used to have their
   * own copy of the world, and both succeeded.
   */
  it("cannot both hold the same machine", async () => {
    const [a, b] = await Promise.all([
      post("/", newHold(["RSV0"], { phone: "+628111000111" })),
      post("/", newHold(["RSV0"], { phone: "+628111000222" })),
    ]);

    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([201, 409]);
    expect(await db.reservation.count()).toBe(1);
    expect(await db.unitEvent.count({ where: { type: "DIRESERVASI" } })).toBe(
      1,
    );
  });

  it("cannot both hold overlapping baskets", async () => {
    const [a, b] = await Promise.all([
      post("/", newHold(["RSV0", "RSV1"], { phone: "+628111000111" })),
      post("/", newHold(["RSV1", "RSV2"], { phone: "+628111000222" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // The loser wrote nothing at all — not even its non-overlapping machine.
    expect(await db.reservation.count()).toBe(1);
    expect(await db.unit.count({ where: { status: "DIRESERVASI" } })).toBe(2);
  });

  it("answers a double-clicked Reserve once, when the key is repeated", async () => {
    const key = "idem-hold-1";
    const first = await post("/", newHold(["RSV0"]), key);
    const second = await post("/", newHold(["RSV0"]), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.body.reservation.code).toBe(first.body.reservation.code);
    expect(await db.reservation.count()).toBe(1);
  });
});

describe("releasing", () => {
  it("lets some machines go and leaves the hold open", async () => {
    const created = await post("/", newHold(["RSV0", "RSV1"]));
    const id = created.body.reservation.id;

    const res = await post(`/${id}/release`, { serials: ["RSV0"] });
    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe("TERJADWAL");

    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "RSV0" } })).status,
    ).toBe("TERSEDIA");
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "RSV1" } })).status,
    ).toBe("DIRESERVASI");
  });

  it("closes the hold when the last machine goes", async () => {
    const created = await post("/", newHold(["RSV0", "RSV1"]));
    const id = created.body.reservation.id;

    await post(`/${id}/release`, { serials: ["RSV0"] });
    const res = await post(`/${id}/release`, { serials: ["RSV1"] });

    expect(res.body.reservation.status).toBe("BATAL");
    expect(await db.unit.count({ where: { status: "DIRESERVASI" } })).toBe(0);
  });

  it("cancels the whole hold in one act", async () => {
    const created = await post("/", newHold(["RSV0", "RSV1"]));
    const res = await post(`/${created.body.reservation.id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe("BATAL");
    expect(await db.unit.count({ where: { status: "TERSEDIA" } })).toBe(3);
    expect(
      await db.unitEvent.count({ where: { type: "RESERVASI_BATAL" } }),
    ).toBe(2);
  });

  it("is idempotent — a second cancel is not an error", async () => {
    const created = await post("/", newHold(["RSV0"]));
    const id = created.body.reservation.id;
    await post(`/${id}/cancel`);

    const again = await post(`/${id}/cancel`);
    expect(again.status).toBe(200);
    expect(again.body.reservation.status).toBe("BATAL");
    // And it did not append a second release to the ledger.
    expect(
      await db.unitEvent.count({ where: { type: "RESERVASI_BATAL" } }),
    ).toBe(1);
  });

  it("404s on a hold that does not exist", async () => {
    const res = await post("/nosuchhold/cancel");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TIDAK_DITEMUKAN");
  });

  /**
   * A cashier can sell a reserved machine straight off the shelf list without
   * ever opening this screen. The release must step over it rather than abort:
   * there is no TERJUAL -> RESERVASI_BATAL arrow, so targeting it would take
   * the whole transaction down and strand the machines that CAN be released.
   */
  it("steps over a machine that was sold out from under the hold", async () => {
    const created = await post("/", newHold(["RSV0", "RSV1"]));
    const id = created.body.reservation.id;

    await db.$transaction(async (tx) => {
      await appendUnitEvent(tx, {
        serial: "RSV0",
        type: "TERJUAL",
        staffId: STAFF,
        at: NOW,
      });
    });

    const res = await post(`/${id}/cancel`);
    expect(res.status).toBe(200);
    // The sold one stayed sold; the other went back to stock.
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "RSV0" } })).status,
    ).toBe("TERJUAL");
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "RSV1" } })).status,
    ).toBe("TERSEDIA");
    // Something on it sold, so the hold reads collected rather than cancelled.
    expect(res.body.reservation.status).toBe("SELESAI");
  });

  /**
   * Nothing in the schema binds a unit to at most one open hold, so a naive
   * projection would read the NEW holder's status and resurrect the old hold.
   */
  it("does not resurrect a cancelled hold when its machine is held again by somebody else", async () => {
    const first = await post(
      "/",
      newHold(["RSV0"], { phone: "+628111000111" }),
    );
    const firstId = first.body.reservation.id;
    await post(`/${firstId}/cancel`);

    // Somebody else takes the same machine.
    const second = await post(
      "/",
      newHold(["RSV0"], { phone: "+628111000222" }),
    );
    expect(second.status).toBe(201);

    // Touching the old hold again must not read the new holder's unit status.
    const again = await post(`/${firstId}/cancel`);
    expect(again.body.reservation.status).toBe("BATAL");

    // And it certainly must not release the other customer's machine.
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "RSV0" } })).status,
    ).toBe("DIRESERVASI");
    const holder = await db.reservation.findUniqueOrThrow({
      where: { id: second.body.reservation.id },
    });
    expect(holder.status).toBe("TERJADWAL");
  });
});

describe("GET /api/reservations", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/reservations")).status).toBe(401);
  });

  it("returns holds with everything a row renders, pre-joined", async () => {
    await post("/", newHold(["RSV0"]));
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const row = res.body.rows[0];
    expect(row).toMatchObject({
      customerName: "Budi",
      status: "TERJADWAL",
      source: "STAF",
      channelName: "WhatsApp",
    });
    expect(row.items[0]).toMatchObject({
      serial: "RSV0",
      productName: "MacBook Air M2 256GB",
      grade: "A",
      unitStatus: "DIRESERVASI",
      state: "HELD",
    });
    // Dates cross the wire as ISO strings, never as Date objects.
    expect(typeof row.createdAt).toBe("string");
  });

  it("distinguishes no data from no matches", async () => {
    await post("/", newHold(["RSV0"]));
    const res = await get("?q=nothingmatchesthis");
    expect(res.body.total).toBe(0);
    expect(res.body.totalUnfiltered).toBe(1);
  });

  it("finds a hold by serial", async () => {
    await post("/", newHold(["RSV1"]));
    expect((await get("?q=RSV1")).body.total).toBe(1);
    expect((await get("?q=RSV0")).body.total).toBe(0);
  });

  it("refuses a status nobody has heard of rather than returning nothing", async () => {
    const res = await get("?status=ACTIVE");
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("status");
  });

  it("serves the channel list the create form needs", async () => {
    const res = await get("/sources");
    expect(res.status).toBe(200);
    expect(res.body.sources.map((s: { name: string }) => s.name)).toContain(
      "Walk-in",
    );
  });
});

/**
 * The point of the whole exercise, revised 2026-10-27.
 *
 * The WhatsApp agent writes real `Reservation` rows, and the POS reads them.
 * Until 2026-10-27 a bot booking was a HOLD that took the machine off the
 * shelf; the owner reversed that (*"if reservation makes the stock decrease
 * and reduce sale, it is bad"*), so a bot booking is now a VISIT — a time to
 * come and look, with no line and nothing held. This asserts the consequence
 * at the counter.
 */
describe("a bot visit and the counter", () => {
  const agentCtx = (): ToolContext => ({
    from: "628111000321",
    profileName: "Budi",
    now: new Date("2026-08-20T03:00:00.000Z"),
    reserve: { write: db, staffId: STAFF },
    writesUsed: new Set<string>(),
  });

  it("shows a visit the chat agent booked, with the machine still on sale", async () => {
    const booked = (await dispatchTool(
      db,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "RSV0", custName: "Budi" },
      agentCtx(),
    )) as Record<string, unknown>;
    expect(booked["ok"]).toBe(true);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);

    const row = res.body.rows[0];
    expect(row.source).toBe("AGEN");
    expect(row.code).toBe(booked["code"]);
    expect(row.items).toEqual([]);

    const unit = await db.unit.findUniqueOrThrow({ where: { serial: "RSV0" } });
    expect(unit.status).toBe("TERSEDIA");
  });

  it("lets the counter cancel a visit the agent booked, touching no unit", async () => {
    await dispatchTool(
      db,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "RSV0" },
      agentCtx(),
    );
    const list = await get();
    const id = list.body.rows[0].id;

    const res = await post(`/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe("BATAL");
    expect(
      await db.unitEvent.count({ where: { type: "RESERVASI_BATAL" } }),
    ).toBe(0);
  });

  it("lets the counter hold the very machine the visit is to see", async () => {
    await dispatchTool(
      db,
      "book_visit",
      { when: "2026-08-21T15:00", serials: "RSV0" },
      agentCtx(),
    );
    const res = await post("/", newHold(["RSV0"], { phone: "+628111000777" }));
    expect(res.status).toBe(201);
  });
});
