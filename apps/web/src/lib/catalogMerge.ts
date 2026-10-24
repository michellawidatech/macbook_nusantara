/**
 * Finding the same product twice, and merging it (owner ask 2026-10-21: "the
 * current naming system is messy, with the inbound already registered and
 * some duplicate products. I need to clean it up").
 *
 * `duplicateGroups` gathers live products that are ONE product by their facts
 * or their name (`lib/modelName.ts`) — `MacBook Air 13" 2020`, `AIR 13" 2020`
 * and `AIR 13" 2020 I5` are one group, the last carrying `i5` as a variant —
 * minus any pair a person marked as different (`notDuplicateOf`).
 *
 * `planMerge` says what merging a group into one of its products does, per
 * variant of the others, before anything is written:
 * - **MOVE** — the product being merged has a variant the target lacks; the
 *   variant itself moves (same id, so every unit, invoice line and receipt
 *   keeps pointing at it), relabelled into the target's options and recoded.
 * - **JOIN** — the target already has that variant. The units it HOLDS move
 *   onto the target's variant, each with a line on its timeline; counted
 *   stock moves by a KOREKSI pair. What it SOLD stays: the variant is kept,
 *   marked merged (`Sku.mergedIntoId`), so old receipts still name it.
 * - **DROP** — a JOIN with nothing held and no history: it is litter, and is
 *   removed outright like any unused variant.
 * - **STUCK** — the variant cannot be placed (the target has a processor
 *   option and this variant names none). One stuck variant stops the merge:
 *   half a merge is worse than none.
 *
 * Pure. `applyMerge` writes the plan into a store draft.
 */
import type { CatalogModel, MockDb, Sku, Unit } from "../mock/seed.js";
import {
  fullModelName,
  identityKey,
  modelIdentity,
  productKeyOf,
  type ModelIdentity,
} from "./modelName.js";
import { freeSkuCode, isLiveSku, sameVariant, skuCodeFor } from "./skuCode.js";
import { variantInUse } from "./partyLinks.js";
import { averageCost, stockLevels } from "./stock.js";

/** The statuses a unit is HELD in — what moves on a JOIN. */
const HELD: readonly Unit["status"][] = [
  "QC",
  "TERSEDIA",
  "DIRESERVASI",
  "SERVIS",
];

const axisKey = (name: string): string => {
  const n = name.toUpperCase();
  if (/CHIP|CPU|PROCESSOR/.test(n)) return "CHIP";
  if (/RAM|MEMORY/.test(n)) return "RAM";
  if (/SSD|STORAGE/.test(n)) return "SSD";
  return n;
};
const AXIS_NAME: Record<string, string> = {
  CHIP: "Chip",
  RAM: "RAM",
  SSD: "SSD",
};

/** A model's identity: its facts, else its name. */
export function identityOf(m: CatalogModel): ModelIdentity | null {
  if (m.family) {
    const key = productKeyOf({
      family: m.family,
      sizeInch: m.sizeInch ?? null,
      year: m.releaseYear,
      chip: m.chip ?? null,
      extra: m.extra ?? null,
    });
    if (key === null) return null;
    const silicon =
      Boolean(m.chip) && key.split("|")[2] === m.chip!.toUpperCase();
    return {
      family: m.family,
      ...(m.sizeInch ? { sizeInch: m.sizeInch } : {}),
      era: silicon ? m.chip!.toUpperCase() : String(m.releaseYear),
      ...(m.extra ? { extra: m.extra.toUpperCase() } : {}),
    };
  }
  return modelIdentity(m.name, m.releaseYear);
}

export interface DuplicateGroup {
  readonly key: string;
  /** The suggested product to keep. */
  readonly target: CatalogModel;
  readonly models: readonly CatalogModel[];
}

const liveVariants = (db: Pick<MockDb, "skus">, modelId: string) =>
  db.skus.filter((s) => isLiveSku(s) && s.modelId === modelId);

/** The product to keep: one already described by facts, then one named in full, then the fullest. */
function suggestTarget(
  db: Pick<MockDb, "skus">,
  models: readonly CatalogModel[],
): CatalogModel {
  const score = (m: CatalogModel) => {
    const id = identityOf(m);
    return [
      m.family ? 1 : 0,
      id && !id.intelChip && m.name === fullModelName(id) ? 1 : 0,
      id?.intelChip ? 0 : 1,
      m.axes.some((a) => axisKey(a.name) === "CHIP") ? 1 : 0,
      liveVariants(db, m.id).length,
    ];
  };
  return [...models].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
    return a.id.localeCompare(b.id);
  })[0]!;
}

export function duplicateGroups(
  db: Pick<MockDb, "models" | "skus">,
): DuplicateGroup[] {
  const byKey = new Map<string, CatalogModel[]>();
  const sizeless: { m: CatalogModel; id: ModelIdentity }[] = [];
  for (const m of db.models) {
    const id = identityOf(m);
    if (!id) continue;
    if (id.sizeInch === undefined) {
      sizeless.push({ m, id });
      continue;
    }
    const k = identityKey(id);
    byKey.set(k, [...(byKey.get(k) ?? []), m]);
  }
  // A name with no size (AppleDB's "MacBook Air (M2, 2022)") joins the one
  // sized product of its line and generation, when there is exactly one.
  for (const { m, id } of sizeless) {
    const tail = `|${id.era.toUpperCase()}|${id.extra ?? ""}`;
    const head = `${id.family.toUpperCase()}|`;
    const sized = [...byKey.keys()].filter(
      (k) => k.startsWith(head) && k.endsWith(tail),
    );
    const k = sized.length === 1 ? sized[0]! : identityKey(id);
    byKey.set(k, [...(byKey.get(k) ?? []), m]);
  }

  const out: DuplicateGroup[] = [];
  for (const [key, models] of byKey) {
    if (models.length < 2) continue;
    const target = suggestTarget(db, models);
    const kept = models.filter(
      (m) =>
        m.id === target.id ||
        (!(m.notDuplicateOf ?? []).includes(target.id) &&
          !(target.notDuplicateOf ?? []).includes(m.id)),
    );
    if (kept.length < 2) continue;
    out.push({ key, target, models: kept });
  }
  return out.sort((a, b) => a.target.name.localeCompare(b.target.name));
}

export type MergeAction = "MOVE" | "JOIN" | "DROP" | "STUCK";

export interface MergeStep {
  readonly skuId: string;
  readonly fromModelId: string;
  readonly fromCode: string;
  readonly fromLabel: string;
  readonly action: MergeAction;
  /** The label it has in the target. */
  readonly label: string;
  /** MOVE: its new code. JOIN/DROP: the code of the variant it joins. */
  readonly code: string;
  /** JOIN/DROP: the target variant. */
  readonly intoSkuId?: string;
  /** Units it holds today (QC, on the shelf, reserved, at service). */
  readonly heldUnits: readonly string[];
  /** Counted stock it holds, per warehouse. */
  readonly counted: ReadonlyMap<string, number>;
}

export interface MergePlan {
  readonly target: CatalogModel;
  readonly name: string;
  readonly axes: { name: string; values: string[] }[];
  readonly steps: readonly MergeStep[];
  /** Target variants relabelled into the merged option order. */
  readonly relabel: readonly { skuId: string; label: string }[];
  /** Every product merged away — an empty one too. */
  readonly sourceIds: readonly string[];
  readonly stuck: boolean;
}

/** A variant's values by axis key. */
function partsOf(sku: Sku, model: CatalogModel): Map<string, string> {
  const values = sku.variantLabel
    .split(/\s*[/·]\s*/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
  const out = new Map<string, string>();
  if (values.length === model.axes.length && values.length > 0) {
    model.axes.forEach((a, i) => out.set(axisKey(a.name), values[i]!));
  } else {
    for (const v of values) {
      if (/^\d+(?:[.,]\d+)?\s*(GB|TB)$/i.test(v)) {
        out.set(out.has("RAM") ? "SSD" : "RAM", v);
      } else if (!out.has("CHIP")) out.set("CHIP", v);
      else out.set(`EXTRA${out.size}`, v);
    }
  }
  const nameChip = modelIdentity(model.name, model.releaseYear)?.intelChip;
  if (nameChip && !out.has("CHIP")) out.set("CHIP", nameChip);
  return out;
}

export function planMerge(
  db: Pick<
    MockDb,
    "models" | "skus" | "units" | "stockMoves" | "stockIns" | "pos" | "orders"
  >,
  targetId: string,
  sourceIds: readonly string[],
): MergePlan {
  const target = db.models.find((m) => m.id === targetId)!;
  const sources = sourceIds
    .filter((id) => id !== targetId)
    .map((id) => db.models.find((m) => m.id === id)!)
    .filter(Boolean);
  const id = identityOf(target);
  const name = id && !id.intelChip ? fullModelName(id) : target.name;

  const targetSkus = liveVariants(db, target.id);
  const sourceSkus = sources.flatMap((m) =>
    liveVariants(db, m.id).map((s) => ({ s, m, parts: partsOf(s, m) })),
  );
  const targetParts = targetSkus.map((s) => ({ s, parts: partsOf(s, target) }));

  // The merged options: the target's own order, then whatever a source adds.
  const keys = target.axes.map((a) => axisKey(a.name));
  for (const k of ["CHIP", "RAM", "SSD"]) {
    if (!keys.includes(k) && sourceSkus.some((x) => x.parts.has(k)))
      keys.push(k);
  }
  const labelOf = (parts: Map<string, string>) =>
    keys.every((k) => parts.has(k))
      ? keys.map((k) => parts.get(k)!).join(" / ")
      : null;

  // A target variant that lacks an option a source brings in cannot be
  // relabelled without inventing a value: the merge is stuck.
  const relabel: { skuId: string; label: string }[] = [];
  let stuck = false;
  for (const { s, parts } of targetParts) {
    const label = labelOf(parts);
    if (label === null) stuck = true;
    else if (label !== s.variantLabel) relabel.push({ skuId: s.id, label });
  }

  const levels = stockLevels(db.stockMoves);
  const taken = new Set(db.skus.map((s) => s.code));
  const placed: { label: string; skuId: string; code: string }[] =
    targetSkus.map((s) => ({
      label: relabel.find((r) => r.skuId === s.id)?.label ?? s.variantLabel,
      skuId: s.id,
      code: s.code,
    }));

  const steps: MergeStep[] = sourceSkus.map(({ s, m, parts }) => {
    const heldUnits = db.units
      .filter((u) => u.skuId === s.id && HELD.includes(u.status))
      .map((u) => u.serial);
    const counted = new Map(
      [...(levels.get(s.id) ?? new Map<string, number>())].filter(
        ([, q]) => q !== 0,
      ),
    );
    const base = {
      skuId: s.id,
      fromModelId: m.id,
      fromCode: s.code,
      fromLabel: s.variantLabel,
      heldUnits,
      counted,
    };
    const label = labelOf(parts);
    if (label === null) {
      stuck = true;
      return {
        ...base,
        action: "STUCK" as const,
        label: s.variantLabel,
        code: s.code,
      };
    }
    const into = placed.find((p) => sameVariant(p.label, label));
    if (into) {
      const unused =
        heldUnits.length === 0 &&
        counted.size === 0 &&
        !variantInUse(db as MockDb, s.id);
      return {
        ...base,
        action: unused ? ("DROP" as const) : ("JOIN" as const),
        label: into.label,
        code: into.code,
        intoSkuId: into.skuId,
      };
    }
    taken.delete(s.code);
    const code = freeSkuCode(
      taken,
      skuCodeFor(
        name,
        target.releaseYear,
        label,
        keys.map((k) => AXIS_NAME[k] ?? k),
      ),
    );
    taken.add(code);
    placed.push({ label, skuId: s.id, code });
    return { ...base, action: "MOVE" as const, label, code };
  });

  const axes = keys.map((k) => {
    const old = target.axes.find((a) => axisKey(a.name) === k);
    const values = [
      ...(old?.values ?? []),
      ...[...targetParts, ...sourceSkus]
        .map((x) => x.parts.get(k))
        .filter((v): v is string => Boolean(v)),
    ];
    const seen = new Set<string>();
    return {
      name: old?.name ?? AXIS_NAME[k] ?? k,
      values: values.filter((v) => {
        const n = v.replace(/\s+/g, "").toUpperCase();
        if (seen.has(n)) return false;
        seen.add(n);
        return true;
      }),
    };
  });

  return {
    target,
    name,
    axes,
    steps,
    relabel,
    sourceIds: sources.map((m) => m.id),
    stuck,
  };
}

/** Write a plan into a store draft. Refuses a stuck one. */
export function applyMerge(
  d: MockDb,
  plan: MergePlan,
  deps: {
    readonly nextId: (prefix: string) => string;
    readonly appendEvent: (
      d: MockDb,
      serial: string,
      ev: { type: string; note?: string },
    ) => void;
    readonly staff: string;
    readonly now: string;
  },
): void {
  if (plan.stuck) throw new Error("This merge has a variant it cannot place.");
  const target = d.models.find((m) => m.id === plan.target.id)!;
  const id = identityOf(target);
  target.name = plan.name;
  target.axes = plan.axes;
  if (id && !id.intelChip && !target.family) {
    target.family = id.family;
    if (id.sizeInch !== undefined && target.sizeInch === undefined)
      target.sizeInch = id.sizeInch;
    if (/^M\d/.test(id.era)) target.chip = id.era;
    if (id.extra) target.extra = id.extra;
  }
  for (const r of plan.relabel) {
    const s = d.skus.find((x) => x.id === r.skuId)!;
    s.variantLabel = r.label;
  }
  for (const s of d.skus.filter(
    (x) => x.modelId === target.id && isLiveSku(x),
  )) {
    s.name = plan.name;
  }

  for (const step of plan.steps) {
    const sku = d.skus.find((x) => x.id === step.skuId)!;
    if (step.action === "MOVE") {
      sku.modelId = target.id;
      sku.name = plan.name;
      sku.variantLabel = step.label;
      sku.code = step.code;
      continue;
    }
    if (step.action === "DROP") {
      d.skus = d.skus.filter((x) => x.id !== step.skuId);
      continue;
    }
    // JOIN: what it holds moves over; the variant stays, marked.
    const into = d.skus.find((x) => x.id === step.intoSkuId)!;
    for (const serial of step.heldUnits) {
      const u = d.units.find((x) => x.serial === serial)!;
      u.skuId = into.id;
      deps.appendEvent(d, serial, {
        type: "DICATAT",
        note: `Product merged: ${step.fromCode} → ${into.code}`,
      });
    }
    for (const [locationId, qty] of step.counted) {
      const cost = averageCost(d, step.skuId);
      d.stockMoves.push(
        {
          id: deps.nextId("sm"),
          skuId: step.skuId,
          locationId,
          qty: -qty,
          cost,
          type: "KOREKSI",
          at: deps.now,
          note: `Product merged into ${into.code}`,
          staff: deps.staff,
        },
        {
          id: deps.nextId("sm"),
          skuId: into.id,
          locationId,
          qty,
          cost,
          type: "KOREKSI",
          at: deps.now,
          note: `Product merged from ${step.fromCode}`,
          staff: deps.staff,
        },
      );
    }
    sku.modelId = target.id;
    sku.mergedIntoId = into.id;
  }

  // The products merged away, now empty, are archived — and their AppleDB
  // identifiers follow the product they were.
  const links = new Set(target.identifiers ?? []);
  for (const mid of plan.sourceIds) {
    const m = d.models.find((x) => x.id === mid);
    if (!m) continue;
    for (const i of [m.identifier, ...(m.identifiers ?? [])])
      if (i) links.add(i);
    d.models = d.models.filter((x) => x.id !== mid);
  }
  if (target.identifier) links.delete(target.identifier);
  if (links.size > 0) target.identifiers = [...links];
}

export type AppleDbMatch =
  | { readonly status: "LINKED"; readonly model: CatalogModel }
  | { readonly status: "MATCH"; readonly model: CatalogModel }
  | { readonly status: "POSSIBLE"; readonly models: readonly CatalogModel[] }
  | { readonly status: "NEW" };

/**
 * Where an AppleDB entry belongs (2026-10-21: "the AppleDB to not adding
 * things that are already there"). LINKED: its identifier is already on a
 * product. MATCH: a product already in the catalogue IS this machine — typed
 * in by hand, imported from B2Soft, or under another identifier — by its
 * facts or its name; the import links it there and adds only missing
 * variants. NEW: nothing like it yet.
 */
export function matchAppleDb(
  db: Pick<MockDb, "models" | "skus">,
  c: {
    readonly name: string;
    readonly releaseYear: number;
    readonly identifier: string;
    readonly chip?: string;
  },
): AppleDbMatch {
  const linked = db.models.find(
    (m) =>
      m.identifier === c.identifier ||
      (m.identifiers ?? []).includes(c.identifier),
  );
  if (linked) return { status: "LINKED", model: linked };
  const id = modelIdentity(
    c.chip && !modelIdentity(c.name, c.releaseYear)?.era.startsWith("M")
      ? `${c.name} ${c.chip}`
      : c.name,
    c.releaseYear,
  );
  if (!id) return { status: "NEW" };
  // AppleDB's own words ("Retina", "Four Thunderbolt 3 Ports") are not the
  // shop's extras, so they are not compared: line, size and generation are.
  // One product that fits is the match; several (a Touch Bar Pro and a
  // non-Touch Bar one of the same year) are left for a person.
  const fits = db.models.filter((m) => {
    const mid = identityOf(m);
    return (
      mid !== null &&
      !mid.intelChip &&
      mid.family === id.family &&
      mid.era.toUpperCase() === id.era.toUpperCase() &&
      (id.sizeInch === undefined ||
        mid.sizeInch === undefined ||
        Math.floor(mid.sizeInch) === Math.floor(id.sizeInch))
    );
  });
  if (fits.length === 0) return { status: "NEW" };
  // Fits that are ONE product (the duplicates this review exists to merge)
  // are one answer: the copy that would be kept.
  const keys = new Set(fits.map((m) => identityKey(identityOf(m)!)));
  if (keys.size === 1)
    return { status: "MATCH", model: suggestTarget(db, fits) };
  return { status: "POSSIBLE", models: fits };
}
