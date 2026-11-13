/**
 * Every unit the shop holds, one row each — Today's stock table (owner ask
 * 2026-11-13: *"see the stock for all units where he can filter per
 * warehouse, per category, and sort (like a normal table)"*).
 *
 * - **A tracked unit** is a row while the shop still has it (`HELD_STATUSES`:
 *   in QC, on the shelf, reserved, at service): its product, serial, grade,
 *   warehouse, category, status, its OWN sell price (`Unit.price` — the one
 *   the bot quotes; a unit nobody priced has none), its COGS (`costIndex`,
 *   the figure every margin is computed against) and how many days it has
 *   been in the building (since its first ledger row).
 * - **A counted product** has no units (2026-09-19), so it is a QUANTITY row
 *   per variant and warehouse, off the `StockMove` ledger: the variant's
 *   asking price, its moving-average cost per piece, no serial, no grade, no
 *   age — a piece has no first day of its own.
 *
 * Pure: no React, no store. `test/todayStock.test.ts` is the spec.
 */
import type { MockDb, UnitStatus } from "../mock/seed.js";
import { HELD_STATUSES } from "./inventory.js";
import { costIndex } from "./service.js";
import { averageCost, stockLevels } from "./stock.js";

export interface TodayStockRow {
  readonly key: string;
  readonly kind: "UNIT" | "COUNTED";
  readonly skuId: string;
  /** The product's name and its variant. */
  readonly product: string;
  readonly serial?: string;
  readonly grade?: string;
  readonly locationId: string;
  readonly category: string;
  /** A counted product's pieces read as on the shelf. */
  readonly status: UnitStatus;
  /** A unit's own sell price, or a counted product's asking price. */
  readonly sellPrice?: number;
  /** Per unit — or per piece, for a counted row. */
  readonly cogs: number;
  /** Whole days since the unit's first ledger row; absent on a counted row. */
  readonly days?: number;
  /** 1 for a unit; the pieces on hand for a counted row. */
  readonly qty: number;
}

export type TodayStockSources = Pick<
  MockDb,
  "units" | "skus" | "models" | "events" | "stockMoves" | "pos" | "services"
>;

const DAY_MS = 86_400_000;

export function todayStockRows(
  db: TodayStockSources,
  now: Date = new Date(),
): TodayStockRow[] {
  const skuById = new Map(db.skus.map((s) => [s.id, s]));
  const modelById = new Map(db.models.map((m) => [m.id, m]));
  const describe = (skuId: string) => {
    const sku = skuById.get(skuId);
    const model = sku ? modelById.get(sku.modelId) : undefined;
    return {
      product: sku ? `${sku.name} ${sku.variantLabel}`.trim() : skuId,
      category: model?.category ?? "",
      price: sku?.price,
    };
  };

  const firstSeen = new Map<string, string>();
  for (const e of db.events) {
    const was = firstSeen.get(e.serial);
    if (was === undefined || e.at < was) firstSeen.set(e.serial, e.at);
  }
  const cost = costIndex(db);

  const rows: TodayStockRow[] = [];
  for (const u of db.units) {
    if (!HELD_STATUSES.includes(u.status)) continue;
    const d = describe(u.skuId);
    const since = firstSeen.get(u.serial);
    rows.push({
      key: `u:${u.serial}`,
      kind: "UNIT",
      skuId: u.skuId,
      product: d.product,
      serial: u.serial,
      ...(u.grade ? { grade: u.grade } : {}),
      locationId: u.locationId,
      category: d.category,
      status: u.status,
      ...(u.price !== undefined ? { sellPrice: u.price } : {}),
      cogs: cost(u).total,
      ...(since !== undefined
        ? {
            days: Math.max(
              0,
              Math.floor((now.getTime() - Date.parse(since)) / DAY_MS),
            ),
          }
        : {}),
      qty: 1,
    });
  }

  for (const [skuId, at] of stockLevels(db.stockMoves)) {
    const d = describe(skuId);
    const each = averageCost(db, skuId);
    for (const [locationId, qty] of at) {
      if (qty <= 0) continue;
      rows.push({
        key: `c:${skuId}:${locationId}`,
        kind: "COUNTED",
        skuId,
        product: d.product,
        locationId,
        category: d.category,
        status: "TERSEDIA",
        ...(d.price !== undefined ? { sellPrice: d.price } : {}),
        cogs: each,
        qty,
      });
    }
  }
  return rows;
}
