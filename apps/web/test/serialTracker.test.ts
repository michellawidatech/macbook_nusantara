/**
 * The S/N tracker's list (owner ask 2026-09-19): every serial, where it is,
 * when its ledger last moved, and the filters over it.
 *
 * See `lib/serialTracker.ts` for why the last movement is the ledger's newest
 * row by `seq`, and why category, product and unit are one tree.
 */
import { describe, expect, it } from "vitest";
import {
  catalogueTree,
  filterTrackerRows,
  latestEvents,
  serialToOpen,
  skuKey,
  skusUnder,
  trackerRows,
  type TrackerSource,
} from "../src/lib/serialTracker.js";
import type { UnitEvent } from "../src/mock/seed.js";

const AIR_8 = "SC02AAAAAAAA1";
const AIR_16 = "SC02AAAAAAAA2";
const IPAD = "SDMPPAD000001";
const SILENT = "SC02NEVENT001";

function event(
  serial: string,
  seq: number,
  type: string,
  at: string,
): UnitEvent {
  return {
    id: `${serial}-${seq}`,
    serial,
    seq,
    type,
    at,
    fromStatus: "-",
    toStatus: "TERSEDIA",
    locationId: "wh-1",
    staff: "Michella",
  };
}

const SOURCE: TrackerSource = {
  warehouses: [
    { id: "wh-1", name: "Toko Kelapa Gading", active: true },
    { id: "wh-2", name: "Gudang Serpong", active: true },
  ],
  models: [
    {
      id: "m-air",
      name: "MacBook Air 13 2022",
      category: "MacBook Air",
      releaseYear: 2022,
      axes: [],
    },
    {
      id: "m-ipad",
      name: "iPad Air 5",
      category: "iPad",
      releaseYear: 2022,
      axes: [],
    },
  ],
  skus: [
    {
      id: "s-air-8",
      modelId: "m-air",
      code: "AIR 8/256",
      name: "MacBook Air 13 2022",
      variantLabel: "M2 / 8GB / 256GB",
      price: 13_000_000,
    },
    {
      id: "s-air-16",
      modelId: "m-air",
      code: "AIR 16/512",
      name: "MacBook Air 13 2022",
      variantLabel: "M2 / 16GB / 512GB",
      price: 17_000_000,
    },
    {
      id: "s-ipad",
      modelId: "m-ipad",
      code: "IPAD 64",
      name: "iPad Air 5",
      variantLabel: "64GB Wi-Fi",
      price: 7_000_000,
    },
  ],
  units: [
    {
      serial: AIR_8,
      skuId: "s-air-8",
      status: "TERJUAL",
      locationId: "wh-1",
      buy: 11_000_000,
      description: "",
      poId: null,
    },
    {
      serial: AIR_16,
      skuId: "s-air-16",
      status: "TERSEDIA",
      locationId: "wh-2",
      buy: 15_000_000,
      description: "",
      poId: null,
    },
    {
      serial: IPAD,
      skuId: "s-ipad",
      status: "TERSEDIA",
      locationId: "wh-1",
      buy: 6_000_000,
      description: "",
      poId: null,
    },
    {
      // Keyed in before the ledger existed: nothing was ever written about it.
      serial: SILENT,
      skuId: "s-air-8",
      status: "TERSEDIA",
      locationId: "wh-1",
      buy: 11_000_000,
      description: "",
      poId: null,
    },
  ],
  events: [
    // Out of order on purpose: the ledger's order is `seq`, not the array's.
    event(AIR_8, 3, "TERJUAL", "2026-09-10T03:00:00.000Z"),
    event(AIR_8, 1, "DITERIMA", "2026-09-01T03:00:00.000Z"),
    event(AIR_8, 2, "QC_SELESAI", "2026-09-02T03:00:00.000Z"),
    event(AIR_16, 1, "DITERIMA", "2026-09-05T03:00:00.000Z"),
    // Two rows written in one mutation share a timestamp; seq still orders.
    event(IPAD, 1, "DITERIMA", "2026-09-12T03:00:00.000Z"),
    event(IPAD, 2, "QC_SELESAI", "2026-09-12T03:00:00.000Z"),
  ],
};

const ROWS = trackerRows(SOURCE);
const serialsOf = (rows: readonly { serial: string }[]) =>
  rows.map((r) => r.serial).sort();

describe("the last movement", () => {
  it("is each serial's newest ledger row by seq, whatever the array order", () => {
    const last = latestEvents(SOURCE.events);
    expect(last.get(AIR_8)?.type).toBe("TERJUAL");
    // A shared timestamp is settled by seq, the order the timeline narrates.
    expect(last.get(IPAD)?.type).toBe("QC_SELESAI");
    expect(last.has(SILENT)).toBe(false);
  });
});

describe("trackerRows", () => {
  it("joins every unit to its product, unit, category and warehouse", () => {
    expect(ROWS).toHaveLength(4);
    const air = ROWS.find((r) => r.serial === AIR_16)!;
    expect(air).toMatchObject({
      product: "MacBook Air 13 2022",
      variant: "M2 / 16GB / 512GB",
      category: "MacBook Air",
      modelId: "m-air",
      warehouse: "Gudang Serpong",
      last: { type: "DITERIMA", at: "2026-09-05T03:00:00.000Z", seq: 1 },
    });
  });

  it("leaves the last movement off a unit nothing was written about", () => {
    expect(ROWS.find((r) => r.serial === SILENT)?.last).toBeUndefined();
  });
});

describe("filterTrackerRows", () => {
  it("keeps everything when nothing is asked", () => {
    expect(filterTrackerRows(ROWS, {})).toHaveLength(4);
  });

  it("matches the search word by word, across the fields", () => {
    // "air" is in the product and "16gb" in the unit — not next to each other.
    expect(serialsOf(filterTrackerRows(ROWS, { query: "air 16gb" }))).toEqual([
      AIR_16,
    ]);
    expect(serialsOf(filterTrackerRows(ROWS, { query: "serpong" }))).toEqual([
      AIR_16,
    ]);
    expect(serialsOf(filterTrackerRows(ROWS, { query: "ipad" }))).toEqual([
      IPAD,
    ]);
  });

  it("finds a serial by the shop's own sticker, which no substring contains", () => {
    const rows = filterTrackerRows(ROWS, {
      query: `AS${AIR_8}`,
      supplierCodes: ["AS"],
    });
    expect(serialsOf(rows)).toEqual([AIR_8]);
  });

  it("keeps only the picked variants", () => {
    expect(serialsOf(filterTrackerRows(ROWS, { skuIds: ["s-air-8"] }))).toEqual(
      [AIR_8, SILENT].sort(),
    );
  });

  it("narrows by the last movement's date, both ends inclusive", () => {
    const since = Date.parse("2026-09-10T03:00:00.000Z");
    expect(serialsOf(filterTrackerRows(ROWS, { movedFrom: since }))).toEqual(
      [AIR_8, IPAD].sort(),
    );
    const until = Date.parse("2026-09-05T03:00:00.000Z");
    expect(serialsOf(filterTrackerRows(ROWS, { movedTo: until }))).toEqual([
      AIR_16,
    ]);
  });

  it("drops a unit with no ledger once a date range is set", () => {
    const rows = filterTrackerRows(ROWS, { movedFrom: 0 });
    expect(rows.map((r) => r.serial)).not.toContain(SILENT);
  });

  it("ANDs the filters together", () => {
    const rows = filterTrackerRows(ROWS, {
      skuIds: ["s-air-8", "s-ipad"],
      query: "toko",
      movedFrom: Date.parse("2026-09-11T00:00:00.000Z"),
    });
    expect(serialsOf(rows)).toEqual([IPAD]);
  });
});

describe("serialToOpen", () => {
  const known = ROWS.map((r) => r.serial);

  it("opens a serial named outright", () => {
    expect(serialToOpen(AIR_16, known)).toBe(AIR_16);
    expect(serialToOpen(` ${AIR_16.toLowerCase()} `, known)).toBe(AIR_16);
  });

  it("reads the shop's sticker and the case's bare number", () => {
    expect(serialToOpen(`AS${AIR_8}`, known, ["AS"])).toBe(AIR_8);
    // The case prints the number without the `S` the barcode carries.
    expect(serialToOpen(AIR_8.slice(1), known)).toBe(AIR_8);
  });

  it("opens nothing for a product name or a serial the store lacks", () => {
    expect(serialToOpen("MacBook Air", known)).toBeNull();
    expect(serialToOpen("SC02ZZZZZZZZ9", known)).toBeNull();
    expect(serialToOpen("", known)).toBeNull();
  });
});

describe("the category → product → unit tree", () => {
  const tree = catalogueTree(ROWS);

  it("nests the variants the list holds, alphabetically, numbers as numbers", () => {
    expect(tree.map((c) => c.title)).toEqual(["iPad", "MacBook Air"]);
    const air = tree[1]!;
    expect(air.children?.map((p) => p.title)).toEqual(["MacBook Air 13 2022"]);
    // 8GB before 16GB: compared as numbers, not as text.
    expect(air.children?.[0]?.children?.map((v) => v.title)).toEqual([
      "M2 / 8GB / 256GB",
      "M2 / 16GB / 512GB",
    ]);
    expect(air.children?.[0]?.children?.[0]?.key).toBe(skuKey("s-air-8"));
  });

  it("expands a category or a product into every variant under it", () => {
    const [ipad, air] = tree;
    expect(skusUnder(tree, [air!.key]).sort()).toEqual(
      ["s-air-16", "s-air-8"].sort(),
    );
    expect(skusUnder(tree, [air!.children![0]!.key]).sort()).toEqual(
      ["s-air-16", "s-air-8"].sort(),
    );
    // Overlapping picks count each variant once.
    expect(
      skusUnder(tree, [ipad!.key, skuKey("s-ipad"), skuKey("s-air-8")]).sort(),
    ).toEqual(["s-air-8", "s-ipad"].sort());
    expect(skusUnder(tree, [])).toEqual([]);
  });
});
