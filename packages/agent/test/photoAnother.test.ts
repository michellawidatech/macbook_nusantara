/**
 * "Ada yang lain?" after a unit's photos (owner, 2026-11-12): another unit of
 * the same model when the shelf has one with photos; when that was the last
 * one, the closest units that fit the customer's budget — the first one's
 * photos with it — and a person only when nothing fits.
 *
 * Real queries against a real schema, as unitFacts.test.ts.
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

const NOW = new Date("2026-11-12T03:00:00.000Z");
const FROM = "628111000777";
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
  sku: string;
  price: bigint;
  grade?: "A" | "B" | "C";
  photos?: number;
}) {
  n += 1;
  const serial = `PHA${String(n).padStart(4, "0")}`;
  await db.unit.create({
    data: {
      id: `u_${serial}`,
      serial,
      skuId: opts.sku,
      status: "TERSEDIA",
      locationId: "loc_a",
      buy: 1n,
      landed: 1n,
      grade: opts.grade ?? "A",
      price: opts.price,
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
        staffId: "staff_pha",
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

/** The chat has already received this unit's photos. */
async function sent(serial: string, photos: number) {
  for (let i = 0; i < photos; i += 1)
    await db.outbox.create({
      data: {
        kind: "WA_IMAGE",
        payload: { to: FROM, photoId: `ph_${serial}_${i}` },
        status: "SENT",
        attempts: 1,
        nextAttemptAt: NOW,
        createdAt: NOW,
        sentAt: NOW,
      },
    });
}

async function variant(id: string, model: string, name: string, label: string) {
  await db.catalogModel
    .create({
      data: {
        id: model,
        categoryId: "cat_air",
        name,
        archived: false,
        createdAt: NOW,
      },
    })
    .catch(() => undefined);
  await db.sku.create({
    data: {
      id,
      modelId: model,
      code: id.toUpperCase(),
      name,
      variantLabel: label,
      price: 1n,
      landed: 1n,
      archived: false,
      createdAt: NOW,
    },
  });
}

beforeEach(async () => {
  await truncateAll(db);
  n = 0;
  await db.location.create({
    data: {
      id: "loc_a",
      code: "01",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.staff.create({
    data: {
      id: "staff_pha",
      username: "pha_kasir",
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
  await variant("air_m2", "mdl_air_m2", 'MacBook Air 13" M2', "8/256");
  await variant("air_m1", "mdl_air_m1", 'MacBook Air 13" M1', "8/256");
  await variant("air_m3", "mdl_air_m3", 'MacBook Air 13" M3', "16/512");
});

const ctx: ToolContext = {
  from: FROM,
  now: NOW,
  capabilities: LIVE_CAPABILITIES,
};
const run = (tool: string, args: Record<string, unknown>) =>
  dispatchTool(db, tool, args, ctx) as Promise<Record<string, unknown>>;

type Row = Record<string, unknown>;

describe("find_unit_photos with another — a different unit of the same model", () => {
  it("leaves out the unit whose photos this chat already has", async () => {
    const first = await unit({ sku: "air_m2", price: 11_000_000n, photos: 2 });
    const second = await unit({ sku: "air_m2", price: 12_000_000n, photos: 1 });
    await sent(first, 2);
    const out = await run("find_unit_photos", {
      query: "air m2",
      another: true,
    });
    expect(out["serial"]).toBe(second);
    expect(out["photoIds"]).toEqual([`ph_${second}_0`]);
  });

  it("finds the model from a serial when no query is given", async () => {
    const first = await unit({ sku: "air_m2", price: 11_000_000n, photos: 2 });
    const second = await unit({ sku: "air_m2", price: 12_000_000n, photos: 1 });
    await sent(first, 2);
    const out = await run("find_unit_photos", {
      serial: first,
      another: true,
    });
    expect(out["serial"]).toBe(second);
  });

  it("without another, still shows the first unit (the photos are sent again)", async () => {
    const first = await unit({ sku: "air_m2", price: 11_000_000n, photos: 2 });
    await unit({ sku: "air_m2", price: 12_000_000n, photos: 1 });
    await sent(first, 2);
    const out = await run("find_unit_photos", { query: "air m2" });
    expect(out["serial"]).toBe(first);
  });

  it("hands photos to a person when the other units have none", async () => {
    const first = await unit({ sku: "air_m2", price: 11_000_000n, photos: 2 });
    await unit({ sku: "air_m2", price: 12_000_000n });
    await sent(first, 2);
    const out = await run("find_unit_photos", {
      query: "air m2",
      another: true,
    });
    expect(out["photoIds"]).toEqual([]);
    expect(out["onlyOne"]).toBeUndefined();
    expect(String(out["note"])).toMatch(/topic photos/);
  });
});

describe("find_unit_photos with another — that was the last one", () => {
  it("says so and offers the closest units within their budget, the first with photos", async () => {
    const last = await unit({ sku: "air_m2", price: 11_000_000n, photos: 2 });
    await sent(last, 2);
    const m1 = await unit({ sku: "air_m1", price: 9_000_000n, photos: 1 });
    await unit({ sku: "air_m3", price: 18_000_000n, photos: 1 }); // over budget
    await db.customerProfile.create({
      data: {
        from: FROM,
        budgetMin: null,
        budgetMax: 12_000_000n,
        updatedAt: NOW,
      },
    });
    const out = await run("find_unit_photos", {
      query: "air m2",
      another: true,
    });
    expect(out["onlyOne"]).toBe(true);
    const alts = out["alternatives"] as Row[];
    expect(alts.map((a) => a["serial"])).toEqual([m1]);
    expect(alts[0]!["photoIds"]).toEqual([`ph_${m1}_0`]);
    expect(out).not.toHaveProperty("noAlternatives");

    // The reply may quote the alternative at the price this lookup gave.
    const facts = stockFactsOf("find_unit_photos", out);
    expect(facts.map((f) => f.serial)).toContain(m1);
    expect(
      checkReply({
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [],
        stockFacts: facts,
        message:
          "Untuk Air M2 cuma tinggal unit itu aja kak. Ada Air M1 8/256 9jt, cocok buat kuliah.",
      }),
    ).toBeNull();
  });

  it("marks noAlternatives when nothing on the shelf fits the budget", async () => {
    const last = await unit({ sku: "air_m2", price: 11_000_000n, photos: 2 });
    await sent(last, 2);
    await unit({ sku: "air_m3", price: 18_000_000n, photos: 1 });
    await db.customerProfile.create({
      data: {
        from: FROM,
        budgetMin: null,
        budgetMax: 8_000_000n,
        updatedAt: NOW,
      },
    });
    const out = await run("find_unit_photos", {
      query: "air m2",
      another: true,
    });
    expect(out["onlyOne"]).toBe(true);
    expect(out["noAlternatives"]).toBe(true);
    expect(out["alternatives"]).toBeUndefined();
  });
});
