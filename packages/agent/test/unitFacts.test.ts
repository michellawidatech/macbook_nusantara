/**
 * What a unit result says, and in what order a shelf is offered (owner,
 * 2026-10-28): condition split into faults and marks, "belum pernah servis"
 * only when it is true, the variant's listing links, the cheapest unit of the
 * lowest grade first with one line per other grade — and a reply may send no
 * link a lookup did not return.
 *
 * Real queries against a real schema, as alternatives.test.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import {
  LIVE_CAPABILITIES,
  checkReply,
  dispatchTool,
  stockFactsOf,
  type ToolContext,
} from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const NOW = new Date("2026-10-28T03:00:00.000Z");
const SHOPEE = "https://shopee.co.id/product/976133661/19990430237";
let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

let n = 0;
async function unit(opts: {
  grade: "A" | "B" | "C" | "NEW";
  price: bigint | null;
  description?: string;
  neverServiced?: boolean;
  photos?: number;
}) {
  n += 1;
  const serial = `FCT${String(n).padStart(4, "0")}`;
  await db.unit.create({
    data: {
      id: `u_${serial}`,
      serial,
      skuId: "air_m2",
      status: "TERSEDIA",
      locationId: "loc_a",
      buy: 1n,
      landed: 1n,
      grade: opts.grade,
      price: opts.price,
      description: opts.description ?? null,
      neverServiced: opts.neverServiced ?? null,
      intakeAt: new Date(NOW.getTime() - n * 60_000),
      version: 1,
    },
  });
  if (opts.photos) {
    await db.unitNote.create({
      data: {
        id: `note_${serial}`,
        unitId: `u_${serial}`,
        serial,
        body: "QC",
        staffId: "staff_fct",
        at: NOW,
        photos: {
          create: Array.from({ length: opts.photos }, (_, i) => ({
            id: `ph_${serial}_${i}`,
            url: `/photos/${serial}/${i}.jpg`,
            sortOrder: i,
          })),
        },
      },
    });
  }
  return serial;
}

beforeEach(async () => {
  await truncateAll(db);
  n = 0;
  await db.location.create({
    data: { id: "loc_a", code: "01", name: "Toko", kind: "TOKO", active: true, sortOrder: 1 },
  });
  await db.staff.create({
    data: {
      id: "staff_fct",
      username: "fct_kasir",
      name: "Kasir",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await db.category.create({
    data: {
      id: "cat_air",
      name: "MacBook Air",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await db.catalogModel.create({
    data: {
      id: "mdl_air_m2",
      categoryId: "cat_air",
      name: 'MacBook Air 13" M2',
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "air_m2",
      modelId: "mdl_air_m2",
      code: "AIR_M2",
      name: 'MacBook Air 13" M2',
      variantLabel: "8/256",
      price: 11_000_000n,
      landed: 1n,
      archived: false,
      createdAt: NOW,
      shopeeUrl: SHOPEE,
    },
  });
});

const ctx: ToolContext = {
  from: "628111000888",
  now: NOW,
  capabilities: LIVE_CAPABILITIES,
};
const run = (tool: string, args: Record<string, unknown>) =>
  dispatchTool(db, tool, args, ctx) as Promise<Record<string, unknown>>;

type Row = Record<string, unknown>;

describe("search_stock — cheapest grade first, with what to say about each unit", () => {
  it("leads with the cheapest unit of the lowest grade and lists the other grades", async () => {
    await unit({ grade: "A", price: 12_000_000n });
    await unit({ grade: "C", price: 10_000_000n });
    const cheapC = await unit({
      grade: "C",
      price: 9_500_000n,
      description: "Lecet halus, Baterai lemah",
      neverServiced: true,
    });
    await unit({ grade: "B", price: 10_800_000n });

    const out = await run("search_stock", { query: "air m2" });
    const units = out["units"] as Row[];
    expect(units[0]!["serial"]).toBe(cheapC);
    expect(units[0]).toMatchObject({
      grade: "C",
      condition: { faults: ["Baterai lemah"], marks: ["Lecet halus"] },
      serviced: "never",
      links: { shopee: SHOPEE },
    });
    const others = out["otherGrades"] as Row[];
    expect(others.map((g) => [g["grade"], g["count"]])).toEqual([
      ["B", 1],
      ["A", 1],
    ]);
    expect(String(out["unitNote"])).toMatch(/belum pernah servis/);
  });

  it("says serviced once the unit has been to the bench, whatever QC said", async () => {
    const serial = await unit({ grade: "A", price: 12_000_000n, neverServiced: true });
    await db.serviceVisit.create({
      data: {
        unitId: `u_${serial}`,
        fromLocationId: "loc_a",
        openedAt: NOW,
        raisedBy: "QC",
        staffId: "staff_fct",
      },
    });
    const out = await run("check_serial", { serial });
    expect(out["serviced"]).toBe("yes");
    expect(out["links"]).toEqual({ shopee: SHOPEE });
  });

  it("says nothing about servicing when QC left it blank", async () => {
    const serial = await unit({ grade: "A", price: 12_000_000n });
    const out = await run("check_serial", { serial });
    expect(out).not.toHaveProperty("serviced");
    expect(out).not.toHaveProperty("condition");
  });
});

describe("find_unit_photos — the photos start where the offer does", () => {
  it("shows the lowest grade, cheapest unit that has photos", async () => {
    await unit({ grade: "A", price: 12_000_000n, photos: 2 });
    const c = await unit({ grade: "C", price: 10_000_000n, photos: 1 });
    await unit({ grade: "C", price: 9_000_000n }); // cheaper, but no photos
    const out = await run("find_unit_photos", { query: "air m2" });
    expect(out["serial"]).toBe(c);
  });
});

describe("checkReply — no link a lookup did not return", () => {
  it("lets the variant's own link through and refuses any other", async () => {
    await unit({ grade: "A", price: 12_000_000n });
    const facts = stockFactsOf(
      "search_stock",
      await run("search_stock", { query: "air m2" }),
    );
    const base = { sourceCount: 1, unknownSources: 0, sourceTexts: [], stockFacts: facts };
    expect(
      checkReply({ ...base, message: `Bisa checkout di sini ya kak: ${SHOPEE}.` }),
    ).toBeNull();
    expect(
      checkReply({
        ...base,
        message: "Bisa checkout di sini kak: https://shopee.co.id/product/1/2",
      }),
    ).toBe("LINK_INVENTED");
  });
});
