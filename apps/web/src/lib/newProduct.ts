/**
 * What *Add product* will create (owner ask 2026-10-21: "the current product
 * making flow is very confusing").
 *
 * The old form asked for a free-typed model name in the shop's short style and
 * had no processor field, so `i5` went into the NAME and became a product of
 * its own (`AIR 13" 2020 I5` beside `MacBook Air 13" 2020`). Now:
 *
 * - A Mac or iPad is described, not named: category (and line, for iPads),
 *   screen size, year, and either an Apple-silicon chip or a list of Intel
 *   processors. The name is BUILT, in full (`fullModelName`). An Apple chip is
 *   part of the product; Intel processors are variants, beside RAM and SSD.
 * - Anything else — an accessory, a charger — keeps a plain name box and gets
 *   one variant.
 * - If the product already exists (`modelIdentity`), nothing new is made: the
 *   missing variants are added to it. Two rows for one product is how the
 *   catalogue got into the state that prompted this.
 *
 * Pure: the form previews exactly what `applyNewProduct` writes.
 */
import type { CatalogModel, MockDb } from "../mock/seed.js";
import { fullModelName, identityKey, modelIdentity } from "./modelName.js";
import { freeSkuCode, sameVariant, skuCodeFor } from "./skuCode.js";

/** The lines a category offers. Empty: the product is named by hand. */
export function familiesFor(category: string | undefined): string[] {
  const c = (category ?? "").trim().toUpperCase();
  if (c === "") return [];
  if (c.startsWith("IPAD"))
    return ["iPad", "iPad Air", "iPad Pro", "iPad mini"];
  const known: Record<string, string[]> = {
    "MACBOOK AIR": ["MacBook Air"],
    "MACBOOK PRO": ["MacBook Pro"],
    MACBOOK: ["MacBook"],
    IMAC: ["iMac", "iMac Pro"],
    "MAC MINI": ["Mac mini"],
    "MAC STUDIO": ["Mac Studio"],
    "MAC PRO": ["Mac Pro"],
  };
  return known[c] ?? [];
}

export interface NewProductInput {
  readonly category: string;
  /** Structured (a Mac or iPad): the line. */
  readonly family?: string;
  readonly sizeInch?: number;
  readonly releaseYear: number;
  /** Apple silicon: the chip, which is part of the product. */
  readonly appleChip?: string;
  /** Intel: the processors it came with, which are variants. */
  readonly processors?: readonly string[];
  readonly ram?: readonly string[];
  readonly ssd?: readonly string[];
  /** Anything else: the name as typed. */
  readonly name?: string;
}

export interface NewProductPlan {
  /** The product's name, built or typed. Empty while the form is incomplete. */
  readonly name: string;
  /** The same product, already in the catalogue — variants go onto it. */
  readonly existing?: CatalogModel;
  readonly axes: { name: string; values: string[] }[];
  /** Only the variants that do not exist yet. */
  readonly variants: { label: string; code: string }[];
  /** Why it cannot be saved as asked, in English (the caller translates). */
  readonly problem?: "INCOMPLETE" | "EXISTS" | "AXES";
}

const clean = (xs: readonly string[] | undefined) => [
  ...new Set((xs ?? []).map((x) => x.trim()).filter((x) => x !== "")),
];

function combos(axes: { name: string; values: string[] }[]): string[] {
  return axes.reduce<string[]>(
    (acc, a) =>
      acc.flatMap((p) => a.values.map((v) => (p ? `${p} / ${v}` : v))),
    [""],
  );
}

const axisKey = (name: string) => {
  const n = name.toUpperCase();
  if (/CHIP|CPU|PROCESSOR/.test(n)) return "CHIP";
  if (/RAM|MEMORY/.test(n)) return "RAM";
  if (/SSD|STORAGE/.test(n)) return "SSD";
  return n;
};

export function planNewProduct(
  db: Pick<MockDb, "models" | "skus">,
  input: NewProductInput,
): NewProductPlan {
  const live = db.models;
  const structured = familiesFor(input.category).length > 0;
  const none = { name: "", axes: [], variants: [] };

  if (!structured) {
    const name = (input.name ?? "").trim().replace(/\s+/g, " ");
    if (name === "") return { ...none, problem: "INCOMPLETE" };
    const same = live.find(
      (m) =>
        m.name.trim().replace(/\s+/g, " ").toUpperCase() === name.toUpperCase(),
    );
    if (same)
      return {
        name: same.name,
        existing: same,
        axes: same.axes,
        variants: [],
        problem: "EXISTS",
      };
    const taken = new Set(db.skus.map((s) => s.code));
    return {
      name,
      axes: [],
      variants: [
        {
          label: "",
          code: freeSkuCode(taken, skuCodeFor(name, undefined, "")),
        },
      ],
    };
  }

  const ram = clean(input.ram);
  const ssd = clean(input.ssd);
  const processors = clean(input.processors).map((p) => p.toLowerCase());
  const chip = input.appleChip?.trim().toUpperCase().replace(/\s+/g, " ");
  if (!input.family || ram.length === 0 || ssd.length === 0) {
    return { ...none, problem: "INCOMPLETE" };
  }
  const name = fullModelName({
    family: input.family,
    ...(input.sizeInch ? { sizeInch: input.sizeInch } : {}),
    era: chip || String(input.releaseYear),
  });
  const wanted: { name: string; values: string[] }[] = [
    ...(processors.length > 0 && !chip
      ? [{ name: "Chip", values: processors }]
      : []),
    { name: "RAM", values: ram },
    { name: "SSD", values: ssd },
  ];

  const ownKey = modelIdentity(name, input.releaseYear);
  // A name carrying an Intel processor (`AIR 13" 2020 I5`) is a mis-filed
  // variant of the product, not the product: never the target. Among the
  // rest, one already named in full wins, then the one with most variants.
  const variantsOf = (m: CatalogModel) =>
    db.skus.filter((s) => s.modelId === m.id).length;
  const existing = ownKey
    ? live
        .filter((m) => {
          const id = modelIdentity(m.name, m.releaseYear);
          return (
            id !== null &&
            !id.intelChip &&
            identityKey(id) === identityKey(ownKey)
          );
        })
        .sort(
          (a, b) =>
            Number(b.name === name) - Number(a.name === name) ||
            variantsOf(b) - variantsOf(a),
        )[0]
    : undefined;

  let axes = wanted;
  let have: string[] = [];
  if (existing) {
    have = db.skus
      .filter((s) => s.modelId === existing.id)
      .map((s) => s.variantLabel);
    const theirs = existing.axes
      .map((a) => axisKey(a.name))
      .sort()
      .join("|");
    const ours = wanted
      .map((a) => axisKey(a.name))
      .sort()
      .join("|");
    if (have.length > 0 && theirs !== ours) {
      return {
        name,
        existing,
        axes: existing.axes,
        variants: [],
        problem: "AXES",
      };
    }
    // The existing product's axes, in its own order, with the new values added.
    axes =
      have.length === 0
        ? wanted
        : existing.axes.map((a) => {
            const add = wanted.find(
              (w) => axisKey(w.name) === axisKey(a.name),
            )!;
            return {
              name: a.name,
              values: [...new Set([...a.values, ...add.values])],
            };
          });
  }

  // Only what was ASKED for, laid out in the target's axis order.
  const askedAxes = axes.map((a) => ({
    name: a.name,
    values: wanted.find((w) => axisKey(w.name) === axisKey(a.name))!.values,
  }));
  const taken = new Set(db.skus.map((s) => s.code));
  const variants: { label: string; code: string }[] = [];
  for (const label of combos(askedAxes)) {
    if (have.some((h) => sameVariant(h, label))) continue;
    const code = freeSkuCode(
      taken,
      skuCodeFor(
        name,
        input.releaseYear,
        label,
        axes.map((a) => a.name),
      ),
    );
    taken.add(code);
    variants.push({ label, code });
  }
  // The existing product is renamed to the full name as it gains variants.
  return {
    name,
    ...(existing ? { existing } : {}),
    axes,
    variants,
    ...(existing && variants.length === 0
      ? { problem: "EXISTS" as const }
      : {}),
  };
}

/** Write the plan. Returns the product's id. */
export function applyNewProduct(
  d: MockDb,
  input: NewProductInput,
  plan: NewProductPlan,
  price: number,
  nextId: (prefix: string) => string,
): string {
  const target =
    plan.existing && d.models.find((m) => m.id === plan.existing!.id);
  const id = target?.id ?? nextId("m");
  if (target) {
    target.name = plan.name;
    target.axes = plan.axes;
  } else {
    d.models.push({
      id,
      name: plan.name,
      category: input.category,
      releaseYear: input.releaseYear,
      ...(input.sizeInch ? { sizeInch: input.sizeInch } : {}),
      source: "MANUAL",
      axes: plan.axes,
    });
  }
  for (const v of plan.variants) {
    d.skus.push({
      id: nextId("sku"),
      modelId: id,
      code: v.code,
      name: plan.name,
      variantLabel: v.label,
      price,
    });
  }
  return id;
}
