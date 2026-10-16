/**
 * /api/store over HTTP — the door every POS screen now reads and writes
 * through (docs/store-on-postgres.md).
 *
 * The mapping itself is proved in packages/db/test/store.test.ts, which sends
 * the whole demo shop through PostgreSQL and back. This file proves the door:
 * a session is required, a commit is attributed to it, a stale change is a 409
 * and a forbidden one a 400, the change feed carries what another till wrote,
 * and a QC photograph committed as a data URL is served back as bytes.
 *
 *   TEST_DATABASE_URL=postgresql://nusantara@localhost:5432/nusantara_store_test \
 *     pnpm --filter @nusantara/api exec vitest run test/store.test.ts
 */
import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_store_test";

const PASSWORD = "rahasia-sekali";
const NOW = new Date("2026-09-13T03:00:00.000Z");
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

async function shop(): Promise<void> {
  await db.staff.create({
    data: {
      id: "staff_store_api",
      username: "kasir_store",
      name: "Kasir Toko",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: await hashPassword(PASSWORD),
      createdAt: NOW,
    },
  });
  await db.location.create({
    data: {
      id: "wh-api",
      code: "WH-API",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 0,
    },
  });
  await db.paymentMethod.create({
    data: {
      id: "pm_tunai",
      code: "TUNAI",
      label: "Cash",
      builtIn: true,
      forPo: true,
      forSale: true,
      active: true,
      sortOrder: 0,
      createdAt: NOW,
    },
  });
  await db.category.create({
    data: {
      id: "cat-api",
      name: "MacBook Air",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 0n,
      marginMax: 0n,
      createdAt: NOW,
    },
  });
  await db.catalogModel.create({
    data: {
      id: "m-api",
      categoryId: "cat-api",
      name: "MacBook Air M1",
      year: "2020",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku-api",
      modelId: "m-api",
      code: "AIR 13 M1 8/256",
      name: "MacBook Air M1",
      variantLabel: "8GB · 256GB",
      price: 9_000_000n,
      landed: 0n,
      archived: false,
      createdAt: NOW,
    },
  });
}

async function signIn(): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "kasir_store", password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

beforeEach(async () => {
  await truncateAll(db);
  await shop();
  cookie = await signIn();
}, 60_000);

const commit = (body: object, key?: string) => {
  const r = request(app).post("/api/store/commit").set("Cookie", cookie);
  if (key !== undefined) r.set("Idempotency-Key", key);
  return r.send(body);
};

/** A machine arriving: the unit and its genesis event, in one commit. */
const ARRIVAL = {
  collections: {
    units: {
      rows: [
        {
          key: "SC02API000001",
          next: {
            serial: "SC02API000001",
            skuId: "sku-api",
            status: "QC",
            locationId: "wh-api",
            buy: "7500000",
            description: "",
            poId: null,
          },
        },
      ],
    },
    events: {
      rows: [
        {
          key: "ev_api_1",
          next: {
            id: "ev_api_1",
            serial: "SC02API000001",
            seq: 1,
            type: "DITERIMA",
            at: NOW.toISOString(),
            fromStatus: "-",
            toStatus: "QC",
            locationId: "wh-api",
            staff: "whoever the browser says",
          },
        },
      ],
    },
  },
  singletons: {},
};

describe("/api/store", () => {
  it("wants a session", async () => {
    const res = await request(app).get("/api/store");
    expect(res.status).toBe(401);
  });

  it("serves the shop with money as strings", async () => {
    const res = await request(app).get("/api/store").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBe("0");
    expect(res.body.db.skus[0]).toMatchObject({
      id: "sku-api",
      price: "9000000",
    });
    expect(res.body.db.settings).toMatchObject({ batteryGoodMin: 80 });
    expect(res.body.db.myWarehouseId).toBe("wh-api");
  });

  it("commits a machine's arrival, attributed to the session", async () => {
    const res = await commit(ARRIVAL, "arrival-1");
    expect(res.status).toBe(200);
    expect(res.body.rows.units[0]).toMatchObject({
      serial: "SC02API000001",
      buy: "7500000",
    });
    expect(res.body.rows.events[0]).toMatchObject({
      staff: "Kasir Toko",
      fromStatus: "-",
    });
    const stored = await db.unitEvent.findFirstOrThrow({
      where: { id: "ev_api_1" },
    });
    expect(stored.staffId).toBe("staff_store_api");
  });

  it("answers a retried commit from the stored response, not by writing twice", async () => {
    const first = await commit(ARRIVAL, "arrival-2");
    const second = await commit(ARRIVAL, "arrival-2");
    expect(second.status).toBe(first.status);
    expect(await db.unitEvent.count()).toBe(1);
  });

  it("refuses to edit the ledger with a 400", async () => {
    await commit(ARRIVAL);
    const event = ARRIVAL.collections.events.rows[0]!.next;
    const res = await commit({
      collections: {
        events: {
          rows: [
            { key: event.id, base: event, next: { ...event, note: "diubah" } },
          ],
        },
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDASI");
  });

  it("refuses a change based on a stale row with a 409", async () => {
    const customer = {
      id: "c-api",
      name: "Andi",
      phone: "",
      createdAt: NOW.toISOString(),
    };
    await commit({
      collections: { customers: { rows: [{ key: "c-api", next: customer }] } },
    });
    const renamed = { ...customer, name: "Andi W" };
    await commit({
      collections: {
        customers: { rows: [{ key: "c-api", base: customer, next: renamed }] },
      },
    });
    const stale = await commit({
      collections: {
        customers: {
          rows: [
            { key: "c-api", base: customer, next: { ...customer, name: "X" } },
          ],
        },
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("KONFLIK");
  });

  it("tells another till what changed", async () => {
    const before = await request(app).get("/api/store").set("Cookie", cookie);
    await commit(ARRIVAL);
    const res = await request(app)
      .get(`/api/store/changes?after=${before.body.cursor}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(
      res.body.rows.units.map((u: { serial: string }) => u.serial),
    ).toEqual(["SC02API000001"]);
    expect(Number(res.body.cursor)).toBeGreaterThan(Number(before.body.cursor));

    const ahead = await request(app)
      .get(`/api/store/changes?after=999999`)
      .set("Cookie", cookie);
    expect(ahead.status).toBe(410);
  });

  it("stores a QC photograph and serves its bytes", async () => {
    await commit(ARRIVAL);
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const res = await commit({
      collections: {
        unitNotes: {
          rows: [
            {
              key: "note-api",
              next: {
                id: "note-api",
                serial: "SC02API000001",
                body: "",
                tag: "QC",
                staff: "x",
                at: NOW.toISOString(),
                photos: [
                  {
                    id: "ph-api",
                    url: `data:image/png;base64,${png.toString("base64")}`,
                    sortOrder: 0,
                  },
                ],
              },
            },
          ],
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.rows.unitNotes[0].photos[0].url).toBe(
      "/api/store/photos/ph-api",
    );
    const photo = await request(app)
      .get("/api/store/photos/ph-api")
      .set("Cookie", cookie);
    expect(photo.status).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(photo.body as Buffer).equals(png)).toBe(true);
  });
});

/**
 * Financial & Report is for the accounts the owner named (2026-10-16): the
 * money only those screens read is withheld from everybody else by the API,
 * not merely hidden by the menu.
 */
describe("/api/store — finance access", () => {
  const REFUND = {
    collections: {
      expenses: {
        rows: [
          {
            key: "exp_api_1",
            next: {
              id: "exp_api_1",
              kind: "REFUND",
              amount: "250000",
              date: "2026-09-13",
              method: "TUNAI",
            },
          },
        ],
      },
    },
    singletons: {},
  };

  async function financeCookie(): Promise<string> {
    await db.staff.create({
      data: {
        id: "staff_finance_api",
        username: "dina_store",
        name: "Dina",
        role: "STAFF",
        canApprove: false,
        canViewFinance: true,
        active: true,
        passwordHash: await hashPassword(PASSWORD),
        createdAt: NOW,
      },
    });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "dina_store", password: PASSWORD });
    return (res.headers["set-cookie"] as unknown as string[])[0]!;
  }

  it("lets an account without it add a refund, and never shows it the money", async () => {
    const before = await request(app).get("/api/store").set("Cookie", cookie);
    const res = await commit(REFUND);
    expect(res.status).toBe(200);
    expect(res.body.rows.expenses).toBeUndefined();
    expect(await db.expense.count()).toBe(1);

    const snap = await request(app).get("/api/store").set("Cookie", cookie);
    expect(snap.body.db.expenses).toEqual([]);
    const feed = await request(app)
      .get(`/api/store/changes?after=${before.body.cursor}`)
      .set("Cookie", cookie);
    expect(feed.body.rows.expenses).toBeUndefined();

    const finance = await financeCookie();
    const theirs = await request(app).get("/api/store").set("Cookie", finance);
    expect(theirs.body.db.expenses.map((e: { id: string }) => e.id)).toEqual([
      "exp_api_1",
    ]);
    const me = await request(app).get("/api/auth/me").set("Cookie", finance);
    expect(me.body.staff.canViewFinance).toBe(true);
  });

  it("refuses an edit to a finance row from an account without it", async () => {
    await commit(REFUND);
    const row = REFUND.collections.expenses.rows[0]!;
    const res = await commit({
      collections: {
        expenses: {
          rows: [
            {
              key: row.key,
              base: row.next,
              next: { ...row.next, amount: "1" },
            },
          ],
        },
      },
      singletons: {},
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AKSES_DITOLAK");
    const removal = await commit({
      collections: { expenses: { rows: [{ key: row.key, base: row.next }] } },
      singletons: {},
    });
    expect(removal.status).toBe(403);
  });
});
