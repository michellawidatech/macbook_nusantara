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
import { modelKeyOf, variantKeyOf } from "@nusantara/domain";
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
      await tx.modelAxis.update({
        where: { id: a.id },
        data: { removedAt: ctx.now },
      });
    }
  }
}

/**
 * The product key this row may hold (2026-10-21). Another LIVE product
 * already being this product — by its stored key, or, for a row saved before
 * keys existed, by its name — means:
 * - a NEW product is refused: that is the second copy the key exists to stop
 *   (in import mode it is let through keyless, so a replay never fails);
 * - an EXISTING one keeps no key, and every edit to it still saves. The
 *   catalogue holds duplicates from before, and a rule that blocked editing
 *   them would stop the shop until they were merged.
 */
/** Products this commit archives — they give up their key and AppleDB links. */
function removedModels(ctx: WriteContext): Set<string> {
  let set = ctx.memo.get("models.removed") as Set<string> | undefined;
  if (!set) ctx.memo.set("models.removed", (set = new Set()));
  return set;
}

async function freeProductKey(
  ctx: WriteContext,
  id: string,
  key: string | null,
  creatingName: string | null,
): Promise<string | null> {
  if (key === null) return null;
  const live = await ctx.tx.catalogModel.findMany({
    where: {
      archived: false,
      id: { notIn: [id, ...removedModels(ctx)] },
    },
    select: {
      name: true,
      year: true,
      family: true,
      sizeInch: true,
      chip: true,
      extra: true,
      productKey: true,
    },
  });
  const holder = live.find(
    (m) =>
      (m.productKey ??
        modelKeyOf({
          ...m,
          sizeInch: m.sizeInch === null ? null : m.sizeInch.toNumber(),
        })) === key,
  );
  if (holder === undefined) return key;
  if (creatingName !== null && ctx.mode !== "import") {
    throw new StoreValidationError(
      `Produk ini sudah ada: ${holder.name}. Tambahkan variannya ke sana.`,
      "models",
      id,
    );
  }
  return null;
}

/** AppleDB identifiers linked to the product. Added, never removed. */
async function linkIdentifiers(
  ctx: WriteContext,
  modelId: string,
  identifiers: readonly string[],
): Promise<void> {
  for (const identifier of new Set(identifiers.map((i) => i.trim()))) {
    if (identifier === "") continue;
    const held = await ctx.tx.modelIdentifier.findUnique({
      where: { identifier },
    });
    if (held?.modelId === modelId) continue;
    if (held) {
      // A product merged away hands its links to the one it became.
      const from = await ctx.tx.catalogModel.findUnique({
        where: { id: held.modelId },
        select: { archived: true },
      });
      if (from?.archived || removedModels(ctx).has(held.modelId)) {
        await ctx.tx.modelIdentifier.update({
          where: { id: held.id },
          data: { modelId },
        });
        continue;
      }
      throw new StoreValidationError(
        `AppleDB ${identifier} sudah terhubung ke produk lain.`,
        "models",
        modelId,
      );
    }
    await ctx.tx.modelIdentifier.create({
      data: { modelId, identifier, createdAt: ctx.now },
    });
  }
}

/** "These are different products" — stored once per pair, ordered. */
async function markNotDuplicates(
  ctx: WriteContext,
  modelId: string,
  others: readonly string[],
): Promise<void> {
  for (const other of new Set(others)) {
    if (other === modelId) continue;
    const [aModelId, bModelId] =
      modelId < other ? [modelId, other] : [other, modelId];
    // Read, then insert: the app role may not UPDATE this table, and an
    // upsert is an UPDATE to PostgreSQL even when it changes nothing.
    const had = await ctx.tx.modelNotDuplicate.findUnique({
      where: { aModelId_bModelId: { aModelId, bModelId } },
    });
    if (had === null) {
      await ctx.tx.modelNotDuplicate.create({
        data: { aModelId, bModelId, createdAt: ctx.now },
      });
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
            values: {
              where: { removedAt: null },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
        identifiers: { orderBy: { createdAt: "asc" } },
        notDuplicateA: { select: { bModelId: true } },
        notDuplicateB: { select: { aModelId: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category.name,
      releaseYear: Number.parseInt(m.year ?? "", 10) || 0,
      line: m.line ?? undefined,
      sizeInch: m.sizeInch === null ? undefined : m.sizeInch.toNumber(),
      axes: m.axes.map((a) => ({
        name: a.name,
        values: a.values.map((v) => v.value),
      })),
      identifier: m.identifier ?? undefined,
      source: m.source ?? undefined,
      ...(m.family === null ? {} : { family: m.family }),
      ...(m.chip === null ? {} : { chip: m.chip }),
      ...(m.extra === null ? {} : { extra: m.extra }),
      ...(m.identifiers.length === 0
        ? {}
        : { identifiers: m.identifiers.map((i) => i.identifier) }),
      ...(m.notDuplicateA.length + m.notDuplicateB.length === 0
        ? {}
        : {
            notDuplicateOf: [
              ...m.notDuplicateA.map((d) => d.bModelId),
              ...m.notDuplicateB.map((d) => d.aModelId),
            ].sort(),
          }),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "CatalogModel", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows)
      if (r.next === undefined) removedModels(ctx).add(r.key);
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        // A product is deleted by archiving it (owner ask 2026-10-21), and
        // only once it has no live variant left. Checked AFTER the rest of
        // the commit: models are written before skus, and the same commit
        // removes the product's variants.
        const id = r.key;
        ctx.later.push(async () => {
          const live = await tx.sku.count({
            where: { modelId: id, archived: false },
          });
          if (live > 0) {
            throw new StoreValidationError(
              "Produk ini masih punya varian — hapus variannya dulu.",
              "models",
              id,
            );
          }
          await tx.catalogModel.update({
            where: { id },
            data: { archived: true },
          });
        });
        ctx.touch("models", id);
        continue;
      }
      const facts = {
        family: n.family?.trim() || null,
        chip: n.chip?.trim() || null,
        extra: n.extra?.trim() || null,
      };
      const productKey = await freeProductKey(
        ctx,
        n.id,
        modelKeyOf({
          name: n.name,
          year: n.releaseYear,
          sizeInch: n.sizeInch ?? null,
          ...facts,
        }),
        r.base === undefined ? n.name : null,
      );
      const data = {
        categoryId: await ctx.categoryId(n.category),
        name: n.name.trim(),
        year: String(n.releaseYear),
        line: n.line ?? null,
        sizeInch: n.sizeInch ?? null,
        identifier: n.identifier ?? null,
        source: n.source ?? null,
        ...facts,
        productKey,
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
      await linkIdentifiers(ctx, n.id, n.identifiers ?? []);
      await markNotDuplicates(ctx, n.id, n.notDuplicateOf ?? []);
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
      await tx.skuAxisValue.update({
        where: { id: v.id },
        data: { removedAt: ctx.now },
      });
    }
  }
}

/**
 * The variant key this row may hold — the rule `freeProductKey` follows: a
 * NEW variant that is already on its product is refused; an existing
 * duplicate keeps no key and still saves.
 */
async function freeVariantKey(
  ctx: WriteContext,
  id: string,
  modelId: string,
  key: string | null,
  creating: boolean,
): Promise<string | null> {
  if (key === null) return null;
  const siblings = await ctx.tx.sku.findMany({
    where: { modelId, archived: false, id: { not: id } },
    select: { code: true, variantKey: true, variantLabel: true },
  });
  const holder = siblings.find(
    (s) => (s.variantKey ?? variantKeyOf(s.variantLabel)) === key,
  );
  if (holder === undefined) return key;
  if (creating && ctx.mode !== "import") {
    throw new StoreValidationError(
      `Varian ini sudah ada di produk ini: ${holder.code}.`,
      "skus",
      id,
    );
  }
  return null;
}

/**
 * A merged variant gives everything it HOLDS to the one it was merged into:
 * no unit still held under it, no counted stock left on its shelf. What it
 * sold stays — receipts name it, which is why it is kept at all.
 */
async function checkMerged(
  ctx: WriteContext,
  id: string,
  into: string,
): Promise<void> {
  const target = await ctx.tx.sku.findUnique({
    where: { id: into },
    select: { mergedIntoId: true, archived: true },
  });
  if (target === null || target.archived || target.mergedIntoId !== null) {
    throw new StoreValidationError(
      "Varian tujuan penggabungan tidak aktif.",
      "skus",
      id,
    );
  }
  const held = await ctx.tx.unit.count({
    where: {
      skuId: id,
      archivedAt: null,
      status: { in: ["QC", "TERSEDIA", "DIRESERVASI", "SERVIS"] },
    },
  });
  const counted = await ctx.tx.stockMove.aggregate({
    where: { skuId: id },
    _sum: { qty: true },
  });
  if (held > 0 || (counted._sum.qty ?? 0) !== 0) {
    throw new StoreValidationError(
      "Varian yang digabung masih punya stok — pindahkan dulu.",
      "skus",
      id,
    );
  }
}

export const skus: Adapter<"skus"> = {
  collection: "skus",
  async project(tx, _ctx, keys) {
    const rows = await tx.sku.findMany({
      // A merged variant is archived but still projected: receipts and
      // invoices name it. Pickers leave it out (`isLiveSku`).
      where: {
        ...byId(keys),
        OR: [{ archived: false }, { mergedIntoId: { not: null } }],
      },
      orderBy: [{ createdAt: "asc" }, { code: "asc" }],
      include: {
        axisValues: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
        },
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
      ...(s.mergedIntoId === null ? {} : { mergedIntoId: s.mergedIntoId }),
      ...(s.shopeeUrl === null ? {} : { shopeeUrl: s.shopeeUrl }),
      ...(s.tokopediaUrl === null ? {} : { tokopediaUrl: s.tokopediaUrl }),
      ...(s.instagramUrl === null ? {} : { instagramUrl: s.instagramUrl }),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Sku", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    /*
     * `Sku.code` is unique across EVERY row, archived ones included, and the
     * browser never sees an archived variant — so a code it picked as free
     * could still be held (2026-10-21: renaming 24 SKU_ codes to the shop's
     * naming was refused, because "Replace all variants" had archived the
     * earlier rows of those exact names). Two passes make the batch safe:
     * every changed code is first parked on a value nothing else can hold, so
     * a rename may take a code another row of the same batch is giving up;
     * then an ARCHIVED holder of a wanted code is renamed out of the way.
     * A LIVE holder is still a real conflict and the database refuses it.
     */
    const changed = rows.filter(
      (r) =>
        r.base !== undefined &&
        r.next !== undefined &&
        r.base.code !== r.next.code,
    );
    for (const r of changed) {
      await tx.sku.update({
        where: { id: r.key },
        data: { code: `~renaming~${r.key}` },
      });
    }
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) continue;
      if (r.base !== undefined && r.base.code === n.code) continue;
      const holder = await tx.sku.findUnique({
        where: { code: n.code },
        select: { id: true, archived: true, mergedIntoId: true },
      });
      // A MERGED variant is archived too, but the browser sees it and its
      // code is still on receipts: it is a live holder, not litter.
      if (
        holder !== null &&
        holder.id !== n.id &&
        holder.archived &&
        holder.mergedIntoId === null
      ) {
        await tx.sku.update({
          where: { id: holder.id },
          data: { code: `${n.code} [archived ${holder.id}]` },
        });
      }
    }
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
        // Nor one any past document names (2026-10-21): an archived variant
        // is not projected, so a receipt or invoice line naming it would name
        // nothing on every screen. Same rule as the browser's `variantInUse`.
        const named = await tx.sku.findUnique({
          where: { id: r.key },
          select: {
            _count: {
              select: {
                orderItems: true,
                poItems: true,
                stockMoves: true,
                stockIns: true,
                tradeIns: true,
              },
            },
          },
        });
        if (named && Object.values(named._count).some((c) => c > 0)) {
          throw new StoreValidationError(
            "Varian ini punya riwayat stok atau penjualan — tidak bisa dihapus.",
            "skus",
            r.key,
          );
        }
        await tx.sku.update({ where: { id: r.key }, data: { archived: true } });
        ctx.touch("skus", r.key);
        continue;
      }
      const merged = n.mergedIntoId ?? null;
      if (merged !== null && (r.base?.mergedIntoId ?? null) !== merged) {
        // Checked once the whole commit has landed: the same commit moves
        // this variant's units onto the one it is merged into.
        ctx.later.push(() => checkMerged(ctx, n.id, merged));
      }
      const data = {
        modelId: n.modelId,
        code: n.code,
        name: n.name,
        variantLabel: n.variantLabel,
        price: n.price,
        mergedIntoId: merged,
        shopeeUrl: n.shopeeUrl ?? null,
        tokopediaUrl: n.tokopediaUrl ?? null,
        instagramUrl: n.instagramUrl ?? null,
        variantKey:
          merged === null
            ? await freeVariantKey(
                ctx,
                n.id,
                n.modelId,
                variantKeyOf(n.variantLabel),
                r.base === undefined,
              )
            : null,
        ...(merged === null ? {} : { archived: true }),
      };
      if (r.base === undefined) {
        await tx.sku.create({
          data: {
            id: n.id,
            ...data,
            grade: null,
            landed: 0n,
            archived: merged !== null,
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
      const data = {
        categoryId: await ctx.categoryId(n.category),
        name: n.name,
      };
      if (r.base === undefined) {
        const max = await tx.gradingCriterion.aggregate({
          _max: { sortOrder: true },
        });
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
        const existing = await tx.gradingOption.findMany({
          where: { criterionId: n.id },
        });
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
      await tx.gradingCriterion.updateMany({
        where: { id },
        data: { sortOrder },
      });
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
        await tx.gradingRule.update({
          where: { id: r.key },
          data: { archivedAt: ctx.now },
        });
        ctx.touch("gradingRules", r.key);
        continue;
      }
      const data = {
        categoryId: await ctx.categoryId(n.category),
        grade: n.grade,
      };
      if (r.base === undefined) {
        const max = await tx.gradingRule.aggregate({
          _max: { sortOrder: true },
        });
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
        const existing = await tx.gradingRuleOption.findMany({
          where: { ruleId: n.id },
        });
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
