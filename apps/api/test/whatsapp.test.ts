/**
 * /api/whatsapp/connection (2026-10-22): the owner's door to the linked
 * device, proxied to a FAKE gateway on loopback — a real HTTP server that
 * answers the way apps/wa-gateway does — against a real database for the
 * session and the audit lines.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
const SECRET = "gateway-secret-for-api-tests";
const sink = new Writable({ write: (_c, _e, cb) => cb() });
const logger = createLogger({ app: "api", env: "test", destination: sink });

/** What the fake gateway will say next, and what it was asked. */
const fake = {
  state: "DISCONNECTED" as string,
  linkStatus: 200,
  seen: [] as Array<{ method: string; path: string; secret: string }>,
};
let gateway: Server;
let gatewayUrl: string;

let db: PrismaClient;
let app: Express;
let ownerCookie: string;
let staffCookie: string;

function appWith(env: Record<string, string>): Express {
  return createApp({
    db,
    config: loadConfig({
      NODE_ENV: "test",
      SESSION_COOKIE_INSECURE: "1",
      ...env,
    }),
    logger,
  });
}

async function login(username: string, role: "OWNER" | "STAFF") {
  await db.staff.upsert({
    where: { username },
    update: { passwordHash: await hashPassword(PASSWORD), active: true, role },
    create: {
      username,
      name: username,
      role,
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

beforeAll(async () => {
  gateway = createServer((req, res) => {
    const secret = String(req.headers["x-wa-gateway-secret"] ?? "");
    fake.seen.push({ method: req.method ?? "", path: req.url ?? "", secret });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (secret !== SECRET)
      return send(401, { error: { code: "UNAUTHORIZED" } });
    const limit = { max: 3, windowMinutes: 60, remaining: 2, resetAt: null };
    if (req.url === "/status") {
      return send(200, {
        state: fake.state,
        ...(fake.state === "CONNECTED"
          ? { number: "+628111222333", since: "2026-10-22T03:00:00.000Z" }
          : {}),
        ...(fake.state === "WAITING_FOR_SCAN"
          ? { qr: "data:image/png;base64,QR" }
          : {}),
        limit,
      });
    }
    if (req.url === "/link") {
      if (fake.linkStatus === 409)
        return send(409, { error: { code: "CONNECTED" } });
      if (fake.linkStatus === 429)
        return send(429, {
          error: { code: "RATE_LIMITED", retryAfterSec: 1_800 },
        });
      fake.state = "CONNECTING";
      return send(200, { state: "CONNECTING", limit });
    }
    if (req.url === "/logout") {
      fake.state = "DISCONNECTED";
      return send(200, { state: "DISCONNECTED", limit });
    }
    send(404, {});
  });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;

  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = appWith({ WA_GATEWAY_URL: gatewayUrl, WA_GATEWAY_SECRET: SECRET });
  ownerCookie = await login("wa-owner", "OWNER");
  staffCookie = await login("wa-staff", "STAFF");
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entity: "WhatsApp" } });
  await db.$disconnect();
  await new Promise<void>((r) => gateway.close(() => r()));
});

beforeEach(async () => {
  fake.state = "DISCONNECTED";
  fake.linkStatus = 200;
  fake.seen = [];
  await db.auditLog.deleteMany({ where: { entity: "WhatsApp" } });
});

describe("who may see it", () => {
  it("is the owner's: staff get 403 and the gateway is never asked", async () => {
    const res = await request(app)
      .get("/api/whatsapp/connection")
      .set("cookie", staffCookie);
    expect(res.status).toBe(403);
    const link = await request(app)
      .post("/api/whatsapp/connection/link")
      .set("cookie", staffCookie);
    expect(link.status).toBe(403);
    expect(fake.seen).toEqual([]);
  });

  it("is nobody's without a session", async () => {
    expect((await request(app).get("/api/whatsapp/connection")).status).toBe(
      401,
    );
  });
});

describe("the status", () => {
  it("passes the gateway's answer through, with the secret added", async () => {
    fake.state = "CONNECTED";
    const res = await request(app)
      .get("/api/whatsapp/connection")
      .set("cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      gateway: "OK",
      state: "CONNECTED",
      number: "+628111222333",
    });
    expect(fake.seen[0]).toEqual({
      method: "GET",
      path: "/status",
      secret: SECRET,
    });
  });

  it("says NOT_CONFIGURED on a shop with no gateway", async () => {
    const plain = appWith({});
    const cookie = await (async () => {
      const r = await request(plain)
        .post("/api/auth/login")
        .send({ username: "wa-owner", password: PASSWORD });
      return (r.headers["set-cookie"] as unknown as string[])[0]!;
    })();
    const res = await request(plain)
      .get("/api/whatsapp/connection")
      .set("cookie", cookie);
    expect(res.body).toEqual({ gateway: "NOT_CONFIGURED" });
    const link = await request(plain)
      .post("/api/whatsapp/connection/link")
      .set("cookie", cookie);
    expect(link.status).toBe(503);
    expect(link.body.error.code).toBe("GATEWAY_MATI");
  });

  it("says UNREACHABLE when the gateway is not running", async () => {
    const down = appWith({
      WA_GATEWAY_URL: "http://127.0.0.1:9",
      WA_GATEWAY_SECRET: SECRET,
    });
    const r = await request(down)
      .post("/api/auth/login")
      .send({ username: "wa-owner", password: PASSWORD });
    const cookie = (r.headers["set-cookie"] as unknown as string[])[0]!;
    const res = await request(down)
      .get("/api/whatsapp/connection")
      .set("cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ gateway: "UNREACHABLE" });
  });

  it("reports a secret the gateway refused as the gateway refusing", async () => {
    const wrong = appWith({
      WA_GATEWAY_URL: gatewayUrl,
      WA_GATEWAY_SECRET: "not-the-secret",
    });
    const r = await request(wrong)
      .post("/api/auth/login")
      .send({ username: "wa-owner", password: PASSWORD });
    const cookie = (r.headers["set-cookie"] as unknown as string[])[0]!;
    const res = await request(wrong)
      .get("/api/whatsapp/connection")
      .set("cookie", cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GATEWAY_MATI");
  });
});

describe("linking and unlinking", () => {
  it("asks the gateway for a QR and audits the request as CREATE", async () => {
    const res = await request(app)
      .post("/api/whatsapp/connection/link")
      .set("cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gateway: "OK", state: "CONNECTING" });
    const rows = await db.auditLog.findMany({ where: { entity: "WhatsApp" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "CREATE", entityId: "connection" });
  });

  it("passes the one-session refusal through as 409, and writes nothing", async () => {
    fake.linkStatus = 409;
    const res = await request(app)
      .post("/api/whatsapp/connection/link")
      .set("cookie", ownerCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KONFLIK");
    expect(await db.auditLog.count({ where: { entity: "WhatsApp" } })).toBe(0);
  });

  it("passes the ration through as 429 with Retry-After", async () => {
    fake.linkStatus = 429;
    const res = await request(app)
      .post("/api/whatsapp/connection/link")
      .set("cookie", ownerCookie);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("1800");
    expect(res.body.error.message).toMatch(/30 menit/);
  });

  it("unlinks and audits DELETE naming the number", async () => {
    fake.state = "CONNECTED";
    const res = await request(app)
      .post("/api/whatsapp/connection/logout")
      .set("cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("DISCONNECTED");
    const row = await db.auditLog.findFirstOrThrow({
      where: { entity: "WhatsApp" },
    });
    expect(row.action).toBe("DELETE");
    expect(JSON.parse(row.before ?? "{}")).toEqual({ number: "+628111222333" });
  });
});
