/**
 * Purchase orders — the invoice an intake happens against.
 *
 * Read side first, because that is what unblocks the migration: Inbound & QC
 * cannot post a unit to the API until the PRODUCT it names is one the database
 * knows. `apps/web`'s mock identifies a SKU as `${modelId}-v${i}` and the
 * database calls it `sku_0`, so a unit accepted from a mock invoice has no real
 * `skuId` to reference — which is why the pages had to move together rather
 * than one at a time.
 *
 * ## What is deliberately not here
 *
 * **The QC grid.** It is derived, not stored (`lib/inboundQc.ts`): a unit row
 * is a real machine and a *slot* is a machine the invoice says is here that
 * nobody has identified yet, and a slot lives in the page. So the detail below
 * returns the LINES and the units that exist against them, and the page counts
 * the difference. Materialising slots here would recreate the placeholder-unit
 * bug the grid was rebuilt to remove.
 *
 * **`Supplier.code`.** The two-letter origin code the store barcode is built
 * from is still a schema gap, so `originCode` comes back null and the label
 * dialog keeps its own fallback. Adding the column is an owner decision.
 */

import type { PrismaClient, Tx } from "./client.js";
import type { POStatus } from "../generated/client/index.js";

/** One row of `/inbound` — enough to list an invoice without opening it. */
export interface PurchaseOrderRow {
  readonly id: string;
  readonly code: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly invoice: string | null;
  readonly noInvoice: boolean;
  readonly status: POStatus;
  readonly orderedAt: Date;
  readonly receivedAt: Date | null;
  readonly closedAt: Date | null;
  readonly locationId: string;
  readonly total: bigint;
  /** What has been paid against it, all targets together. */
  readonly paid: bigint;
  /** Machines the invoice says are coming. */
  readonly qty: number;
  /** Machines that now exist as units — the grid's "identified" count. */
  readonly identified: number;
  /** Of those, the ones QC has passed. */
  readonly accepted: number;
}

const ROW_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  items: {
    select: {
      qty: true,
      units: { select: { status: true } },
    },
  },
  payments: { select: { amount: true, status: true } },
} as const;

/**
 * Paid means SETTLED, not merely recorded.
 *
 * `PayStatus` has TEMPO and BELUM as well as LUNAS — an invoice with a
 * fortnight's credit on it has a payment row and has been paid nothing, and
 * counting it would tell the shop an outstanding balance is clear.
 */
const settled = (
  payments: readonly { amount: bigint; status: string }[],
): bigint =>
  payments.reduce((n, p) => (p.status === "LUNAS" ? n + p.amount : n), 0n);

function toRow(po: {
  id: string;
  code: string;
  invoice: string | null;
  noInvoice: boolean;
  status: POStatus;
  orderedAt: Date;
  receivedAt: Date | null;
  closedAt: Date | null;
  locationId: string;
  total: bigint;
  supplier: { id: string; name: string };
  items: readonly { qty: number; units: readonly { status: string }[] }[];
  payments: readonly { amount: bigint; status: string }[];
}): PurchaseOrderRow {
  const units = po.items.flatMap((i) => i.units);
  return {
    id: po.id,
    code: po.code,
    supplierId: po.supplier.id,
    supplierName: po.supplier.name,
    invoice: po.invoice,
    noInvoice: po.noInvoice,
    status: po.status,
    orderedAt: po.orderedAt,
    receivedAt: po.receivedAt,
    closedAt: po.closedAt,
    locationId: po.locationId,
    total: po.total,
    paid: settled(po.payments),
    qty: po.items.reduce((n, i) => n + i.qty, 0),
    identified: units.length,
    // Anything past QC has been accepted — including a machine already sold,
    // which is why this is not `=== "TERSEDIA"`. An invoice does not become
    // un-accepted because its stock moved on.
    accepted: units.filter((u) => u.status !== "QC").length,
  };
}

export interface ListPurchaseOrdersQuery {
  readonly q?: string;
  readonly status?: readonly POStatus[];
  /** `true` for closed only, `false` for open only, undefined for both. */
  readonly closed?: boolean;
  readonly page?: number;
  readonly perPage?: number;
}

export const MAX_PO_PER_PAGE = 100;

export async function listPurchaseOrders(
  db: PrismaClient | Tx,
  query: ListPurchaseOrdersQuery = {},
): Promise<{ rows: readonly PurchaseOrderRow[]; total: number }> {
  const perPage = Math.min(query.perPage ?? 20, MAX_PO_PER_PAGE);
  const page = Math.max(query.page ?? 1, 1);
  const q = query.q?.trim();

  const where = {
    ...(q === undefined || q === ""
      ? {}
      : {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { invoice: { contains: q, mode: "insensitive" as const } },
            {
              supplier: {
                name: { contains: q, mode: "insensitive" as const },
              },
            },
          ],
        }),
    ...(query.status === undefined || query.status.length === 0
      ? {}
      : { status: { in: [...query.status] } }),
    ...(query.closed === undefined
      ? {}
      : query.closed
        ? { closedAt: { not: null } }
        : { closedAt: null }),
  };

  const [rows, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      include: ROW_INCLUDE,
      // Newest first: an intake screen opens on what arrived today.
      orderBy: [{ orderedAt: "desc" }, { code: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.purchaseOrder.count({ where }),
  ]);

  return { rows: rows.map(toRow), total };
}

/** A line of the invoice, and the machines identified against it. */
export interface PurchaseOrderLine {
  readonly id: string;
  readonly skuId: string | null;
  readonly skuCode: string | null;
  readonly skuName: string | null;
  readonly categoryId: string | null;
  /** What the invoice CALLED it — kept even when a SKU is linked. */
  readonly produk: string;
  readonly spec: string | null;
  readonly qty: number;
  readonly unitCost: bigint;
  readonly lineTotal: bigint;
  readonly allocatedFee: bigint;
  readonly units: readonly PurchaseOrderUnit[];
}

export interface PurchaseOrderUnit {
  readonly id: string;
  readonly serial: string;
  readonly status: string;
  readonly grade: string | null;
  readonly description: string | null;
  readonly buy: bigint;
  readonly landed: bigint;
  readonly locationId: string;
  readonly intakeAt: Date;
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  readonly supplierWa: string | null;
  /** ⚠️ Always null: `Supplier.code` is a schema gap. */
  readonly originCode: string | null;
  readonly note: string | null;
  readonly subtotal: bigint;
  readonly feesTaxPct: string;
  readonly feesTotal: bigint;
  readonly lines: readonly PurchaseOrderLine[];
  readonly fees: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: string;
    readonly amount: bigint;
  }[];
  readonly payments: readonly {
    readonly id: string;
    readonly methodId: string;
    readonly methodLabel: string;
    readonly amount: bigint;
    readonly appliedTo: string;
    readonly status: string;
    readonly paidAt: Date | null;
    readonly ref: string | null;
  }[];
}

export async function purchaseOrderDetail(
  db: PrismaClient | Tx,
  id: string,
): Promise<PurchaseOrderDetail | null> {
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, wa: true } },
      fees: { select: { id: true, label: true, kind: true, amount: true } },
      payments: {
        select: {
          id: true,
          methodId: true,
          amount: true,
          appliedTo: true,
          status: true,
          paidAt: true,
          ref: true,
          method: { select: { label: true } },
        },
        orderBy: { paidAt: "asc" },
      },
      items: {
        include: {
          sku: {
            select: {
              id: true,
              code: true,
              name: true,
              model: { select: { categoryId: true } },
            },
          },
          units: {
            select: {
              id: true,
              serial: true,
              status: true,
              grade: true,
              description: true,
              buy: true,
              landed: true,
              locationId: true,
              intakeAt: true,
            },
            orderBy: { intakeAt: "asc" },
          },
        },
      },
    },
  });
  if (po === null) return null;

  const row = toRow({
    ...po,
    items: po.items.map((i) => ({ qty: i.qty, units: i.units })),
  });

  return {
    ...row,
    supplierWa: po.supplier.wa,
    // The schema gap, said out loud rather than guessed at from the name.
    originCode: null,
    note: po.note,
    subtotal: po.subtotal,
    // Decimal does not survive JSON as a number without losing precision, and
    // this one is a percentage with two places that ends up in an arithmetic
    // CHECK. A string is what the money rule already says (01 §4).
    feesTaxPct: po.feesTaxPct.toFixed(2),
    feesTotal: po.feesTotal,
    fees: po.fees,
    payments: po.payments.map((p) => ({
      id: p.id,
      methodId: p.methodId,
      methodLabel: p.method.label,
      amount: p.amount,
      appliedTo: p.appliedTo,
      status: p.status,
      paidAt: p.paidAt,
      ref: p.ref,
    })),
    lines: po.items.map((i) => ({
      id: i.id,
      skuId: i.skuId,
      skuCode: i.sku?.code ?? null,
      skuName: i.sku?.name ?? null,
      categoryId: i.sku?.model.categoryId ?? null,
      produk: i.produk,
      spec: i.spec,
      qty: i.qty,
      unitCost: i.unitCost,
      lineTotal: i.lineTotal,
      allocatedFee: i.allocatedFee,
      units: i.units,
    })),
  };
}

/**
 * Close an invoice, or reopen it.
 *
 * A filing decision, not a state change: `status` is about the GOODS, and an
 * order can be fully received and still open because the ongkir has not been
 * settled. Reversible on purpose — the one thing an intake screen must never do
 * is make a mistake permanent.
 *
 * It warns about an outstanding balance or an ungraded machine and never
 * refuses; that judgement is the operator's, so it belongs to the page, and
 * nothing here checks it.
 */
export async function setPurchaseOrderClosed(
  tx: Tx,
  input: { readonly id: string; readonly closed: boolean; readonly at?: Date },
): Promise<{ closedAt: Date | null }> {
  const po = await tx.purchaseOrder.update({
    where: { id: input.id },
    data: { closedAt: input.closed ? (input.at ?? new Date()) : null },
    select: { closedAt: true },
  });
  return po;
}
