/**
 * S6 — the API skeleton, driven with Supertest against a real database.
 *
 * The Definition of Done names the cases: login success, wrong password, rate
 * limit, logout, revoke-one, revoke-all, an owner-only route rejecting a STAFF
 * token, and a replayed Idempotency-Key returning the stored response without a
 * second write.
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
import { createLoginLimiter } from "../src/auth/rateLimit.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const PASSWORD = "rahasia-sekali";

let db: PrismaClient;
let app: Express;
let clock = Date.parse("2026-08-15T00:00:00Z");

/** The env is injected, never inherited: no test may read a developer .env. */
const config = loadConfig({
  NODE_ENV: "test",
  SESSION_COOKIE_INSECURE: "1",
  LOGIN_MAX_ATTEMPTS: "3",
  LOGIN_WINDOW_MS: "60000",
  LOGIN_BASE_DELAY_MS: "1000",
});

/** Logs go nowhere visible, but the app still writes them. */
const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
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

  const hash = await hashPassword(PASSWORD);
  await db.staff.createMany({
    data: [
      {
        id: "staff_owner",
        username: "pemilik",
        name: "Pemilik",
        role: "OWNER",
        canApprove: true,
        active: true,
        passwordHash: hash,
        createdAt: new Date(),
      },
      {
        id: "staff_kasir",
        username: "kasir",
        name: "Kasir",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: hash,
        createdAt: new Date(),
      },
      {
        id: "staff_nonaktif",
        username: "mantan",
        name: "Mantan",
        role: "STAFF",
        canApprove: false,
        active: false,
        passwordHash: hash,
        createdAt: new Date(),
      },
    ],
  });

  clock = Date.parse("2026-08-15T00:00:00Z");
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
    limiter: createLoginLimiter(config.login, () => clock),
  });
});

/** Log in and return the raw Set-Cookie value for subsequent requests. */
async function login(username = "kasir"): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookies = res.headers["set-cookie"] as unknown as string[];
  return cookies[0]!;
}

describe("public surface", () => {
  it("serves health without a session", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, app: "api" });
  });

  it("returns a request id on every response", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("does not tell an anonymous caller which endpoints exist", async () => {
    // 01 §4: everything but /api/health and /api/auth/* sits behind
    // requireAuth, so an unknown path is 401 rather than 404 — the auth wall
    // comes first, and probing it reveals nothing.
    const res = await request(app).get("/api/tidak-ada");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TIDAK_LOGIN");
  });

  it("answers an unknown endpoint in the error shape, in Indonesian", async () => {
    const cookie = await login();
    const res = await request(app).get("/api/tidak-ada").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TIDAK_DITEMUKAN");
    expect(res.body.error.message).toMatch(/tidak ditemukan/i);
  });
});

describe("password hashing — 08 §9", () => {
  it("really is Argon2id, not bcrypt and not Argon2i", async () => {
    const stored = await db.staff.findUniqueOrThrow({
      where: { username: "kasir" },
    });
    expect(stored.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("salts, so the same password never produces the same hash twice", async () => {
    // Asserted on hashPassword directly: the fixture deliberately reuses one
    // hash across the three staff rows so the suite is not paying for an
    // Argon2 run per row per test.
    const [a, b] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);
    expect(a).not.toBe(b);
    expect(a.startsWith("$argon2id$")).toBe(true);
  });
});

describe("login", () => {
  it("succeeds, and puts the token only in an HttpOnly SameSite=Lax cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({ username: "kasir", role: "STAFF" });

    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toContain("nusantara_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    // The raw token is never in the body, and never in the database.
    expect(JSON.stringify(res.body)).not.toContain("nusantara_token");
    const raw = /nusantara_token=([^;]+)/.exec(cookie)![1]!;
    const stored = await db.staffSession.findFirst();
    expect(stored?.tokenHash).not.toBe(raw);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a wrong password without saying which half was wrong", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: "salah" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TIDAK_LOGIN");
    expect(res.body.error.message).toBe("Nama pengguna atau kata sandi salah.");
    expect(await db.staffSession.count()).toBe(0);
  });

  it("gives an unknown username the identical answer", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "hantu", password: "salah" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Nama pengguna atau kata sandi salah.");
  });

  it("refuses a deactivated account", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "mantan", password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("writes AuditLog(LOGIN_GAGAL) on every failure", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: "salah" });
    await request(app)
      .post("/api/auth/login")
      .send({ username: "hantu", password: "salah" });

    const rows = await db.auditLog.findMany({
      where: { action: "LOGIN_GAGAL" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.entityId).sort()).toEqual([
      "hantu",
      "staff_kasir",
    ]);
  });

  it("validates the body", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDASI");
    expect(res.body.error.field).toBe("username");
  });

  it("rate limits by username and by IP, then lets the delay expire", async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "kasir", password: "salah" });
      expect(res.status).toBe(401);
    }

    const limited = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: "salah" });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("TERLALU_BANYAK");
    expect(limited.headers["retry-after"]).toBeTruthy();

    // Even the correct password is refused while the delay stands.
    const correct = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: PASSWORD });
    expect(correct.status).toBe(429);

    // Progressive delay, not a hard lock: it expires on its own.
    clock += 10 * 60 * 1000;
    const later = await request(app)
      .post("/api/auth/login")
      .send({ username: "kasir", password: PASSWORD });
    expect(later.status).toBe(200);
  });
});

describe("session lifecycle", () => {
  it("rejects a request with no cookie", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TIDAK_LOGIN");
  });

  it("rejects a forged cookie", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", "nusantara_token=palsu-sekali");
    expect(res.status).toBe(401);
  });

  it("identifies the caller", async () => {
    const cookie = await login();
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({ username: "kasir", role: "STAFF" });
  });

  it("logs out, and the cookie stops working immediately", async () => {
    const cookie = await login();

    const out = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(out.status).toBe(204);

    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);

    expect((await db.staffSession.findFirst())?.revokedAt).not.toBeNull();
  });

  it("lists sessions without ever handing out a token hash", async () => {
    const cookie = await login();
    await login(); // a second device

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(
      res.body.sessions.filter((s: { current: boolean }) => s.current),
    ).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
  });

  it("revokes one session and leaves the other alone", async () => {
    const first = await login();
    const second = await login();

    const list = await request(app)
      .get("/api/auth/sessions")
      .set("Cookie", first);
    const other = list.body.sessions.find(
      (s: { current: boolean }) => !s.current,
    ) as {
      id: string;
    };

    const res = await request(app)
      .delete(`/api/auth/sessions/${other.id}`)
      .set("Cookie", first);
    expect(res.status).toBe(204);

    expect(
      (await request(app).get("/api/auth/me").set("Cookie", second)).status,
    ).toBe(401);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", first)).status,
    ).toBe(200);
  });

  it("will not revoke a session belonging to someone else", async () => {
    const kasir = await login("kasir");
    const owner = await login("pemilik");

    const ownerSessions = await request(app)
      .get("/api/auth/sessions")
      .set("Cookie", owner);
    const victim = ownerSessions.body.sessions[0] as { id: string };

    const res = await request(app)
      .delete(`/api/auth/sessions/${victim.id}`)
      .set("Cookie", kasir);
    expect(res.status).toBe(404);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", owner)).status,
    ).toBe(200);
  });

  it("revokes everything — a real log out everywhere", async () => {
    const first = await login();
    const second = await login();

    const res = await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", first);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);

    expect(
      (await request(app).get("/api/auth/me").set("Cookie", first)).status,
    ).toBe(401);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", second)).status,
    ).toBe(401);
  });

  it("stops accepting a session once the staff row is deactivated", async () => {
    const cookie = await login();
    await db.staff.update({
      where: { id: "staff_kasir" },
      data: { active: false },
    });
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });

  it("stops accepting a session past its absolute expiry", async () => {
    const cookie = await login();
    await db.staffSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });
});

describe("authorisation is server-side, per endpoint", () => {
  it("rejects a STAFF token on an owner-only route", async () => {
    const cookie = await login("kasir");
    const res = await request(app)
      .get("/api/kontrol/audit")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AKSES_DITOLAK");
  });

  it("admits the owner to the same route", async () => {
    const cookie = await login("pemilik");
    const res = await request(app)
      .get("/api/kontrol/audit")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("rejects an anonymous caller before it even considers the role", async () => {
    const res = await request(app).get("/api/kontrol/audit");
    expect(res.status).toBe(401);
  });
});

describe("Idempotency-Key — 08 §3", () => {
  it("replays the stored response without acting a second time", async () => {
    const first = await login();
    await login(); // two live sessions

    const key = "checkout-double-click-1";

    const one = await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", first)
      .set("Idempotency-Key", key);
    expect(one.status).toBe(200);
    expect(one.body.revoked).toBe(2);
    expect(one.headers["idempotent-replay"]).toBeUndefined();

    // Re-login so the replay is not merely an auth failure.
    const fresh = await login();

    const two = await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", fresh)
      .set("Idempotency-Key", key);

    expect(two.status).toBe(200);
    expect(two.headers["idempotent-replay"]).toBe("true");
    // The stored answer, not a fresh one: acting again would have said 1.
    expect(two.body.revoked).toBe(2);

    // And the second call really did nothing — the new session still works.
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", fresh)).status,
    ).toBe(200);

    expect(await db.idempotencyKey.count()).toBe(1);
  });

  it("refuses the same key used for a different request", async () => {
    const cookie = await login();
    const key = "sama-tapi-beda";

    await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", cookie)
      .set("Idempotency-Key", key);

    const fresh = await login();
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", fresh)
      .set("Idempotency-Key", key);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KONFLIK");
  });

  it("leaves requests without the header alone", async () => {
    const cookie = await login();
    const res = await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(await db.idempotencyKey.count()).toBe(0);
  });

  it("scopes a key to the staff member who used it", async () => {
    const kasir = await login("kasir");
    const owner = await login("pemilik");
    const key = "kunci-bersama";

    await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", kasir)
      .set("Idempotency-Key", key);
    const res = await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", owner)
      .set("Idempotency-Key", key);

    // The owner gets their own answer, not the cashier's.
    expect(res.headers["idempotent-replay"]).toBeUndefined();
    expect(await db.idempotencyKey.count()).toBe(2);
  });
});
