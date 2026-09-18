/**
 * `pnpm --filter @nusantara/api knowledge <file>` — the first load of the
 * owner's answer sheet on a fresh database (2026-09-18), against a real one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { importKnowledge } from "../src/cli/import-knowledge.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const SHEET = [
  "Lists of Questions:",
  "Q: Cod bisa ga kak?",
  "A: Bisa kak 😊 Untuk COD area Jabodetabek ada biaya transportasi Rp180.000 ya kak.",
  "Q: Garansi berapa lama kak?",
  "A: Garansi dari kami 1 bulan ya kak 😊",
  "Terhitung sejak unit diterima.",
  "Q: Bisa PO?",
].join("\n");

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.agentKnowledge.deleteMany({});
  await db.storeChange.deleteMany({ where: { collection: "knowledge" } });
  await db.staff.upsert({
    where: { id: "staff_kb_import" },
    update: {},
    create: {
      id: "staff_kb_import",
      username: "kb_import",
      name: "Pemilik",
      role: "OWNER",
      canApprove: true,
      active: true,
      passwordHash: "x",
      createdAt: new Date(),
    },
  });
});

describe("importing the owner's answer sheet", () => {
  it("adds every answered pair in the sheet's order, and tells the tills", async () => {
    const result = await importKnowledge(db, SHEET, {
      staffId: "staff_kb_import",
    });
    expect(result).toEqual({ added: 2, skipped: [], unanswered: ["Bisa PO?"] });

    const rows = await db.agentKnowledge.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(rows.map((r) => r.question)).toEqual([
      "Cod bisa ga kak?",
      "Garansi berapa lama kak?",
    ]);
    expect(rows[1]!.answer).toBe(
      "Garansi dari kami 1 bulan ya kak 😊\nTerhitung sejak unit diterima.",
    );
    expect(
      rows.every((r) => r.active && r.createdById === "staff_kb_import"),
    ).toBe(true);
    // An open till learns of them on its next poll.
    expect(
      await db.storeChange.count({ where: { collection: "knowledge" } }),
    ).toBe(2);
  });

  it("adds nothing the second time, whatever the spelling of the question", async () => {
    await importKnowledge(db, SHEET, { staffId: "staff_kb_import" });
    const again = await importKnowledge(
      db,
      SHEET.replace("Cod bisa ga kak?", "COD bisa ga kak ??"),
      { staffId: "staff_kb_import" },
    );
    expect(again.added).toBe(0);
    expect(again.skipped).toHaveLength(2);
    expect(await db.agentKnowledge.count()).toBe(2);
  });

  it("writes nothing on a dry run", async () => {
    const result = await importKnowledge(db, SHEET, {
      staffId: "staff_kb_import",
      dryRun: true,
    });
    expect(result.added).toBe(2);
    expect(await db.agentKnowledge.count()).toBe(0);
  });
});
