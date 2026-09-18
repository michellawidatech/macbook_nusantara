/**
 * The catalogue — categories, models, and every variant the shop sells.
 *
 * This used to exist twice. `apps/web/src/mock/seed.ts` held a hand-written
 * Apple catalogue with real configurations, and `packages/db/src/seed.ts` held
 * a generator that produced names like "MacBook Air M1 129GB" with a variant
 * label of "24/180" — 24 GB of RAM and 180 GB of storage, a machine Apple has
 * never made. Two catalogues meant two id spaces (`m-air-m2-v1` against
 * `sku_0`), which is why the S/N tracker could not find a serial the inventory
 * list was showing: they were reading different shops.
 *
 * So the catalogue is defined once, here, and both seeds project it. Nothing
 * in this package imports Prisma, Express or React — the same rule
 * `packages/domain` follows, and for the same reason: a fixture that can only
 * be built by one of its two consumers is not shared.
 *
 * Every configuration below is one Apple actually shipped. That matters more
 * than it looks: the recommender scores by grid similarity, Inventory filters
 * by RAM and storage, and the product code goes on a sticker somebody reads at
 * arm's length. Invented specifications make all three of those demo the wrong
 * thing.
 */
import { productCode } from "@nusantara/domain";

export interface FixtureCategory {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  /** Free-text facts QC records per machine, not variant axes. */
  readonly attributes: readonly string[];
  /**
   * Are these machines identified one by one? Absent means yes.
   *
   * False for what the shop counts — accessories (owner ask 2026-09-15). See
   * `Category.tracksSerial` in the schema for what it changes.
   */
  readonly tracksSerial?: boolean;
}

export interface FixtureAxis {
  readonly name: string;
  readonly values: readonly string[];
}

export interface FixtureModel {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly releaseYear: number;
  /** Short line code for the printed label — "PRO", "AIR". */
  readonly line?: string;
  /** Screen size in inches, for the printed label. */
  readonly sizeInch?: number;
  readonly axes: readonly FixtureAxis[];
}

export interface FixtureSku {
  readonly id: string;
  readonly modelId: string;
  /** Derived, never typed. See `productCode`. */
  readonly code: string;
  readonly name: string;
  readonly variantLabel: string;
  readonly axisValues: Readonly<Record<string, string>>;
  /** What the shop asks. Whole rupiah — `Sku.price` in the schema. */
  readonly price: number;
  /** What one costs the shop landed. Whole rupiah. */
  readonly landed: number;
}

/**
 * The three battery attributes every category with a cell carries.
 *
 * All three, on every such category, because a category spans BOTH eras: a
 * MacBook Air is a 2015 body and an M2, and after the 2026-09-08 split the
 * first is described by `siklus` + `kapasitas` and the second by `baterai`.
 * Which of them a particular machine carries is a fact about the machine, and
 * `UnitAttribute` is where a per-machine fact goes — so the category declares
 * all three and each unit fills in the pair its era reports.
 *
 * `baterai` had been missing entirely until 2026-09-08, which made
 * `packages/db`'s battery seeding a silent no-op: it looked the attribute up
 * by that key, found nothing, and wrote no readings at all.
 */
const BATTERY_ATTRS = (own: readonly string[]): readonly string[] => [
  ...own,
  "siklus",
  "kapasitas",
  "baterai",
];

export const CATEGORIES: readonly FixtureCategory[] = [
  {
    id: "cat-macbook-air",
    name: "MacBook Air",
    sortOrder: 1,
    attributes: BATTERY_ATTRS(["prosesor", "layar"]),
  },
  {
    id: "cat-macbook-pro",
    name: "MacBook Pro",
    sortOrder: 2,
    attributes: BATTERY_ATTRS(["prosesor", "layar"]),
  },
  {
    // "MacBook" unqualified is the 12-inch Retina line and nothing else, so it
    // cannot live under Air or Pro without misfiling it.
    id: "cat-macbook",
    name: "MacBook",
    sortOrder: 3,
    attributes: BATTERY_ATTRS(["prosesor", "layar"]),
  },
  {
    id: "cat-ipad",
    name: "iPad",
    sortOrder: 4,
    attributes: BATTERY_ATTRS(["generasi", "layar"]),
  },
  {
    id: "cat-accessory",
    name: "Accessory",
    sortOrder: 5,
    attributes: ["garansi"],
    // Counted, not tracked (owner ask 2026-09-15). A sleeve has no serial
    // anybody would read, and a stock take of forty of them is a number.
    tracksSerial: false,
  },
];

/** Category id by the name the models carry. */
export const CATEGORY_ID: Readonly<Record<string, string>> =
  Object.fromEntries(CATEGORIES.map((c) => [c.name, c.id]));

/**
 * The machines.
 *
 * A second-hand shop's volume is the Intel-era Airs and the last Intel Pros;
 * the M-series arrive occasionally and leave quickly. A catalogue holding only
 * the expensive end teaches every screen the wrong shape, so the 2015–2017
 * bodies are here in force.
 *
 * 13.3 rather than 13 on the Intel bodies is not fussiness: they really are
 * 13.3", `CatalogModel.sizeInch` is a Decimal(3,1) for that reason, and
 * `productCode` prints the decimal only when there is one.
 */
export const MODELS: readonly FixtureModel[] = [
  {
    id: "m-air-2015",
    categoryId: "cat-macbook-air",
    name: "MacBook Air 13 2015",
    releaseYear: 2015,
    line: "AIR",
    sizeInch: 13.3,
    axes: [
      { name: "Chip", values: ["i5"] },
      { name: "RAM", values: ["4GB", "8GB"] },
      { name: "SSD", values: ["128GB", "256GB"] },
    ],
  },
  {
    id: "m-air-2017",
    categoryId: "cat-macbook-air",
    name: "MacBook Air 13 2017",
    releaseYear: 2017,
    line: "AIR",
    sizeInch: 13.3,
    axes: [
      { name: "Chip", values: ["i5"] },
      { name: "RAM", values: ["8GB"] },
      { name: "SSD", values: ["128GB", "256GB"] },
    ],
  },
  {
    id: "m-air-m1",
    categoryId: "cat-macbook-air",
    name: "MacBook Air M1",
    releaseYear: 2020,
    line: "AIR",
    sizeInch: 13,
    axes: [
      { name: "RAM", values: ["8GB", "16GB"] },
      { name: "SSD", values: ["256GB", "512GB"] },
    ],
  },
  {
    id: "m-air-m2",
    categoryId: "cat-macbook-air",
    name: "MacBook Air M2",
    releaseYear: 2022,
    line: "AIR",
    sizeInch: 13,
    axes: [
      { name: "RAM", values: ["8GB", "16GB"] },
      { name: "SSD", values: ["256GB", "512GB"] },
    ],
  },
  {
    // Four axes, not two: this model genuinely shipped in both chips and both
    // touch-bar configurations, so chip and touch bar are axes rather than
    // columns.
    id: "m-pro13-2016",
    categoryId: "cat-macbook-pro",
    name: "MacBook Pro 13 2016",
    releaseYear: 2016,
    line: "PRO",
    sizeInch: 13,
    axes: [
      { name: "Chip", values: ["i5", "i7"] },
      { name: "RAM", values: ["8GB", "16GB"] },
      { name: "SSD", values: ["128GB", "256GB"] },
      { name: "Touch Bar", values: ["NTB", "TB"] },
    ],
  },
  {
    id: "m-pro13-2015",
    categoryId: "cat-macbook-pro",
    name: "MacBook Pro 13 2015",
    releaseYear: 2015,
    line: "PRO",
    sizeInch: 13.3,
    axes: [
      { name: "Chip", values: ["i5", "i7"] },
      { name: "RAM", values: ["8GB", "16GB"] },
      { name: "SSD", values: ["128GB", "256GB"] },
    ],
  },
  {
    // One axis has a single value because that is how it shipped: the 15-inch
    // came with 16GB or not at all. The variant builder handles a one-value
    // axis without special casing — it just yields fewer SKUs, which is the
    // honest catalogue.
    id: "m-pro15-2016",
    categoryId: "cat-macbook-pro",
    name: "MacBook Pro 15 2016",
    releaseYear: 2016,
    line: "PRO",
    sizeInch: 15,
    axes: [
      { name: "RAM", values: ["16GB"] },
      { name: "SSD", values: ["256GB", "512GB"] },
    ],
  },
  {
    id: "m-pro13-m1",
    categoryId: "cat-macbook-pro",
    name: "MacBook Pro 13 M1",
    releaseYear: 2020,
    line: "PRO",
    sizeInch: 13,
    axes: [
      { name: "RAM", values: ["8GB", "16GB"] },
      { name: "SSD", values: ["256GB", "512GB"] },
    ],
  },
  {
    id: "m-pro14-m1",
    categoryId: "cat-macbook-pro",
    name: "MacBook Pro 14 M1 Pro",
    releaseYear: 2021,
    line: "PRO",
    sizeInch: 14,
    axes: [
      { name: "RAM", values: ["16GB", "32GB"] },
      { name: "SSD", values: ["512GB", "1TB"] },
    ],
  },
  {
    id: "m-mb12-2016",
    categoryId: "cat-macbook",
    name: "MacBook 12 Retina 2016",
    releaseYear: 2016,
    line: "MB",
    sizeInch: 12,
    axes: [
      { name: "RAM", values: ["8GB"] },
      { name: "SSD", values: ["256GB", "512GB"] },
    ],
  },
  /*
   * iPads. Their axes are the first here that are neither RAM nor SSD: an iPad
   * varies by storage and by whether it has a SIM, and calling the storage
   * axis "SSD" to fit one loop would put a word on the Products screen that is
   * wrong about the hardware.
   */
  {
    id: "m-ipad-9",
    categoryId: "cat-ipad",
    name: "iPad 9",
    releaseYear: 2021,
    line: "IPAD",
    sizeInch: 10.2,
    axes: [
      { name: "Storage", values: ["64GB", "256GB"] },
      { name: "Connectivity", values: ["WiFi", "Cellular"] },
    ],
  },
  {
    id: "m-ipad-air-4",
    categoryId: "cat-ipad",
    name: "iPad Air 4",
    releaseYear: 2020,
    line: "IPAD AIR",
    sizeInch: 10.9,
    axes: [
      { name: "Storage", values: ["64GB", "256GB"] },
      { name: "Connectivity", values: ["WiFi", "Cellular"] },
    ],
  },
  {
    id: "m-ipad-pro11-m1",
    categoryId: "cat-ipad",
    name: "iPad Pro 11 M1",
    releaseYear: 2021,
    line: "IPAD PRO",
    sizeInch: 11,
    axes: [
      { name: "Storage", values: ["128GB", "256GB", "512GB"] },
      { name: "Connectivity", values: ["WiFi", "Cellular"] },
    ],
  },
  {
    id: "m-ipad-mini-6",
    categoryId: "cat-ipad",
    name: "iPad mini 6",
    releaseYear: 2021,
    line: "IPAD MINI",
    sizeInch: 8.3,
    axes: [
      { name: "Storage", values: ["64GB", "256GB"] },
      { name: "Connectivity", values: ["WiFi", "Cellular"] },
    ],
  },
  /*
   * Accessories. They exist because "what else can this customer be sold" has
   * no answer in a catalogue that contains only laptops — and because sealed
   * stock is what `Grade.NEW` is for.
   */
  {
    id: "m-magic-mouse",
    categoryId: "cat-accessory",
    name: "Magic Mouse",
    releaseYear: 2021,
    axes: [{ name: "Colour", values: ["White", "Black"] }],
  },
  {
    id: "m-magic-keyboard",
    categoryId: "cat-accessory",
    name: "Magic Keyboard",
    releaseYear: 2021,
    axes: [{ name: "Layout", values: ["US", "US with Touch ID"] }],
  },
  {
    id: "m-usbc-hub",
    categoryId: "cat-accessory",
    name: "USB-C Hub 7-in-1",
    releaseYear: 2023,
    axes: [{ name: "Colour", values: ["Space Grey"] }],
  },
  {
    id: "m-sleeve",
    categoryId: "cat-accessory",
    name: 'Laptop Sleeve 13-14"',
    releaseYear: 2024,
    axes: [{ name: "Colour", values: ["Grey"] }],
  },
];

/**
 * The floor variant's asking price, in whole rupiah.
 *
 * Not a sticker price: the builder below adds a step for the higher RAM tier
 * and another for the larger drive, so this is the cheapest variant of the
 * model. The 2016 bases look low for that reason — a 15-inch 2016 with 16GB
 * lands at 6.8jt, and the 12-inch at 4.2jt.
 */
const BASE_PRICE: Readonly<Record<string, number>> = {
  "m-air-2015": 3_200_000,
  "m-air-2017": 4_100_000,
  "m-air-m1": 8_900_000,
  "m-air-m2": 11_500_000,
  "m-pro13-2015": 4_500_000,
  "m-pro13-2016": 3_000_000,
  "m-pro15-2016": 4_300_000,
  "m-pro13-m1": 9_800_000,
  "m-pro14-m1": 16_500_000,
  "m-mb12-2016": 4_200_000,
  "m-ipad-9": 3_400_000,
  "m-ipad-air-4": 5_600_000,
  "m-ipad-pro11-m1": 9_500_000,
  "m-ipad-mini-6": 5_900_000,
  "m-magic-mouse": 950_000,
  "m-magic-keyboard": 1_450_000,
  "m-usbc-hub": 385_000,
  "m-sleeve": 175_000,
};

/**
 * What an iPad's storage tier adds over its floor variant.
 *
 * An absolute table rather than the per-doubling ladder the Macs use, because
 * an iPad's ladder is not a Mac's: 64 → 256 is most of the price difference
 * between two otherwise identical tablets, while the same jump on a Mac is the
 * smaller of its two options.
 */
const STORAGE_STEP: Readonly<Record<string, number>> = {
  "64GB": 0,
  "128GB": 0,
  "256GB": 900_000,
  "512GB": 2_400_000,
};

/** What one doubling of RAM is worth, second-hand. */
const RAM_STEP = 1_250_000;

/** What one doubling of the drive is worth, on a Mac. */
const SSD_STEP = 1_500_000;

/**
 * What a particular axis VALUE is worth over the plainest one.
 *
 * A table rather than a chain of comparisons, because these are all the same
 * kind of fact — this option costs more than that one — and a chain is where
 * the fifth one gets forgotten.
 */
const VARIANT_PREMIUM: Readonly<Record<string, number>> = {
  i7: 1_200_000,
  // The touch bar was the dearer of the two 2016 Pros and still is.
  TB: 400_000,
  // A cellular iPad costs more new and holds it second-hand.
  Cellular: 1_100_000,
  "US with Touch ID": 300_000,
};

/** `8GB` -> 8, `512GB` -> 512, `1TB` -> 1024. */
function capacityGb(value: string): number | null {
  const m = /^(\d+)\s*(GB|TB)$/i.exec(value.trim());
  if (m === null) return null;
  return Number(m[1]) * (m[2]!.toUpperCase() === "TB" ? 1024 : 1);
}

/** How many doublings `value` sits above the smallest this model offers. */
function doublingsAbove(
  axis: FixtureAxis | undefined,
  value: string | undefined,
): number {
  if (axis === undefined || value === undefined) return 0;
  const here = capacityGb(value);
  const floor = axis.values
    .map(capacityGb)
    .filter((n): n is number => n !== null)
    .reduce((lo, n) => Math.min(lo, n), Number.POSITIVE_INFINITY);
  if (here === null || !Number.isFinite(floor) || here <= floor) return 0;
  return Math.log2(here / floor);
}

/**
 * What the shop pays for a machine, as a fraction of what it asks.
 *
 * One number for the whole fixture rather than a per-model margin, because the
 * point of the seed is that every margin on every screen is positive and
 * plausible — not that any particular one is the shop's real number.
 */
export const COST_RATIO = 0.82;

/** Whole rupiah, always: money in this app is never a fraction. */
export const costOf = (price: number): number =>
  Math.round((price * COST_RATIO) / 1_000) * 1_000;

/**
 * Every combination of a model's axes, in axis order.
 *
 * The shape comes from the data rather than from the loop: the Intel-era Pros
 * vary by chip and by touch bar, and those are axes too.
 */
function combinations(
  axes: readonly FixtureAxis[],
): Record<string, string>[] {
  return axes.reduce<Record<string, string>[]>(
    (acc, axis) =>
      acc.flatMap((partial) =>
        axis.values.map((v) => ({ ...partial, [axis.name]: v })),
      ),
    [{}],
  );
}

/**
 * What the shop asks for one variant.
 *
 * Every step is a LADDER, not a flag. The first version of this added a flat
 * 2.5jt for "16GB or more" and a flat 1.5jt for "512GB or 1TB", which meant
 * all four MacBook Pro 14 variants — 16/512, 16/1TB, 32/512 and 32/1TB —
 * carried exactly the same price. A catalogue where the top of a model's grid
 * costs what the bottom does is not a price list: the till's upgrade
 * suggestion has nothing to suggest, the margin column is flat, and the
 * salesperson's bargain report measures against a number that never moved.
 */
function priceOf(model: FixtureModel, axisValues: Record<string, string>) {
  const axis = (name: string) => model.axes.find((a) => a.name === name);
  const storage = axisValues["Storage"];
  return (
    BASE_PRICE[model.id]! +
    doublingsAbove(axis("RAM"), axisValues["RAM"]) * RAM_STEP +
    doublingsAbove(axis("SSD"), axisValues["SSD"]) * SSD_STEP +
    (storage === undefined ? 0 : (STORAGE_STEP[storage] ?? 0)) +
    Object.values(axisValues).reduce(
      (n, v) => n + (VARIANT_PREMIUM[v] ?? 0),
      0,
    )
  );
}

/**
 * Every sellable variant, built from the models above.
 *
 * The id is `${modelId}-v${n}` with `n` counting from one in axis order. That
 * is the id space `apps/web` has always used, and it is now the one Postgres
 * uses too — which is the whole reason this file exists.
 */
/**
 * The code for one variant.
 *
 * A machine gets `productCode` — line, size, year, chip, ram/ssd, then
 * whatever else separates two otherwise identical units. An accessory gets
 * none of those: a Magic Mouse has no screen, no year worth printing and no
 * storage, so `productCode` would return the same empty string for the white
 * one and the black one — and `Sku.code` is UNIQUE in the schema, so the seed
 * would not even insert. Its code is its model and its variant number instead,
 * which is short, unique, and legible on a 30mm label.
 */
function codeFor(
  model: FixtureModel,
  axisValues: Record<string, string>,
  index: number,
): string {
  if (model.line === undefined) {
    return `${model.id.replace(/^m-/, "").replace(/-/g, "").toUpperCase()}${index + 1}`;
  }
  const ssd = axisValues["SSD"] ?? "";
  const storage = axisValues["Storage"] ?? "";
  return productCode({
    line: model.line,
    sizeInch: model.sizeInch,
    year: String(model.releaseYear),
    chip: axisValues["Chip"],
    ram: axisValues["RAM"],
    // An iPad calls it Storage; a Mac calls it SSD.
    ssd: ssd || storage,
    // On an Intel Pro that is the touch bar; on an iPad it is the SIM.
    extra: axisValues["Touch Bar"] ?? axisValues["Connectivity"],
  });
}

export const SKUS: readonly FixtureSku[] = MODELS.flatMap((model) =>
  combinations(model.axes).map((axisValues, i): FixtureSku => {
    const price = priceOf(model, axisValues);
    return {
      id: `${model.id}-v${i + 1}`,
      modelId: model.id,
      code: codeFor(model, axisValues, i),
      name: model.name,
      variantLabel: Object.values(axisValues).join(" / "),
      axisValues,
      price,
      landed: costOf(price),
    };
  }),
);

const SKU_BY_ID = new Map(SKUS.map((s) => [s.id, s]));

/** Throws rather than returning undefined: a fixture naming a SKU that does
 * not exist is a bug in the fixture, and it should fail where it is written. */
export function skuOf(id: string): FixtureSku {
  const found = SKU_BY_ID.get(id);
  if (found === undefined) throw new Error(`fixture: unknown SKU ${id}`);
  return found;
}

const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function modelOf(id: string): FixtureModel {
  const found = MODEL_BY_ID.get(id);
  if (found === undefined) throw new Error(`fixture: unknown model ${id}`);
  return found;
}

/** Accessories have no battery and no grade to inspect — they arrive sealed. */
export const isAccessory = (skuId: string): boolean =>
  modelOf(skuOf(skuId).modelId).categoryId === "cat-accessory";
