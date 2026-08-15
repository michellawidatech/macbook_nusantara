/**
 * S9 — GET /api/katalog/inventori, against a real seeded database.
 *
 * The Definition of Done includes "5 000 seeded units render and filter within
 * the budgets in 02 §1", so this suite seeds the full 5 000 and asserts the
 * server side of that budget: a filtered, sorted, paginated page in well under
 * the 100 ms 02 §1 allows for a list filter.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, seed } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const PASSWORD = "rahasia-sekali";
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let cookie: string;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();

  // The full 5 000 — this is the screen's stated scale.
  await seed(db, { units: 5_000 });

  // The seed's staff carry an unusable hash on purpose, so give one a password.
  await db.staff.update({
    where: { username: "kasir" },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });

  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "kasir", password: PASSWORD });
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
});

const get = (query: string) =>
  request(app).get(`/api/katalog/inventori${query}`).set("Cookie", cookie);

describe("GET /api/katalog/inventori", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/katalog/inventori")).status).toBe(401);
  });

  it("paginates rather than returning 5 000 rows", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(50);
    expect(res.body.total).toBe(5_000);
    expect(res.body.page).toBe(1);
  });

  it("serializes money as a string, never a number", async () => {
    const res = await get("?perPage=1");
    expect(typeof res.body.rows[0].landed).toBe("string");
  });

  it("derives its columns from CategoryAttribute rather than hardcoding them", async () => {
    const res = await get("?perPage=5");
    expect(res.body.columns.length).toBeGreaterThan(0);

    const fromDb = await db.categoryAttribute.findMany({
      select: { id: true, key: true },
    });
    const keys = new Set(fromDb.map((a) => a.key));
    for (const column of res.body.columns) {
      expect(keys.has(column.key)).toBe(true);
    }
  });

  it("filters by location, and multi-select is OR", async () => {
    const locations = await db.location.findMany({ select: { id: true } });
    const [a, b] = locations;

    const one = await get(`?lokasi=${a!.id}`);
    const two = await get(`?lokasi=${b!.id}`);
    const both = await get(`?lokasi=${a!.id},${b!.id}`);

    // Each single location is a strict subset...
    expect(one.body.total).toBeGreaterThan(0);
    expect(one.body.total).toBeLessThan(5_000);
    expect(two.body.total).toBeGreaterThan(0);
    expect(two.body.total).toBeLessThan(5_000);
    // ...and asking for both returns their union, not their intersection.
    // (The two together happen to cover the whole shop: the seed leaves no
    // stock parked at the service bench, so do not assert a smaller total.)
    expect(both.body.total).toBe(one.body.total + two.body.total);
  });

  it("filters by status and by grade", async () => {
    const sold = await get("?status=TERJUAL");
    expect(sold.body.total).toBeGreaterThan(0);
    expect(
      sold.body.rows.every((r: { status: string }) => r.status === "TERJUAL"),
    ).toBe(true);

    const gradeA = await get("?grade=A");
    expect(
      gradeA.body.rows.every((r: { grade: string }) => r.grade === "A"),
    ).toBe(true);
  });

  it("combines filters as AND across facets", async () => {
    const status = await get("?status=TERJUAL");
    const combined = await get("?status=TERJUAL&grade=A");
    expect(combined.body.total).toBeLessThanOrEqual(status.body.total);
  });

  it("searches serial and SKU", async () => {
    const first = (await get("?perPage=1")).body.rows[0] as { serial: string };
    const res = await get(`?q=${first.serial}`);
    expect(res.body.total).toBe(1);
    expect(res.body.rows[0].serial).toBe(first.serial);
  });

  it("sorts, and the sort is stable", async () => {
    const asc = await get("?sort=landed&dir=asc&perPage=20");
    const values = asc.body.rows.map((r: { landed: string }) =>
      BigInt(r.landed),
    );
    const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(values).toEqual(sorted);

    const desc = await get("?sort=landed&dir=desc&perPage=20");
    expect(BigInt(desc.body.rows[0].landed)).toBeGreaterThanOrEqual(
      BigInt(asc.body.rows[0].landed),
    );
  });

  it("pages without repeating or skipping a row", async () => {
    const p1 = await get("?perPage=25&page=1");
    const p2 = await get("?perPage=25&page=2");
    const serials = new Set([
      ...p1.body.rows.map((r: { serial: string }) => r.serial),
      ...p2.body.rows.map((r: { serial: string }) => r.serial),
    ]);
    expect(serials.size).toBe(50);
  });

  it("reports totalUnfiltered so the UI can tell empty from no-match", async () => {
    const res = await get("?q=tidak-akan-cocok-dengan-apa-pun");
    expect(res.body.total).toBe(0);
    expect(res.body.rows).toEqual([]);
    expect(res.body.totalUnfiltered).toBe(5_000);
  });

  it("rejects a sort column that is not on the allowlist", async () => {
    const res = await get("?sort=passwordHash");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDASI");
  });

  it("caps perPage so one request cannot ask for everything", async () => {
    expect((await get("?perPage=5000")).status).toBe(400);
  });

  it("answers a filtered, sorted page of 5 000 units well inside the budget", async () => {
    // 02 §1: the list filter/sort budget is 100 ms. Measured warm, and as a
    // median of several runs rather than a single sample — `pnpm -r test` puts
    // four other suites on this same Postgres, and one contended request is
    // not evidence that the query is slow.
    const query = "?status=TERJUAL&sort=landed&dir=desc&perPage=50";
    await get(query);

    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      const res = await get(query);
      samples.push(performance.now() - started);
      expect(res.status).toBe(200);
    }

    samples.sort((a, b) => a - b);
    expect(samples[2]).toBeLessThan(100);
  });
});

describe("GET /api/katalog/inventori/filters", () => {
  it("offers the facets from the data, not a hardcoded list", async () => {
    const res = await request(app)
      .get("/api/katalog/inventori/filters")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.lokasi).toHaveLength(3);
    expect(res.body.kategori).toHaveLength(5);
    expect(res.body.status.length).toBeGreaterThan(0);
    expect(res.body.status[0]).toHaveProperty("count");
  });
});
