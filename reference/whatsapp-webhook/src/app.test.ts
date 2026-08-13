import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";
import { mockDb } from "./test/harness.js";

// Configure the service before importing it (config reads env at module load).
process.env.APP_SECRET = "test-secret";
process.env.VERIFY_TOKEN = "verify-tok";
delete process.env.ANTHROPIC_API_KEY; // force the human-handoff path
delete process.env.WHATSAPP_TOKEN; // sendText no-ops (no real Graph call)

const { db } = mockDb();
// Force the human-handoff path deterministically: assert no Anthropic credential
// regardless of what the runner's environment injects (env-var deletes above are
// not reliable when a credential is present in the process).
vi.doMock("./agent/anthropic.js", () => ({
  hasAnthropicCredential: () => false,
  usingOAuth: () => false,
}));
// Stub the WhatsApp sender so the handoff path never touches the network (the
// runner's env may carry send credentials).
vi.doMock("./send.js", () => ({ sendText: vi.fn(async () => {}) }));
const { createApp, handleInbound } = await import("./app.js");
const { _resetDebounce } = await import("./agent/debounce.js");
const app = createApp();

const sign = (raw: string) =>
  "sha256=" + createHmac("sha256", "test-secret").update(raw).digest("hex");

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "e1",
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ profile: { name: "Budi" }, wa_id: "628111" }],
            messages: [{ from: "628111", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "jam buka?" } }],
          },
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /webhook (verification handshake)", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const res = await request(app).get("/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "verify-tok",
      "hub.challenge": "12345",
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe("12345");
  });

  it("rejects a wrong verify token", async () => {
    const res = await request(app).get("/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "12345",
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /webhook (signature gate)", () => {
  it("accepts a correctly signed payload with 200", async () => {
    // The route acks 200 then processes via setImmediate; treat this delivery as
    // a duplicate so the async path is a clean no-op, and flush it before the
    // test ends so it can't run against the next test's cleared mocks.
    db.waRawEvent.create.mockResolvedValue({ id: "raw" });
    db.waMessage.findUnique.mockResolvedValue({ id: "dup" });

    const raw = JSON.stringify(payload);
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(raw))
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });

    await new Promise((r) => setImmediate(r));
  });

  it("rejects a bad signature with 401", async () => {
    const raw = JSON.stringify(payload);
    const res = await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(raw);
    expect(res.status).toBe(401);
  });
});

describe("handleInbound (persist + debounced pipeline)", () => {
  // handleInbound now schedules a per-sender debounce timer; fake timers let us
  // fire the quiet window deterministically.
  beforeEach(() => {
    vi.useFakeTimers();
    _resetDebounce();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists a WaMessage and, once the debounce fires, hands the burst to staff (no API key)", async () => {
    const created = {
      id: "m1",
      waMessageId: "wamid.1",
      from: "628111",
      name: "Budi",
      text: "jam buka?",
      msgType: "text",
      status: "BARU",
      ts: new Date(),
    };
    db.waRawEvent.create.mockResolvedValue({ id: "raw1" });
    db.waMessage.findUnique.mockResolvedValue(null);
    db.waMessage.create.mockResolvedValue(created);
    db.waMessage.findMany.mockResolvedValue([created]); // the BARU burst runConversation loads

    await handleInbound(payload);
    await vi.runAllTimersAsync(); // fire the debounce → runConversation

    // A WaMessage row was created (status BARU) ...
    expect(db.waMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ waMessageId: "wamid.1", status: "BARU" }) }),
    );
    // ... then, without ANTHROPIC_API_KEY, the burst was handed to staff.
    expect(db.waMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PERLU_STAF" }) }),
    );
  });

  it("does not reprocess a duplicate delivery", async () => {
    db.waRawEvent.create.mockResolvedValue({ id: "raw2" });
    db.waMessage.findUnique.mockResolvedValue({ id: "existing" });

    await handleInbound(payload);
    await vi.runAllTimersAsync();

    expect(db.waMessage.create).not.toHaveBeenCalled();
    expect(db.waMessage.updateMany).not.toHaveBeenCalled();
  });
});
