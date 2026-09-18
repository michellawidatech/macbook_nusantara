/**
 * How a turn ends: an answer with its sources, or a person (2026-09-18).
 *
 * The shop runs this app in parallel with B2Soft and production does not hold
 * the real stock or prices, so the bot answers only from the owner's approved
 * answers, the shop's facts and the catalogue — and everything else goes to a
 * colleague (policy.ts, prompt.ts). These pin the parts the model is not
 * trusted with: a routed message cannot be answered, a reply is checked
 * against what it cites, and a turn that never decides ends with a person.
 */

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { converse, type ConverseInput } from "../src/converse.js";
import { knowledgeBase } from "../src/knowledge.js";
import { routeMessage } from "../src/policy.js";
import {
  calls,
  fails,
  handsOver,
  noDb,
  replies,
  says,
  scriptedClient,
  silent,
  type ScriptStep,
} from "./fixtures.js";

/** 21 August 2026, 14:15 in Jakarta — the shop is open. */
const OPEN = new Date("2026-08-21T07:15:00.000Z");
/** 22:00 in Jakarta — shut. */
const SHUT = new Date("2026-08-21T15:00:00.000Z");

const KB = knowledgeBase([
  {
    id: "kb-cod",
    question: "Cod bisa ga kak?",
    answer:
      "Bisa kak 😊 Untuk COD area Jabodetabek bisa kami bantu, namun ada biaya transportasi sebesar Rp180.000 ya kak.",
  },
  {
    id: "kb-ready",
    question: "Apakah unitnya ready?",
    answer:
      "Ready kak 😊 Untuk memastikan unit yang kakak incar masih tersedia, boleh kirim tipe atau seri MacBook yang kakak cari ya kak.",
  },
  {
    id: "kb-garansi",
    question: "Garansi berapa lama kak?",
    answer:
      "Garansi dari kami 1 bulan ya kak 😊 Terhitung sejak unit diterima.",
  },
]);

const STORE =
  "The shop is open every day from 10.00 to 20.00 WIB (Jakarta time).";

function run(
  script: readonly ScriptStep[],
  text: string,
  over: Partial<ConverseInput> = {},
) {
  const scripted = scriptedClient(script);
  const result = converse({
    client: scripted.client,
    db: noDb as unknown as PrismaClient,
    ctx: { from: "628123", now: over.ctx?.now ?? OPEN },
    prompt: { stable: "STABLE", volatile: "VOLATILE" },
    turns: [{ role: "user", text }],
    knowledge: KB,
    storeFacts: STORE,
    route: routeMessage(text),
    ...over,
  });
  return { result, calls: scripted.calls };
}

describe("an answer", () => {
  it("is sent when it cites an approved answer and says only what it says", async () => {
    const { result, calls: made } = run(
      [
        replies(
          "Bisa kak 😊 COD Jabodetabek ada biaya transportasi Rp180.000 ya kak 🙏",
          "K1",
        ),
      ],
      "cod bisa ga kak",
    );
    const r = await result;
    expect(r?.handoff).toBeUndefined();
    expect(r?.sources).toEqual(["K1"]);
    expect(r?.reply).toBe(
      "Bisa kak 😊 COD Jabodetabek ada biaya transportasi Rp180.000 ya kak 🙏",
    );
    // Every step must end in a tool, and the stable prompt is the cache
    // breakpoint.
    expect(made[0]!.tool_choice).toEqual({ type: "any" });
    expect(made[0]!.system).toEqual([
      { type: "text", text: "STABLE", cache_control: { type: "ephemeral" } },
      { type: "text", text: "VOLATILE" },
    ]);
  });

  it("keeps the owner's punctuation — ranges, brackets, emoji", async () => {
    const { result } = run(
      [
        replies(
          "Estimasinya 1–3 hari kerja ya kak (tergantung ekspedisi) 😊🙏",
          "greeting",
        ),
      ],
      "halo",
    );
    expect((await result)?.reply).toBe(
      "Estimasinya 1–3 hari kerja ya kak (tergantung ekspedisi) 😊🙏",
    );
  });

  it("may greet with no source, but may state nothing that way", async () => {
    const hello = await run(
      [replies("Halo kak 😊 ada yang bisa dibantu?", "greeting")],
      "halo kak",
    ).result;
    expect(hello?.handoff).toBeUndefined();

    const sneaky = await run(
      [replies("Halo kak, Air M1 nya 7jt ya", "greeting")],
      "halo kak",
    ).result;
    expect(sneaky?.handoff).toMatchObject({
      topic: "other",
      forcedBy: "AMOUNT_NOT_IN_SOURCE",
    });
  });

  it("becomes a hand-over when it cites a source that does not exist", async () => {
    const r = await run([replies("Bisa kak", "K99")], "bisa cicil?").result;
    expect(r?.handoff).toMatchObject({ forcedBy: "UNKNOWN_SOURCE" });
    // The customer gets the shop's fixed words, not the refused ones.
    expect(r?.reply).toMatch(/admin kami/i);
    expect(r?.reply).not.toBe("Bisa kak");
  });

  it("becomes a hand-over when it carries a figure the source does not", async () => {
    const r = await run(
      [replies("Garansi 1 bulan kak, perpanjang 3 bulan tambah 500rb", "K3")],
      "garansi berapa lama",
    ).result;
    expect(r?.handoff).toMatchObject({ forcedBy: "AMOUNT_NOT_IN_SOURCE" });
  });

  it("becomes a hand-over when it promises stock the source does not", async () => {
    const r = await run(
      [replies("Ready kak, tokonya buka sampai jam 8", "store")],
      "buka sampai jam berapa?",
    ).result;
    expect(r?.handoff).toMatchObject({
      forcedBy: "AVAILABILITY_NOT_IN_SOURCE",
    });
  });

  it("may cite the catalogue only after looking it up", async () => {
    const db = {
      catalogModel: {
        findMany: async () => [
          {
            name: "MacBook Air M2",
            year: "2022",
            sizeInch: null,
            category: { name: "MacBook" },
            axes: [],
            skus: [{ variantLabel: "8/256", name: "AIR M2 8/256" }],
          },
        ],
      },
    } as unknown as PrismaClient;
    const looked = await run(
      [
        calls("lookup_catalog", { query: "air m2" }),
        replies("MacBook Air M2 ada varian 8/256 kak 😊", "catalog"),
      ],
      "air m2 ram nya berapa?",
      { db },
    ).result;
    expect(looked?.handoff).toBeUndefined();
    expect(looked?.toolsUsed).toEqual(["lookup_catalog", "reply"]);

    const unlooked = await run(
      [replies("MacBook Air M2 ada varian 8/256 kak 😊", "catalog")],
      "air m2 ram nya berapa?",
    ).result;
    expect(unlooked?.handoff).toMatchObject({ forcedBy: "UNKNOWN_SOURCE" });
  });

  it("searches the pass's own knowledge base without touching the database", async () => {
    const { result, calls: made } = run(
      [
        calls("search_knowledge", { query: "garansi" }),
        replies("Garansi dari kami 1 bulan ya kak 😊", "K3"),
      ],
      "garansinya brp lama",
    );
    expect((await result)?.sources).toEqual(["K3"]);
    const toolResult = JSON.stringify(made[1]!.messages.at(-1));
    expect(toolResult).toContain("K3");
  });
});

describe("a message the code has already given to a person", () => {
  it("is offered no reply tool, and ends in the model's hand-over line", async () => {
    const { result, calls: made } = run(
      [
        handsOver(
          "stock",
          "Tanya stok MacBook Air M1",
          "Siap kak 😊 untuk Air M1 kami cekkan stok dan kondisinya dulu ya, admin kami segera balas 🙏",
        ),
      ],
      "kak air m1 ready?",
    );
    const r = await result;
    expect(made[0]!.tools!.map((t) => t.name)).not.toContain("reply");
    expect(JSON.stringify(made[0]!.messages)).toContain(
      "must go to a colleague",
    );
    expect(r?.handoff).toEqual({
      topic: "stock",
      summary: "Tanya stok MacBook Air M1",
    });
    expect(r?.reply).toMatch(/Air M1 kami cekkan/);
  });

  it("is handed over even if a reply comes back anyway", async () => {
    const r = await run([replies("Ready kak", "K2")], "kak air m1 ready?")
      .result;
    expect(r?.handoff).toMatchObject({ topic: "stock", forcedBy: "route" });
  });

  it("gets the fixed line instead when the model's line quotes a price", async () => {
    const r = await run(
      [
        handsOver(
          "price",
          "Tanya harga",
          "Harganya 8.500.000 kak, admin kami cek dulu",
        ),
      ],
      "harga air m2 berapa?",
      { ctx: { from: "628123", now: SHUT } },
    ).result;
    expect(r?.reply).not.toMatch(/8\.500\.000/);
    // Shut: the fixed line says when somebody will answer.
    expect(r?.reply).toMatch(/jam operasional/);
    expect(r?.handoff?.topic).toBe("price");
  });
});

describe("a turn that never decides", () => {
  it("goes to a person once the lookups run out", async () => {
    const r = await run(
      Array.from({ length: 4 }, () =>
        calls("search_knowledge", { query: "x" }),
      ),
      "bisa bayar pakai crypto?",
    ).result;
    expect(r?.handoff).toMatchObject({
      topic: "other",
      forcedBy: "no_terminal_tool",
    });
    expect(r?.steps).toBe(4);
  });

  it("goes to a person when the model writes words and calls nothing", async () => {
    const r = await run([says("halo kak")], "halo").result;
    expect(r?.handoff).toMatchObject({ forcedBy: "no_terminal_tool" });
    const quiet = await run([silent()], "halo").result;
    expect(quiet?.handoff).toMatchObject({ forcedBy: "no_terminal_tool" });
  });

  it("prefers the person when the model both replies and hands over", async () => {
    const r = await run(
      [
        {
          kind: "tools",
          uses: [
            { name: "reply", input: { message: "Bisa kak", sources: "K1" } },
            {
              name: "handoff_to_staff",
              input: {
                topic: "other",
                summary: "ragu",
                customer_message: "Admin kami bantu ya kak 🙏",
              },
            },
          ],
        },
      ],
      "cod?",
    ).result;
    expect(r?.handoff?.topic).toBe("other");
  });
});

describe("the fence around the shop's note", () => {
  it("rides beside the customer's words, never inside them", async () => {
    const { result, calls: made } = run(
      [replies("Halo kak 😊", "greeting")],
      "halo",
      { hint: "Likeliest approved answers: K1." },
    );
    await result;
    const lastTurn = made[0]!.messages.at(-1)!;
    expect(lastTurn.content).toEqual([
      { type: "text", text: "halo" },
      {
        type: "text",
        text: "<shop_note>\nLikeliest approved answers: K1.\n</shop_note>",
      },
    ]);
  });
});

describe("failure", () => {
  it("returns null and reports what the SDK threw", async () => {
    let seen: unknown;
    const boom = new Error("401 invalid x-api-key");
    const r = await run([fails(boom)], "halo", { onError: (e) => (seen = e) })
      .result;
    expect(r).toBeNull();
    expect(seen).toBe(boom);
  });

  it("returns null for a thread with no turns", async () => {
    expect(await run([], "x", { turns: [] }).result).toBeNull();
  });
});
