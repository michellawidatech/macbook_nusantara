/**
 * The catalogue: models and their axes, variants and their axis values, and
 * the grading configuration per category.
 *
 * Categories are NAMES in the browser (`CatalogModel.category`,
 * `GradingCriterion.category`) and rows here; `WriteContext.categoryId` is the
 * one place a name becomes a row.
 *
 * Removals, where the pages make them, become marks rather than deletes: an
 * axis value somebody took off a model is `removedAt`, a variant nobody ever
 * stocked is `archived`, a grading option or rule is `archivedAt`. Projection
 * leaves them out, so the page sees what it wrote.
 */
import { deepEqual } from "@nusantara/store";
import { StoreValidationError } from "../errors.js";
import {
  type Adapter,
  type RowOf,
  type WriteContext,
  indexIn,
  lockRows,
  refuseRemoval,
} from "../context.js";

const byId = (keys?: readonly string[]) =>
  keys === undefined ? {} : { id: { in: [...keys] } };

const after = (max: number | null | undefined): number => (max ?? -1) + 1;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * A category as a row of its own (2026-09-15).
 *
 * Until now a category reached the browser only as a NAME, on a model and on a
 * grading rule, and `WriteContext.categoryId` created one the first time
 * somebody typed it on a product. That still happens — it is how a category is
 * born — and this adapter is what carries the one fact the app branches on:
 * whether machines of this category are identified one by one.
 *
 * Never removed here. A category is referenced by every model under it, and
 * `Category` has no archived-at; Settings switches `tracksSerial` and renames,
 * and a category nobody uses is simply a category nobody uses.
 */
export const categories: Adapter<"categories"> = {
  collection: "categories",
  async project(tx, _ctx, keys) {
    const rows = await tx.category.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tracksSerial: r.tracksSerial,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Category", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("categories", r.key);
      const name = n.name.trim();
      if (name === "") {
        throw new StoreValidationError(
          "Nama kategori tidak boleh kosong.",
          "categories",
          n.id,
        );
      }
      const data = { name, tracksSerial: n.tracksSerial };
      if (r.base === undefined) {
        const max = await tx.category.aggregate({ _max: { sortOrder: true } });
        await tx.category.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            // The margin band is Settings' own screen and is not this row's
            // to invent; a category born here starts on the same zeroes
            // `WriteContext.categoryId` gives one born from a product.
            marginMode: "PCT",
            marginMin: 0n,
            marginMax: 0n,
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.category.update({ where: { id: n.id }, data });
      }
      ctx.touch("categories", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.category.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("categories", id);
    }
  },
};

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

type Axis = RowOf<"models">["axes"][number];

async function syncAxes(
  ctx: WriteContext,
  modelId: string,
  axes: readonly Axis[],
): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.modelAxis.findMany({
    where: { modelId },
    include: { values: true },
  });
  const left = new Map(existing.map((a) => [a.name, a]));
  for (const [sortOrder, axis] of axes.entries()) {
    let row = left.get(axis.name);
    if (row === undefined) {
      row = await tx.modelAxis.create({
        data: { modelId, name: axis.name, sortOrder },
        include: { values: true },
      });
    } else {
      left.delete(axis.name);
      if (row.sortOrder !== sortOrder || row.removedAt !== null) {
        await tx.modelAxis.update({
          where: { id: row.id },
          data: { sortOrder, removedAt: null },
        });
      }
    }
    const values = new Map(row.values.map((v) => [v.value, v]));
    for (const [j, value] of axis.values.entries()) {
      const had = values.get(value);
      if (had === undefined) {
        await tx.modelAxisValue.create({
          data: { axisId: row.id, value, sortOrder: j },
        });
      } else {
        values.delete(value);
        if (had.sortOrder !== j || had.removedAt !== null) {
          await tx.modelAxisValue.update({
            where: { id: had.id },
            data: { sortOrder: j, removedAt: null },
          });
        }
      }
    }
    for (const v of values.values()) {
      if (v.removedAt === null) {
        await tx.modelAxisValue.update({
          where: { id: v.id },
          data: { removedAt: ctx.now },
        });
      }
    }
  }
  for (const a of left.values()) {
    if (a.removedAt === null) {
      await tx.modelAxis.update({ where: { id: a.id }, data: { removedAt: ctx.now } });
    }
  }
}

export const models: Adapter<"models"> = {
  collection: "models",
  async project(tx, _ctx, keys) {
    const rows = await tx.catalogModel.findMany({
      where: { ...byId(keys), archived: false },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        category: { select: { name: true } },
        axes: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
          include: {
            values: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category.name,
      releaseYear: Number.parseInt(m.year ?? "", 10) || 0,
      line: m.line ?? undefined,
      sizeInch: m.sizeInch === null ? undefined : m.sizeInch.toNumber(),
      axes: m.axes.map((a) => ({ name: a.name, values: a.values.map((v) => v.value) })),
      identifier: m.identifier ?? undefined,
      source: m.source ?? undefined,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "CatalogModel", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("models", r.key);
      const data = {
        categoryId: await ctx.categoryId(n.category),
        name: n.name.trim(),
        year: String(n.releaseYear),
        line: n.line ?? null,
        sizeInch: n.sizeInch ?? null,
        identifier: n.identifier ?? null,
        source: n.source ?? null,
      };
      if (r.base === undefined) {
        await tx.catalogModel.create({
          data: { id: n.id, ...data, archived: false, createdAt: ctx.now },
        });
      } else {
        await tx.catalogModel.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.axes, n.axes)) {
        await syncAxes(ctx, n.id, n.axes);
      }
      ctx.touch("models", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

async function syncAxisValues(
  ctx: WriteContext,
  skuId: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.skuAxisValue.findMany({ where: { skuId } });
  const left = new Map(existing.map((v) => [v.axis, v]));
  for (const [sortOrder, [axis, value]] of Object.entries(values).entries()) {
    if (left.has(axis)) {
      await tx.skuAxisValue.update({
        where: { skuId_axis: { skuId, axis } },
        data: { value, sortOrder, removedAt: null },
      });
      left.delete(axis);
    } else {
      await tx.skuAxisValue.create({ data: { skuId, axis, value, sortOrder } });
    }
  }
  for (const v of left.values()) {
    if (v.removedAt === null) {
      await tx.skuAxisValue.update({ where: { id: v.id }, data: { removedAt: ctx.now } });
    }
  }
}

export const skus: Adapter<"skus"> = {
  collection: "skus",
  async project(tx, _ctx, keys) {
    const rows = await tx.sku.findMany({
      where: { ...byId(keys), archived: false },
      orderBy: [{ createdAt: "asc" }, { code: "asc" }],
      include: {
        axisValues: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      modelId: s.modelId,
      code: s.code,
      name: s.name,
      variantLabel: s.variantLabel ?? "",
      axisValues:
        s.axisValues.length === 0
          ? undefined
          : Object.fromEntries(s.axisValues.map((v) => [v.axis, v.value])),
      price: s.price,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Sku", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        // A variant with stock is refused: its machines would be left pointing
        // at a product no page lists. One nobody ever stocked is archived.
        const inStock = await tx.unit.count({
          where: { skuId: r.key, archivedAt: null },
        });
        if (inStock > 0) {
          throw new StoreValidationError(
            "Varian ini masih punya unit — tidak bisa dihapus.",
            "skus",
            r.key,
          );
        }
        await tx.sku.update({ where: { id: r.key }, data: { archived: true } });
        ctx.touch("skus", r.key);
        continue;
      }
      const data = {
        modelId: n.modelId,
        code: n.code,
        name: n.name,
        variantLabel: n.variantLabel,
        price: n.price,
      };
      if (r.base === undefined) {
        await tx.sku.create({
          data: {
            id: n.id,
            ...data,
            grade: null,
            landed: 0n,
            archived: false,
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.sku.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.axisValues, n.axisValues)) {
        await syncAxisValues(ctx, n.id, n.axisValues ?? {});
      }
      ctx.touch("skus", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export const gradingCriteria: Adapter<"gradingCriteria"> = {
  collection: "gradingCriteria",
  async project(tx, _ctx, keys) {
    const rows = await tx.gradingCriterion.findMany({
      where: { ...byId(keys), archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        category: { select: { name: true } },
        options: { where: { archivedAt: null }, orderBy: { sortOrder: "asc" } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      category: c.category.name,
      name: c.name,
      options: c.options.map((o) => ({ id: o.id, label: o.label })),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "GradingCriterion", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await tx.gradingCriterion.update({
          where: { id: r.key },
          data: { archivedAt: ctx.now },
        });
        ctx.touch("gradingCriteria", r.key);
        continue;
      }
      const data = { categoryId: await ctx.categoryId(n.category), name: n.name };
      if (r.base === undefined) {
        const max = await tx.gradingCriterion.aggregate({ _max: { sortOrder: true } });
        await tx.gradingCriterion.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.gradingCriterion.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.options, n.options)) {
        const existing = await tx.gradingOption.findMany({ where: { criterionId: n.id } });
        const left = new Map(existing.map((o) => [o.id, o]));
        for (const [sortOrder, o] of n.options.entries()) {
          if (left.has(o.id)) {
            await tx.gradingOption.update({
              where: { id: o.id },
              data: { label: o.label, sortOrder, archivedAt: null },
            });
            left.delete(o.id);
          } else {
            await tx.gradingOption.create({
              data: { id: o.id, criterionId: n.id, label: o.label, sortOrder },
            });
          }
        }
        for (const o of left.values()) {
          if (o.archivedAt === null) {
            await tx.gradingOption.update({
              where: { id: o.id },
              data: { archivedAt: ctx.now },
            });
          }
        }
      }
      ctx.touch("gradingCriteria", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.gradingCriterion.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("gradingCriteria", id);
    }
  },
};

export const gradingRules: Adapter<"gradingRules"> = {
  collection: "gradingRules",
  async project(tx, _ctx, keys) {
    const rows = await tx.gradingRule.findMany({
      where: { ...byId(keys), archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        category: { select: { name: true } },
        options: { where: { removedAt: null }, orderBy: { sortOrder: "asc" } },
      },
    });
    return rows.map((rule) => {
      const groups = new Map<string, string[]>();
      for (const o of rule.options) {
        const list = groups.get(o.criterionId) ?? [];
        list.push(o.optionId);
        groups.set(o.criterionId, list);
      }
      return {
        id: rule.id,
        category: rule.category.name,
        grade: rule.grade,
        conditions: [...groups].map(([criterionId, optionIds]) => ({
          criterionId,
          optionIds,
        })),
      };
    });
  },
  lock: (tx, keys) => lockRows(tx, "GradingRule", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await tx.gradingRule.update({ where: { id: r.key }, data: { archivedAt: ctx.now } });
        ctx.touch("gradingRules", r.key);
        continue;
      }
      const data = { categoryId: await ctx.categoryId(n.category), grade: n.grade };
      if (r.base === undefined) {
        const max = await tx.gradingRule.aggregate({ _max: { sortOrder: true } });
        await tx.gradingRule.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.gradingRule.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.conditions, n.conditions)) {
        const existing = await tx.gradingRuleOption.findMany({ where: { ruleId: n.id } });
        const left = new Map(existing.map((o) => [o.optionId, o]));
        for (const [ci, condition] of n.conditions.entries()) {
          for (const [oi, optionId] of condition.optionIds.entries()) {
            const data = {
              criterionId: condition.criterionId,
              sortOrder: ci * 1000 + oi,
              removedAt: null,
            };
            if (left.has(optionId)) {
              await tx.gradingRuleOption.update({
                where: { ruleId_optionId: { ruleId: n.id, optionId } },
                data,
              });
              left.delete(optionId);
            } else {
              await tx.gradingRuleOption.create({
                data: { ruleId: n.id, optionId, ...data },
              });
            }
          }
        }
        for (const o of left.values()) {
          if (o.removedAt === null) {
            await tx.gradingRuleOption.update({
              where: { id: o.id },
              data: { removedAt: ctx.now },
            });
          }
        }
      }
      ctx.touch("gradingRules", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.gradingRule.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("gradingRules", id);
    }
  },
};
