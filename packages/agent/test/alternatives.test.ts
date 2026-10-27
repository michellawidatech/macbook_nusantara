/**
 * Out of stock is not the end of the conversation, and a suggestion may carry
 * one gentle step up (owner, 2026-10-27): *"if the stock is 0, the system
 * should upsell / cross sell items"* and *"when suggesting an item, we should
 * suggest something more expensive as well, but do not force them"*.
 *
 * Real queries against a real schema, as stock.test.ts: the ranking is only
 * worth anything if the rows underneath it are the shop's sellable rows.
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

const NOW = new Date("2026-10-27T03:00:00.000Z");
const FROM = "628111000777";
let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

async function category(id: string, name: string, tracksSerial = true) {
  await db.category.create({
    data: {
      id,
      name,
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
      tracksSerial,
    },
  });
}

async function sku(opts: {
  id: string;
  categoryId: string;
  model: string;
  name: string;
  variant?: string;
  price: bigint;
}) {
  await db.catalogModel.upsert({
    where: { id: `mdl_${opts.model}` },
    update: {},
    create: {
      id: `mdl_${opts.model}`,
      categoryId: opts.categoryId,
      name: opts.model,
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: opts.id,
      modelId: `mdl_${opts.model}`,
      code: opts.id.toUpperCase(),
      name: opts.name,
      variantLabel: opts.variant ?? null,
      price: opts.price,
      landed: 1n,
      archived: false,
      createdAt: NOW,
    },
  });
}

let n = 0;
async function unit(
  skuId: string,
  opts: {
    price?: bigint | null;
    grade?: "A" | "B" | "C";
    status?: "TERSEDIA" | "TERJUAL";
  } = {},
) {
  n += 1;
  const serial = `ALT${String(n).padStart(4, "0")}`;
  await db.unit.create({
    data: {
      id: `u_${serial}`,
      serial,
      skuId,
      status: opts.status ?? "TERSEDIA",
      locationId: "loc_a",
      buy: 1n,
      landed: 1n,
      grade: opts.grade ?? "A",
      price: opts.price ?? null,
      intakeAt: new Date(NOW.getTime() - n * 60_000),
      version: 1,
    },
  });
  return serial;
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
      id: "staff_alt",
      username: "alt_kasir",
      name: "Kasir",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await category("cat_air", "MacBook Air");
  await category("cat_pro", "MacBook Pro");
  await category("cat_watch", "Apple Watch");
  await category("cat_acc", "Accessories", false);

  // Asked for, and sold out.
  await sku({
    id: "air_m3_16",
    categoryId: "cat_air",
    model: 'MacBook Air 13" M3',
    name: 'MacBook Air 13" M3',
    variant: "16/512",
    price: 18_000_000n,
  });
  // On the shelf.
  await sku({
    id: "air_m2_8",
    categoryId: "cat_air",
    model: 'MacBook Air 13" M2',
    name: 'MacBook Air 13" M2',
    variant: "8/256",
    price: 11_000_000n,
  });
  await sku({
    id: "air_m2_16",
    categoryId: "cat_air",
    model: 'MacBook Air 13" M2',
    name: 'MacBook Air 13" M2 16GB',
    variant: "16/512",
    price: 14_000_000n,
  });
  await sku({
    id: "air_m1",
    categoryId: "cat_air",
    model: 'MacBook Air 13" M1',
    name: 'MacBook Air 13" M1',
    variant: "8/256",
    price: 8_000_000n,
  });
  await sku({
    id: "pro_m3",
    categoryId: "cat_pro",
    model: 'MacBook Pro 14" M3',
    name: 'MacBook Pro 14" M3',
    variant: "8/512",
    price: 19_000_000n,
  });
  await sku({
    id: "watch_s9",
    categoryId: "cat_watch",
    model: "Apple Watch Series 9",
    name: "Apple Watch Series 9",
    price: 18_000_000n,
  });
  await sku({
    id: "acc_charger",
    categoryId: "cat_acc",
    model: "Charger",
    name: "Charger MacBook Air 30W",
    price: 450_000n,
  });
});

const ctx: ToolContext = {
  from: FROM,
  now: NOW,
  capabilities: LIVE_CAPABILITIES,
};
const search = (
  args: Record<string, unknown>,
  over: Partial<ToolContext> = {},
) =>
  dispatchTool(db, "search_stock", args, { ...ctx, ...over }) as Promise<
    Record<string, unknown>
  >;

type Shown = { serial: string; model: string; price?: string | null };
const serials = (v: unknown) => ((v ?? []) as Shown[]).map((u) => u.serial);

describe("when what they asked for is sold out", () => {
  it("offers the closest units in stock: the same line first, then the nearest price", async () => {
    await unit("air_m3_16", { status: "TERJUAL" });
    const m1 = await unit("air_m1");
    const m2 = await unit("air_m2_8");
    const m2big = await unit("air_m2_16");
    const pro = await unit("pro_m3");
    await unit("watch_s9");

    const out = await search({ query: "air m3 16/512" });
    expect(out["units"]).toEqual([]);
    // Nearest to the Rp18jt the M3 asks: the 16/512 M2, then the 8/256, then
    // the M1. The Pro is nearer in price but a different line, and the watch
    // is never an alternative to a MacBook.
    expect(serials(out["alternatives"])).toEqual([m2big, m2, m1]);
    expect(serials(out["alternatives"])).not.toContain(pro);
    expect(JSON.stringify(out)).not.toContain("Watch");
    expect(String(out["alternativesNote"])).toMatch(/not in\s+stock/);
  });

  it("stays inside the budget the customer gave", async () => {
    await unit("air_m1");
    const m2 = await unit("air_m2_8");
    await unit("air_m2_16");
    const out = await search({ query: "air m3", maxPrice: 12_000_000 });
    expect(serials(out["alternatives"])).toEqual([m2, expect.any(String)]);
    for (const u of out["alternatives"] as Shown[])
      expect(String(u.price).replace(/\D/g, "")).toMatch(/^(11|8)000000$/);
  });

  it("reads the budget off the customer's own profile when the search names none", async () => {
    await db.customerProfile.create({
      data: { from: FROM, budgetMax: 9_000_000n, updatedAt: NOW },
    });
    const m1 = await unit("air_m1");
    await unit("air_m2_8");
    const out = await search({ query: "air m3" });
    expect(serials(out["alternatives"])).toEqual([m1]);
    // Somebody else's profile is not this customer's budget.
    const other = await search({ query: "air m3" }, { from: "628999" });
    expect(serials(other["alternatives"])).toHaveLength(2);
  });

  it("never offers a unit the shop has not priced, and one per variant and grade", async () => {
    await unit("air_m2_8", { price: null });
    await unit("air_m2_8");
    await unit("air_m2_8");
    await db.sku.update({ where: { id: "air_m1" }, data: { price: 0n } });
    await unit("air_m1");
    const out = await search({ query: "air m3" });
    expect(out["alternatives"]).toHaveLength(1);
  });

  it("adds one accessory that fits the line, when it is on the shelf", async () => {
    await unit("air_m2_8");
    await db.stockMove.create({
      data: {
        skuId: "acc_charger",
        locationId: "loc_a",
        qty: 3,
        unitCost: 200_000n,
        type: "MASUK",
        at: NOW,
        staffId: "staff_alt",
      },
    });
    const out = await search({ query: "air m3" });
    expect(out["accessory"]).toMatchObject({
      model: "Charger MacBook Air 30W",
    });
    expect(String((out["accessory"] as Shown).price).replace(/\D/g, "")).toBe(
      "450000",
    );
    // Nothing for a line it does not name.
    expect((await search({ query: "pro m4" }))["accessory"]).toBeUndefined();
  });

  it("offers nothing from an unrelated line", async () => {
    await unit("watch_s9");
    const out = await search({ query: "air m3" });
    expect(out["alternatives"]).toBeUndefined();
  });

  it("quotes no figure and ranks by nothing but the line with the price switch off", async () => {
    await unit("air_m2_8");
    const out = await search(
      { query: "air m3" },
      { capabilities: { ...LIVE_CAPABILITIES, price: false } },
    );
    expect(JSON.stringify(out)).not.toContain("Rp");
    expect(out["alternatives"]).toHaveLength(1);
    expect(out["stepUp"]).toBeUndefined();
  });
});

describe("one step up", () => {
  it("offers the cheapest unit above the main pick, at most 30% dearer", async () => {
    const m2 = await unit("air_m2_8"); // Rp11jt
    const m2big = await unit("air_m2_16"); // Rp14jt — 27% more
    await unit("air_m3_16"); // Rp18jt — too far
    const out = await search({ query: "air m2 8/256" });
    expect(serials(out["units"])).toEqual([m2]);
    expect((out["stepUp"] as Shown).serial).toBe(m2big);
    expect(String(out["stepUpNote"])).toMatch(/never push/i);
  });

  it("stays in the same line and offers none when nothing is a small step above", async () => {
    await unit("air_m2_8");
    await unit("pro_m3");
    const out = await search({ query: "air m2 8/256" });
    expect(out["stepUp"]).toBeUndefined();
  });

  it("goes no further than a fifth over a stated ceiling", async () => {
    await unit("air_m2_8", { price: 10_000_000n });
    await unit("air_m2_16", { price: 12_900_000n }); // 29% up, 29% over 10jt
    const capped = await search({
      query: "air m2 8/256",
      maxPrice: 10_000_000,
    });
    expect(capped["stepUp"]).toBeUndefined();
    const out = await search({ query: "air m2 8/256", maxPrice: 11_000_000 });
    expect(out["stepUp"]).toBeDefined();
  });

  it("steps up from the first alternative when the asked unit is gone", async () => {
    await unit("air_m1"); // Rp8jt
    const m2 = await unit("air_m2_8"); // Rp11jt
    const out = await search({ query: "air m3", maxPrice: 8_500_000 });
    expect(serials(out["alternatives"])).toHaveLength(1);
    // 8jt × 1.3 = 10.4jt and 8.5jt × 1.2 = 10.2jt: the M2 at 11jt is too far.
    expect(out["stepUp"]).toBeUndefined();
    const roomy = await search({ query: "air m3", maxPrice: 9_000_000 });
    expect(roomy["stepUp"]).toBeUndefined();
    await db.unit.update({
      where: { serial: m2 },
      data: { price: 10_000_000n },
    });
    expect(
      (
        (await search({ query: "air m3", maxPrice: 8_500_000 }))[
          "stepUp"
        ] as Shown
      ).serial,
    ).toBe(m2);
  });
});

describe("the grounding check vouches for what the lookup offered", () => {
  it("lets a reply quote an alternative's and the step up's price, and nothing else", async () => {
    await unit("air_m2_8");
    await unit("air_m2_16");
    const out = await search({ query: "air m3" });
    const facts = stockFactsOf("search_stock", out);
    const check = (message: string) =>
      checkReply({
        message,
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [],
        stockFacts: facts,
      });
    expect(
      check(
        "Air M3-nya lagi kosong kak 🙏 Yang ready Air M2 16/512 Rp14.000.000. " +
          "Atau Air M2 8/256 Rp11.000.000.",
      ),
    ).toBeNull();
    expect(check("Air M2 ready kak, Rp12.000.000")).toBe(
      "AMOUNT_NOT_IN_SOURCE",
    );
  });

  it("reads the step up and the accessory as facts", () => {
    const facts = stockFactsOf("search_stock", {
      units: [],
      alternatives: [
        { serial: "A", model: "MacBook Air M2", price: "Rp 11.000.000" },
      ],
      stepUp: {
        serial: "B",
        model: "MacBook Air M2",
        variant: "16/512",
        price: "Rp 14.000.000",
      },
      accessory: { model: "Charger MacBook Air 30W", price: "Rp 450.000" },
    });
    expect(facts).toEqual([
      { label: "MacBook Air M2", available: true, prices: ["11000000"] },
      { label: "MacBook Air M2 16/512", available: true, prices: ["14000000"] },
      { label: "Charger MacBook Air 30W", available: true, prices: ["450000"] },
    ]);
  });
});

describe("what a recommendation may say about a unit (2026-10-27)", () => {
  it("counts each variant on the shelf, so only a true last one reads 'tinggal 1'", async () => {
    const lone = await unit("air_m2_16");
    await unit("air_m2_8");
    await unit("air_m2_8");
    await unit("air_m2_8", { status: "TERJUAL" });
    const out = await search({ query: "air m2" });
    const byserial = new Map(
      (out["units"] as Array<{ serial: string; left?: number }>).map((u) => [
        u.serial,
        u.left,
      ]),
    );
    expect(byserial.get(lone)).toBe(1);
    expect([...byserial.values()].filter((l) => l === 2)).toHaveLength(2);
    const facts = stockFactsOf("search_stock", out);
    expect(
      checkReply({
        message: "Air M2 16/512 tinggal 1 unit kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [],
        stockFacts: facts,
      }),
    ).toBeNull();
    expect(
      checkReply({
        message: "Air M2 8/256 tinggal 1 unit kak",
        sourceCount: 1,
        unknownSources: 0,
        sourceTexts: [],
        stockFacts: facts,
      }),
    ).toBe("AVAILABILITY_NOT_IN_SOURCE");
  });

  it("carries the battery reading the unit's era records", async () => {
    const s = await unit("air_m2_8");
    const attr = await db.categoryAttribute.create({
      data: {
        categoryId: "cat_air",
        key: "baterai",
        label: "Baterai",
        type: "NUMBER",
        unit: "%",
        sortOrder: 1,
      },
    });
    await db.unitAttribute.create({
      data: { unitId: `u_${s}`, attributeId: attr.id, value: "91" },
    });
    const out = await search({ query: "air m2" });
    expect((out["units"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      serial: s,
      batteryHealth: 91,
    });
  });
});

describe("tell me when it's in stock (2026-10-27)", () => {
  const watch = (
    args: Record<string, unknown>,
    over: Partial<ToolContext> = {},
  ) =>
    dispatchTool(db, "watch_stock", args, {
      ...ctx,
      profile: { write: db },
      ...over,
    }) as Promise<Record<string, unknown>>;

  it("remembers what they want, resolved to the variant when the words name one", async () => {
    expect(
      await watch({ query: "air m3 16/512", budget: 20_000_000 }),
    ).toMatchObject({ saved: true });
    const w = await db.stockWatch.findFirstOrThrow();
    expect(w).toMatchObject({
      from: FROM,
      query: "air m3 16/512",
      skuId: "air_m3_16",
      modelId: 'mdl_MacBook Air 13" M3',
      budget: 20_000_000n,
      notifiedAt: null,
      closedAt: null,
    });
  });

  it("is one wish however many times they say yes", async () => {
    await watch({ query: "air m3 16/512" });
    expect(await watch({ query: "Air M3 16/512" })).toMatchObject({
      already: true,
    });
    expect(await db.stockWatch.count()).toBe(1);
  });

  it("resolves to the product, not a variant, when the words fit several", async () => {
    await watch({ query: "air m2" });
    expect(await db.stockWatch.findFirstOrThrow()).toMatchObject({
      skuId: null,
      modelId: 'mdl_MacBook Air 13" M2',
    });
  });

  it("writes nothing for a caller that may not write", async () => {
    expect(
      await watch({ query: "air m3" }, { profile: undefined }),
    ).toMatchObject({
      error: expect.any(String),
    });
    expect(await db.stockWatch.count()).toBe(0);
  });
});
