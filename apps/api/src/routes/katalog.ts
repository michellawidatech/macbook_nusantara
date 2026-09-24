/**
 * /api/katalog/inventori — 03-pages-and-features.md (Inventori), 02 §8.
 *
 * "The densest table in the app." Everything the table needs is decided here,
 * server-side: filtering, sorting and pagination, because 5 000 units is well
 * past 02 §1's 2 000-row client-side threshold.
 *
 * The columns are NOT hardcoded. They are derived from `CategoryAttribute`, so
 * adding an attribute to a category adds a column to this screen without a
 * front-end change — that is the whole point of the ERD modelling attributes as
 * rows rather than as a JSON blob.
 */

import { Router } from "express";
import { z } from "zod";
import {
  searchUnits,
  unitTimeline,
  Prisma,
  type PrismaClient,
  type TimelineEvent,
  type UnitCard,
} from "@nusantara/db";
import { ApiError } from "../errors.js";

/** A comma-separated multi-select, as it appears in the URL. */
const csv = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v === ""
      ? []
      : v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
  );

const SORTABLE = [
  "serial",
  "status",
  "lokasi",
  "sku",
  "landed",
  "intakeAt",
] as const;

const querySchema = z.object({
  q: z.string().trim().max(64).optional(),
  grade: csv,
  status: csv,
  lokasi: csv,
  kategori: csv,
  sort: z.enum(SORTABLE).default("serial"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

/** 01 §6: reads that matter are ordered and paginated by an indexed key. */
const ORDER_BY: Record<
  (typeof SORTABLE)[number],
  (dir: "asc" | "desc") => Prisma.Sql
> = {
  serial: (d) =>
    Prisma.sql`u.serial ${d === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}`,
  status: (d) =>
    Prisma.sql`u.status ${d === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, u.serial ASC`,
  lokasi: (d) =>
    Prisma.sql`l.name ${d === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, u.serial ASC`,
  sku: (d) =>
    Prisma.sql`s.name ${d === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, u.serial ASC`,
  landed: (d) =>
    Prisma.sql`u.landed ${d === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, u.serial ASC`,
  intakeAt: (d) =>
    Prisma.sql`u."intakeAt" ${d === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`}, u.serial ASC`,
};

export interface InventoriRow {
  readonly id: string;
  readonly serial: string;
  readonly status: string;
  readonly grade: string | null;
  /** What QC saw. Null for sealed stock, which has nothing to describe. */
  readonly description: string | null;
  /**
   * The ids, not only the labels. Inventory groups a row per PRODUCT and
   * expands to the serials behind it, so it needs something to group BY that
   * survives two variants sharing a display name — and the till needs an id to
   * put in a basket.
   */
  readonly skuId: string;
  readonly skuCode: string;
  readonly skuName: string;
  readonly variantLabel: string | null;
  /** What the shop asks for this variant today. Price is per variant. */
  readonly skuPrice: bigint;
  readonly kategoriId: string;
  readonly kategori: string;
  readonly lokasiId: string;
  readonly lokasi: string;
  /** What this machine cost, and what it cost landed — per-serial facts. */
  readonly buy: bigint;
  readonly landed: bigint;
  readonly intakeAt: Date;
  /** attributeId → value, for the columns derived from CategoryAttribute. */
  readonly attrs: Record<string, string>;
}

/**
 * A serial is at most 23 characters — the Inbound field's width, since a
 * second-hand serial is taken as read (2026-09-21).
 */
const serialParam = z.string().trim().min(1).max(23);

const pickerQuery = z.object({
  q: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Dates go out as ISO strings. Money stays a BigInt here and is stringified by
 * the app-wide JSON replacer (app.ts) — one replacer so no route can forget.
 */
const unitJson = (u: UnitCard) => ({
  ...u,
  intakeAt: u.intakeAt.toISOString(),
  archivedAt: u.archivedAt?.toISOString() ?? null,
});

const eventJson = (e: TimelineEvent) => ({
  ...e,
  at: e.at.toISOString(),
});

export function katalogRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/inventori", (req, res, next) => {
    void (async () => {
      try {
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Filter tidak valid.", {
              field: String(parsed.error.issues[0]?.path[0] ?? "q"),
            }),
          );
          return;
        }
        const { q, grade, status, lokasi, kategori, sort, dir, page, perPage } =
          parsed.data;

        // Built as parameterised fragments — never string interpolation (08 §9).
        const where: Prisma.Sql[] = [Prisma.sql`u."archivedAt" IS NULL`];
        if (q !== undefined && q !== "") {
          where.push(
            Prisma.sql`(u.serial ILIKE ${`%${q}%`} OR s.name ILIKE ${`%${q}%`} OR s.code ILIKE ${`%${q}%`})`,
          );
        }
        if (grade.length > 0) {
          where.push(Prisma.sql`u.grade::text IN (${Prisma.join(grade)})`);
        }
        if (status.length > 0) {
          where.push(Prisma.sql`u.status::text IN (${Prisma.join(status)})`);
        }
        if (lokasi.length > 0) {
          where.push(Prisma.sql`u."locationId" IN (${Prisma.join(lokasi)})`);
        }
        if (kategori.length > 0) {
          where.push(Prisma.sql`c.id IN (${Prisma.join(kategori)})`);
        }

        const from = Prisma.sql`
            FROM "Unit" u
            JOIN "Sku" s ON s.id = u."skuId"
            JOIN "CatalogModel" m ON m.id = s."modelId"
            JOIN "Category" c ON c.id = m."categoryId"
            JOIN "Location" l ON l.id = u."locationId"
           WHERE ${Prisma.join(where, " AND ")}`;

        const [rows, totalRows] = await Promise.all([
          db.$queryRaw<
            (Omit<InventoriRow, "attrs"> & { kategoriId: string })[]
          >(Prisma.sql`
            SELECT u.id, u.serial, u.status::text AS status, u.grade::text AS grade,
                   u.description,
                   s.id AS "skuId", s.code AS "skuCode", s.name AS "skuName",
                   s.price AS "skuPrice", s."variantLabel" AS "variantLabel",
                   c.name AS kategori, c.id AS "kategoriId",
                   l.id AS "lokasiId", l.name AS lokasi, u.landed, u.buy, u."intakeAt"
            ${from}
             ORDER BY ${ORDER_BY[sort](dir)}
             LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`),
          db.$queryRaw<{ n: bigint }[]>(
            Prisma.sql`SELECT count(*) AS n ${from}`,
          ),
        ]);

        const total = Number(totalRows[0]?.n ?? 0);

        // The per-unit attribute values for exactly the rows being shown.
        const ids = rows.map((r) => r.id);
        const attributes =
          ids.length === 0
            ? []
            : await db.unitAttribute.findMany({
                where: { unitId: { in: ids } },
                select: { unitId: true, attributeId: true, value: true },
              });

        const byUnit = new Map<string, Record<string, string>>();
        for (const a of attributes) {
          const bucket = byUnit.get(a.unitId) ?? {};
          bucket[a.attributeId] = a.value;
          byUnit.set(a.unitId, bucket);
        }

        // Columns come from CategoryAttribute — nothing hardcoded. Only the
        // categories actually present in this result contribute columns, so the
        // table does not sprout empty columns for stock that is not there.
        const kategoriIds = [...new Set(rows.map((r) => r.kategoriId))];
        const columns =
          kategoriIds.length === 0
            ? []
            : await db.categoryAttribute.findMany({
                where: { categoryId: { in: kategoriIds } },
                orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
                select: {
                  id: true,
                  key: true,
                  label: true,
                  unit: true,
                  categoryId: true,
                },
              });

        res.json({
          rows: rows.map(({ kategoriId: _kategoriId, ...r }) => ({
            ...r,
            attrs: byUnit.get(r.id) ?? {},
          })),
          columns,
          page,
          perPage,
          total,
          // Distinguishing "no data" from "no matches" is a server fact, not a
          // guess the client should make (02 §8).
          totalUnfiltered: await db.unit.count({ where: { archivedAt: null } }),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  /** The multi-select filter options, so the UI never hardcodes a list. */
  /**
   * The variant picker: what Inbound & QC and the till put on a line.
   *
   * Returns SKUs, not models, because price is per VARIANT (owner revision
   * 2026-08-27) and a line has to name the thing that has a price. `archived`
   * variants are excluded — the shop stopped selling them, and offering one on
   * a new invoice is how a dead variant comes back.
   */
  router.get("/produk", (req, res, next) => {
    void (async () => {
      try {
        const parsed = pickerQuery.safeParse(req.query);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Filter tidak valid.", {
              field: "q",
            }),
          );
          return;
        }
        const { q, limit } = parsed.data;
        const rows = await db.sku.findMany({
          where: {
            archived: false,
            ...(q === undefined || q === ""
              ? {}
              : {
                  OR: [
                    { code: { contains: q, mode: "insensitive" } },
                    { name: { contains: q, mode: "insensitive" } },
                    { model: { name: { contains: q, mode: "insensitive" } } },
                  ],
                }),
          },
          orderBy: [{ name: "asc" }],
          take: limit,
          select: {
            id: true,
            code: true,
            name: true,
            variantLabel: true,
            price: true,
            landed: true,
            grade: true,
            model: {
              select: {
                id: true,
                name: true,
                categoryId: true,
                category: { select: { name: true } },
              },
            },
          },
        });

        res.json(
          rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            variantLabel: r.variantLabel,
            price: r.price,
            landed: r.landed,
            grade: r.grade,
            modelId: r.model.id,
            modelName: r.model.name,
            kategoriId: r.model.categoryId,
            kategori: r.model.category.name,
          })),
        );
      } catch (e) {
        next(e);
      }
    })();
  });

  /** Who the shop buys from. Active only — an inactive supplier is one it stopped using. */
  router.get("/supplier", (_req, res, next) => {
    void (async () => {
      try {
        const rows = await db.supplier.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, wa: true, note: true },
        });
        // ⚠️ No `code`: the two-letter origin code the store barcode is built
        // from is still a schema gap (CLAUDE.md). Said here rather than
        // silently omitted, because the label dialog looks for it.
        res.json(rows.map((r) => ({ ...r, originCode: null })));
      } catch (e) {
        next(e);
      }
    })();
  });

  /** How the shop pays. `forPo` separates supplier payments from till payments. */
  router.get("/pembayaran", (_req, res, next) => {
    void (async () => {
      try {
        const rows = await db.paymentMethod.findMany({
          where: { active: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            code: true,
            label: true,
            forPo: true,
            forSale: true,
          },
        });
        res.json(rows);
      } catch (e) {
        next(e);
      }
    })();
  });

  router.get("/inventori/filters", (_req, res, next) => {
    void (async () => {
      try {
        const [locations, categories, statuses, grades] = await Promise.all([
          db.location.findMany({
            where: { active: true },
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true },
          }),
          db.category.findMany({
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true },
          }),
          db.unit.groupBy({ by: ["status"], _count: { status: true } }),
          db.unit.groupBy({ by: ["grade"], _count: { grade: true } }),
        ]);

        res.json({
          lokasi: locations,
          kategori: categories,
          status: statuses.map((s) => ({
            id: s.status,
            name: s.status,
            count: s._count.status,
          })),
          grade: grades
            .filter((g) => g.grade !== null)
            .map((g) => ({
              id: g.grade,
              name: g.grade,
              count: g._count.grade,
            })),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  /**
   * One serial's whole life — S/N Tracking.
   *
   * Longer prefixes first (01 §2): this sits above nothing, but it is declared
   * before the picker below so the shape of the section reads top-down.
   */
  router.get("/unit/:serial", (req, res, next) => {
    void (async () => {
      try {
        const parsed = serialParam.safeParse(req.params["serial"]);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Nomor seri tidak valid.", {
              field: "serial",
            }),
          );
          return;
        }
        // UnknownSerialError from the service becomes a 404 naming the serial,
        // translated centrally in errorHandler.
        const { unit, events } = await unitTimeline(db, parsed.data);
        res.json({ unit: unitJson(unit), events: events.map(eventJson) });
      } catch (error) {
        next(error);
      }
    })();
  });

  /** Serials to offer in the tracker's picker — searched and capped server-side. */
  router.get("/unit", (req, res, next) => {
    void (async () => {
      try {
        const parsed = pickerQuery.safeParse(req.query);
        if (!parsed.success) {
          next(
            new ApiError(400, "VALIDASI", "Pencarian tidak valid.", {
              field: "q",
            }),
          );
          return;
        }
        res.json({ units: await searchUnits(db, parsed.data) });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
