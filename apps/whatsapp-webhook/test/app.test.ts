/**
 * The happy path, against a real database — 06 §9.3 and §9.4.
 *
 * Three things the fail-closed file cannot prove, because they all require
 * something to actually be written:
 *
 *  - a correctly signed event is acked with 200 and then persisted;
 *  - a redelivery of the identical event creates no second row (Meta retries
 *    for ~36 hours, so this is the difference between one reply and three);
 *  - a delivery-status callback is stored raw and produces no message.
 *
 * ## Why nothing here asserts a global row count
 *
 * The route acks BEFORE it persists — that is the contract (§9.3) — so the
 * write lands after the response, on a later tick. A `count(*)` assertion is
 * therefore racing two things at once: this test's own out-of-band write, and
 * any still-in-flight write from the previous test that a `beforeEach` DELETE
 * has already run past. It also races the other suites in this repo, because
 * `apps/api` truncates the whole public schema of the SAME database between its
 * cases.
 *
 * So every case here owns a unique message id and asserts on ITS rows. That is
 * both robust and a better description of the guarantee: "this delivery created
 * exactly one message", not "the table has one row in it".
 */

import { Writable } from "node:stream";
import { createHmac, randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { extractMessages } from "../src/persist.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const APP_SECRET = "test-app-secret";

/** Injected, never inherited — no test may read a developer .env (01 §7). */
const config = loadConfig({ APP_SECRET, VERIFY_TOKEN: "test-verify-token" });

const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});
const logger = createLogger({
  app: "whatsapp-webhook",
  env: "test",
  level: "fatal",
  destination: sink,
});

let db: PrismaClient;
let app: Express;

/** A message id no other test or suite can collide with. */
const newId = () => `wamid.TEST.${randomUUID()}`;

/** A WhatsApp text message envelope, exactly as Meta shapes it. */
function messageEvent(id: string, text: string, from = "628123456789") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "628", phone_number_id: "0" },
              contacts: [{ profile: { name: "Test Customer" }, wa_id: from }],
              messages: [
                {
                  from,
                  id,
                  timestamp: "1760000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * POST a payload the way Meta would.
 *
 * The body is serialised ONCE and both signed and sent as that exact string —
 * signing an object and letting supertest re-serialise it is the classic way to
 * write a test that fails for the wrong reason (06 §9.2).
 */
async function post(
  payload: unknown,
  secret: string | null = APP_SECRET,
  target = app,
) {
  const body = JSON.stringify(payload);
  const req = request(target)
    .post("/webhook")
    .set("Content-Type", "application/json");
  if (secret !== null) {
    req.set(
      "X-Hub-Signature-256",
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    );
  }
  return req.send(body);
}

/** Poll until `check` is truthy, or give up. Returns the last value seen. */
async function waitFor<T>(
  check: () => Promise<T>,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Settle the post-ack work for one message id, then hand back the row. */
const waitForMessage = (waMessageId: string) =>
  waitFor(() => db.waMessage.findUnique({ where: { waMessageId } }));

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({ config, db, logger });
});

afterAll(async () => {
  // Leave the shared database as we found it. Scoped to this file's own ids so
  // a concurrently running suite's fixtures are not collateral damage.
  await db.waMessage.deleteMany({
    where: { waMessageId: { startsWith: "wamid.TEST." } },
  });
  await db.$disconnect();
});

describe("extractMessages", () => {
  it("pulls out the message, the sender and the profile name", () => {
    const [m] = extractMessages(messageEvent("wamid.A", "ada macbook air m2?"));
    expect(m).toMatchObject({
      waMessageId: "wamid.A",
      from: "628123456789",
      name: "Test Customer",
      text: "ada macbook air m2?",
      msgType: "text",
    });
    expect(m!.ts.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it("yields nothing for an Instagram envelope", () => {
    expect(extractMessages({ object: "instagram", entry: [] })).toEqual([]);
  });

  it("yields nothing for a delivery-status callback", () => {
    const statusOnly = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "0",
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "wamid.A", status: "read", recipient_id: "628" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extractMessages(statusOnly)).toEqual([]);
  });
});

describe("POST /webhook", () => {
  it("acks a signed event with 200 and then stores it", async () => {
    const id = newId();
    const res = await post(messageEvent(id, "halo"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });

    expect(await waitForMessage(id)).toMatchObject({
      from: "628123456789",
      name: "Test Customer",
      text: "halo",
      msgType: "text",
      direction: "IN",
      status: "BARU",
      answeredByAgent: false,
    });
  });

  it("creates no second message when Meta redelivers the identical event", async () => {
    const id = newId();
    const event = messageEvent(id, "halo");

    await post(event);
    await waitForMessage(id);
    const first = (await db.waMessage.findUnique({
      where: { waMessageId: id },
    }))!.id;

    await post(event);
    // Nothing new to wait FOR on a duplicate, so settle the tick the second
    // delivery's write would have used, then prove the row did not change.
    await new Promise((r) => setTimeout(r, 250));

    const rows = await db.waMessage.findMany({ where: { waMessageId: id } });
    expect(rows).toHaveLength(1);
    // Same row, not a replacement: the dedup skipped the insert entirely.
    expect(rows[0]!.id).toBe(first);
  });

  it("calls onInbound once per distinct message, never for a redelivery", async () => {
    const id = newId();
    const seen: string[] = [];
    const hooked = createApp({
      config,
      db,
      logger,
      onInbound: (rows) => seen.push(...rows.map((r) => r.text ?? "")),
    });

    await post(messageEvent(id, "sekali saja"), APP_SECRET, hooked);
    await waitForMessage(id);
    await post(messageEvent(id, "sekali saja"), APP_SECRET, hooked);
    await new Promise((r) => setTimeout(r, 250));

    expect(seen).toEqual(["sekali saja"]);
  });

  it("stores several messages delivered separately", async () => {
    const a = newId();
    const b = newId();
    await post(messageEvent(a, "halo"));
    await post(messageEvent(b, "mau tanya"));

    expect(await waitForMessage(a)).not.toBeNull();
    expect(await waitForMessage(b)).not.toBeNull();
  });

  it("stores a delivery-status callback as a raw event and no message", async () => {
    const before = await db.waRawEvent.count();
    const sender = `62899${Date.now()}`;
    await post({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "0",
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "wamid.X", status: "delivered", recipient_id: sender },
                ],
              },
            },
          ],
        },
      ],
    });

    // The raw event is the only evidence a status callback leaves.
    expect(
      await waitFor(async () => (await db.waRawEvent.count()) > before),
    ).toBe(true);
    expect(await db.waMessage.count({ where: { from: sender } })).toBe(0);
  });

  it("routes an Instagram envelope to IgRawEvent, not to WaMessage", async () => {
    const before = await db.igRawEvent.count();
    const waBefore = await db.waMessage.count();
    await post({
      object: "instagram",
      entry: [
        {
          id: "0",
          changes: [
            {
              field: "comments",
              value: {
                id: "ig.1",
                text: "berapa harganya?",
                from: { id: "u1" },
              },
            },
          ],
        },
      ],
    });

    expect(
      await waitFor(async () => (await db.igRawEvent.count()) > before),
    ).toBe(true);
    expect(await db.waMessage.count()).toBe(waBefore);
  });

  it("writes nothing at all when the signature is wrong", async () => {
    const id = newId();
    const res = await post(messageEvent(id, "halo"), "wrong-secret");
    expect(res.status).toBe(401);

    // Give the (incorrect) out-of-band write a chance to happen before denying it did.
    await new Promise((r) => setTimeout(r, 250));
    expect(
      await db.waMessage.findUnique({ where: { waMessageId: id } }),
    ).toBeNull();
  });
});
