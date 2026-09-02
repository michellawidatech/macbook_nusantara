/**
 * The staff-written answers, and why they are a tool and not just a prompt block.
 *
 * `AgentKnowledge` already rides in the system prompt, but only the forty most
 * recently edited, and a prompt block is something a model may or may not reach
 * for. A tool call is different in two ways that matter here: it scales past
 * whatever fits in a prompt, and its result arrives as a fact retrieved in THIS
 * turn — which is the standing the grounding rules give a tool result and
 * explicitly withhold from the model's own memory.
 *
 * The case that matters most is the empty one. A bot that answers "bisa kirim
 * ke Surabaya?" from what sounds reasonable has committed the shop to a
 * delivery nobody agreed to. So a miss returns an instruction to hand over,
 * not an invitation to improvise.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { dispatchTool, type ToolContext } from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const NOW = new Date("2026-08-20T03:00:00.000Z");
const STAFF = "staff_kb";

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.agentKnowledge.deleteMany({});
  await db.staff.deleteMany({ where: { id: STAFF } });
  await db.staff.create({
    data: {
      id: STAFF, username: "kb_staff", name: "Staf", role: "STAFF",
      canApprove: false, active: true, passwordHash: "unusable", createdAt: NOW,
    },
  });
});

async function entry(question: string, answer: string, active = true) {
  return db.agentKnowledge.create({
    data: {
      question, answer, active,
      createdById: STAFF, createdAt: NOW, updatedAt: NOW,
    },
  });
}

const ctx: ToolContext = { from: "628111000321", now: NOW };

const ask = (query: string) =>
  dispatchTool(db, "search_knowledge", { query }, ctx) as Promise<
    Record<string, unknown>
  >;

describe("finding an approved answer", () => {
  it("finds an answer the shop has written", async () => {
    await entry("Terima tukar tambah?", "Iya, bawa unitnya buat dicek dulu.");
    const out = await ask("tukar tambah");
    expect(out).toMatchObject({ found: true });
    expect(JSON.stringify(out)).toContain("bawa unitnya buat dicek dulu");
  });

  it("matches on the answer text too, not only the question", async () => {
    // A customer rarely phrases it the way staff wrote the question.
    await entry("Pengiriman", "Kami kirim ke seluruh Indonesia lewat JNE dan SiCepat.");
    expect(await ask("sicepat")).toMatchObject({ found: true });
  });

  it("matches in any word order, because nobody types a question the same way twice", async () => {
    await entry("Bisa cicilan?", "Bisa, lewat kartu kredit atau Kredivo.");
    expect(await ask("cicilan kredivo")).toMatchObject({ found: true });
  });

  it("tells the bot to reword rather than read the answer out verbatim", async () => {
    await entry("Garansi berapa lama?", "90 hari garansi toko.");
    const out = await ask("garansi");
    expect(String(out["guidance"])).toMatch(/reword them into your own voice/i);
    expect(String(out["guidance"])).toMatch(/do not add anything they do not say/i);
  });

  it("never returns an answer staff switched off", async () => {
    // Deactivating is how staff retract something that stopped being true.
    await entry("Promo lebaran?", "Diskon 2 juta sampai akhir bulan.", false);
    expect(await ask("promo lebaran")).toMatchObject({ found: false });
  });

  it("caps how many answers come back, so one search cannot fill the context", async () => {
    for (let i = 0; i < 10; i += 1) {
      await entry(`Pengiriman kota ${i}`, `Kirim ke kota ${i} bisa.`);
    }
    const out = await ask("pengiriman");
    expect((out["answers"] as unknown[]).length).toBeLessThanOrEqual(6);
  });
});

describe("when the shop has not written an answer", () => {
  it("says so, and tells the bot to hand over rather than work it out", async () => {
    // The whole point. "bisa kirim ke Surabaya?" answered from what sounds
    // reasonable is a delivery promise nobody at the shop agreed to.
    await entry("Garansi berapa lama?", "90 hari garansi toko.");

    const out = await ask("bisa bayar pakai crypto");

    expect(out).toMatchObject({ found: false });
    expect(String(out["guidance"])).toMatch(/do NOT work one out yourself/i);
    expect(String(out["guidance"])).toMatch(/handoff_to_staff/);
  });

  it("returns nothing rather than everything for a query that matches nothing", async () => {
    await entry("Garansi berapa lama?", "90 hari garansi toko.");
    expect(await ask("zzzzqqq")).toMatchObject({ found: false });
  });

  it("reports an empty question as an error rather than dumping the whole base", async () => {
    await entry("Garansi berapa lama?", "90 hari garansi toko.");
    expect(await ask("   ")).toMatchObject({ error: expect.any(String) });
  });

  it("treats a wildcard as text, not as a pattern matching everything", async () => {
    await entry("Garansi berapa lama?", "90 hari garansi toko.");
    expect(await ask("%")).toMatchObject({ found: false });
  });
});

describe("what a customer cannot do to it", () => {
  it("is read-only: a search writes nothing", async () => {
    await entry("Garansi berapa lama?", "90 hari garansi toko.");
    const before = await db.agentKnowledge.findMany();
    await ask("garansi");
    expect(await db.agentKnowledge.findMany()).toEqual(before);
  });

  it("has no tool that could add an answer, so the bot cannot write its own instructions", async () => {
    // Knowledge is injected into the system prompt. A bot that could write it
    // would be authoring its own rules, permanently.
    const { ANTHROPIC_TOOLS } = await import("../src/tools.js");
    const names = ANTHROPIC_TOOLS.map((t) => t.name);
    expect(names).not.toContain("save_knowledge");
    expect(names).not.toContain("remember_preference");
    expect(names.filter((n) => /knowledge/.test(n))).toEqual(["search_knowledge"]);
  });
});
