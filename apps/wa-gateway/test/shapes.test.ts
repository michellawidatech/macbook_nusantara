/**
 * The pure halves: what an arriving message becomes for the webhook, what a
 * worker's Graph request becomes for Baileys, and the three rations.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  chatKind,
  deliveryFor,
  digits,
  shapeOf,
  signatureOf,
} from "../src/delivery.js";
import { graphCallOf, parseSendRequest } from "../src/graph.js";
import { LinkLimiter, MediaStore, Pacer } from "../src/limits.js";
import { loadGatewayConfig, startupProblems } from "../src/config.js";

describe("which chats are a customer", () => {
  it("reads a person and a LID, and ignores groups, status and channels", () => {
    expect(chatKind("6281234567890@s.whatsapp.net")).toBe("person");
    expect(chatKind("123456789012345@lid")).toBe("lid");
    expect(chatKind("120363000000000000@g.us")).toBe("ignore");
    expect(chatKind("status@broadcast")).toBe("ignore");
    expect(chatKind("120363000000000000@newsletter")).toBe("ignore");
  });

  it("writes a number the way a wa_id is written", () => {
    expect(digits("0812-3456-7890")).toBe("6281234567890");
    expect(digits("+62 812 3456 7890")).toBe("6281234567890");
  });
});

describe("what the webhook receives", () => {
  it("is a Cloud API text delivery, signed over the exact bytes", () => {
    const shape = shapeOf({ conversation: "ada air m2?" })!;
    const body = deliveryFor({
      waId: "6281234567890",
      name: "Ayu",
      id: "ABC",
      seconds: 1_760_000_000,
      shape,
      displayNumber: "628111",
    });
    const parsed = JSON.parse(body);
    expect(parsed.object).toBe("whatsapp_business_account");
    const value = parsed.entry[0].changes[0].value;
    expect(value.contacts[0]).toEqual({
      profile: { name: "Ayu" },
      wa_id: "6281234567890",
    });
    expect(value.messages[0]).toEqual({
      from: "6281234567890",
      id: "wamid.baileys.ABC",
      timestamp: "1760000000",
      type: "text",
      text: { body: "ada air m2?" },
    });
    const secret = "app-secret";
    expect(signatureOf(body, secret)).toBe(
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    );
  });

  it("forwards an image as Meta does — type, caption, MIME — and no bytes", () => {
    const shape = shapeOf({
      imageMessage: { caption: " ini kak ", mimetype: "image/jpeg" },
    })!;
    const msg = JSON.parse(
      deliveryFor({
        waId: "62812",
        name: null,
        id: "IMG1",
        seconds: 1,
        shape,
        displayNumber: "",
      }),
    ).entry[0].changes[0].value.messages[0];
    expect(msg.type).toBe("image");
    expect(msg.image).toEqual({
      id: "baileys-IMG1",
      mime_type: "image/jpeg",
      caption: "ini kak",
    });
    expect(msg.text).toBeUndefined();
  });

  it("reads extended text, and skips what is not a message", () => {
    expect(shapeOf({ extendedTextMessage: { text: "halo" } })).toEqual({
      type: "text",
      text: "halo",
    });
    expect(shapeOf({ audioMessage: {} })?.type).toBe("audio");
    expect(shapeOf({ reactionMessage: {} })?.type).toBe("reaction");
    expect(shapeOf({})).toBeNull();
    expect(shapeOf(null)).toBeNull();
  });
});

describe("the worker's Graph calls", () => {
  it("knows the two paths and nothing else", () => {
    expect(graphCallOf("/graph/v25.0/1200651716467039/messages")).toBe(
      "messages",
    );
    expect(graphCallOf("/graph/v25.0/baileys/media")).toBe("media");
    expect(graphCallOf("/graph/v25.0/1/phone_numbers")).toBeNull();
    expect(graphCallOf("/graph/../messages")).toBeNull();
  });

  it("reads sendText's and sendImage's bodies", () => {
    expect(
      parseSendRequest({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "6281234567890",
        type: "text",
        text: { preview_url: false, body: "Halo kak" },
      }),
    ).toEqual({ kind: "text", to: "6281234567890", body: "Halo kak" });
    expect(
      parseSendRequest({
        to: "6281234567890",
        type: "image",
        image: { id: "m-1", caption: "Air M2" },
      }),
    ).toEqual({
      kind: "image",
      to: "6281234567890",
      mediaId: "m-1",
      caption: "Air M2",
    });
  });

  it("refuses a link, a missing body and a non-number", () => {
    expect(
      parseSendRequest({
        to: "62812345",
        type: "image",
        image: { link: "https://example.com/x.jpg" },
      }),
    ).toMatch(/upload/);
    expect(parseSendRequest({ to: "62812345", type: "text" })).toMatch(
      /text.body/,
    );
    expect(
      parseSendRequest({ to: "abc", type: "text", text: { body: "x" } }),
    ).toMatch(/phone/);
  });
});

describe("the rations", () => {
  it("allows three links an hour, and says when the next one is free", () => {
    const limiter = new LinkLimiter(3, 3_600_000);
    const t0 = 1_000_000;
    expect(limiter.take(t0).ok).toBe(true);
    expect(limiter.take(t0 + 1).ok).toBe(true);
    expect(limiter.take(t0 + 2).ok).toBe(true);
    const fourth = limiter.take(t0 + 60_000);
    expect(fourth).toEqual({ ok: false, retryAfterMs: 3_600_000 - 60_000 });
    expect(limiter.report(t0 + 60_000).remaining).toBe(0);
    expect(limiter.take(t0 + 3_600_000).ok).toBe(true);
  });

  it("spaces sends per chat and for the whole number", () => {
    const pacer = new Pacer({
      perChatMs: 1_500,
      globalMs: 400,
      typingMinMs: 800,
      typingMaxMs: 3_500,
      typingMsPerChar: 25,
    });
    expect(pacer.reserve("a", 0)).toBe(0);
    expect(pacer.reserve("b", 0)).toBe(400); // another chat: global spacing
    expect(pacer.reserve("a", 0)).toBe(1_500); // same chat: its own spacing
    expect(pacer.typingMs("ok")).toBe(800);
    expect(pacer.typingMs("x".repeat(80))).toBe(2_000);
    expect(pacer.typingMs("x".repeat(1_000))).toBe(3_500);
  });

  it("hands an upload over once, and forgets it after ten minutes", () => {
    const store = new MediaStore();
    const id = store.put(Buffer.from("jpeg"), "image/jpeg", 0);
    expect(store.take(id, 1)?.mimeType).toBe("image/jpeg");
    expect(store.take(id, 2)).toBeNull();
    const old = store.put(Buffer.from("jpeg"), "image/jpeg", 0);
    expect(store.take(old, 11 * 60_000)).toBeNull();
  });
});

describe("refusing to start", () => {
  const prod = {
    APP_ENV: "prod",
    WA_GATEWAY_SECRET: "a-long-enough-secret",
    APP_SECRET: "meta-app-secret",
    WA_GATEWAY_STATE_DIR: "/opt/nusantara/var/wa-gateway",
  };

  it("starts on prod with everything set, on loopback :3002", () => {
    const config = loadGatewayConfig(prod);
    expect(startupProblems(config)).toEqual([]);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3002);
    expect(config.webhookUrl).toBe("http://127.0.0.1:3001/webhook");
  });

  it("refuses staging and dev unless a developer opts in", () => {
    expect(
      startupProblems(loadGatewayConfig({ ...prod, APP_ENV: "stage" })),
    ).toHaveLength(1);
    expect(
      startupProblems(
        loadGatewayConfig({
          ...prod,
          APP_ENV: "dev",
          WA_GATEWAY_ALLOW_NONPROD: "1",
        }),
      ),
    ).toEqual([]);
  });

  it("refuses without the secrets or a state directory", () => {
    expect(
      startupProblems(loadGatewayConfig({ APP_ENV: "prod" })),
    ).toHaveLength(3);
    expect(
      startupProblems(
        loadGatewayConfig({ ...prod, WA_GATEWAY_SECRET: "short" }),
      ),
    ).toHaveLength(1);
  });
});
