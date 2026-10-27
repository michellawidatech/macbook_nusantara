/**
 * The AI decides; a hand-over is the exception (owner, 2026-10-27: *"it
 * escalates too much, it is not smart enough to make the decision"*).
 *
 *  - A refused draft goes back to the model ONCE with what was wrong and the
 *    facts; a corrected draft is sent, a second refusal is a hand-over.
 *  - A hand-over outside the short list a person must take is sent back once;
 *    asked twice, the model's judgement stands.
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { converse, type ConverseInput } from "../src/converse.js";
import { knowledgeBase } from "../src/knowledge.js";
import { SHOP_CAPABILITIES } from "../src/policy.js";
import {
  calls,
  handsOver,
  noDb,
  replies,
  scriptedClient,
  type ScriptStep,
} from "./fixtures.js";

const NOW = new Date("2026-10-27T07:00:00.000Z");
const AIR = {
  serial: "C02AIRM2XX",
  model: "MacBook Air M2",
  variant: "8/256",
  grade: "A",
  price: "Rp 11.900.000",
  left: 2,
  photos: 1,
};

function talk(
  script: readonly ScriptStep[],
  text: string,
  answers: Record<string, unknown> = {},
  over: Partial<ConverseInput> = {},
) {
  const scripted = scriptedClient(script);
  const result = converse({
    client: scripted.client,
    db: noDb as unknown as PrismaClient,
    ctx: { from: "628111", now: NOW, capabilities: SHOP_CAPABILITIES },
    prompt: { stable: "S", volatile: "V" },
    turns: [{ role: "user", text }],
    knowledge: knowledgeBase([]),
    storeFacts: "Buka 10.00-20.00",
    capabilities: SHOP_CAPABILITIES,
    route: null,
    dispatch: async (name) => answers[name] ?? { error: "not scripted" },
    ...over,
  });
  return { result, calls: scripted.calls };
}

const search = calls("search_stock", { query: "air m2" });
const shelf = { search_stock: { matched: 1, units: [AIR] } };

describe("a refused draft gets one second chance", () => {
  it("a wrong price is corrected on the retry and sent — no hand-over", async () => {
    const t = talk(
      [
        search,
        replies("Air M2 mulus 10,5jt kak 😊", "stock"),
        replies("Air M2 mulus 11,9jt kak 😊", "stock"),
      ],
      "air m2 berapa kak?",
      shelf,
    );
    const r = await t.result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).toBe("Air M2 mulus 11,9jt kak 😊");
    // Told exactly what was wrong, and what the shelf says.
    const note = JSON.stringify(t.calls[2]!.messages.at(-1));
    expect(note).toContain("Your reply was NOT sent");
    expect(note).toContain("MacBook Air M2 8/256 — Rp 11.900.000");
    expect(note).toContain('"is_error":true');
    // Both drafts were model calls, so the run's trace records both.
    expect(t.calls).toHaveLength(3);
  });

  it("two wrong prices are a hand-over", async () => {
    const r = await talk(
      [
        search,
        replies("Air M2 mulus 10,5jt kak 😊", "stock"),
        replies("Air M2 mulus 10jt kak 😊", "stock"),
      ],
      "air m2 berapa kak?",
      shelf,
    ).result;
    expect(r?.handoff).toMatchObject({
      topic: "price",
      forcedBy: "AMOUNT_NOT_IN_SOURCE",
    });
  });

  it("a draft that is too long is shortened on the retry", async () => {
    const t = talk(
      [
        replies(`Halo kak 😊 ${"panjang sekali ".repeat(120)}`, "greeting"),
        replies("Halo kak 😊 Ada yang bisa aku bantu?", "greeting"),
      ],
      "halo",
    );
    const r = await t.result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.reply).toBe("Halo kak 😊 Ada yang bisa aku bantu?");
    expect(JSON.stringify(t.calls[1]!.messages.at(-1))).toContain("too long");
  });

  it("a 'ready' for a unit not on the shelf is told what IS there", async () => {
    const t = talk(
      [
        search,
        replies("Air M3 ready kak 😊", "stock"),
        replies(
          "Air M3 lagi kosong kak, yang ready Air M2 mulus 11,9jt 😊",
          "stock",
        ),
      ],
      "air m3 ada?",
      shelf,
    );
    const r = await t.result;
    expect(r?.handoff).toBeUndefined();
    expect(JSON.stringify(t.calls[2]!.messages.at(-1))).toContain(
      "Only those are on the shelf",
    );
  });

  it("a source that does not exist is named, and the retry may cite the chat", async () => {
    const r = await talk(
      [replies("Bisa kak", "K99"), replies("Bisa kak 😊", "chat")],
      "bisa ya kak",
    ).result;
    expect(r?.handoff).toBeUndefined();
  });
});

describe("a hand-over is the exception", () => {
  it("one outside the list goes back once, and the model answers", async () => {
    const t = talk(
      [
        handsOver("stock", "Perlu cek stok", "Bentar ya kak 🙏"),
        search,
        replies("Ada kak, Air M2 mulus 11,9jt 😊", "stock"),
      ],
      "air m2 masih ada?",
      shelf,
    );
    const r = await t.result;
    expect(r?.handoff).toBeUndefined();
    // (The fake records the live message list, so search all of it.)
    expect(JSON.stringify(t.calls[1]!.messages)).toContain(
      "ONE short question",
    );
  });

  it("asked twice, the model's judgement stands", async () => {
    const r = await talk(
      [
        handsOver("trade_in", "Perlu taksir tukar tambah", "Aku tanyain ya 🙏"),
        handsOver("trade_in", "Perlu taksir tukar tambah", "Aku tanyain ya 🙏"),
      ],
      "bisa tukar tambah iphone 11?",
    ).result;
    expect(r?.handoff?.topic).toBe("trade_in");
  });

  it.each([
    "order_payment",
    "negotiation",
    "closing",
    "complaint",
    "warranty_claim",
    "media",
    "human",
  ])("%s is a person's at once", async (topic) => {
    const r = await talk(
      [handsOver(topic, "Perlu …", "Aku bantu cek dulu ya kak 🙏")],
      "x",
    ).result;
    expect(r?.handoff?.topic).toBe(topic);
  });

  it("a unit with no price in the POS (topic price with its serial) is a person's at once", async () => {
    const r = await talk(
      [
        calls("handoff_to_staff", {
          topic: "price",
          serial: "C02AIRM2XX",
          summary: "Perlu cek harga — Air M2",
          customer_message: "Harganya aku tanyain dulu ya kak 🙏",
        }),
      ],
      "air m2 berapa?",
    ).result;
    expect(r?.handoff?.topic).toBe("price");
  });
});
