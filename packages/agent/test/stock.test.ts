/**
 * What the bot may say is in stock.
 *
 * Every claim a reply makes about availability or price has to have come back
 * from one of these calls in the same turn. That is the grounding rule, and it
 * is only worth anything if the query underneath it is honest: a filter that
 * quietly widens to "everything" turns "we have three" into "we have four
 * hundred", and a `BigInt` that escapes as a number does not merely look wrong,
 * it throws inside `JSON.stringify` and takes the whole turn down with it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { dispatchTool, type ToolContext } from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const NOW = new Date("2026-08-20T03:00:00.000Z");
let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.reservationItem.deleteMany({});
  await db.reservation.deleteMany({});
  await db.unitEvent.deleteMany({});
  await db.unit.deleteMany({});
  await db.sku.deleteMany({});
  await db.catalogModel.deleteMany({});
  await db.category.deleteMany({});
  await db.location.deleteMany({});

  await db.location.create({
    data: { id: "loc_s", code: "S1", name: "Toko", kind: "TOKO", active: true, sortOrder: 1 },
  });
  await db.category.create({
    data: {
      id: "cat_s", name: "MacBook", sortOrder: 1, marginMode: "PCT",
      marginMin: 5n, marginMax: 30n, createdAt: NOW,
    },
  });
  await db.catalogModel.create({
    data: { id: "mdl_s", categoryId: "cat_s", name: "MacBook Air M2", archived: false, createdAt: NOW },
  });
  await db.sku.create({
    data: {
      id: "sku_s", modelId: "mdl_s", code: "SKU-S1", name: "MacBook Air M2 256GB",
      variantLabel: "8/256", grade: "A", price: 15_500_000n, landed: 12_000_000n,
      archived: false, createdAt: NOW,
    },
  });
});

/** A unit in a given state. Status is set directly: this suite is about reads. */
async function unit(opts: {
  id: string;
  serial: string;
  status: "QC" | "TERSEDIA" | "DIRESERVASI" | "TERJUAL";
  archivedAt?: Date | null;
}) {
  return db.unit.create({
    data: {
      id: opts.id, serial: opts.serial, skuId: "sku_s", status: opts.status,
      locationId: "loc_s", buy: 12_000_000n, landed: 12_000_000n,
      grade: "A", intakeAt: NOW, version: 1,
      archivedAt: opts.archivedAt ?? null,
    },
  });
}

const ctx: ToolContext = { from: "628111000321", now: NOW };
const search = (args: Record<string, unknown> = {}) =>
  dispatchTool(db, "search_stock", args, ctx) as Promise<Record<string, unknown>>;

describe("what counts as sellable", () => {
  it("lists only what can be bought today", async () => {
    await unit({ id: "s1", serial: "AVAIL", status: "TERSEDIA" });
    await unit({ id: "s2", serial: "HELD", status: "DIRESERVASI" });
    await unit({ id: "s3", serial: "SOLD", status: "TERJUAL" });
    await unit({ id: "s4", serial: "QCING", status: "QC" });

    const out = await search();
    expect(out).toMatchObject({ matched: 1 });
    expect(JSON.stringify(out)).toContain("AVAIL");
    expect(JSON.stringify(out)).not.toContain("HELD");
  });

  it("cannot hold a sellable unit with no asking price", async () => {
    // Until 2026-08-27 this was a CHECK on a nullable `Unit.price`: the
    // database refused a sellable unit that nobody had priced. The column is
    // gone and the guarantee is stronger for it — the price is `Sku.price`,
    // which is NOT NULL, so "in stock" and "has a price" are now the same set
    // and there is no unpriced state left to refuse.
    await unit({ id: "s5", serial: "PRICED", status: "TERSEDIA" });

    const out = (await search()) as { units: Array<{ price?: string }> };

    expect(out.units).toHaveLength(1);
    // Not an exact string: formatRupiah separates with a non-breaking space.
    expect(out.units[0]!.price).toMatch(/^Rp\s15\.500\.000$/);
  });

  it("quotes one price for every unit of a variant, whatever their grade", async () => {
    // The point of the move. Two machines, same spec, different condition —
    // and the bot must not invent a difference in what the shop asks for them.
    await unit({ id: "s7", serial: "MINT", status: "TERSEDIA" });
    await db.unit.create({
      data: {
        id: "s8", serial: "SCUFFED", skuId: "sku_s", status: "TERSEDIA",
        locationId: "loc_s", buy: 11_000_000n, landed: 11_000_000n,
        grade: "C", intakeAt: NOW, version: 1,
      },
    });

    const out = (await search()) as { units: Array<{ price: string }> };

    expect(out.units).toHaveLength(2);
    expect(new Set(out.units.map((u) => u.price)).size).toBe(1);
  });

  it("never lists an archived unit", async () => {
    await unit({ id: "s6", serial: "GONE", status: "TERSEDIA", archivedAt: NOW });
    expect(await search()).toMatchObject({ matched: 0 });
  });

  it("never lists a unit whose sku staff retired", async () => {
    await unit({ id: "s7", serial: "OLDSKU", status: "TERSEDIA" });
    await db.sku.update({ where: { id: "sku_s" }, data: { archived: true } });
    expect(await search()).toMatchObject({ matched: 0 });
  });
});

describe("matching what a customer typed", () => {
  beforeEach(async () => {
    await unit({ id: "m1", serial: "M1", status: "TERSEDIA" });
  });

  it("matches the words in any order, because nobody types them the same way twice", async () => {
    for (const q of ["macbook air m2", "m2 air", "air 256gb", "MACBOOK"]) {
      expect(await search({ query: q }), q).toMatchObject({ matched: 1 });
    }
  });

  it("requires every word to match, so an unrelated word narrows to nothing", async () => {
    expect(await search({ query: "macbook iphone" })).toMatchObject({ matched: 0 });
  });

  it("narrows to nothing for a wildcard rather than listing the whole shop", async () => {
    // Prisma's `contains` does not escape LIKE wildcards. Before this, "%"
    // matched every row and the bot would report the entire inventory.
    for (const q of ["%", "_", "%%"]) {
      expect(await search({ query: q }), q).toMatchObject({ matched: 0 });
    }
  });

  it("still lists everything when no query is given at all", async () => {
    // "apa aja yang ready" is a real question, and different from a query that
    // narrowed to nothing.
    expect(await search({})).toMatchObject({ matched: 1 });
  });

  it("leaves the database untouched when a query looks like an injection", async () => {
    // Aimed at Sku now, which is where the money moved to.
    const read = () => db.sku.findMany({ select: { code: true, price: true } });
    const before = await read();
    await search({ query: `'; UPDATE "Sku" SET price=1; --` });
    expect(await read()).toEqual(before);
  });
});

describe("what crosses to the model", () => {
  beforeEach(async () => {
    await unit({ id: "p1", serial: "P1", status: "TERSEDIA" });
  });

  it("writes money as a string, never as a number", async () => {
    const out = await search();
    const json = JSON.stringify(out);
    expect(json).toContain("Rp");
    expect(json).not.toMatch(/\b15500000\b/);
  });

  it("never leaks what the shop paid", async () => {
    // `buy` and `landed` are the shop's own margin and are not selected
    // anywhere in this package.
    const json = JSON.stringify(await search());
    expect(json).not.toContain("12000000");
    expect(json).not.toMatch(/\bbuy\b|\blanded\b/);
  });

  it("honours a budget ceiling in whole rupiah", async () => {
    expect(await search({ maxPrice: 15_000_000 })).toMatchObject({ matched: 0 });
    expect(await search({ maxPrice: 16_000_000 })).toMatchObject({ matched: 1 });
  });

  it("ignores a nonsense budget rather than returning nothing", async () => {
    for (const bad of [0, -5, Number.NaN, "banyak"]) {
      expect(await search({ maxPrice: bad }), String(bad)).toMatchObject({ matched: 1 });
    }
  });

  it("caps a broad result and says how many more matched, so the bot narrows down", async () => {
    for (let i = 0; i < 15; i += 1) {
      await unit({ id: `c${i}`, serial: `C${i}`, status: "TERSEDIA" });
    }
    const out = await search();
    expect(out["showing"]).toBe(12);
    expect(Number(out["matched"])).toBeGreaterThan(12);
    // The note used to end "Ask the customer what they need so you can narrow
    // it down", and a tool result reads as an instruction: a customer who had
    // already given a budget and a use was asked to narrow it themselves,
    // because the tool had just said to ask. The narrowing wanted is of the
    // SEARCH, and it is the model holding the query.
    expect(String(out["note"])).toMatch(/narrow the search/i);
    expect(String(out["note"])).not.toMatch(/ask the customer/i);
  });

  it("says nothing about narrowing when everything that matched fits", async () => {
    expect((await search())["note"]).toBeUndefined();
  });
});
