/**
 * One serial's whole life — the read behind S/N Tracking.
 *
 * The ledger is the truth and this is a reading of it. Each event is *enriched*
 * by looking sideways at the order, the hold, the supplier return and the
 * purchase order, so a sale says who bought it and a hold says who it is being
 * held for. None of that is stored on the event.
 *
 * ## Why the joins are by id and not by serial
 *
 * The browser version searched each table for a row mentioning this serial and
 * took the FIRST match. A machine held, released, and then held again by a
 * different customer narrated the wrong person on both events — and there was
 * no way for it to know better, because nothing recorded which hold an event
 * belonged to.
 *
 * `UnitEvent` carries `orderId`, `purchaseOrderId`, `claimId`,
 * `opnameSessionId` and — since migration 20260828120000 — `reservationId`. So
 * every join here is an id the event itself names. An event that names nothing
 * gets no context line rather than a guess.
 */

import type { UnitStatus } from "@nusantara/domain";
import { type PrismaClient, type Tx } from "./client.js";
import { UnknownSerialError } from "./withUnitLocks.js";

export interface TimelineEvent {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly at: Date;
  readonly fromStatus: UnitStatus | null;
  readonly toStatus: UnitStatus;
  readonly locationName: string | null;
  readonly staffName: string;
  /** The document number a transfer carries, if any. */
  readonly code: string | null;
  readonly note: string | null;
  /**
   * The reference this event points at — an order code, a hold code, a supplier
   * return. Null when the event names none, which is most of them.
   */
  readonly refCode: string | null;
  /** Who or what the reference is about, already joined. Null when there is nothing to add. */
  readonly context: TimelineContext | null;
}

/**
 * Structured rather than a sentence.
 *
 * The phrasing is the SPA's job — it is user-facing text and has to go through
 * the translation catalogue (CLAUDE.md: every string is bilingual). A service
 * that returned "Sold to Budi on SI-…" would be shipping untranslatable English
 * from the server.
 */
export type TimelineContext =
  | {
      readonly kind: "SALE";
      readonly orderCode: string;
      readonly platform: string;
      readonly customerName: string | null;
      /** What this machine sold for, in whole rupiah. */
      readonly price: bigint | null;
    }
  | {
      readonly kind: "HOLD";
      readonly reservationCode: string;
      readonly customerName: string | null;
      readonly channelName: string | null;
    }
  | {
      readonly kind: "SUPPLIER_RETURN";
      readonly returnCode: string;
      readonly supplierName: string;
    }
  | {
      readonly kind: "ARRIVAL";
      readonly purchaseOrderCode: string;
      readonly supplierName: string;
    }
  | { readonly kind: "SHELVED"; readonly locationName: string | null };

export interface UnitCard {
  readonly serial: string;
  readonly status: UnitStatus;
  readonly locationName: string | null;
  readonly grade: string | null;
  /** Whole rupiah. What the shop paid for THIS machine. */
  readonly buy: bigint;
  readonly landed: bigint;
  readonly intakeAt: Date;
  readonly archivedAt: Date | null;
  readonly skuId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  /** The variant's asking price — per variant since 2026-08-27, not per serial. */
  readonly price: bigint;
  readonly modelName: string | null;
  readonly categoryName: string | null;
  /** The invoice this machine arrived on, if it is linked to one. */
  readonly purchaseOrderCode: string | null;
  /**
   * NOT SERVED YET, and deliberately null rather than invented.
   *
   * `Unit` has no `description` column and never has. `QcDescription`'s docblock
   * says the phrases are joined "into the sentence the column stores" while
   * `UnitStatus.QC`'s says QC records "the description (UnitNote)" — the schema
   * says two things, and CLAUDE.md's rule is that the schema wins, so there is
   * nothing here to win with. Needs an owner decision before it can be read.
   */
  readonly description: null;
  /**
   * NOT SERVED YET. There is no Rack model: `Location` has no parent and `Unit`
   * carries a single `locationId`, so a warehouse and a shelf cannot both be
   * stored. Needs a migration and an owner decision.
   */
  readonly rackName: null;
}

export interface UnitTimeline {
  readonly unit: UnitCard;
  /** Newest first — the same order the screen reads in. */
  readonly events: readonly TimelineEvent[];
}

const INCLUDE = {
  location: { select: { name: true } },
  sku: {
    select: {
      id: true,
      code: true,
      name: true,
      variantLabel: true,
      price: true,
      model: { select: { name: true, category: { select: { name: true } } } },
    },
  },
  poItem: { select: { po: { select: { code: true } } } },
  events: {
    orderBy: { seq: "desc" as const },
    select: {
      id: true,
      seq: true,
      type: true,
      at: true,
      fromStatus: true,
      toStatus: true,
      code: true,
      note: true,
      toLocation: { select: { name: true } },
      staff: { select: { name: true } },
      order: {
        select: {
          code: true,
          platform: true,
          custName: true,
          customer: { select: { name: true } },
          items: { select: { unitId: true, price: true } },
        },
      },
      reservation: {
        select: {
          code: true,
          custName: true,
          customer: { select: { name: true } },
          reservationSource: { select: { name: true } },
        },
      },
      purchaseOrder: {
        select: { code: true, supplier: { select: { name: true } } },
      },
    },
  },
} as const;

/**
 * Everything S/N Tracking renders for one serial, in one round trip.
 *
 * @throws UnknownSerialError when the serial is not in the database — the same
 *         class the locking helper throws, so the API maps it to one 404 that
 *         names the serial rather than a bare "not found".
 */
export async function unitTimeline(
  db: PrismaClient | Tx,
  serial: string,
): Promise<UnitTimeline> {
  const unit = await db.unit.findUnique({
    where: { serial },
    include: INCLUDE,
  });
  if (!unit) throw new UnknownSerialError([serial]);

  // Supplier returns are the one reference an event does NOT carry an id for:
  // `UnitEvent` has no `supplierReturnId`. Read them by unit — which is exact,
  // because `SupplierReturnItem.unitId` is a real FK — and pair them with the
  // RETUR_SUPPLIER events in order, oldest first, so a machine sent back twice
  // narrates its two claims in the order they were raised rather than showing
  // the first one twice.
  const returns = await db.supplierReturnItem.findMany({
    where: { unitId: unit.id },
    orderBy: { supplierReturn: { createdAt: "asc" } },
    select: {
      supplierReturn: {
        select: { code: true, supplier: { select: { name: true } } },
      },
    },
  });
  const returnQueue = returns.map((r) => r.supplierReturn);
  let returnsSeen = 0;

  const events: TimelineEvent[] = [];
  // Oldest first while pairing the returns, then reversed for the screen.
  for (const e of [...unit.events].reverse()) {
    let context: TimelineContext | null = null;
    let refCode: string | null = null;

    if (e.type === "TERJUAL" && e.order) {
      const line = e.order.items.find((i) => i.unitId === unit.id);
      refCode = e.order.code;
      context = {
        kind: "SALE",
        orderCode: e.order.code,
        platform: e.order.platform,
        customerName: e.order.customer?.name ?? e.order.custName ?? null,
        price: line?.price ?? null,
      };
    } else if (
      (e.type === "DIRESERVASI" || e.type === "RESERVASI_BATAL") &&
      e.reservation
    ) {
      refCode = e.reservation.code;
      context = {
        kind: "HOLD",
        reservationCode: e.reservation.code,
        customerName:
          e.reservation.customer?.name ?? e.reservation.custName ?? null,
        channelName: e.reservation.reservationSource?.name ?? null,
      };
    } else if (e.type === "RETUR_SUPPLIER") {
      const claim = returnQueue[returnsSeen];
      returnsSeen += 1;
      if (claim) {
        refCode = claim.code;
        context = {
          kind: "SUPPLIER_RETURN",
          returnCode: claim.code,
          supplierName: claim.supplier.name,
        };
      }
    } else if (e.type === "DITERIMA" && e.purchaseOrder) {
      refCode = e.purchaseOrder.code;
      context = {
        kind: "ARRIVAL",
        purchaseOrderCode: e.purchaseOrder.code,
        supplierName: e.purchaseOrder.supplier.name,
      };
    } else if (e.type === "QC_SELESAI") {
      context = {
        kind: "SHELVED",
        locationName: e.toLocation?.name ?? unit.location.name,
      };
    }

    events.push({
      id: e.id,
      seq: e.seq,
      type: e.type,
      at: e.at,
      fromStatus: e.fromStatus as UnitStatus | null,
      toStatus: e.toStatus as UnitStatus,
      locationName: e.toLocation?.name ?? null,
      staffName: e.staff.name,
      // A transfer's own TX number, which is the only code an event carries.
      code: e.code,
      note: e.note,
      refCode: refCode ?? e.code,
      context,
    });
  }
  events.reverse();

  return {
    unit: {
      serial: unit.serial,
      status: unit.status as UnitStatus,
      locationName: unit.location.name,
      grade: unit.grade,
      buy: unit.buy,
      landed: unit.landed,
      intakeAt: unit.intakeAt,
      archivedAt: unit.archivedAt,
      skuId: unit.sku.id,
      skuCode: unit.sku.code,
      productName: unit.sku.name,
      variantLabel: unit.sku.variantLabel,
      price: unit.sku.price,
      modelName: unit.sku.model?.name ?? null,
      categoryName: unit.sku.model?.category?.name ?? null,
      purchaseOrderCode: unit.poItem?.po.code ?? null,
      description: null,
      rackName: null,
    },
    events,
  };
}

export interface UnitPickerRow {
  readonly serial: string;
  readonly productName: string;
  readonly variantLabel: string | null;
}

/**
 * Serials to offer in the tracker's picker.
 *
 * Capped and searchable rather than "every unit": the browser version built its
 * option list from the whole unit table, which is 5 000 rows in this shop and
 * one `db.skus.find` per option on top.
 */
export async function searchUnits(
  db: PrismaClient | Tx,
  query: { readonly q?: string; readonly limit?: number } = {},
): Promise<readonly UnitPickerRow[]> {
  const q = query.q?.trim();
  const rows = await db.unit.findMany({
    where: {
      archivedAt: null,
      ...(q
        ? {
            OR: [
              { serial: { contains: q, mode: "insensitive" as const } },
              { sku: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { serial: "asc" },
    take: Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50))),
    select: {
      serial: true,
      sku: { select: { name: true, variantLabel: true } },
    },
  });
  return rows.map((r) => ({
    serial: r.serial,
    productName: r.sku.name,
    variantLabel: r.sku.variantLabel,
  }));
}
