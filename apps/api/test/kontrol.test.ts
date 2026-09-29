/**
 * GET /api/kontrol/audit, against a real seeded database.
 *
 * The route existed from S6 and answered `{ entries: [] }` unconditionally.
 * The guard around it was tested (auth.test.ts still owns the 401/403/200);
 * the body was not, because there was nothing to assert. These are the cases
 * that stub could not have passed.
 *
 * Rows are written directly here rather than by exercising the three writers.
 * That is deliberate: what is under test is the reader — its ordering, paging
 * and filters — and driving it through login attempts would fix the shape of
 * the data to whatever those writers happen to record today.
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

/** Fixed instants, so ordering and range assertions do not depend on the clock. */
const T = (iso: string) => new Date(iso);
const DAY1 = "2026-08-30T02:00:00.000Z";
const DAY2 = "2026-08-31T02:00:00.000Z";
const DAY3 = "2026-09-01T02:00:00.000Z";

let db: PrismaClient;
let app: Express;
let cookie: string;
let ownerId: string;

const get = (query = "") =>
  request(app).get(`/api/kontrol/audit${query}`).set("Cookie", cookie);

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();

  // Shape only — this suite is about AuditLog, which the seed does not fill.
  await seed(db, { referenceOnly: true });

  const owner = await db.staff.update({
    where: { username: "pemilik" },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  ownerId = owner.id;

  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "pemilik", password: PASSWORD });
  // Say why, if it ever fails: once in a full run this read only "Cannot read
  // properties of undefined", and it never happened again (2026-09-18).
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;

  // A successful sign-in is audited too (2026-09-18). This suite's own one is
  // taken back out, so the four rows below are the whole log it reads.
  await db.auditLog.deleteMany({ where: { action: "LOGIN" } });

  await db.auditLog.createMany({
    data: [
      {
        at: T(DAY1),
        staffId: ownerId,
        entity: "Staff",
        entityId: "budi",
        action: "LOGIN_GAGAL",
        requestId: "req-aaa",
        ip: "10.0.0.1",
      },
      {
        at: T(DAY2),
        staffId: ownerId,
        entity: "Order",
        entityId: "SI-2026/08-000001",
        action: "CREATE",
        requestId: "req-bbb",
        ip: "10.0.0.2",
      },
      {
        at: T(DAY2),
        staffId: null,
        entity: "Order",
        entityId: "SI-2026/08-000001",
        action: "UPDATE",
        field: "status",
        before: "BARU",
        after: "LUNAS",
        requestId: "req-ccc",
        ip: null,
      },
      {
        at: T(DAY3),
        staffId: ownerId,
        entity: "Unit",
        entityId: "SBJ347203KL",
        action: "ARCHIVE",
        requestId: "req-ddd",
        ip: "10.0.0.3",
      },
    ],
  });
}, 180_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/kontrol/audit", () => {
  it("returns the rows that are actually there", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    // The stub's answer. If this ever passes again the route has regressed.
    expect(res.body.entries).not.toEqual([]);
    expect(res.body.total).toBe(4);
    expect(res.body.entries).toHaveLength(4);
  });

  it("orders newest first", async () => {
    const { body } = await get();
    const at: string[] = body.entries.map((e: { at: string }) => e.at);
    expect(at).toEqual([...at].sort().reverse());
    expect(at[0]).toBe(new Date(DAY3).toISOString());
  });

  it("carries the whole row, with dates as ISO strings", async () => {
    const { body } = await get("?action=UPDATE");
    const entry = body.entries[0];
    expect(entry).toMatchObject({
      entity: "Order",
      entityId: "SI-2026/08-000001",
      action: "UPDATE",
      field: "status",
      before: "BARU",
      after: "LUNAS",
      requestId: "req-ccc",
      ip: null,
    });
    expect(entry.at).toBe(new Date(DAY2).toISOString());
  });

  it("joins the staff who acted, and tolerates a row with none", async () => {
    const { body } = await get("?entity=Order");
    const byAction = Object.fromEntries(
      body.entries.map((e: { action: string; staff: unknown }) => [
        e.action,
        e.staff,
      ]),
    );
    expect(byAction["CREATE"]).toMatchObject({
      id: ownerId,
      username: "pemilik",
    });
    // staffId is nullable — a system write, or an account since removed.
    expect(byAction["UPDATE"]).toBeNull();
  });

  it("filters by entity and by one particular row", async () => {
    expect((await get("?entity=Order")).body.total).toBe(2);
    expect(
      (await get("?entity=Order&entityId=SI-2026%2F08-000001")).body.total,
    ).toBe(2);
    expect((await get("?entity=Order&entityId=nope")).body.total).toBe(0);
  });

  it("takes several actions at once", async () => {
    const { body } = await get("?action=CREATE,ARCHIVE");
    expect(body.total).toBe(2);
    expect(
      body.entries.map((e: { action: string }) => e.action).sort(),
    ).toEqual(["ARCHIVE", "CREATE"]);
  });

  it("filters by the staff who acted", async () => {
    expect((await get(`?staffId=${ownerId}`)).body.total).toBe(3);
  });

  it("treats the date range as half-open, so adjacent days never double-count", async () => {
    // `to` is exclusive: DAY2's rows belong to [DAY2, DAY3) and to nothing else.
    const earlier = await get(`?from=${DAY1}&to=${DAY2}`);
    const later = await get(`?from=${DAY2}&to=${DAY3}`);
    expect(earlier.body.total).toBe(1);
    expect(later.body.total).toBe(2);
    expect((await get(`?from=${DAY1}&to=${DAY3}`)).body.total).toBe(3);
  });

  it("searches the three ids a reader actually has", async () => {
    expect((await get("?q=req-ddd")).body.total).toBe(1);
    expect((await get("?q=SI-2026")).body.total).toBe(2);
    // Case-insensitive: an entity name typed in lower case still finds it.
    expect((await get("?q=order")).body.total).toBe(2);
  });

  it("pages, and reports the total beyond the page", async () => {
    const first = await get("?perPage=2");
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.total).toBe(4);
    expect(first.body.page).toBe(1);

    const second = await get("?perPage=2&page=2");
    expect(second.body.entries).toHaveLength(2);

    const ids = [...first.body.entries, ...second.body.entries].map(
      (e: { id: string }) => e.id,
    );
    // No row appears on both pages — the id tiebreak earning its keep, since
    // two of these four share an `at` to the millisecond.
    expect(new Set(ids).size).toBe(4);
  });

  it("refuses a filter it does not understand rather than ignoring it", async () => {
    const res = await get("?action=DIHAPUS");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDASI");
  });

  it("refuses a backwards date range", async () => {
    const res = await get(`?from=${DAY3}&to=${DAY1}`);
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("from");
  });
});
