/**
 * The fail-closed contract — 06 §9.1.
 *
 * This is the file that must never be allowed to go green for the wrong
 * reason, so it does two things deliberately:
 *
 *  - **It injects an empty config.** Nothing here reads `process.env`. A
 *    developer with a real `APP_SECRET` exported in their shell must still see
 *    these tests prove that an unconfigured server rejects everything.
 *    CLAUDE.md records that this repo has already been bitten by the opposite.
 *  - **Its database throws on contact.** Every rejection must happen before any
 *    persistence, so the `db` handed in is a proxy that fails the test if the
 *    route touches it. "Returns 401" and "returns 401 without writing anything"
 *    are different guarantees, and only the second one is worth having.
 */

import { Writable } from "node:stream";
import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});
// Level "fatal" plus a black-hole stream: the app still logs, nothing is printed.
const logger = createLogger({
  app: "whatsapp-webhook",
  env: "test",
  level: "fatal",
  destination: sink,
});

/** Any property access is a test failure: nothing may reach the database. */
const noDb = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `the database was touched (${String(prop)}) on a path that must reject first`,
      );
    },
  },
) as PrismaClient;

const BODY = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    { id: "0", changes: [{ field: "messages", value: { messages: [] } }] },
  ],
});

const sign = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("with no APP_SECRET and no VERIFY_TOKEN", () => {
  const app = createApp({ config: loadConfig({}), db: noDb, logger });

  it("refuses the verification handshake with 503 rather than matching an empty token", async () => {
    // The bug this guards: "" === "" would otherwise let anyone register this
    // host as their callback URL.
    const res = await request(app).get(
      "/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=abc",
    );
    expect(res.status).toBe(503);
    expect(res.text).not.toBe("abc");
  });

  it("rejects a correctly signed event with 503, because it cannot check anything", async () => {
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(BODY, "whatever"))
      .send(BODY);
    expect(res.status).toBe(503);
  });

  it("still serves health and the status page", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(200);
  });

  it("does not disclose which secrets are missing on the public status page", async () => {
    // 06 §9.1: advertising `appSecretSet: false` hands an attacker a target.
    const res = await request(app).get("/");
    expect(JSON.stringify(res.body)).not.toMatch(
      /secret|token|appSecret|verifyToken/i,
    );
  });
});

describe("with secrets configured", () => {
  const config = loadConfig({
    APP_SECRET: "s3cr3t",
    VERIFY_TOKEN: "let-me-in",
  });
  const app = createApp({ config, db: noDb, logger });

  it("echoes the challenge verbatim as text/plain on a correct token", async () => {
    const res = await request(app).get(
      "/webhook?hub.mode=subscribe&hub.verify_token=let-me-in&hub.challenge=1158201444",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toBe("1158201444");
  });

  it("rejects the handshake when the token is wrong", async () => {
    const res = await request(app).get(
      "/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc",
    );
    expect(res.status).toBe(403);
  });

  it("rejects the handshake when the mode is not subscribe", async () => {
    const res = await request(app).get(
      "/webhook?hub.mode=unsubscribe&hub.verify_token=let-me-in&hub.challenge=abc",
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unsigned POST with 401, without touching the database", async () => {
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .send(BODY);
    expect(res.status).toBe(401);
  });

  it("rejects a POST whose signature is for different bytes", async () => {
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign('{"object":"something-else"}', "s3cr3t"))
      .send(BODY);
    expect(res.status).toBe(401);
  });

  it("rejects a POST signed with the wrong secret", async () => {
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(BODY, "not-the-secret"))
      .send(BODY);
    expect(res.status).toBe(401);
  });

  it("rejects a garbage signature header of the wrong length", async () => {
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(BODY);
    expect(res.status).toBe(401);
  });
});
