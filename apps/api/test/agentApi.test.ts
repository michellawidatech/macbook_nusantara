/**
 * `/api/agent/v1` against a real database (chatbot v2 step 3).
 *
 * The owner's rule, 2026-10-14: "the user can only write to their own data".
 * The route takes the customer from the worker's signed token and from
 * nowhere else, so the claims below are made by trying to reach the other
 * customer every way a request can carry a phone number — and failing.
 */

import { Writable } from "node:stream";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { mintAgentToken, type AgentCapabilities } from "@nusantara/agent";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { agentRouter } from "../src/routes/agent.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const SECRET = "agent-api-test-secret";
const AGENT_STAFF = "staff_agent";
/** Thursday 20 August 2026, 10:00 in Jakarta; the shop is open. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const TOMORROW_3PM = "2026-08-21T15:00";

const ALICE = "628111000401";
const BOB = "628111000402";

const ALL_ON = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

const sink = new Writable({ write: (_c, _e, cb) => cb() });
const logger = createLogger({ app: "api", env: "test", destination: sink });

let db: PrismaClient;
/** The router alone, on a fixed clock, so a booking's day is known. */
let agentApp: Express;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  agentApp = express()
    .use(express.json())
    .use(
      "/api/agent/v1",
      agentRouter({
        db,
        logger,
        secret: SECRET,
        agentStaffId: AGENT_STAFF,
        now: () => NOW,
      }),
    );
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

const token = (
  waId: string,
  over: { caps?: AgentCapabilities; writes?: boolean; turn?: string } = {},
) =>
  `Bearer ${mintAgentToken(
    {
      waId,
      turn: over.turn ?? `turn-${testNo}-${waId}`,
      caps: over.caps ?? ALL_ON,
      writes: over.writes ?? true,
    },
    SECRET,
    NOW,
  )}`;

/** Two sellable units, as reserve.test.ts builds them. */
async function seedShop() {
  await truncateAll(db);
  await db.staff.upsert({
    where: { id: AGENT_STAFF },
    update: {},
    create: {
      id: AGENT_STAFF,
      username: "agent",
      name: "Agen WhatsApp",
      role: "STAFF",
      canApprove: false,
      active: false,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await db.location.create({
    data: {
      id: "loc_t",
      code: "T1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_t",
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
      id: "mdl_t",
      categoryId: "cat_t",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_t",
      modelId: "mdl_t",
      code: "SKU-T1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  for (const [i, serial] of ["SERA", "SERB"].entries()) {
    await db.unit.create({
      data: {
        id: `u_${i}`,
        serial,
        skuId: "sku_t",
        status: "QC",
        locationId: "loc_t",
        buy: 12_000_000n,
        landed: 12_000_000n,
        grade: "A",
        intakeAt: new Date(NOW.getTime() - 86_400_000),
        version: 1,
      },
    });
    await db.$transaction(async (tx) => {
      await appendUnitEvent(tx, {
        serial,
        type: "DITERIMA",
        staffId: AGENT_STAFF,
        at: NOW,
        toLocationId: "loc_t",
      });
      await appendUnitEvent(tx, {
        serial,
        type: "QC_SELESAI",
        staffId: AGENT_STAFF,
        at: NOW,
      });
    });
  }
}

/** A fresh turn per test: the router remembers a turn's writes, as it should. */
let testNo = 0;

beforeEach(async () => {
  testNo += 1;
  await seedShop();
});

const holdsFor = (phone: string) =>
  db.reservation.findMany({
    where: { phone: { contains: phone.slice(2) } },
    select: { code: true, status: true },
  });

describe("who may call it", () => {
  it("answers 503 when no secret is configured, so nothing is exposed by default", async () => {
    const app = createApp({
      db,
      logger,
      config: loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" }),
    });
    await request(app).get("/api/agent/v1/stock").expect(503);
  });

  it("refuses a missing, forged or foreign token, and needs no staff session", async () => {
    const app = createApp({
      db,
      logger,
      config: loadConfig({
        NODE_ENV: "test",
        SESSION_COOKIE_INSECURE: "1",
        AGENT_API_SECRET: SECRET,
      }),
    });
    await request(app).get("/api/agent/v1/stock").expect(401);
    await request(app)
      .get("/api/agent/v1/stock")
      .set("authorization", "Bearer not.atoken")
      .expect(401);
    const foreign = mintAgentToken(
      { waId: ALICE, turn: "t", caps: ALL_ON, writes: true },
      "some-other-secret",
      new Date(),
    );
    await request(app)
      .get("/api/agent/v1/stock")
      .set("authorization", `Bearer ${foreign}`)
      .expect(401);
    // A real token, signed now: through the door, no cookie needed.
    const real = mintAgentToken(
      { waId: ALICE, turn: "t", caps: ALL_ON, writes: true },
      SECRET,
      new Date(),
    );
    await request(app)
      .get("/api/agent/v1/stock")
      .set("authorization", `Bearer ${real}`)
      .expect(200);
  });
});

describe("reading the POS", () => {
  it("answers a stock search with 200 and the units", async () => {
    const res = await request(agentApp)
      .get("/api/agent/v1/stock?query=air%20m2")
      .set("authorization", token(ALICE))
      .expect(200);
    expect(JSON.stringify(res.body)).toContain("SERA");
  });

  it("answers a serial with 200, and an unknown one with 404 and the tool's words", async () => {
    const found = await request(agentApp)
      .get("/api/agent/v1/units/SERA")
      .set("authorization", token(ALICE))
      .expect(200);
    expect(found.body).toMatchObject({ found: true, available: true });
    const missing = await request(agentApp)
      .get("/api/agent/v1/units/NOPE")
      .set("authorization", token(ALICE))
      .expect(404);
    expect(missing.body).toMatchObject({ found: false });
  });

  it("refuses a lookup the shop's switches turned off", async () => {
    await request(agentApp)
      .get("/api/agent/v1/stock")
      .set("authorization", token(ALICE, { caps: { ...ALL_ON, stock: false } }))
      .expect(403);
  });
});

describe("a customer's own data, and only theirs", () => {
  // A visit since 2026-10-27: it holds nothing.
  async function book(who: string, serial: string, body: object = {}) {
    return request(agentApp)
      .post("/api/agent/v1/me/visits")
      .set("authorization", token(who))
      .send({
        when: TOMORROW_3PM,
        serials: serial,
        custName: "Alice",
        ...body,
      });
  }

  it("books under the token's customer, whatever the body says", async () => {
    const res = await book(ALICE, "SERA", {
      phone: BOB,
      from: BOB,
      waId: BOB,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(await holdsFor(ALICE)).toHaveLength(1);
    expect(await holdsFor(BOB)).toHaveLength(0);
  });

  it("shows a customer their holds and nobody else's", async () => {
    await book(ALICE, "SERA");
    const bobs = await request(agentApp)
      .get("/api/agent/v1/me/reservations")
      .set("authorization", token(BOB))
      .expect(200);
    expect(JSON.stringify(bobs.body)).not.toContain("SERA");
    const alices = await request(agentApp)
      .get("/api/agent/v1/me/reservations")
      .set("authorization", token(ALICE))
      .expect(200);
    expect(JSON.stringify(alices.body)).toContain("RV-");
  });

  it("will not let one customer cancel another's hold, even by its code", async () => {
    await book(ALICE, "SERA");
    const { code } = (await holdsFor(ALICE))[0]!;

    await request(agentApp)
      .delete(`/api/agent/v1/me/reservations?code=${encodeURIComponent(code)}`)
      .set("authorization", token(BOB));
    expect((await holdsFor(ALICE))[0]!.status).toBe("TERJADWAL");

    await request(agentApp)
      .delete(`/api/agent/v1/me/reservations?code=${encodeURIComponent(code)}`)
      .set("authorization", token(ALICE))
      .expect(200);
    expect((await holdsFor(ALICE))[0]!.status).toBe("BATAL");
  });

  it("refuses a booking from a caller that may not write", async () => {
    await request(agentApp)
      .post("/api/agent/v1/me/visits")
      .set("authorization", token(ALICE, { writes: false }))
      .send({ when: TOMORROW_3PM, serials: "SERA" })
      .expect(403);
    expect(await holdsFor(ALICE)).toHaveLength(0);
  });

  it("books once per turn, however often the call is retried", async () => {
    const first = await book(ALICE, "SERA");
    const again = await book(ALICE, "SERB");
    expect(first.body).toMatchObject({ ok: true, visit: true });
    expect(again.body).not.toMatchObject({ ok: true });
    expect(await holdsFor(ALICE)).toHaveLength(1);
    // A visit: neither unit left the shelf.
    expect(await db.unit.count({ where: { status: "DIRESERVASI" } })).toBe(0);
  });
});
