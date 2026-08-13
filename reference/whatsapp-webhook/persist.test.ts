import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "./test/harness.js";

const { db } = mockDb();
const { extractMessages, persistInbound, sweepStuck, STUCK_AFTER_MS } = await import("./persist.js");

const textPayload = (id: string, body = "halo") => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "e1",
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ profile: { name: "Budi" }, wa_id: "628111" }],
            messages: [{ from: "628111", id, timestamp: "1700000000", type: "text", text: { body } }],
          },
        },
      ],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractMessages", () => {
  it("flattens inbound text messages with contact name and timestamp", () => {
    const [msg] = extractMessages(textPayload("wamid.1", "stok m2?"));
    expect(msg).toMatchObject({
      waMessageId: "wamid.1",
      from: "628111",
      name: "Budi",
      text: "stok m2?",
      msgType: "text",
    });
    expect(msg!.ts).toEqual(new Date(1700000000 * 1000));
  });

  it("ignores status callbacks and non-WABA payloads", () => {
    expect(
      extractMessages({
        object: "whatsapp_business_account",
        entry: [{ id: "e", changes: [{ field: "messages", value: { statuses: [{ id: "x", status: "read", recipient_id: "6281" }] } }] }],
      }),
    ).toEqual([]);
    expect(extractMessages({ object: "page" })).toEqual([]);
  });

  it("captures non-text messages with a null body", () => {
    const payload = textPayload("wamid.img");
    payload.entry[0]!.changes[0]!.value.messages![0] = {
      from: "628111",
      id: "wamid.img",
      timestamp: "1700000000",
      type: "image",
    } as never;
    const [msg] = extractMessages(payload);
    expect(msg).toMatchObject({ msgType: "image", text: null });
  });
});

describe("persistInbound", () => {
  it("stores the raw event and creates a BARU message for a new id", async () => {
    db.waRawEvent.create.mockResolvedValue({ id: "raw1" });
    db.waMessage.findUnique.mockResolvedValue(null);
    db.waMessage.create.mockResolvedValue({ id: "m1", waMessageId: "wamid.1" });

    const created = await persistInbound(textPayload("wamid.1"));

    expect(db.waRawEvent.create).toHaveBeenCalledOnce();
    expect(db.waMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ waMessageId: "wamid.1", status: "BARU" }) }),
    );
    expect(created).toHaveLength(1);
  });

  it("dedupes a message id that already exists (Meta retry)", async () => {
    db.waRawEvent.create.mockResolvedValue({ id: "raw1" });
    db.waMessage.findUnique.mockResolvedValue({ id: "existing" });

    const created = await persistInbound(textPayload("wamid.dup"));

    expect(db.waMessage.create).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("swallows a unique-constraint race and skips that row", async () => {
    db.waRawEvent.create.mockResolvedValue({ id: "raw1" });
    db.waMessage.findUnique.mockResolvedValue(null);
    db.waMessage.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    const created = await persistInbound(textPayload("wamid.race"));
    expect(created).toEqual([]);
  });
});

describe("sweepStuck", () => {
  it("reschedules distinct senders with BARU rows older than the stuck threshold", async () => {
    db.waMessage.findMany.mockResolvedValue([{ from: "628111" }]);
    const schedule = vi.fn();

    const n = await sweepStuck(schedule);

    expect(n).toBe(1);
    expect(schedule).toHaveBeenCalledWith("628111");
    const args = db.waMessage.findMany.mock.calls[0]![0];
    expect(args.where.status).toBe("BARU");
    expect(args.where.ts.lt).toBeInstanceOf(Date);
    expect(args.distinct).toEqual(["from"]);
    // Cutoff is ~STUCK_AFTER_MS in the past.
    expect(Date.now() - args.where.ts.lt.getTime()).toBeGreaterThanOrEqual(STUCK_AFTER_MS - 5000);
  });

  it("isolates a failing schedule call so the rest of the sweep continues", async () => {
    db.waMessage.findMany.mockResolvedValue([{ from: "a" }, { from: "b" }]);
    const schedule = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockImplementationOnce(() => undefined);

    await expect(sweepStuck(schedule)).resolves.toBe(2);
    expect(schedule).toHaveBeenCalledTimes(2);
  });
});
