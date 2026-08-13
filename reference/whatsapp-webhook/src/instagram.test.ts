import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "./test/harness.js";

// Our own IG account id — used by the reply-loop guard. Set before importing
// the module so `extractComments` sees it (and no live Graph token, so
// processComment's auto-reply stays in no-op "skipped" mode).
process.env.IG_BUSINESS_ACCOUNT_ID = "1789OWN";
delete process.env.IG_ACCESS_TOKEN;

const { db } = mockDb();
const { extractComments, persistInboundIg, processComment } = await import("./instagram.js");

const commentPayload = (id: string, fromId = "17841400000000000", extra: Record<string, unknown> = {}) => ({
  object: "instagram",
  entry: [
    {
      id: "1789OWN",
      changes: [
        {
          field: "comments",
          value: {
            id,
            text: "kak ini ready?",
            from: { id: fromId, username: "budi" },
            media: { id: "media.1" },
            parent_id: null,
            ...extra,
          },
        },
      ],
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractComments", () => {
  it("flattens an inbound comment", () => {
    const [c] = extractComments(commentPayload("ig.1"));
    expect(c).toMatchObject({
      igCommentId: "ig.1",
      igMediaId: "media.1",
      fromId: "17841400000000000",
      fromUsername: "budi",
      text: "kak ini ready?",
    });
  });

  it("ignores non-comments change fields", () => {
    const payload = {
      object: "instagram",
      entry: [{ id: "1789OWN", changes: [{ field: "mentions", value: { id: "x" } }] }],
    };
    expect(extractComments(payload)).toEqual([]);
  });

  it("skips comments authored by our own account (reply-loop guard)", () => {
    // fromId === IG_BUSINESS_ACCOUNT_ID → dropped.
    expect(extractComments(commentPayload("ig.self", "1789OWN"))).toEqual([]);
  });

  it("ignores a non-instagram object", () => {
    expect(extractComments({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
  });
});

describe("persistInboundIg", () => {
  it("persists the raw event and creates new comment rows, deduping existing ones", async () => {
    db.igRawEvent.create.mockResolvedValue({ id: "raw1" });
    db.igRawEvent.update.mockResolvedValue({});
    db.igComment.findUnique.mockResolvedValue(null); // not seen yet
    db.igMedia.findUnique.mockResolvedValue(null); // no media row yet
    db.igComment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "c1", ...data }),
    );

    const created = await persistInboundIg(commentPayload("ig.1"));

    expect(created).toHaveLength(1);
    expect(db.igRawEvent.create).toHaveBeenCalledOnce();
    expect(db.igComment.create).toHaveBeenCalledOnce();
    expect(db.igRawEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "raw1" } }),
    );
  });

  it("does not re-create an already-seen comment", async () => {
    db.igRawEvent.create.mockResolvedValue({ id: "raw2" });
    db.igRawEvent.update.mockResolvedValue({});
    db.igComment.findUnique.mockResolvedValue({ id: "c1" }); // already exists

    const created = await persistInboundIg(commentPayload("ig.1"));

    expect(created).toEqual([]);
    expect(db.igComment.create).not.toHaveBeenCalled();
  });
});

describe("processComment", () => {
  const row = { id: "c1", igCommentId: "ig.1", status: "NEW" } as never;

  it("does nothing when auto-reply is off", async () => {
    db.igSettings.findUnique.mockResolvedValue({ autoReply: false, replyTemplate: "Cek DM ya kak" });

    await processComment(row);

    expect(db.igComment.update).not.toHaveBeenCalled();
  });

  it("stamps REPLIED/auto when auto-reply is on (send skipped without a token)", async () => {
    db.igSettings.findUnique.mockResolvedValue({ autoReply: true, replyTemplate: "Cek DM ya kak" });
    db.igComment.update.mockResolvedValue({});

    await processComment(row);

    const arg = db.igComment.update.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: "c1" });
    expect(arg.data.status).toBe("REPLIED");
    expect(arg.data.replyText).toBe("Cek DM ya kak");
    expect(arg.data.repliedBy).toBe("auto");
  });

  it("skips a comment that is not NEW", async () => {
    await processComment({ id: "c9", igCommentId: "ig.9", status: "REPLIED" } as never);
    expect(db.igSettings.findUnique).not.toHaveBeenCalled();
  });
});
