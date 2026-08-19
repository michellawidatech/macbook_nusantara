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
import { Prisma, type PrismaClient } from "@nusantara/db";
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
  readonly skuCode: string;
  readonly skuName: string;
  readonly kategori: string;
  readonly lokasi: string;
  readonly landed: bigint;
  readonly intakeAt: Date;
  /** attributeId → value, for the columns derived from CategoryAttribute. */
  readonly attrs: Record<string, string>;
}

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
                   s.code AS "skuCode", s.name AS "skuName",
                   c.name AS kategori, c.id AS "kategoriId",
                   l.name AS lokasi, u.landed, u."intakeAt"
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

  return router;
}
