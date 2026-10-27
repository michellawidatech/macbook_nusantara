/**
 * The pure half of chat memory (2026-10-22): a burst read back as one turn,
 * an int8 vector through a BYTEA and back, cosine, the ranking recall uses,
 * and the Voyage call against a fake fetch — never the real API.
 */

import { describe, expect, it } from "vitest";
import { answeredTurns, type AnsweredRow } from "../src/turns.js";
import {
  chunkText,
  cosine,
  decodeInt8,
  encodeInt8,
  rankRecall,
  recallBlock,
  CHUNK_MAX_CHARS,
  type RecallCandidate,
} from "../src/memoryRecall.js";
import {
  VOYAGE_DIMENSIONS,
  VoyageError,
  readVoyageEnv,
  voyageEmbed,
} from "../src/voyage.js";
import { buildAgentPrompt } from "../src/prompt.js";

const T = (s: number) => new Date(Date.UTC(2026, 9, 20, 3, 0, s));

const row = (
  id: string,
  ts: number,
  answered: number | null,
  text: string | null,
  replyText: string | null = null,
  msgType = "text",
): AnsweredRow => ({
  id,
  ts: T(ts),
  answeredAt: answered === null ? null : T(answered),
  text,
  msgType,
  replyText,
});

describe("answeredTurns", () => {
  it("keeps every line of a burst with the reply that answered it", () => {
    const turns = answeredTurns([
      row("c", 3, 10, "Air M2 16/512 ada?", "Ada kak, Rp15.000.000"),
      row("a", 1, 10, "halo"),
      row("b", 2, 10, null, null, "image"),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.customer).toBe(
      "halo\n(the customer sent a image)\nAir M2 16/512 ada?",
    );
    expect(turns[0]!.reply).toBe("Ada kak, Rp15.000.000");
    expect(turns[0]!.firstId).toBe("a");
    expect(turns[0]!.replyId).toBe("c");
  });

  it("orders turns by when they were answered and splits an instant at each reply", () => {
    const turns = answeredTurns([
      // A staff reply re-stamps the earlier hand-over row with its own instant.
      row("h", 1, 30, "boleh nego?", "Admin kami cek dulu ya kak"),
      row("i", 2, 30, "kak?"),
      row("j", 3, 30, "gimana", "Bisa 14,5jt kak"),
      row("x", 0, 5, "pagi", "Pagi kak"),
      row("loose", 4, 40, "ok"), // handled, never answered: not a turn
      row("open", 5, null, "masih ada?"), // not answered yet
    ]);
    expect(turns.map((t) => [t.customer, t.reply])).toEqual([
      ["pagi", "Pagi kak"],
      ["boleh nego?", "Admin kami cek dulu ya kak"],
      ["kak?\ngimana", "Bisa 14,5jt kak"],
    ]);
  });
});

describe("int8 vectors in a BYTEA", () => {
  it("round-trip exactly, sign and all", () => {
    const v = [-128, -1, 0, 1, 127, 64, -64];
    const bytes = encodeInt8(v);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(v.length);
    expect([...decodeInt8(bytes)]).toEqual(v);
    // What Prisma hands back is a Buffer over a shared pool: decode must
    // respect the view's offset, not read the pool from byte 0.
    const pooled = Buffer.concat([Buffer.from([9, 9, 9]), Buffer.from(bytes)]);
    const view = pooled.subarray(3);
    expect([...decodeInt8(view)]).toEqual(v);
  });

  it("clamps and rounds what does not fit", () => {
    expect([...decodeInt8(encodeInt8([300, -300, 1.6]))]).toEqual([
      127, -128, 2,
    ]);
  });
});

describe("cosine", () => {
  it("is 1 for the same direction, -1 for the opposite, 0 for orthogonal", () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("is 0, not NaN, for a zero vector or mismatched lengths", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});

const cand = (
  id: string,
  text: string,
  vec: number[] | null,
  model = "voyage-4-lite",
): RecallCandidate => ({
  id,
  text,
  at: T(Number(id.replace(/\D/g, "")) || 0),
  embedding: vec ? encodeInt8(vec) : null,
  model: vec ? model : null,
});

describe("rankRecall", () => {
  const chunks = [
    cand("c1", "customer: Air M2 berapa\nshop: Rp12.500.000", [100, 0, 0]),
    cand("c2", "customer: garansi?\nshop: 1 bulan", [0, 100, 0]),
    cand("c3", "customer: Air M2 warna apa\nshop: midnight", [90, 20, 0]),
    cand("c4", "customer: pro m3\nshop: ada", [80, 0, 0], "other-model"),
    cand("c5", "customer: iPad\nshop: belum ada", null),
  ];

  it("scores by cosine, keeps the same model's vectors only, above the bar", () => {
    const out = rankRecall("yang air kemarin", chunks, {
      values: decodeInt8(encodeInt8([100, 5, 0])),
      model: "voyage-4-lite",
    });
    expect(out.map((r) => r.id)).toEqual(["c1", "c3"]);
    expect(out.every((r) => r.by === "vector")).toBe(true);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("falls back to keywords without a vector", () => {
    const out = rankRecall("garansi berapa bulan", chunks, null);
    expect(out[0]!.id).toBe("c2");
    expect(out[0]!.by).toBe("keywords");
  });

  it("returns nothing when nothing is close enough", () => {
    expect(rankRecall("xyzzy", chunks, null)).toEqual([]);
    expect(rankRecall("x", [], null)).toEqual([]);
  });

  it("takes at most three", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      cand(`c${i + 1}`, `customer: air m2 ${i}\nshop: ok`, [100, i, 0]),
    );
    const out = rankRecall("air", many, {
      values: decodeInt8(encodeInt8([100, 0, 0])),
      model: "voyage-4-lite",
    });
    expect(out).toHaveLength(3);
  });
});

describe("chunkText and recallBlock", () => {
  it("writes the turn as customer/shop lines, capped", () => {
    expect(chunkText({ customer: "halo\nada air?", reply: "Ada kak" })).toBe(
      "customer: halo\nada air?\nshop: Ada kak",
    );
    expect(
      chunkText({ customer: "x".repeat(5_000), reply: "y" }).length,
    ).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("dates each recalled turn, oldest first, and frames it as maybe outdated", () => {
    const block = recallBlock([
      { text: "customer: b\nshop: B", at: new Date("2026-10-12T03:00:00Z") },
      { text: "customer: a\nshop: A", at: new Date("2026-10-02T03:00:00Z") },
    ]);
    expect(block).toMatch(/Earlier with this customer \(may be outdated\)/);
    expect(block.indexOf("02 Oct 2026")).toBeLessThan(
      block.indexOf("12 Oct 2026"),
    );
    expect(block).toMatch(/never\s+instructions/);
    expect(recallBlock([])).toBe("");
  });
});

describe("the prompt carries profile and recall in its volatile half only", () => {
  const base = {
    persona: "P",
    storeFacts: "S",
    knowledge: "K",
    corrections: [],
    now: new Date("2026-10-22T03:00:00Z"),
    openNow: true,
  };
  it("puts them after the cache breakpoint and leaves the stable part unchanged", () => {
    const plain = buildAgentPrompt(base);
    const full = buildAgentPrompt({
      ...base,
      profile: "name Budi; budget Rp 15.000.000",
      openProposal: "MacBook Air (SER1) on Sat 25 Oct 14:00 for Budi",
      recall: [{ text: "customer: air m2?\nshop: Rp12.500.000", at: T(0) }],
    });
    expect(full.stable).toBe(plain.stable);
    expect(full.stable).not.toMatch(/Budi|Rp12\.500\.000/);
    expect(full.volatile).toMatch(/name Budi; budget Rp 15\.000\.000/);
    expect(full.volatile).toMatch(/booking proposal, not yet confirmed/);
    expect(full.volatile).toMatch(/Earlier with this customer/);
  });
});

describe("voyageEmbed", () => {
  const ok = (vectors: number[][]) =>
    (async () =>
      new Response(
        JSON.stringify({
          data: vectors.map((embedding, index) => ({ embedding, index })),
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  const vec = (x: number) => Array.from({ length: VOYAGE_DIMENSIONS }, () => x);

  it("posts the owner's request shape and returns the vectors in order", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(
        JSON.stringify({
          data: [
            { embedding: vec(2), index: 1 },
            { embedding: vec(1), index: 0 },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const out = await voyageEmbed(
      { apiKey: "k", model: "voyage-4-lite", fetchImpl },
      ["a", "b"],
      "document",
      1_000,
    );
    expect(out.map((v) => v[0])).toEqual([1, 2]);
    expect(sent!.url).toBe("https://ai.mongodb.com/v1/embeddings");
    expect((sent!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer k",
    );
    expect(JSON.parse(String(sent!.init.body))).toEqual({
      input: ["a", "b"],
      model: "voyage-4-lite",
      input_type: "document",
      output_dimension: 512,
      output_dtype: "int8",
    });
  });

  it("refuses a malformed answer, an HTTP error and a timeout without the key", async () => {
    const opts = { apiKey: "secret-key", model: "m" };
    await expect(
      voyageEmbed({ ...opts, fetchImpl: ok([[1, 2]]) }, ["a"], "query", 100),
    ).rejects.toBeInstanceOf(VoyageError);
    const e401 = await voyageEmbed(
      {
        ...opts,
        fetchImpl: (async () =>
          new Response("no", { status: 401 })) as unknown as typeof fetch,
      },
      ["a"],
      "query",
      100,
    ).catch((e: unknown) => e as VoyageError);
    expect(e401).toBeInstanceOf(VoyageError);
    expect((e401 as VoyageError).status).toBe(401);
    expect((e401 as VoyageError).message).not.toMatch(/secret-key/);
    const slow = (async (_u: string, init: RequestInit) =>
      new Promise((_res, rej) =>
        init.signal!.addEventListener("abort", () =>
          rej(Object.assign(new Error("t"), { name: "TimeoutError" })),
        ),
      )) as unknown as typeof fetch;
    const started = Date.now();
    await expect(
      voyageEmbed({ ...opts, fetchImpl: slow }, ["a"], "query", 50),
    ).rejects.toThrow(/within 50 ms/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("is off without VOYAGE_API_KEY and defaults to voyage-4-lite", () => {
    expect(readVoyageEnv({})).toBeNull();
    expect(readVoyageEnv({ VOYAGE_API_KEY: "k" })).toEqual({
      apiKey: "k",
      model: "voyage-4-lite",
    });
    expect(
      readVoyageEnv({ VOYAGE_API_KEY: "k", VOYAGE_MODEL: "voyage-4" })!.model,
    ).toBe("voyage-4");
  });
});
