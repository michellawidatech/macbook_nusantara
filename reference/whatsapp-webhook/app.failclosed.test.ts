import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mockDb } from "./test/harness.js";

/**
 * Fail-closed contract for the public webhook.
 *
 * app.test.ts sets APP_SECRET/VERIFY_TOKEN before importing the app, so it only
 * ever exercises the *configured* branch. These tests import a fresh module
 * graph with the secrets UNSET — the state that used to skip HMAC verification
 * entirely and let `?hub.verify_token=` satisfy `"" === ""`.
 */

async function appWithoutSecrets() {
  vi.resetModules();
  // Set to "" rather than delete: re-importing the app re-runs config.ts, which
  // calls process.loadEnvFile() on apps/whatsapp-webhook/.env. Deleting the keys
  // lets that file put them straight back, so on any machine with a real .env
  // these tests silently exercised the *configured* branch and saw 401/403
  // instead of 503. loadEnvFile does not overwrite an already-set var, and ""
  // counts as set, so this pins the unset state without depending on the disk.
  process.env.APP_SECRET = "";
  process.env.VERIFY_TOKEN = "";
  mockDb();
  const { createApp } = await import("./app.js");
  return createApp();
}

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "e1",
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              { from: "628999", id: "wamid.forged", timestamp: "1700000000", type: "text", text: { body: "hi" } },
            ],
          },
        },
      ],
    },
  ],
};

describe("webhook fails closed when APP_SECRET is unset", () => {
  it("rejects an unsigned POST instead of processing it", async () => {
    const app = await appWithoutSecrets();

    const res = await request(app).post("/webhook").send(payload);

    expect(res.status).toBe(503);
    expect(res.text).toMatch(/app secret/i);
  });

  it("rejects a POST carrying a bogus signature", async () => {
    const app = await appWithoutSecrets();

    const res = await request(app)
      .post("/webhook")
      .set("x-hub-signature-256", "sha256=deadbeef")
      .send(payload);

    expect(res.status).toBe(503);
  });
});

describe("verification handshake fails closed when VERIFY_TOKEN is unset", () => {
  it("does not echo the challenge for an empty hub.verify_token", async () => {
    const app = await appWithoutSecrets();

    const res = await request(app)
      .get("/webhook")
      .query({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "PWNED" });

    expect(res.status).toBe(503);
    expect(res.text).not.toContain("PWNED");
  });
});

describe("public status page", () => {
  it("does not advertise which secrets are configured", async () => {
    const app = await appWithoutSecrets();

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    for (const key of ["appSecretSet", "verifyTokenSet", "canSend", "agentEnabled", "agentAuth"]) {
      expect(res.body).not.toHaveProperty(key);
    }
  });
});
