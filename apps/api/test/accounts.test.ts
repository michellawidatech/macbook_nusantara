/**
 * The app's own sign-in (owner ask 2026-09-18), driven with Supertest against a
 * real database: the forced first change, the owner's account screen, and the
 * `accounts` seeder.
 *
 * "Initially all will be 'password', then in the first time login need to
 * change their password and Ersen can manage all the password account."
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, UNUSABLE_PASSWORD_HASH } from "@nusantara/db";
import { INITIAL_PASSWORD } from "@nusantara/domain";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword, verifyPassword } from "../src/auth/credentials.js";
import { createLoginLimiter } from "../src/auth/rateLimit.js";
import { seedAccounts } from "../src/cli/seed-accounts.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

/** What the owner and the settled cashier chose for themselves. */
const CHOSEN = "kopi-susu-gula-aren";

let db: PrismaClient;
let app: Express;
let initialHash: string;
let chosenHash: string;

const config = loadConfig({
  NODE_ENV: "test",
  SESSION_COOKIE_INSECURE: "1",
  LOGIN_MAX_ATTEMPTS: "3",
  LOGIN_WINDOW_MS: "60000",
  LOGIN_BASE_DELAY_MS: "1000",
});

const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  // Two Argon2 runs for the whole file, not two per test.
  [initialHash, chosenHash] = await Promise.all([
    hashPassword(INITIAL_PASSWORD),
    hashPassword(CHOSEN),
  ]);
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT quote_ident(tablename) AS t FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`,
  );
  const now = new Date();
  const row = (
    id: string,
    username: string,
    name: string,
    role: "OWNER" | "STAFF",
    passwordHash: string,
    mustChangePassword: boolean,
  ) => ({
    id,
    username,
    name,
    role,
    canApprove: role === "OWNER",
    active: true,
    passwordHash,
    mustChangePassword,
    createdAt: now,
  });
  await db.staff.createMany({
    data: [
      row("s_ersen", "ersen", "Ersen", "OWNER", chosenHash, false),
      row("s_kasir", "kasir", "Kasir", "STAFF", chosenHash, false),
      row("s_baru", "baru", "Anak Baru", "STAFF", initialHash, true),
      // A service account: listed nowhere, resettable by nobody.
      {
        ...row(
          "staff_agent",
          "agent",
          "Agen WhatsApp",
          "STAFF",
          UNUSABLE_PASSWORD_HASH,
          false,
        ),
        active: false,
      },
    ],
  });

  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
    limiter: createLoginLimiter(config.login, () => Date.now()),
  });
});

async function login(username: string, password: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password });
  expect(res.status).toBe(200);
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

describe("the first sign-in", () => {
  it("lets an account on the initial password in, and says it must change", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "baru", password: INITIAL_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({
      username: "baru",
      mustChangePassword: true,
    });
  });

  it("answers every business route with GANTI_SANDI until it has", async () => {
    const cookie = await login("baru", INITIAL_PASSWORD);
    for (const path of ["/api/store", "/api/inbox", "/api/staff"]) {
      const res = await request(app).get(path).set("Cookie", cookie);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("GANTI_SANDI");
    }
    // Who am I still works — it is how the SPA knows which screen to show.
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.staff.mustChangePassword).toBe(true);
  });

  it("refuses the wrong current password, as a validation error not a sign-out", async () => {
    const cookie = await login("baru", INITIAL_PASSWORD);
    const res = await request(app)
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .send({ currentPassword: "tebakan", newPassword: CHOSEN });
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("currentPassword");
    const audit = await db.auditLog.findMany({
      where: { action: "LOGIN_GAGAL", field: "passwordHash" },
    });
    expect(audit).toHaveLength(1);
  });

  it.each([
    ["the initial password again", "PASSWORD"],
    ["something too short", "kopi"],
    ["the username inside it", "baru-2026-ok"],
    ["a blocklisted favourite", "bismillah123"],
  ])("refuses %s", async (_label, newPassword) => {
    const cookie = await login("baru", INITIAL_PASSWORD);
    const res = await request(app)
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword });
    expect(res.status).toBe(400);
    expect(res.body.error.field).toBe("newPassword");
  });

  it("changes it, rotates the session and signs every other device out", async () => {
    const here = await login("baru", INITIAL_PASSWORD);
    const elsewhere = await login("baru", INITIAL_PASSWORD);

    const res = await request(app)
      .post("/api/auth/password")
      .set("Cookie", here)
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: CHOSEN });
    expect(res.status).toBe(200);
    expect(res.body.staff.mustChangePassword).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("argon2");

    const rotated = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(rotated).not.toBe(here);

    // Both old cookies are dead; the new one reaches the business routes.
    for (const old of [here, elsewhere]) {
      expect(
        (await request(app).get("/api/auth/me").set("Cookie", old)).status,
      ).toBe(401);
    }
    expect(
      (await request(app).get("/api/inbox").set("Cookie", rotated)).status,
    ).toBe(200);

    // The new password signs in; the shared one no longer does.
    await login("baru", CHOSEN);
    const shared = await request(app)
      .post("/api/auth/login")
      .send({ username: "baru", password: INITIAL_PASSWORD });
    expect(shared.status).toBe(401);

    const audit = await db.auditLog.findMany({
      where: { action: "UPDATE", field: "passwordHash", entityId: "s_baru" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toBeNull();
    expect(audit[0]!.after).toBeNull();
  });

  it("never remembers a password in the idempotency table", async () => {
    const cookie = await login("baru", INITIAL_PASSWORD);
    await request(app)
      .post("/api/auth/password")
      .set("Cookie", cookie)
      .set("Idempotency-Key", "dobel-klik")
      .send({ currentPassword: INITIAL_PASSWORD, newPassword: CHOSEN });
    expect(await db.idempotencyKey.count()).toBe(0);
  });
});

describe("signing in", () => {
  it("audits a success, not just a failure", async () => {
    await login("kasir", CHOSEN);
    const rows = await db.auditLog.findMany({ where: { action: "LOGIN" } });
    expect(rows.map((r) => r.entityId)).toEqual(["s_kasir"]);
  });

  it("forgives the capital a phone keyboard puts on the first letter", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "Kasir ", password: CHOSEN });
    expect(res.status).toBe(200);
    expect(res.body.staff.username).toBe("kasir");
  });
});

describe("the owner's account screen", () => {
  it("is the owner's alone", async () => {
    const cookie = await login("kasir", CHOSEN);
    const res = await request(app).get("/api/staff").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AKSES_DITOLAK");
  });

  it("lists people, never a service account and never a hash", async () => {
    const cookie = await login("ersen", CHOSEN);
    const res = await request(app).get("/api/staff").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const names = (res.body.accounts as Array<{ username: string }>).map(
      (a) => a.username,
    );
    expect(names.sort()).toEqual(["baru", "ersen", "kasir"]);
    expect(JSON.stringify(res.body)).not.toContain("argon2");
    expect(res.body.accounts[0]).toHaveProperty("hasPassword", true);
  });

  it("adds a person on the initial password, who must change it", async () => {
    const cookie = await login("ersen", CHOSEN);
    const res = await request(app)
      .post("/api/staff")
      .set("Cookie", cookie)
      .send({ username: "Mila", name: "Mila", role: "STAFF" });
    expect(res.status).toBe(201);
    expect(res.body.account).toMatchObject({
      username: "mila",
      mustChangePassword: true,
      hasPassword: true,
    });

    const first = await request(app)
      .post("/api/auth/login")
      .send({ username: "mila", password: INITIAL_PASSWORD });
    expect(first.body.staff.mustChangePassword).toBe(true);

    const again = await request(app)
      .post("/api/staff")
      .set("Cookie", cookie)
      .send({ username: "mila", name: "Mila Dua" });
    expect(again.status).toBe(409);

    const service = await request(app)
      .post("/api/staff")
      .set("Cookie", cookie)
      .send({ username: "agent", name: "Bukan Agen" });
    expect(service.status).toBe(400);

    const bad = await request(app)
      .post("/api/staff")
      .set("Cookie", cookie)
      .send({ username: "a b", name: "Spasi" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.field).toBe("username");
  });

  it("resets somebody back to the initial password and signs them out", async () => {
    const owner = await login("ersen", CHOSEN);
    const cashier = await login("kasir", CHOSEN);

    const res = await request(app)
      .post("/api/staff/s_kasir/reset-password")
      .set("Cookie", owner);
    expect(res.status).toBe(200);
    expect(res.body.account.mustChangePassword).toBe(true);

    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cashier)).status,
    ).toBe(401);
    const back = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: INITIAL_PASSWORD });
    expect(back.body.staff.mustChangePassword).toBe(true);
    const old = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: CHOSEN });
    expect(old.status).toBe(401);

    const row = await db.staff.findUniqueOrThrow({ where: { id: "s_kasir" } });
    expect(await verifyPassword(row.passwordHash, INITIAL_PASSWORD)).toBe(true);
  });

  it("will not reset its own account, or a service account", async () => {
    const owner = await login("ersen", CHOSEN);
    const self = await request(app)
      .post("/api/staff/s_ersen/reset-password")
      .set("Cookie", owner);
    expect(self.status).toBe(400);
    const agent = await request(app)
      .post("/api/staff/staff_agent/reset-password")
      .set("Cookie", owner);
    expect(agent.status).toBe(404);
  });

  it("deactivates, which ends the person's sessions at once", async () => {
    const owner = await login("ersen", CHOSEN);
    const cashier = await login("kasir", CHOSEN);

    const res = await request(app)
      .patch("/api/staff/s_kasir")
      .set("Cookie", owner)
      .send({ active: false });
    expect(res.status).toBe(200);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cashier)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ username: "kasir", password: CHOSEN })
      ).status,
    ).toBe(401);
    const audit = await db.auditLog.findMany({
      where: { action: "ARCHIVE", entityId: "s_kasir" },
    });
    expect(audit).toHaveLength(1);
  });

  it("will not let the owner demote or deactivate themselves", async () => {
    const owner = await login("ersen", CHOSEN);
    for (const body of [{ active: false }, { role: "STAFF" }]) {
      const res = await request(app)
        .patch("/api/staff/s_ersen")
        .set("Cookie", owner)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it("makes an owner an approver, always", async () => {
    const owner = await login("ersen", CHOSEN);
    const res = await request(app)
      .patch("/api/staff/s_kasir")
      .set("Cookie", owner)
      .send({ role: "OWNER", canApprove: false });
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ role: "OWNER", canApprove: true });
  });
});

describe("the accounts seeder", () => {
  beforeEach(async () => {
    const now = new Date();
    await db.salesperson.createMany({
      data: [
        {
          id: "sp-1",
          name: "Ersen",
          active: true,
          sortOrder: 1,
          createdAt: now,
        },
        {
          id: "sp-2",
          name: "Mila",
          active: true,
          sortOrder: 2,
          createdAt: now,
        },
        {
          id: "sp-3",
          name: "Rini",
          active: true,
          sortOrder: 3,
          createdAt: now,
        },
        {
          id: "sp-4",
          name: "Rizal",
          active: false,
          sortOrder: 4,
          createdAt: now,
        },
      ],
    });
    // A seeded human with the placeholder, the way packages/db's seed leaves one.
    await db.staff.create({
      data: {
        id: "s_ayu",
        username: "ayu",
        name: "Ayu",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        createdAt: new Date(),
      },
    });
  });

  it("gives every active salesperson a login, opens the locked ones, and names the owner", async () => {
    const lines = await seedAccounts(
      db,
      { owner: "rini", dryRun: false },
      initialHash,
    );
    const by = new Map(lines.map((l) => [l.username, l]));

    // Ersen already has an account of the same name; Rizal is inactive.
    expect(by.get("mila")).toMatchObject({ action: "dibuat", role: "STAFF" });
    expect(by.get("rini")).toMatchObject({ action: "dibuat", role: "OWNER" });
    expect(by.has("rizal")).toBe(false);
    expect(by.get("ayu")?.action).toBe("diberi kata sandi awal");
    expect(by.get("ersen")?.action).toBe("tetap");
    expect(by.has("agent")).toBe(false);

    const mila = await db.staff.findUniqueOrThrow({
      where: { username: "mila" },
    });
    expect(mila.mustChangePassword).toBe(true);
    const ayu = await db.staff.findUniqueOrThrow({
      where: { username: "ayu" },
    });
    expect(await verifyPassword(ayu.passwordHash, INITIAL_PASSWORD)).toBe(true);

    // The service account and the chosen passwords were not touched.
    const agent = await db.staff.findUniqueOrThrow({
      where: { username: "agent" },
    });
    expect(agent.passwordHash).toBe(UNUSABLE_PASSWORD_HASH);
    const ersen = await db.staff.findUniqueOrThrow({
      where: { username: "ersen" },
    });
    expect(await verifyPassword(ersen.passwordHash, CHOSEN)).toBe(true);
  });

  it("changes nothing the second time", async () => {
    await seedAccounts(db, { owner: "rini", dryRun: false }, initialHash);
    const again = await seedAccounts(
      db,
      { owner: "rini", dryRun: false },
      initialHash,
    );
    expect(again.every((l) => l.action === "tetap")).toBe(true);
  });

  it("writes nothing on a dry run", async () => {
    const before = await db.staff.count();
    const lines = await seedAccounts(
      db,
      { owner: "rini", dryRun: true },
      initialHash,
    );
    expect(lines.some((l) => l.action === "dibuat")).toBe(true);
    expect(await db.staff.count()).toBe(before);
  });
});
