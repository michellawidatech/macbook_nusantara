/**
 * Instagram through the worker (2026-11-16), every pass AS nusantara_agent:
 * an Instagram DM drafted by the same bot and queued as IG_DM; the Instagram
 * send pass onto a fake Graph; the sync pass (profiles, posts, the account,
 * the token refresh and its env-file write-back, comment alerts); and the
 * WhatsApp send pass leaving Instagram rows alone.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaClient,
  appendUnitEvent,
  enqueueOutbox,
  truncateAll,
} from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import type { AgentCapabilities } from "@nusantara/agent";
import { draftPass } from "../src/draft.js";
import { sendPass } from "../src/send.js";
import { igSendPass } from "../src/igSend.js";
import { igSyncPass, igTokenState, rewriteEnvFile } from "../src/igSync.js";
import type { InstagramConfig } from "../src/config.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });
const NOW = new Date("2026-08-20T03:00:00.000Z");
const AGENT_STAFF = "staff_agent";
const IGSID = "17841400000000321";
const FROM = `ig:${IGSID}`;
const LIVE = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

const igConfig = (over: Partial<InstagramConfig> = {}): InstagramConfig => ({
  credentials: {
    accessToken: "IGQ-test-token",
    igUserId: "17841400000000000",
    graphVersion: "v25.0",
  },
  mediaPublicUrl: "https://shop.ts.net:8443/webhook/media",
  tokenFile: "",
  tokenRefreshedAt: null,
  ...over,
});

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

/** A fake Graph: answers by path, records every call. */
function graph(
  answer: (url: string) => unknown = () => ({ message_id: "mid.out" }),
) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const reply = answer(url);
    return new Response(JSON.stringify(reply), {
      status: (reply as { error?: unknown }).error ? 400 : 200,
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

let owner: PrismaClient;
let agent: PrismaClient;

beforeAll(async () => {
  owner = new PrismaClient({ datasources: { db: { url: URL } } });
  agent = new PrismaClient({
    datasources: { db: { url: asRole("nusantara_agent") } },
  });
});

afterAll(async () => {
  await truncateAll(owner);
  await owner.$disconnect();
  await agent.$disconnect();
});

beforeEach(async () => {
  await truncateAll(owner);
  await owner.staff.create({
    data: {
      id: AGENT_STAFF,
      username: "agent",
      name: "Agen",
      role: "STAFF",
      canApprove: false,
      active: false,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await owner.location.create({
    data: {
      id: "loc_t",
      code: "T1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await owner.category.create({
    data: {
      id: "cat_t",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await owner.catalogModel.create({
    data: {
      id: "mdl_t",
      categoryId: "cat_t",
      name: "MacBook Pro 16 M3",
      archived: false,
      createdAt: NOW,
    },
  });
  await owner.sku.create({
    data: {
      id: "sku_t",
      modelId: "mdl_t",
      code: "SKU-T1",
      name: "MacBook Pro 16 M3 512GB",
      variantLabel: "18/512",
      grade: "A",
      price: 32_500_000n,
      landed: 28_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  await owner.unit.create({
    data: {
      id: "u_1",
      serial: "MBP1",
      skuId: "sku_t",
      status: "QC",
      locationId: "loc_t",
      buy: 28_000_000n,
      landed: 28_000_000n,
      grade: "A",
      price: 32_500_000n,
      intakeAt: NOW,
      version: 1,
    },
  });
  await owner.$transaction(async (tx) => {
    await appendUnitEvent(tx, {
      serial: "MBP1",
      type: "DITERIMA",
      staffId: AGENT_STAFF,
      at: NOW,
      toLocationId: "loc_t",
    });
    await appendUnitEvent(tx, {
      serial: "MBP1",
      type: "QC_SELESAI",
      staffId: AGENT_STAFF,
      at: NOW,
    });
  });
});

async function dm(id: string, text: string, at: Date) {
  await owner.waMessage.create({
    data: {
      waMessageId: `ig:${id}`,
      from: FROM,
      text,
      msgType: "text",
      ts: new Date(at.getTime() - 20_000),
      direction: "IN",
      status: "BARU",
      entities: {},
      answeredByAgent: false,
    },
  });
}

const draft = (at: Date) =>
  draftPass({
    db: agent,
    logger,
    anthropic: {},
    debounceMs: 8_000,
    maxDraftsPerTick: 5,
    capabilities: LIVE,
    agentStaffId: AGENT_STAFF,
    now: () => at,
  });

describe("the bot answers an Instagram DM", () => {
  it("drafts it like any chat and queues the reply as IG_DM to the ig: thread", async () => {
    await dm("m1", "kak ada macbook pro 16 m3?", NOW);
    await draft(NOW);
    const row = await owner.waMessage.findFirstOrThrow({
      where: { waMessageId: "ig:m1" },
    });
    expect(row.status).toBe("DIJAWAB_AGEN");
    expect(row.replyText).toBeTruthy();
    const out = await owner.outbox.findMany();
    expect(out.map((o) => o.kind)).toEqual(["IG_DM"]);
    expect(out[0]!.payload as { to: string; body: string }).toMatchObject({
      to: FROM,
      body: row.replyText,
    });
  });

  // Asked again, sent again (owner, 2026-11-12).
  it("queues the shop's photos as IG_IMAGE when asked, and again when asked again", async () => {
    await owner.unitNote.create({
      data: {
        id: "note_mbp1",
        unitId: "u_1",
        serial: "MBP1",
        body: "QC",
        staffId: AGENT_STAFF,
        at: NOW,
        photos: { create: [{ id: "ph_1", url: "/p/1.jpg", sortOrder: 0 }] },
      },
    });
    await dm("m2", "minta foto macbook pro 16 m3 dong", NOW);
    await draft(NOW);
    expect(await owner.outbox.count({ where: { kind: "IG_IMAGE" } })).toBe(1);
    const later = new Date(NOW.getTime() + 60_000);
    await dm("m3", "minta fotonya dong kak", later);
    await draft(later);
    expect(await owner.outbox.count({ where: { kind: "IG_IMAGE" } })).toBe(2);
  });

  it("hands over, and sends nothing, once Instagram's 24 hours have passed", async () => {
    const later = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
    await owner.waMessage.create({
      data: {
        waMessageId: "ig:old",
        from: FROM,
        text: "halo kak",
        msgType: "text",
        ts: NOW,
        direction: "IN",
        status: "BARU",
        entities: {},
        answeredByAgent: false,
      },
    });
    await draft(later);
    expect(
      (
        await owner.waMessage.findFirstOrThrow({
          where: { waMessageId: "ig:old" },
        })
      ).status,
    ).toBe("PERLU_STAF");
    expect(
      await owner.outbox.count({
        where: { kind: { in: ["IG_DM", "WA_REPLY"] } },
      }),
    ).toBe(0);
  });
});

describe("the Instagram send pass", () => {
  it("is dormant without a token, and the WhatsApp pass never claims an Instagram row", async () => {
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: FROM, body: "halo" },
      }),
    );
    const none = await igSendPass({
      db: agent,
      logger,
      instagram: igConfig({
        credentials: { accessToken: "", igUserId: "", graphVersion: "v25.0" },
      }),
      maxSendsPerTick: 5,
    });
    expect(none.dormant).toBe(true);
    const wa = await sendPass({
      db: agent,
      logger,
      credentials: {
        whatsappToken: "t",
        phoneNumberId: "1",
        graphVersion: "v25.0",
      },
      maxSendsPerTick: 5,
      fetchImpl: (async () => {
        throw new Error("WhatsApp must not be called");
      }) as unknown as typeof fetch,
    });
    expect(wa.sent + wa.failed).toBe(0);
    expect((await owner.outbox.findFirstOrThrow()).status).toBe("PENDING");
  });

  it("sends a long DM in parts and keeps the first message id", async () => {
    const body = `${"a".repeat(700)}\n\n${"b".repeat(700)}`;
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "WA_REPLY", payload: { to: FROM, body } }),
    );
    const g = graph();
    const r = await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 5,
      fetchImpl: g.impl,
    });
    expect(r.sent).toBe(1);
    expect(g.calls).toHaveLength(2);
    expect(g.calls[0]!.url).toBe(
      "https://graph.instagram.com/v25.0/17841400000000000/messages",
    );
    expect(g.calls[0]!.body).toEqual({
      recipient: { id: IGSID },
      message: { text: "a".repeat(700) },
    });
    const row = await owner.outbox.findFirstOrThrow();
    expect(row.status).toBe("SENT");
    expect(row.providerMessageId).toBe("mid.out");
  });

  it("resends only the parts that did not go", async () => {
    const body = `${"a".repeat(700)}\n\n${"b".repeat(700)}`;
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "WA_REPLY", payload: { to: FROM, body } }),
    );
    let n = 0;
    const flaky = graph(() =>
      ++n === 2
        ? { error: { code: 2, message: "temporary" } }
        : { message_id: "mid.1" },
    );
    expect(
      (
        await igSendPass({
          db: agent,
          logger,
          instagram: igConfig(),
          maxSendsPerTick: 1,
          fetchImpl: flaky.impl,
        })
      ).failed,
    ).toBe(1);
    await owner.outbox.updateMany({ data: { nextAttemptAt: NOW } });
    const g = graph();
    await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 1,
      fetchImpl: g.impl,
    });
    expect(g.calls).toHaveLength(1);
    expect(
      (g.calls[0]!.body as { message: { text: string } }).message.text,
    ).toBe("b".repeat(700));
    const row = await owner.outbox.findFirstOrThrow();
    expect(row.status).toBe("SENT");
    expect(row.providerMessageId).toBe("mid.1");
  });

  it("sends a picture by a tokened URL the webhook serves, and the caption after it", async () => {
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, {
        kind: "WA_IMAGE",
        payload: { to: FROM, photoId: "ph_x", caption: "Ini kak" },
      }),
    );
    const g = graph();
    await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 5,
      fetchImpl: g.impl,
      pictureToken: () => "T".repeat(43),
    });
    const row = await owner.outbox.findFirstOrThrow();
    expect(row.status).toBe("SENT");
    expect((row.payload as { mediaToken: string }).mediaToken).toBe(
      "T".repeat(43),
    );
    expect(g.calls[0]!.body).toEqual({
      recipient: { id: IGSID },
      message: {
        attachment: {
          type: "image",
          payload: {
            url: `https://shop.ts.net:8443/webhook/media/${row.id}/${"T".repeat(43)}`,
          },
        },
      },
    });
    expect(g.calls[1]!.body).toMatchObject({ message: { text: "Ini kak" } });
  });

  it("fails a picture at once when there is no public URL, and a reply past 24 h", async () => {
    await owner.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: "WA_IMAGE",
        payload: { to: FROM, photoId: "ph_x" },
      });
    });
    await igSendPass({
      db: agent,
      logger,
      instagram: igConfig({ mediaPublicUrl: "" }),
      maxSendsPerTick: 5,
      fetchImpl: graph().impl,
    });
    const pic = await owner.outbox.findFirstOrThrow();
    expect(pic.status).toBe("FAILED");
    expect(pic.lastError).toContain("IG_MEDIA_PUBLIC_URL");

    await owner.outbox.deleteMany();
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: FROM, body: "telat" },
      }),
    );
    await owner.outbox.updateMany({
      data: { createdAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const g = graph();
    await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 5,
      fetchImpl: g.impl,
    });
    expect(g.calls).toHaveLength(0);
    expect((await owner.outbox.findFirstOrThrow()).status).toBe("FAILED");

    // A tagged staff reply may go up to seven days.
    await owner.outbox.deleteMany();
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, {
        kind: "WA_REPLY",
        payload: { to: FROM, body: "maaf telat", tag: "HUMAN_AGENT" },
      }),
    );
    await owner.outbox.updateMany({
      data: { createdAt: new Date(Date.now() - 3 * 24 * 3600_000) },
    });
    const h = graph();
    await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 5,
      fetchImpl: h.impl,
    });
    expect(h.calls[0]!.body).toMatchObject({
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });
  });

  it("replies under a comment (keeping the reply's id), sends the private reply, hides", async () => {
    const media = await owner.igMedia.create({
      data: { igMediaId: "m1", fetchedAt: new Date(0) },
    });
    await owner.igComment.create({
      data: {
        igCommentId: "c1",
        mediaId: media.id,
        fromId: "555",
        ts: NOW,
        status: "REPLIED",
        repliedByAgent: false,
        replyText: "Cek DM ya kak",
      },
    });
    await owner.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: "IG_REPLY",
        payload: { commentId: "c1", body: "Cek DM ya kak" },
      });
      await enqueueOutbox(tx, {
        kind: "IG_PRIVATE_REPLY",
        payload: { commentId: "c1", body: "Halo kak" },
      });
      await enqueueOutbox(tx, {
        kind: "IG_HIDE",
        payload: { commentId: "c1", hidden: true },
      });
    });
    const g = graph((url) =>
      url.endsWith("/replies")
        ? { id: "reply.9" }
        : url.includes("hide=")
          ? { success: true }
          : { message_id: "mid.p" },
    );
    const r = await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 5,
      fetchImpl: g.impl,
    });
    expect(r.sent).toBe(3);
    expect((await owner.igComment.findFirstOrThrow()).replyCommentId).toBe(
      "reply.9",
    );
    expect(g.calls.map((c) => c.url)).toEqual(
      expect.arrayContaining([
        "https://graph.instagram.com/v25.0/c1/replies",
        "https://graph.instagram.com/v25.0/17841400000000000/messages",
        "https://graph.instagram.com/v25.0/c1?hide=true",
      ]),
    );
    expect(g.calls.find((c) => c.body && "recipient" in c.body)!.body).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "Halo kak" },
    });
  });

  it("exhausts a malformed row at once", async () => {
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "IG_HIDE", payload: { commentId: "c1" } }),
    );
    await igSendPass({
      db: agent,
      logger,
      instagram: igConfig(),
      maxSendsPerTick: 5,
      fetchImpl: graph().impl,
    });
    expect((await owner.outbox.findFirstOrThrow()).status).toBe("FAILED");
  });
});

describe("the Instagram sync pass", () => {
  it("names a new sender, fetches a post, checks the account, and alerts on a NEW comment", async () => {
    await dm("s1", "halo", NOW);
    const media = await owner.igMedia.create({
      data: { igMediaId: "m9", fetchedAt: new Date(0) },
    });
    await owner.igComment.create({
      data: {
        igCommentId: "c9",
        mediaId: media.id,
        fromId: "777",
        fromUsername: "sari",
        text: "ready kak?",
        ts: new Date(),
        status: "NEW",
        repliedByAgent: false,
      },
    });
    await owner.appSetting.create({
      data: {
        key: "chatbot.notifyNumbers",
        value: "6281234567890:Rina",
        updatedAt: NOW,
      },
    });
    const g = graph((url) => {
      if (url.includes(`/${IGSID}?`))
        return { username: "budi.mac", name: "Budi" };
      if (url.includes("/m9?"))
        return {
          caption: "Air M2 mulus",
          media_type: "IMAGE",
          media_url: "https://cdn/x.jpg",
          permalink: "https://instagram.com/p/x",
        };
      if (url.includes("/me?"))
        return {
          user_id: "17841400000000000",
          username: "macbooknusantara",
          account_type: "Business",
        };
      if (url.includes("refresh_access_token"))
        return { error: { code: 190, message: "too young" } };
      return {};
    });
    const token = igTokenState(igConfig());
    const r = await igSyncPass({
      db: agent,
      logger,
      instagram: igConfig(),
      token,
      fetchImpl: g.impl,
      baseUrl: "https://pos.test",
    });
    expect(r).toMatchObject({
      contacts: 1,
      media: 1,
      alerts: 1,
      refreshed: false,
    });
    expect(
      await owner.igContact.findUniqueOrThrow({ where: { igsid: IGSID } }),
    ).toMatchObject({
      username: "budi.mac",
      name: "Budi",
    });
    expect(
      (
        await owner.waMessage.findFirstOrThrow({
          where: { waMessageId: "ig:s1" },
        })
      ).name,
    ).toBe("Budi");
    expect(
      await owner.igMedia.findUniqueOrThrow({ where: { id: media.id } }),
    ).toMatchObject({
      caption: "Air M2 mulus",
      permalink: "https://instagram.com/p/x",
      thumbnailUrl: "https://cdn/x.jpg",
    });
    expect(
      await owner.igConnection.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toMatchObject({
      username: "macbooknusantara",
      lastError: null,
    });
    const alert = await owner.outbox.findFirstOrThrow({
      where: { kind: "WA_REPLY" },
    });
    expect((alert.payload as { to: string; body: string }).to).toBe(
      "6281234567890",
    );
    expect((alert.payload as { body: string }).body).toContain("@sari");
    expect((alert.payload as { body: string }).body).toContain(
      "https://pos.test/chat?tab=comments",
    );

    // A second pass: nothing new to fetch, no second alert.
    const again = await igSyncPass({
      db: agent,
      logger,
      instagram: igConfig(),
      token,
      fetchImpl: g.impl,
    });
    expect(again).toMatchObject({ contacts: 0, media: 0, alerts: 0 });
    expect(
      g.calls.filter((c) => c.url.includes("refresh_access_token")),
    ).toHaveLength(1);
  });

  it("with a Unified-login token: reads the account by id, subscribes it once, never refreshes (2026-11-23)", async () => {
    const config = igConfig({
      credentials: {
        accessToken: "EAAbusiness-token",
        igUserId: "17841400000000000",
        graphVersion: "v25.0",
      },
    });
    const token = igTokenState(config);
    const g = graph((url) =>
      url.includes("/17841400000000000?fields=")
        ? { id: "17841400000000000", username: "macbooknusantara", name: "MN" }
        : { success: true },
    );
    const r = await igSyncPass({
      db: agent,
      logger,
      instagram: config,
      token,
      fetchImpl: g.impl,
    });
    expect(r).toMatchObject({ refreshed: false });
    expect(
      g.calls.every((c) => c.url.startsWith("https://graph.facebook.com/")),
    ).toBe(true);
    expect(g.calls.some((c) => c.url.includes("refresh_access_token"))).toBe(
      false,
    );
    expect(
      g.calls
        .filter((c) => c.url.includes("/subscribed_apps"))
        .map((c) => c.method),
    ).toEqual(["POST"]);
    expect(
      await owner.igConnection.findUniqueOrThrow({
        where: { id: "singleton" },
      }),
    ).toMatchObject({
      username: "macbooknusantara",
      igUserId: "17841400000000000",
      lastError: null,
    });
    // The account is checked hourly; the subscription is once per process.
    await owner.igConnection.update({
      where: { id: "singleton" },
      data: { checkedAt: new Date(0) },
    });
    await igSyncPass({
      db: agent,
      logger,
      instagram: config,
      token,
      fetchImpl: g.impl,
    });
    expect(
      g.calls.filter((c) => c.url.includes("/subscribed_apps")),
    ).toHaveLength(1);
  });

  it("refreshes a week-old token, uses it at once, and writes it back to the env file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ig-token-"));
    const file = join(dir, "worker.env");
    writeFileSync(
      file,
      "# worker\nIG_ACCESS_TOKEN='IGQ-test-token'\nOTHER='x'\n",
      { mode: 0o600 },
    );
    const config = igConfig({
      tokenFile: file,
      tokenRefreshedAt: new Date(Date.now() - 8 * 24 * 3600_000),
    });
    const token = igTokenState(config);
    const g = graph((url) =>
      url.includes("refresh_access_token")
        ? {
            access_token: "IGQ-fresh",
            token_type: "bearer",
            expires_in: 5184000,
          }
        : {},
    );
    const r = await igSyncPass({
      db: agent,
      logger,
      instagram: config,
      token,
      fetchImpl: g.impl,
    });
    expect(r.refreshed).toBe(true);
    expect(token.accessToken).toBe("IGQ-fresh");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("IG_ACCESS_TOKEN='IGQ-fresh'");
    expect(text).toMatch(/IG_TOKEN_REFRESHED_AT='\d{4}-/);
    expect(text).toContain("OTHER='x'");
    expect(text.startsWith("# worker\n")).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const conn = await owner.igConnection.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    expect(conn.tokenExpiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 59 * 24 * 3600_000,
    );
    // The next send uses the new token.
    await owner.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "WA_REPLY", payload: { to: FROM, body: "x" } }),
    );
    const seen: string[] = [];
    await igSendPass({
      db: agent,
      logger,
      instagram: config,
      tokenState: token,
      maxSendsPerTick: 1,
      fetchImpl: (async (_u: string, init: RequestInit) => {
        seen.push((init.headers as Record<string, string>)["Authorization"]!);
        return new Response(JSON.stringify({ message_id: "m" }));
      }) as unknown as typeof fetch,
    });
    expect(seen).toEqual(["Bearer IGQ-fresh"]);
  });

  it("rewrites an env file in place and appends a key it lacks", () => {
    const dir = mkdtempSync(join(tmpdir(), "ig-env-"));
    const file = join(dir, "a.env");
    writeFileSync(file, "A='1'\nB='2'");
    rewriteEnvFile(file, { B: "3", C: "4" });
    expect(readFileSync(file, "utf8")).toBe("A='1'\nB='3'\nC='4'\n");
  });
});
