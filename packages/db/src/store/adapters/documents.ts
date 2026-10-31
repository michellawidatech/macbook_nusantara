/**
 * The documents: purchase invoices, supplier deposits, holds, sales, returns,
 * stock takes, service visits, marketplace settlements, and the two edit logs.
 *
 * Each maps one browser record onto a header and its child rows. Child lists
 * are synced by key — updated where the row exists, created where it does
 * not, and marked removed (`removedAt`, `voidedAt`) where the browser dropped
 * it — so nothing a document ever held is deleted.
 *
 * Money the browser computed is re-derived here where the schema holds a total
 * (an invoice's subtotal, a sale's bill) and REFUSED where it disagrees: a
 * sale whose total does not equal its lines, discount, fees and trade-ins is
 * not written (`Order_total_arithmetic_check` holds the figure before the
 * trade-in; the browser's `total` is after it).
 */
import { byFeeOrder, deepEqual } from "@nusantara/store";
import type { PayStatus, ScanResult } from "../../../generated/client/index.js";
import { StoreValidationError } from "../errors.js";
import {
  type Adapter,
  type RowOf,
  type WriteContext,
  FEE_KIND_FROM,
  FEE_KIND_OF,
  OPNAME_STATUS_FROM,
  PAY_STATUS_OF_STATE,
  PAY_TARGET_FROM,
  PAY_TARGET_OF,
  PLATFORM_OF_SOURCE,
  PO_STATUS_FROM,
  PO_STATUS_OF,
  RESERVATION_STATUS_FROM,
  RESERVATION_STATUS_OF,
  SOURCE_OF_PLATFORM,
  STATE_OF_PAY_STATUS,
  blankToNull,
  booksClosedUntil,
  dateOfDay,
  dayOf,
  instantOf,
  isoOf,
  lockRows,
  noRowLock,
  optionalIso,
  refuseEdit,
  refuseRemoval,
} from "../context.js";
import { releaseReconciliationRefs } from "./reconciliation.js";

const byId = (keys?: readonly string[]) =>
  keys === undefined ? {} : { id: { in: [...keys] } };

const sum = (values: readonly bigint[]): bigint =>
  values.reduce((t, v) => t + v, 0n);

async function defaultLocationId(ctx: WriteContext): Promise<string> {
  const cached = ctx.memo.get("defaultLocation") as string | undefined;
  if (cached !== undefined) return cached;
  const staff = await ctx.tx.staff.findUnique({
    where: { id: ctx.staffId },
    select: { defaultLocationId: true },
  });
  const id =
    staff?.defaultLocationId ??
    (
      await ctx.tx.location.findFirst({
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      })
    )?.id;
  if (id === undefined) {
    throw new StoreValidationError(
      "Belum ada gudang — tambahkan satu di Pengaturan.",
    );
  }
  ctx.memo.set("defaultLocation", id);
  return id;
}

// ---------------------------------------------------------------------------
// Purchase invoices
// ---------------------------------------------------------------------------

type Po = RowOf<"pos">;

async function syncPoItems(ctx: WriteContext, po: Po): Promise<void> {
  const { tx } = ctx;
  const skus = await tx.sku.findMany({
    where: {
      id: { in: po.items.map((i) => i.skuId).filter((s) => s !== "") },
    },
    select: { id: true, name: true, variantLabel: true },
  });
  const skuOf = new Map(skus.map((s) => [s.id, s]));
  const existing = await tx.purchaseOrderItem.findMany({
    where: { poId: po.id },
    include: { serials: { orderBy: { id: "asc" } } },
  });
  const left = new Map(existing.map((i) => [i.id, i]));
  for (const [sortOrder, item] of po.items.entries()) {
    // A line nobody has picked the product for yet is a draft, not an error —
    // see `po.items` in @nusantara/store. It is stored with no SKU.
    const blank = item.skuId === "";
    const sku = blank ? undefined : skuOf.get(item.skuId);
    if (!blank && sku === undefined) {
      throw new StoreValidationError(
        `Varian ${item.skuId} tidak ditemukan.`,
        "pos",
        po.id,
      );
    }
    if (item.qty <= 0) {
      throw new StoreValidationError(
        "Jumlah barang harus lebih dari nol.",
        "pos",
        po.id,
      );
    }
    const data = {
      skuId: blank ? null : item.skuId,
      produk: sku?.name ?? "",
      spec: sku?.variantLabel ?? null,
      qty: item.qty,
      unitCost: item.unitCost,
      discount: item.discount ?? 0n,
      // Net of the line's own discount: `lineTotal` is what is owed for the
      // line, and the CHECK keeps the discount inside it.
      lineTotal: BigInt(item.qty) * item.unitCost - (item.discount ?? 0n),
      notReceived: item.notReceived ?? false,
      outsideInvoice: item.outsideInvoice ?? false,
      sortOrder,
      removedAt: null,
    };
    const had = left.get(item.id);
    if (had === undefined) {
      await tx.purchaseOrderItem.create({
        data: { id: item.id, poId: po.id, allocatedFee: 0n, ...data },
      });
    } else {
      left.delete(item.id);
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data });
    }
    const current = had?.serials[0];
    if (item.serial !== null && item.serial !== "") {
      if (current === undefined) {
        await tx.purchaseOrderItemSerial.create({
          data: { itemId: item.id, serial: item.serial },
        });
      } else if (current.serial !== item.serial) {
        await tx.purchaseOrderItemSerial.update({
          where: { id: current.id },
          data: { serial: item.serial },
        });
      }
    }
  }
  for (const item of left.values()) {
    if (item.removedAt === null) {
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { removedAt: ctx.now },
      });
    }
  }
}

/**
 * The invoice's expenses, one `PurchaseOrderFee` row each (owner ask
 * 2026-09-18). Synced by key like the lines: updated where the row exists,
 * created where it does not, and marked removed — never deleted — where the
 * browser dropped it, because a payment may still name it.
 */
async function syncPoFees(ctx: WriteContext, po: Po): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.purchaseOrderFee.findMany({
    where: { poId: po.id },
  });
  const left = new Map(existing.map((f) => [f.id, f]));
  for (const fee of po.fees) {
    if (fee.amount < 0n) {
      throw new StoreValidationError(
        "Biaya tidak boleh negatif.",
        "pos",
        po.id,
      );
    }
    const data = {
      label: fee.label,
      kind: FEE_KIND_OF[fee.kind],
      amount: fee.amount,
      inCogs: fee.inCogs,
      removedAt: null,
    };
    if (left.has(fee.id)) {
      left.delete(fee.id);
      await tx.purchaseOrderFee.update({ where: { id: fee.id }, data });
    } else {
      await tx.purchaseOrderFee.create({
        data: { id: fee.id, poId: po.id, ...data },
      });
    }
  }
  for (const fee of left.values()) {
    if (fee.removedAt === null) {
      await tx.purchaseOrderFee.update({
        where: { id: fee.id },
        data: { removedAt: ctx.now },
      });
    }
  }
}

/**
 * A supplier-return credit (method RETUR_SUPPLIER, owner 2026-10-26) names
 * its return — `Payment.unitReturnId`. Written after every adapter has run,
 * because the return may be in the same changeset and is written later. A
 * return that never turns up, or one from a customer, is refused in words.
 */
function linkReturnLater(
  ctx: WriteContext,
  collection: "pos",
  key: string,
  paymentId: string,
  returnId: string,
): void {
  ctx.later.push(async () => {
    const ret = await ctx.tx.unitReturn.findUnique({
      where: { id: returnId },
      select: { kind: true },
    });
    if (ret === null || ret.kind !== "SUPPLIER") {
      throw new StoreValidationError(
        "Pembayaran menunjuk retur ke supplier yang tidak ada.",
        collection,
        key,
      );
    }
    await ctx.tx.payment.update({
      where: { id: paymentId },
      data: { unitReturnId: returnId },
    });
  });
}

async function syncPoPayments(ctx: WriteContext, po: Po): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.payment.findMany({ where: { poId: po.id } });
  const left = new Map(existing.map((p) => [p.id, p]));
  const feeIds = new Set(po.fees.map((f) => f.id));
  for (const [sortOrder, p] of po.payments.entries()) {
    if (p.amount <= 0n) {
      throw new StoreValidationError(
        "Pembayaran harus lebih dari nol.",
        "pos",
        po.id,
      );
    }
    // An expense of THIS invoice, still on it. The foreign key alone would
    // take another invoice's expense, or one taken off this one.
    if (p.feeId !== undefined && !feeIds.has(p.feeId)) {
      throw new StoreValidationError(
        "Pembayaran menunjuk biaya yang tidak ada di faktur ini.",
        "pos",
        po.id,
      );
    }
    const at = instantOf(p.at);
    // `returns` is written AFTER `pos` (collections.ts), so a supplier return
    // and the credit naming it arrive in one changeset with the return not
    // yet in the table: the link is written once every adapter has run.
    if (p.returnId !== undefined)
      linkReturnLater(ctx, "pos", po.id, p.id, p.returnId);
    const data = {
      methodId: await ctx.paymentMethodId(p.method),
      amount: p.amount,
      appliedTo: PAY_TARGET_OF[p.appliedTo ?? "ORDER"],
      status: "LUNAS" as const,
      paidAt: at,
      recordedAt: at,
      fromDepositId: p.fromDepositId ?? null,
      poFeeId: p.feeId ?? null,
      // Set by `linkReturnLater` when the payment names a return.
      ...(p.returnId === undefined ? { unitReturnId: null } : {}),
      // Absent means it went through the shop, as every payment did before
      // the switch (owner answer 2026-09-22).
      inBalance: p.inBalance ?? true,
      sortOrder,
      voidedAt: null,
    };
    if (left.has(p.id)) {
      left.delete(p.id);
      await tx.payment.update({ where: { id: p.id }, data });
    } else {
      await tx.payment.create({
        data: {
          id: p.id,
          poId: po.id,
          direction: "KELUAR",
          staffId: ctx.staffId,
          ...data,
        },
      });
    }
  }
  for (const p of left.values()) {
    if (p.voidedAt === null) {
      await tx.payment.update({
        where: { id: p.id },
        data: { voidedAt: ctx.now },
      });
    }
  }
}

/**
 * An invoice deleted from the Inbound list (owner ask 2026-09-15: *"Make the
 * inbound deletable, with right click"*).
 *
 * Nothing is hard-deleted, so deleting is cancelling: the header goes to
 * `BATAL` — which projection leaves out — its lines are marked removed, its
 * payments voided, and any deposit money allocated to it goes back to being
 * unallocated on the supplier's account.
 *
 * Its machines are not this adapter's to decide about. The browser removes the
 * ones still in QC in the same commit, and the units adapter archives them;
 * one that has left QC — accepted, sold, on the bench — is a machine the shop
 * really bought on this invoice, so an invoice still carrying one after every
 * write in the commit is refused.
 */
async function cancelPo(ctx: WriteContext, id: string): Promise<void> {
  const { tx } = ctx;
  const po = await tx.purchaseOrder.findUnique({
    where: { id },
    select: { status: true },
  });
  if (po === null || po.status === "BATAL") return;
  await tx.purchaseOrder.update({ where: { id }, data: { status: "BATAL" } });
  await tx.purchaseOrderItem.updateMany({
    where: { poId: id, removedAt: null },
    data: { removedAt: ctx.now },
  });
  await tx.payment.updateMany({
    where: { poId: id, voidedAt: null },
    data: { voidedAt: ctx.now },
  });
  const allocations = await tx.depositAllocation.findMany({
    where: { purchaseOrderId: id, removedAt: null },
    select: { id: true, depositId: true },
  });
  if (allocations.length > 0) {
    await tx.depositAllocation.updateMany({
      where: { id: { in: allocations.map((a) => a.id) } },
      data: { removedAt: ctx.now },
    });
    for (const depositId of new Set(allocations.map((a) => a.depositId))) {
      ctx.touch("deposits", depositId);
    }
  }
  ctx.later.push(async () => {
    const left = await tx.unit.findMany({
      where: {
        archivedAt: null,
        OR: [{ purchaseOrderId: id }, { poItem: { poId: id } }],
      },
      select: { serial: true },
      take: 4,
    });
    if (left.length > 0) {
      throw new StoreValidationError(
        `Faktur ini masih punya unit (${left
          .slice(0, 3)
          .map((u) => u.serial)
          .join(
            ", ",
          )}${left.length > 3 ? ", …" : ""}) — unit yang sudah keluar dari QC tidak ikut terhapus.`,
        "pos",
        id,
      );
    }
  });
  ctx.touch("pos", id);
}

export const pos: Adapter<"pos"> = {
  collection: "pos",
  async project(tx, _ctx, keys) {
    const rows = await tx.purchaseOrder.findMany({
      // A cancelled invoice is a deleted one, as far as any screen knows.
      where: { ...byId(keys), status: { not: "BATAL" } },
      orderBy: [{ orderedAt: "desc" }, { code: "desc" }],
      include: {
        items: {
          // Lines with no product yet included: they are drafts the page shows.
          where: { removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            serials: {
              select: { serial: true },
              orderBy: { id: "asc" },
              take: 1,
            },
          },
        },
        fees: { where: { removedAt: null } },
        payments: {
          where: { voidedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { method: { select: { code: true } } },
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      code: p.code,
      supplierId: p.supplierId,
      invoice: p.invoice ?? "",
      noInvoice: p.noInvoice ? true : undefined,
      date: dayOf(p.orderedAt),
      locationId: p.locationId,
      items: p.items.map((i) => ({
        id: i.id,
        skuId: i.skuId ?? "",
        serial: i.serials[0]?.serial ?? null,
        qty: i.qty,
        unitCost: i.unitCost,
        discount: i.discount === 0n ? undefined : i.discount,
        notReceived: i.notReceived ? true : undefined,
        outsideInvoice: i.outsideInvoice ? true : undefined,
      })),
      payments: p.payments.map((pay) => ({
        id: pay.id,
        method: pay.method.code,
        amount: pay.amount,
        at: isoOf(pay.recordedAt ?? pay.paidAt ?? p.orderedAt),
        appliedTo: PAY_TARGET_FROM[pay.appliedTo],
        fromDepositId: pay.fromDepositId ?? undefined,
        feeId: pay.poFeeId ?? undefined,
        // Only a `false` is said; true is the absent key the browser wrote.
        inBalance: pay.inBalance ? undefined : false,
        returnId: pay.unitReturnId ?? undefined,
      })),
      // In one order on every till, whatever order the rows were written in:
      // the ids are random tokens, and a list that reshuffles on each poll is
      // a list nobody can find their place in. `byFeeOrder` is the browser's.
      fees: p.fees
        .map((f) => ({
          id: f.id,
          kind: FEE_KIND_FROM[f.kind],
          label: f.label,
          amount: f.amount,
          inCogs: f.inCogs,
        }))
        .sort(byFeeOrder),
      discount: p.discount,
      status: PO_STATUS_FROM[p.status],
      closedAt: optionalIso(p.closedAt),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "PurchaseOrder", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await cancelPo(ctx, r.key);
        continue;
      }
      const subtotal = sum(
        n.items.map((i) => BigInt(i.qty) * i.unitCost - (i.discount ?? 0n)),
      );
      const feesTotal = sum(n.fees.map((f) => f.amount));
      const gross = subtotal + feesTotal - n.discount;
      const orderedAt = dateOfDay(n.date);
      const existing =
        r.base === undefined
          ? null
          : await tx.purchaseOrder.findUnique({
              where: { id: n.id },
              select: { receivedAt: true },
            });
      const data = {
        code: n.code,
        supplierId: n.supplierId,
        invoice: blankToNull(n.invoice),
        noInvoice: n.noInvoice ?? false,
        status: PO_STATUS_OF[n.status],
        orderedAt,
        receivedAt:
          n.status === "RECEIVED"
            ? (existing?.receivedAt ??
              (ctx.mode === "import" ? orderedAt : ctx.now))
            : null,
        closedAt: n.closedAt === undefined ? null : instantOf(n.closedAt),
        subtotal,
        feesTaxPct: 0,
        feesTotal,
        total: gross < 0n ? 0n : gross,
        discount: n.discount,
        locationId: n.locationId,
      };
      if (r.base === undefined) {
        await tx.purchaseOrder.create({
          data: {
            id: n.id,
            ...data,
            staffId: ctx.staffId,
            createdAt: ctx.mode === "import" ? orderedAt : ctx.now,
          },
        });
      } else {
        await tx.purchaseOrder.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.items, n.items))
        await syncPoItems(ctx, n);
      // Before the payments: a payment names its expense by foreign key.
      if (r.base === undefined || !deepEqual(r.base.fees, n.fees)) {
        await syncPoFees(ctx, n);
      }
      if (r.base === undefined || !deepEqual(r.base.payments, n.payments)) {
        await syncPoPayments(ctx, n);
      }
      ctx.touch("pos", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Supplier deposits
// ---------------------------------------------------------------------------

export const deposits: Adapter<"deposits"> = {
  collection: "deposits",
  async project(tx, _ctx, keys) {
    const rows = await tx.supplierDeposit.findMany({
      where: byId(keys),
      orderBy: [{ at: "desc" }, { id: "asc" }],
      include: {
        method: { select: { code: true } },
        staff: { select: { name: true } },
        allocations: {
          where: { removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { staff: { select: { name: true } } },
        },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      supplierId: d.supplierId,
      amount: d.amount,
      method: d.method.code,
      at: isoOf(d.at),
      note: d.note ?? undefined,
      inBalance: d.inBalance ? undefined : false,
      staff: d.staff.name,
      allocations: d.allocations.map((a) => ({
        id: a.id,
        poId: a.purchaseOrderId,
        amount: a.amount,
        at: isoOf(a.at),
        staff: a.staff.name,
        note: a.note ?? undefined,
      })),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "SupplierDeposit", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("deposits", r.key);
      const data = {
        supplierId: n.supplierId,
        amount: n.amount,
        methodId: await ctx.paymentMethodId(n.method),
        at: instantOf(n.at),
        note: blankToNull(n.note),
        inBalance: n.inBalance ?? true,
      };
      if (r.base === undefined) {
        await tx.supplierDeposit.create({
          data: { id: n.id, ...data, staffId: await ctx.staffFor(n.staff) },
        });
      } else {
        await tx.supplierDeposit.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.allocations, n.allocations))
        ctx.later.push(async () => {
          const existing = await tx.depositAllocation.findMany({
            where: { depositId: n.id },
          });
          const left = new Map(existing.map((a) => [a.id, a]));
          for (const [sortOrder, a] of n.allocations.entries()) {
            const allocation = {
              purchaseOrderId: a.poId,
              amount: a.amount,
              at: instantOf(a.at),
              note: blankToNull(a.note),
              sortOrder,
              removedAt: null,
            };
            if (left.has(a.id)) {
              left.delete(a.id);
              await tx.depositAllocation.update({
                where: { id: a.id },
                data: allocation,
              });
            } else {
              await tx.depositAllocation.create({
                data: {
                  id: a.id,
                  depositId: n.id,
                  staffId: await ctx.staffFor(a.staff),
                  ...allocation,
                },
              });
            }
          }
          for (const a of left.values()) {
            if (a.removedAt === null) {
              await tx.depositAllocation.update({
                where: { id: a.id },
                data: { removedAt: ctx.now },
              });
            }
          }
        });
      ctx.touch("deposits", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------

type Hold = RowOf<"reservations">;

/**
 * The DP on a hold and its refund (2026-10-27) — `Payment` rows naming the
 * reservation. Inserted here; the sale that takes the DP is the orders
 * adapter's (`orderId` on the same row), so `dp.orderId` is read, never
 * written, by this one.
 */
async function syncHoldMoney(
  ctx: WriteContext,
  base: Hold | undefined,
  n: Hold,
): Promise<void> {
  const { tx } = ctx;
  const write = async (
    row: {
      id: string;
      method: string;
      amount: bigint;
      at: string;
      note?: string;
    },
    direction: "MASUK" | "KELUAR",
    sortOrder: number,
  ) => {
    const at = instantOf(row.at);
    const data = {
      methodId: await ctx.paymentMethodId(row.method),
      amount: row.amount,
      status: PAY_STATUS_OF_STATE.SETTLED,
      paidAt: at,
      recordedAt: at,
      note: blankToNull(row.note),
      voidedAt: null,
    };
    const had = await tx.payment.findUnique({
      where: { id: row.id },
      select: { reservationId: true, orderId: true },
    });
    if (had !== null) {
      if (had.reservationId !== n.id) {
        throw new StoreValidationError(
          "Pembayaran ini bukan DP reservasi ini.",
          "reservations",
          n.id,
        );
      }
      // Once a sale took it, the sale owns its amount: a correction there is
      // Transaction History's, and two writers of one row disagree.
      if (had.orderId === null)
        await tx.payment.update({ where: { id: row.id }, data });
      return;
    }
    await tx.payment.create({
      data: {
        id: row.id,
        reservationId: n.id,
        direction,
        appliedTo: "BARANG",
        staffId: ctx.staffId,
        sortOrder,
        ...data,
      },
    });
  };
  const voidRow = async (id: string) => {
    const had = await tx.payment.findUnique({
      where: { id },
      select: { reservationId: true, orderId: true, voidedAt: true },
    });
    if (had === null || had.reservationId !== n.id || had.voidedAt !== null)
      return;
    if (had.orderId !== null) {
      throw new StoreValidationError(
        "DP ini sudah dipakai di penjualan — hapus dari transaksinya dulu.",
        "reservations",
        n.id,
      );
    }
    await tx.payment.update({ where: { id }, data: { voidedAt: ctx.now } });
  };

  if (n.dp !== undefined) {
    if (
      base?.dp === undefined ||
      !deepEqual(
        { ...base.dp, orderId: undefined, refund: undefined },
        { ...n.dp, orderId: undefined, refund: undefined },
      )
    )
      await write(n.dp, "MASUK", 0);
    if (base?.dp?.id !== undefined && base.dp.id !== n.dp.id)
      await voidRow(base.dp.id);
    const refund = n.dp.refund;
    if (refund !== undefined && !deepEqual(base?.dp?.refund, refund))
      await write(refund, "KELUAR", 1);
    const hadRefund = base?.dp?.refund;
    if (hadRefund !== undefined && hadRefund.id !== refund?.id)
      await voidRow(hadRefund.id);
  } else if (base?.dp !== undefined) {
    if (base.dp.refund !== undefined) await voidRow(base.dp.refund.id);
    await voidRow(base.dp.id);
  }
}

/**
 * A unit on a hold nobody paid a DP for, sold to somebody else at the till
 * (2026-10-27): the till takes the item off the hold, and the customer it was
 * reserved for has to be told. When they have a chat thread, a colleague gets
 * the task — `Perlu kabari — {unit} sudah terjual ke pembeli lain` — in the
 * same transaction as the sale. Run from `ctx.later`, after the order and the
 * ledger rows this commit carries are written.
 */
async function tellSoldOver(
  ctx: WriteContext,
  hold: { id: string; phone: string | null; custName: string | null },
  unitIds: readonly string[],
): Promise<void> {
  const { tx } = ctx;
  if (hold.phone === null || hold.phone.trim() === "" || unitIds.length === 0)
    return;
  const from = hold.phone.trim().replace(/^\+/, "");
  const thread = await tx.waMessage.findFirst({
    where: { from },
    select: { id: true },
  });
  if (thread === null) return;
  const sold = await tx.unit.findMany({
    where: {
      id: { in: [...unitIds] },
      status: "TERJUAL",
      soldOrderItem: {
        order: {
          OR: [{ reservationId: null }, { reservationId: { not: hold.id } }],
        },
      },
    },
    select: {
      id: true,
      skuId: true,
      sku: { select: { name: true, variantLabel: true } },
    },
  });
  for (const u of sold) {
    const unit = [u.sku.name, u.sku.variantLabel].filter(Boolean).join(" ");
    const summary = `Perlu kabari — ${unit} sudah terjual ke pembeli lain`;
    const customer = await tx.customer.findFirst({
      where: { phone: { in: [from, `+${from}`] } },
      select: { id: true },
    });
    const common = {
      // Not a hand-over topic: the customer asked nothing, so the bot is not
      // told to wait on a colleague (`waitingTasks`).
      topic: "hold",
      summary,
      customerText: hold.custName
        ? `Reservasi ${hold.custName} belum DP`
        : "Reservasi belum DP",
      unitId: u.id,
      skuId: u.skuId,
      updatedAt: ctx.now,
      ...(customer ? { customerId: customer.id } : {}),
    };
    // One OPEN task per (thread, kind) — the partial unique index.
    const open = await tx.chatAction.findFirst({
      where: { from, kind: "RESERVATION", status: "OPEN" },
      select: { id: true },
    });
    if (open)
      await tx.chatAction.update({ where: { id: open.id }, data: common });
    else
      await tx.chatAction.create({
        data: { from, kind: "RESERVATION", createdAt: ctx.now, ...common },
      });
  }
}

export const reservations: Adapter<"reservations"> = {
  collection: "reservations",
  async project(tx, _ctx, keys) {
    const rows = await tx.reservation.findMany({
      where: byId(keys),
      orderBy: [{ createdAt: "desc" }, { code: "desc" }],
      include: {
        items: {
          where: { removedAt: null, unit: { archivedAt: null } },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { unit: { select: { serial: true } } },
        },
        payments: {
          where: { voidedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { method: { select: { code: true } } },
        },
      },
    });
    return rows.map((h) => {
      const paid = h.payments.find((p) => p.direction === "MASUK");
      const refund = h.payments.find((p) => p.direction === "KELUAR");
      const at = (p: { paidAt: Date | null; recordedAt: Date | null }) =>
        isoOf(p.paidAt ?? p.recordedAt ?? h.createdAt);
      return {
        id: h.id,
        code: h.code,
        customerId: h.customerId ?? "",
        when: isoOf(h.scheduledFor ?? h.createdAt),
        note: h.note ?? "",
        sourceId: h.reservationSourceId ?? undefined,
        items: h.items.flatMap((i) =>
          i.unit === null ? [] : [{ id: i.id, serial: i.unit.serial }],
        ),
        status: RESERVATION_STATUS_FROM[h.status],
        heldUntil: optionalIso(h.heldUntil),
        dp:
          paid === undefined
            ? undefined
            : {
                id: paid.id,
                method: paid.method.code,
                amount: paid.amount,
                at: at(paid),
                note: paid.note ?? undefined,
                orderId: paid.orderId ?? undefined,
                refund:
                  refund === undefined
                    ? undefined
                    : {
                        id: refund.id,
                        method: refund.method.code,
                        amount: refund.amount,
                        at: at(refund),
                      },
              },
      };
    });
  },
  lock: (tx, keys) => lockRows(tx, "Reservation", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("reservations", r.key);
      const customer =
        n.customerId === ""
          ? null
          : await tx.customer.findUnique({
              where: { id: n.customerId },
              select: { name: true, phone: true },
            });
      const data = {
        code: n.code,
        customerId: n.customerId === "" ? null : n.customerId,
        custName: customer?.name ?? null,
        phone: customer?.phone ?? null,
        scheduledFor: instantOf(n.when),
        status: RESERVATION_STATUS_OF[n.status],
        reservationSourceId: n.sourceId ?? null,
        note: blankToNull(n.note),
        heldUntil: n.heldUntil === undefined ? null : instantOf(n.heldUntil),
      };
      if (r.base === undefined) {
        await tx.reservation.create({
          data: {
            id: n.id,
            ...data,
            source: "STAF",
            createdAt: ctx.mode === "import" ? instantOf(n.when) : ctx.now,
          },
        });
      } else {
        await tx.reservation.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.items, n.items)) {
        const existing = await tx.reservationItem.findMany({
          where: { reservationId: n.id },
        });
        const left = new Map(existing.map((i) => [i.id, i]));
        for (const [sortOrder, item] of n.items.entries()) {
          const unit = await tx.unit.findFirst({
            where: { serial: item.serial, archivedAt: null },
            select: { id: true, skuId: true },
          });
          if (unit === null) {
            throw new StoreValidationError(
              `Unit ${item.serial} tidak ditemukan.`,
              "reservations",
              n.id,
            );
          }
          const line = {
            unitId: unit.id,
            skuId: unit.skuId,
            qty: 1,
            sortOrder,
            removedAt: null,
          };
          if (left.has(item.id)) {
            left.delete(item.id);
            await tx.reservationItem.update({
              where: { id: item.id },
              data: line,
            });
          } else {
            await tx.reservationItem.create({
              data: { id: item.id, reservationId: n.id, ...line },
            });
          }
        }
        const dropped: string[] = [];
        for (const item of left.values()) {
          if (item.removedAt === null) {
            await tx.reservationItem.update({
              where: { id: item.id },
              data: { removedAt: ctx.now },
            });
            if (item.unitId !== null) dropped.push(item.unitId);
          }
        }
        // Taken off a hold nobody paid for: if another sale took it, the
        // customer it was reserved for is owed a message.
        if (
          dropped.length > 0 &&
          n.dp === undefined &&
          n.heldUntil === undefined
        ) {
          const hold = {
            id: n.id,
            phone: data.phone,
            custName: data.custName,
          };
          ctx.later.push(() => tellSoldOver(ctx, hold, dropped));
        }
      }
      if (r.base === undefined || !deepEqual(r.base.dp, n.dp))
        await syncHoldMoney(ctx, r.base, n);
      ctx.touch("reservations", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

type Sale = RowOf<"orders">;

/**
 * The `returnReason` of a line taken off a sale by Edit transaction (owner,
 * 2026-10-22: *"the transaction history should be editable … do not implement
 * append only"*). The line is CLOSED, not deleted — its `TERJUAL` stock moves
 * and the unit's history name it, and every one of those FKs is RESTRICT —
 * and a closed-by-correction line is projected nowhere, so on every screen the
 * sale reads as though it never carried it. A line a customer RETURNED is
 * closed with another reason and is still shown, marked Returned.
 */
const CORRECTED = "Dikoreksi";

/**
 * A RETUR adjustment whose return was taken back (2026-10-23). Kept, at zero,
 * because the app cannot delete it; filtered out of every reading.
 */
const WITHDRAWN = "Retur dibatalkan";
const NOT_WITHDRAWN = { NOT: { reason: { startsWith: WITHDRAWN } } };

/**
 * "Not closed by a correction" as a Prisma filter. ⚠️ Not `NOT: { returnReason:
 * CORRECTED }`: SQL's `NOT (x = 'y')` is NULL when x is NULL, so that drops
 * every ordinary line — whose reason is null — along with the corrected ones.
 */
const NOT_CORRECTED = {
  OR: [{ returnReason: null }, { returnReason: { not: CORRECTED } }],
};

async function syncSaleLines(
  ctx: WriteContext,
  sale: Sale,
  units: ReadonlyMap<
    string,
    {
      id: string;
      skuId: string;
      buy: bigint;
      sku: { name: string; variantLabel: string | null };
    }
  >,
  /**
   * The sale was already in the database before this commit. A unit that
   * joins it then — the replacement an exchange hands over (2026-09-21) —
   * adds what it cost to `Order.cogs`, which a NEW sale is given whole when
   * its row is created. The counted half does the same from its `TERJUAL`
   * moves (`adapters/stock.ts`).
   */
  alreadyWritten: boolean,
): Promise<void> {
  const { tx } = ctx;
  // Unit lines only: a counted product's line has no unit and is kept by
  // `syncCountedLines`.
  const existing = await tx.orderItem.findMany({
    where: {
      orderId: sale.id,
      unitId: { not: null },
      ...NOT_CORRECTED,
    },
    select: {
      id: true,
      unitId: true,
      price: true,
      listPrice: true,
      sortOrder: true,
      cogs: true,
    },
  });
  const left = new Map(existing.map((i) => [i.unitId, i]));
  for (const [sortOrder, serial] of sale.serials.entries()) {
    const unit = units.get(serial)!;
    const price = sale.prices[serial]!;
    const listPrice = sale.listPrices?.[serial] ?? null;
    const had = left.get(unit.id);
    if (had !== undefined) {
      left.delete(unit.id);
      if (
        had.price !== price ||
        had.listPrice !== listPrice ||
        had.sortOrder !== sortOrder
      ) {
        await tx.orderItem.update({
          where: { id: had.id },
          data: { price, sub: price, listPrice, sortOrder },
        });
      }
      continue;
    }
    // Only a unit on the shelf (or held for this customer) can go on a sale
    // (audit 2026-10-23: Edit transaction took a unit still in QC, in
    // service or gone back to its supplier). Judged by its newest ledger row
    // BEFORE this commit — events are written after orders, and the unit's
    // own column may already carry the browser's TERJUAL.
    if (ctx.mode !== "import") {
      const last = await tx.unitEvent.findFirst({
        where: { unitId: unit.id },
        orderBy: { seq: "desc" },
        select: { toStatus: true },
      });
      if (
        last !== null &&
        last.toStatus !== "TERSEDIA" &&
        last.toStatus !== "DIRESERVASI"
      ) {
        throw new StoreValidationError(
          `Unit ${serial} tidak tersedia untuk dijual (${last.toStatus}).`,
          "orders",
          sale.id,
        );
      }
    }
    // A machine can be on one open receipt at a time. Its earlier line is
    // closed: the machine came back and is being sold again.
    await tx.orderItem.updateMany({
      where: { unitId: unit.id, returnedAt: null, NOT: { orderId: sale.id } },
      data: {
        returnedAt: instantOf(sale.ts),
        returnedQty: 1,
        returnReason: "Terjual ulang",
      },
    });
    const item = await tx.orderItem.create({
      data: {
        orderId: sale.id,
        unitId: unit.id,
        skuId: unit.skuId,
        name: unit.sku.name,
        variant: unit.sku.variantLabel,
        qty: 1,
        price,
        sub: price,
        cogs: unit.buy,
        listPrice,
        returnedQty: 0,
        sortOrder,
      },
      select: { id: true },
    });
    await tx.unit.update({
      where: { id: unit.id },
      data: { soldOrderItemId: item.id },
    });
    if (alreadyWritten) {
      await tx.order.update({
        where: { id: sale.id },
        data: { cogs: { increment: unit.buy } },
      });
    }
  }
  // Units taken off the sale by a correction: the line closes, the unit is
  // no longer this sale's, and what it cost leaves the sale's cost. Its sold
  // row comes off its history in the same commit (`removeEvents`).
  for (const item of left.values()) {
    await tx.orderItem.update({
      where: { id: item.id },
      data: { returnedAt: ctx.now, returnedQty: 1, returnReason: CORRECTED },
    });
    await tx.unit.updateMany({
      where: { soldOrderItemId: item.id },
      data: { soldOrderItemId: null },
    });
    await tx.order.update({
      where: { id: sale.id },
      data: { cogs: { decrement: item.cogs } },
    });
    if (item.unitId) await restoreUnitOffSale(ctx, item.unitId, sale.id);
  }
}

/**
 * A sale's counted lines — accessories, by quantity (2026-09-19) — as
 * `OrderItem` rows with no unit, keyed by the browser's line id. The cost is
 * not written here: it arrives with the `TERJUAL` stock moves naming the line
 * (`adapters/stock.ts`), later in the same commit.
 */
async function syncCountedLines(ctx: WriteContext, sale: Sale): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.orderItem.findMany({
    where: { orderId: sale.id, unitId: null, ...NOT_CORRECTED },
    select: { id: true, qty: true },
  });
  const left = new Set(existing.map((i) => i.id));
  const lines = sale.lines ?? [];
  const skus = await tx.sku.findMany({
    where: { id: { in: lines.map((l) => l.skuId) } },
    select: { id: true, name: true, variantLabel: true },
  });
  const skuOf = new Map(skus.map((s) => [s.id, s]));
  for (const [i, l] of lines.entries()) {
    const sku = skuOf.get(l.skuId);
    if (sku === undefined) {
      throw new StoreValidationError(
        `Produk ${l.skuId} tidak ditemukan.`,
        "orders",
        sale.id,
      );
    }
    const returned = l.returnedQty ?? 0;
    const data = {
      skuId: l.skuId,
      name: sku.name,
      variant: sku.variantLabel,
      qty: l.qty,
      price: l.price,
      sub: l.price * BigInt(l.qty),
      listPrice: l.listPrice ?? null,
      returnedQty: returned,
      sortOrder: sale.serials.length + i,
    };
    if (left.has(l.id)) {
      left.delete(l.id);
      await tx.orderItem.update({
        where: { id: l.id },
        data: {
          ...data,
          ...(returned > 0 ? { returnReason: "Retur pelanggan" } : {}),
        },
      });
      if (returned > 0) {
        await tx.orderItem.updateMany({
          where: { id: l.id, returnedAt: null },
          data: { returnedAt: ctx.now },
        });
      } else {
        // A return taken back (2026-10-23): nothing is out any more, so the
        // line is open again — left closed, the sale could never be deleted.
        await tx.orderItem.updateMany({
          where: { id: l.id, returnReason: "Retur pelanggan" },
          data: { returnedAt: null, returnReason: null },
        });
      }
      continue;
    }
    await tx.orderItem.create({
      data: {
        id: l.id,
        orderId: sale.id,
        unitId: null,
        ...data,
        cogs: 0n,
      },
    });
  }
  // A line taken off by a correction closes (see `CORRECTED`). Its pieces go
  // back on the shelf by the KOREKSI moves the browser sends in the same
  // commit, which also take their cost off the sale (adapters/stock.ts).
  const qtyOf = new Map(existing.map((i) => [i.id, i.qty]));
  for (const id of left) {
    await tx.orderItem.update({
      where: { id },
      data: {
        returnedAt: ctx.now,
        returnedQty: qtyOf.get(id) ?? 0,
        returnReason: CORRECTED,
      },
    });
  }
}

async function syncSalePayments(ctx: WriteContext, sale: Sale): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.payment.findMany({ where: { orderId: sale.id } });
  const left = new Map(existing.map((p) => [p.id, p]));
  for (const [sortOrder, p] of (sale.payments ?? []).entries()) {
    // A zero is no payment. PaymentsPanel can hold one while a part is being
    // typed; the database refuses one (Payment_amount_positive_check).
    if (p.amount <= 0n) continue;
    const at = instantOf(p.at);
    const data = {
      methodId: await ctx.paymentMethodId(p.method),
      amount: p.amount,
      status: PAY_STATUS_OF_STATE[p.state],
      paidAt: p.state === "SETTLED" ? at : null,
      dueAt: p.dueAt === undefined ? null : instantOf(p.dueAt),
      recordedAt: at,
      channel: p.channel === undefined ? null : PLATFORM_OF_SOURCE[p.channel],
      note: blankToNull(p.note),
      // The marketplace's order number (owner ask 2026-09-19) — the key a
      // payout report is matched on. `Payment.ref` has been in the schema
      // since the supplier side needed one.
      ref: blankToNull(p.ref),
      inBalance: p.inBalance ?? true,
      sortOrder,
      voidedAt: null,
    };
    if (left.has(p.id)) {
      left.delete(p.id);
      await tx.payment.update({ where: { id: p.id }, data });
    } else if (p.reservationId !== undefined) {
      await adoptDp(ctx, sale, p.reservationId, p.id, data);
    } else {
      await tx.payment.create({
        data: {
          id: p.id,
          orderId: sale.id,
          direction: "MASUK",
          appliedTo: "BARANG",
          staffId: ctx.staffId,
          ...data,
        },
      });
    }
  }
  /*
   * Money handed back — a return that refunds (owner brief 2026-09-19). The
   * same table, the other direction: settled the moment it is recorded,
   * because a refund is recorded when it is paid.
   */
  for (const [i, r] of (sale.refunds ?? []).entries()) {
    if (r.amount <= 0n) continue;
    const at = instantOf(r.at);
    const data = {
      methodId: await ctx.paymentMethodId(r.method),
      amount: r.amount,
      status: PAY_STATUS_OF_STATE.SETTLED,
      paidAt: at,
      dueAt: null,
      recordedAt: at,
      channel: null,
      note: blankToNull(r.note),
      sortOrder: (sale.payments?.length ?? 0) + i,
      voidedAt: null,
    };
    if (left.has(r.id)) {
      left.delete(r.id);
      await tx.payment.update({ where: { id: r.id }, data });
    } else {
      await tx.payment.create({
        data: {
          id: r.id,
          orderId: sale.id,
          direction: "KELUAR",
          appliedTo: "BARANG",
          staffId: ctx.staffId,
          ...data,
        },
      });
    }
  }
  for (const p of left.values()) {
    if (p.reservationId !== null) {
      // A DP taken off the sale goes back to its reservation, unspent — the
      // money still came in, once, on the day it did (2026-10-27).
      await tx.payment.update({
        where: { id: p.id },
        data: { orderId: null, voidedAt: null },
      });
      ctx.touch("reservations", p.reservationId);
      continue;
    }
    if (p.voidedAt === null) {
      await tx.payment.update({
        where: { id: p.id },
        data: { voidedAt: ctx.now },
      });
    }
  }
}

/**
 * A reservation's DP put towards a sale (2026-10-27): the SAME `Payment` row
 * gains the sale as its parent and keeps the reservation (invariant 7 allows
 * exactly that pair). Never a copy — a second row would count the money
 * twice, once when it came in and again at the sale. Refused for a DP that is
 * not the reservation's, already on another sale, or refunded.
 */
async function adoptDp(
  ctx: WriteContext,
  sale: Sale,
  reservationId: string,
  paymentId: string,
  data: {
    methodId: string;
    amount: bigint;
    status: PayStatus;
    paidAt: Date | null;
    recordedAt: Date;
  } & Record<string, unknown>,
): Promise<void> {
  const { tx } = ctx;
  const refuse = (why: string) =>
    new StoreValidationError(
      `DP tidak bisa dipakai: ${why}`,
      "orders",
      sale.id,
    );
  const dp = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      reservationId: true,
      orderId: true,
      direction: true,
      voidedAt: true,
    },
  });
  if (dp === null) {
    // Recorded and spent in the same breath: one row with both parents.
    await tx.payment.create({
      data: {
        ...data,
        id: paymentId,
        orderId: sale.id,
        reservationId,
        direction: "MASUK",
        appliedTo: "BARANG",
        staffId: ctx.staffId,
      },
    });
    ctx.touch("reservations", reservationId);
    return;
  }
  if (dp.reservationId !== reservationId || dp.direction !== "MASUK")
    throw refuse("bukan DP reservasi itu.");
  if (dp.voidedAt !== null) throw refuse("DP-nya sudah dihapus.");
  if (dp.orderId !== null && dp.orderId !== sale.id)
    throw refuse("sudah dipakai di penjualan lain.");
  const refunded = await tx.payment.count({
    where: { reservationId, direction: "KELUAR", voidedAt: null },
  });
  if (refunded > 0) throw refuse("sudah dikembalikan ke pelanggan.");
  await tx.payment.update({
    where: { id: paymentId },
    data: { ...data, orderId: sale.id },
  });
  ctx.touch("reservations", reservationId);
}

/**
 * What returns took off a sale's bill (owner brief 2026-09-19) — the table
 * the return flow was always meant to fill (see `OrderAdjustment.code`).
 * Append-only: an adjustment is a record that something happened, so one
 * that disappears from the browser's copy is refused rather than deleted.
 */
async function syncOrderAdjustments(
  ctx: WriteContext,
  sale: Sale,
): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.orderAdjustment.findMany({
    where: { orderId: sale.id, ...NOT_WITHDRAWN },
  });
  const left = new Map(existing.map((a) => [a.id, a]));
  for (const a of sale.adjustments ?? []) {
    const data = {
      type: a.type,
      code: blankToNull(a.code),
      amount: a.amount,
      reason: a.reason,
      at: instantOf(a.at),
    };
    if (left.has(a.id)) {
      left.delete(a.id);
      await tx.orderAdjustment.update({ where: { id: a.id }, data });
    } else {
      await tx.orderAdjustment.create({
        data: { id: a.id, orderId: sale.id, staffId: ctx.staffId, ...data },
      });
    }
  }
  // A return taken back (audit 2026-10-23: the undo was refused here every
  // time). The app holds no DELETE on this table, so the row is WITHDRAWN —
  // amount 0, what it was kept in its reason — and projected nowhere. Any
  // other adjustment that disappears is still refused.
  for (const a of left.values()) {
    if (a.type !== "RETUR" || a.code === null) {
      throw new StoreValidationError(
        "Penyesuaian penjualan tidak bisa dihapus.",
        "orders",
        sale.id,
      );
    }
    await tx.orderAdjustment.update({
      where: { id: a.id },
      data: {
        amount: 0n,
        reason: `${WITHDRAWN} (${a.amount.toString()}): ${a.reason}`,
      },
    });
  }
}

/**
 * A sale deleted from Transaction History (owner ask 2026-10-22: *"add a
 * button to delete a transaction … close transaction monthly so before that
 * all the transaction can be deleted"*; asked, *"gone completely"*).
 *
 * The browser drops the order, takes each unit's sold row off its ledger
 * (`removeEvents`, units.ts, which runs after this in the same commit) and
 * puts counted pieces back with a KOREKSI move. Here the row is CANCELLED,
 * not deleted — the same footing as a deleted inbound invoice (`cancelPo`):
 * `BATAL` is projected nowhere, its payments are voided, and its lines are
 * closed so the units on them can be sold again
 * (`OrderItem_unitId_unreturned_key`). Every UnitEvent, PaymentLog and
 * StockMove that names the order still finds it.
 *
 * Refused, each because undoing it here would have to guess: a closed book
 * (retired 2026-10-27, `booksClosedUntil`), a return (an adjustment, a refund or a line
 * already closed), a trade-in, a marketplace payout received against it, or
 * an Income & Expense line naming it. `lib/saleDeletion.ts` in the web app
 * asks the same questions so the button can say why before anybody presses.
 */
async function cancelSale(ctx: WriteContext, id: string): Promise<void> {
  const { tx } = ctx;
  const order = await tx.order.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      ts: true,
      status: true,
      _count: {
        select: {
          adjustments: { where: NOT_WITHDRAWN },
          expenses: true,
          incomes: true,
          tradeIns: { where: { removedAt: null } },
          payments: { where: { direction: "KELUAR", voidedAt: null } },
          items: {
            where: {
              returnedAt: { not: null },
              ...NOT_CORRECTED,
            },
          },
        },
      },
    },
  });
  if (order === null || order.status === "BATAL") {
    throw new StoreValidationError("Transaksi tidak ditemukan.", "orders", id);
  }
  const refuse = (why: string) =>
    new StoreValidationError(
      `Transaksi ${order.code} tidak bisa dihapus: ${why}`,
      "orders",
      id,
    );
  // Locked only once finished (2026-10-22) — and never, since the book close
  // was retired on 2026-10-27 (`booksClosedUntil`).
  const until = booksClosedUntil();
  if (until !== null && order.ts <= until && order.status === "LUNAS")
    throw refuse("bukunya sudah ditutup.");
  const c = order._count;
  if (c.adjustments > 0 || c.payments > 0 || c.items > 0)
    throw refuse("ada retur di dalamnya.");
  if (c.tradeIns > 0) throw refuse("ada tukar tambah di dalamnya.");
  // A reservation's DP (2026-10-27): voiding it with the sale would make the
  // money vanish from the reservation it came in on.
  const dps = await tx.payment.count({
    where: { orderId: id, reservationId: { not: null }, voidedAt: null },
  });
  if (dps > 0) throw refuse("ada DP reservasi di dalamnya.");
  if (c.expenses > 0 || c.incomes > 0)
    throw refuse("ada catatan pemasukan/pengeluaran yang menautnya.");

  const items = await tx.orderItem.findMany({
    where: { orderId: id },
    select: { id: true, qty: true, unitId: true },
  });
  await tx.unit.updateMany({
    where: { soldOrderItemId: { in: items.map((i) => i.id) } },
    data: { soldOrderItemId: null },
  });
  for (const i of items) {
    await tx.orderItem.update({
      where: { id: i.id },
      data: {
        returnedAt: ctx.now,
        returnedQty: i.qty,
        returnReason: "Transaksi dihapus",
      },
    });
  }
  await tx.payment.updateMany({
    where: { orderId: id, voidedAt: null },
    data: { voidedAt: ctx.now },
  });
  await tx.orderFee.updateMany({
    where: { orderId: id, removedAt: null },
    data: { removedAt: ctx.now },
  });
  await tx.order.update({ where: { id }, data: { status: "BATAL" } });
  ctx.touch("orders", id);

  // The units go back to the shelf HERE, whatever the browser sent (owner
  // report 2026-10-23: a sale was deleted and its unit still read Sold). Every
  // ledger row that names this sale comes off — the sold row and any note a
  // payout wrote after it — and the unit takes the status and place of its
  // newest remaining row. A unit is never emptied: if the sale's rows are all
  // it has, it is left for a person.
  const unitIds = [
    ...new Set(items.map((i) => i.unitId).filter((u): u is string => !!u)),
  ];
  for (const unitId of unitIds) await restoreUnitOffSale(ctx, unitId, id);
}

/**
 * A unit that has stopped being part of a sale — the sale deleted, or the unit
 * taken off it by a correction — goes back to what it was before (owner report
 * 2026-10-23: a deleted sale left C02D503ZM6KJ Sold). Every ledger row naming
 * the sale comes off — the sold row and any note written after it — and the
 * unit takes the status and place of its newest remaining row. Done here
 * whatever the browser sent; `removeEvents` skips a row already dropped. A
 * unit is never emptied: if the sale's rows are all it has, it is left alone.
 */
async function restoreUnitOffSale(
  ctx: WriteContext,
  unitId: string,
  orderId: string,
): Promise<void> {
  const { tx } = ctx;
  const mine = await tx.unitEvent.findMany({
    where: { unitId, orderId },
    select: { id: true },
  });
  if (mine.length === 0) return;
  const total = await tx.unitEvent.count({ where: { unitId } });
  if (mine.length >= total) return;
  const ids = mine.map((e) => e.id);
  await tx.$queryRaw`SELECT unit_event_drop(${ids}::text[])`;
  for (const e of ids) {
    ctx.droppedEvents.add(e);
    ctx.touch("events", e);
  }
  const last = await tx.unitEvent.findFirst({
    where: { unitId },
    orderBy: { seq: "desc" },
    select: { toStatus: true },
  });
  const moved = await tx.unitEvent.findFirst({
    where: { unitId, toLocationId: { not: null } },
    orderBy: { seq: "desc" },
    select: { toLocationId: true },
  });
  const unit = await tx.unit.update({
    where: { id: unitId },
    data: {
      ...(last ? { status: last.toStatus } : {}),
      ...(moved?.toLocationId ? { locationId: moved.toLocationId } : {}),
    },
    select: { serial: true, status: true, locationId: true },
  });
  ctx.touch("units", unit.serial);
  ctx.ledgerAfter.set(unit.serial, {
    status: unit.status,
    locationId: unit.locationId,
  });
  // Sold out of a hold: the hold had closed as collected, and with the unit
  // back at DIRESERVASI it is holding again (audit 2026-10-23 — otherwise the
  // unit is held by a finished reservation nobody can release).
  if (unit.status === "DIRESERVASI") {
    const holds = await tx.reservation.findMany({
      where: {
        status: "SELESAI",
        items: { some: { unitId, removedAt: null } },
      },
      select: { id: true },
    });
    for (const h of holds) {
      await tx.reservation.update({
        where: { id: h.id },
        data: { status: "TERJADWAL" },
      });
      ctx.touch("reservations", h.id);
    }
  }
}

export const orders: Adapter<"orders"> = {
  collection: "orders",
  async project(tx, _ctx, keys) {
    const rows = await tx.order.findMany({
      // A deleted sale (`cancelSale`) is projected nowhere — the browser
      // removed it, and every screen reads the projection.
      where: { ...byId(keys), status: { not: "BATAL" } },
      orderBy: [{ ts: "desc" }, { code: "desc" }],
      include: {
        items: {
          where: { ...NOT_CORRECTED },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { unit: { select: { serial: true } } },
        },
        fees: {
          where: { removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        tradeIns: {
          where: { removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
        payments: {
          where: { voidedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { method: { select: { code: true } } },
        },
        adjustments: {
          where: NOT_WITHDRAWN,
          orderBy: [{ at: "asc" }, { id: "asc" }],
        },
        payMethod: { select: { code: true } },
      },
    });
    return rows.map((o) => {
      const lines = o.items.flatMap((i) =>
        i.unit === null
          ? []
          : [{ serial: i.unit.serial, price: i.price, listPrice: i.listPrice }],
      );
      const listed = lines.filter((l) => l.listPrice !== null);
      // A counted product's line — an accessory, no unit (2026-09-19).
      const counted = o.items.filter((i) => i.unitId === null);
      // `Order.total` holds the bill; the store's is what was collected — the
      // bill less the trade-in, or the whole bill when the trade-in was worth
      // more and was bought outright (2026-10-31). A sale recorded BEFORE that
      // with a trade-in worth more collected nothing and paid nothing, so it
      // still reads 0 — the bill would make it a debt nobody owes.
      const afterTrade =
        o.tradeCredit > o.total
          ? o.paidTotal > 0n
            ? o.total
            : 0n
          : o.total - o.tradeCredit;
      // What the customer paid, and what was handed back — one table, told
      // apart by direction.
      const paidIn = o.payments.filter((p) => p.direction === "MASUK");
      const paidOut = o.payments.filter((p) => p.direction === "KELUAR");
      return {
        id: o.id,
        code: o.code,
        ts: isoOf(o.ts),
        customerId: o.customerId,
        serials: lines.map((l) => l.serial),
        prices: Object.fromEntries(lines.map((l) => [l.serial, l.price])),
        listPrices:
          listed.length === 0
            ? undefined
            : Object.fromEntries(
                listed.map((l) => [l.serial, l.listPrice as bigint]),
              ),
        lines:
          counted.length === 0
            ? undefined
            : counted.map((i) => ({
                id: i.id,
                skuId: i.skuId,
                qty: i.qty,
                price: i.price,
                listPrice: i.listPrice ?? undefined,
                returnedQty: i.returnedQty > 0 ? i.returnedQty : undefined,
              })),
        discount: o.discount,
        discountId: o.discountId ?? undefined,
        source: SOURCE_OF_PLATFORM[o.platform],
        salesmanId: o.salespersonId ?? undefined,
        referralSourceId: o.referralSourceId ?? undefined,
        shippingAddress: o.shippingAddress ?? undefined,
        payMethod: o.payMethod?.code ?? paidIn[0]?.method.code ?? "TUNAI",
        settled: o.status === "LUNAS",
        payments:
          paidIn.length === 0
            ? undefined
            : paidIn.map((p) => ({
                id: p.id,
                method: p.method.code,
                amount: p.amount,
                state: STATE_OF_PAY_STATUS[p.status],
                channel:
                  p.channel === null
                    ? undefined
                    : SOURCE_OF_PLATFORM[p.channel],
                at: isoOf(p.recordedAt ?? p.paidAt ?? o.ts),
                dueAt: optionalIso(p.dueAt),
                note: p.note ?? undefined,
                ref: p.ref ?? undefined,
                inBalance: p.inBalance ? undefined : false,
                reservationId: p.reservationId ?? undefined,
              })),
        refunds:
          paidOut.length === 0
            ? undefined
            : paidOut.map((p) => ({
                id: p.id,
                method: p.method.code,
                amount: p.amount,
                at: isoOf(p.recordedAt ?? p.paidAt ?? o.ts),
                note: p.note ?? undefined,
              })),
        adjustments:
          o.adjustments.length === 0
            ? undefined
            : o.adjustments.map((a) => ({
                id: a.id,
                type: a.type,
                code: a.code ?? undefined,
                amount: a.amount,
                reason: a.reason,
                at: isoOf(a.at),
              })),
        extra: o.extra === 0n ? undefined : o.extra,
        extraNote: o.extraNote ?? undefined,
        fees:
          o.fees.length === 0
            ? undefined
            : o.fees.map((f) => ({
                id: f.id,
                label: f.label,
                amount: f.amount,
              })),
        tradeIns:
          o.tradeIns.length === 0
            ? undefined
            : o.tradeIns.map((x) => ({
                id: x.id,
                label: x.label,
                serial: x.serial ?? undefined,
                value: x.value,
                note: x.note ?? undefined,
                skuId: x.skuId ?? undefined,
                condition: x.condition ?? undefined,
                grade: x.grade ?? undefined,
              })),
        total: afterTrade,
        grossTotal: o.grossTotal ?? undefined,
        netReceived: o.netReceived ?? undefined,
        reservationId: o.reservationId ?? undefined,
      };
    });
  },
  lock: (tx, keys) => lockRows(tx, "Order", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await cancelSale(ctx, r.key);
        continue;
      }

      const unitRows = await tx.unit.findMany({
        where: { serial: { in: n.serials }, archivedAt: null },
        select: {
          id: true,
          serial: true,
          skuId: true,
          buy: true,
          locationId: true,
          sku: { select: { name: true, variantLabel: true } },
        },
      });
      const units = new Map(unitRows.map((u) => [u.serial, u]));
      for (const serial of n.serials) {
        if (!units.has(serial)) {
          throw new StoreValidationError(
            `Unit ${serial} tidak ditemukan.`,
            "orders",
            n.id,
          );
        }
        if (n.prices[serial] === undefined) {
          throw new StoreValidationError(
            `Harga ${serial} tidak ada.`,
            "orders",
            n.id,
          );
        }
      }

      const subtotal =
        sum(n.serials.map((s) => n.prices[s]!)) +
        sum((n.lines ?? []).map((l) => l.price * BigInt(l.qty)));
      const extra = n.extra ?? 0n;
      const tradeCredit = sum((n.tradeIns ?? []).map((x) => x.value));
      const bill = subtotal - n.discount + extra;
      if (bill < 0n) {
        throw new StoreValidationError(
          `Diskon ${n.code} melebihi nilai penjualan.`,
          "orders",
          n.id,
        );
      }
      // A trade-in worth more than the bill (2026-10-31) leaves the sale at its
      // full bill, paid in full, and the trade-in a purchase of its own — the
      // shop hands the customer the difference. One worth less comes off it.
      // `totalAfterTradeIn` in apps/web lib/pos.ts is the same rule.
      const afterTrade = tradeCredit > bill ? bill : bill - tradeCredit;
      // …or 0, a sale from before 2026-10-31 that netted it away.
      const legacyZero = tradeCredit > bill && n.total === 0n;
      if (n.total !== afterTrade && !legacyZero) {
        throw new StoreValidationError(
          `Total ${n.code} tidak cocok: ${n.total}, seharusnya ${afterTrade}.`,
          "orders",
          n.id,
        );
      }
      const refunded = sum((n.refunds ?? []).map((x) => x.amount));
      const paidIn =
        n.payments === undefined
          ? n.settled
            ? bill
            : 0n
          : sum(
              n.payments
                .filter((p) => p.state === "SETTLED")
                .map((p) => p.amount),
            );
      // Net of what was handed back; never below nothing (Order_money_nonneg).
      const paidTotal = paidIn > refunded ? paidIn - refunded : 0n;
      const customer =
        n.customerId === null
          ? null
          : await tx.customer.findUnique({
              where: { id: n.customerId },
              select: { name: true, phone: true },
            });
      const data = {
        code: n.code,
        ts: instantOf(n.ts),
        customerId: n.customerId,
        custName: customer?.name ?? null,
        phone: customer?.phone ?? null,
        platform: PLATFORM_OF_SOURCE[n.source],
        fulfill: n.shippingAddress ? ("SHIP" as const) : ("PICKUP" as const),
        status: n.settled ? ("LUNAS" as const) : ("BELUM" as const),
        subtotal,
        discountId: n.discountId ?? null,
        discount: n.discount,
        extra,
        extraNote: blankToNull(n.extraNote),
        total: bill,
        paidTotal,
        tradeCredit,
        referralSourceId: n.referralSourceId ?? null,
        salespersonId: n.salesmanId ?? null,
        shippingAddress: blankToNull(n.shippingAddress),
        payMethodId: await ctx.paymentMethodId(n.payMethod),
        grossTotal: n.grossTotal ?? null,
        netReceived: n.netReceived ?? null,
        reservationId: n.reservationId ?? null,
      };
      if (r.base === undefined) {
        await tx.order.create({
          data: {
            id: n.id,
            ...data,
            cogs: sum(unitRows.map((u) => u.buy)),
            belowFloor: false,
            soldById: ctx.staffId,
            locationId:
              unitRows[0]?.locationId ?? (await defaultLocationId(ctx)),
          },
        });
        // Chatbot v2: a sale ends the customer's 🔥 lead (owner, 2026-10-14:
        // "it will clear at sale"). Their WhatsApp thread is keyed by the
        // bare digits of the number on the order; nothing happens for a
        // customer who never wrote in.
        const waId = customer?.phone?.replace(/\D/g, "") ?? "";
        if (waId) {
          await tx.waThreadMemory.updateMany({
            where: { from: waId },
            data: { leadClearedAt: ctx.now },
          });
        }
      } else {
        await tx.order.update({ where: { id: n.id }, data });
      }

      if (
        r.base === undefined ||
        !deepEqual(r.base.serials, n.serials) ||
        !deepEqual(r.base.prices, n.prices) ||
        !deepEqual(r.base.listPrices, n.listPrices)
      ) {
        await syncSaleLines(ctx, n, units, r.base !== undefined);
      }
      if (r.base === undefined || !deepEqual(r.base.lines, n.lines)) {
        await syncCountedLines(ctx, n);
      }

      if (r.base === undefined || !deepEqual(r.base.fees, n.fees)) {
        const existing = await tx.orderFee.findMany({
          where: { orderId: n.id },
        });
        const left = new Map(existing.map((f) => [f.id, f]));
        for (const [sortOrder, f] of (n.fees ?? []).entries()) {
          const fee = {
            label: f.label,
            amount: f.amount,
            sortOrder,
            removedAt: null,
          };
          if (left.has(f.id)) {
            left.delete(f.id);
            await tx.orderFee.update({ where: { id: f.id }, data: fee });
          } else {
            await tx.orderFee.create({
              data: { id: f.id, orderId: n.id, ...fee },
            });
          }
        }
        for (const f of left.values()) {
          if (f.removedAt === null) {
            await tx.orderFee.update({
              where: { id: f.id },
              data: { removedAt: ctx.now },
            });
          }
        }
      }

      if (r.base === undefined || !deepEqual(r.base.tradeIns, n.tradeIns)) {
        const existing = await tx.tradeIn.findMany({
          where: { orderId: n.id },
        });
        const left = new Map(existing.map((x) => [x.id, x]));
        for (const [sortOrder, x] of (n.tradeIns ?? []).entries()) {
          const serial = blankToNull(x.serial);
          const line = {
            label: x.label,
            serial,
            value: x.value,
            unitId:
              serial === null ? null : ((await ctx.findUnitId(serial)) ?? null),
            note: blankToNull(x.note),
            skuId: x.skuId ?? null,
            condition: x.condition ?? null,
            grade: x.grade ?? null,
            sortOrder,
            removedAt: null,
          };
          if (left.has(x.id)) {
            left.delete(x.id);
            await tx.tradeIn.update({ where: { id: x.id }, data: line });
          } else {
            await tx.tradeIn.create({
              data: { id: x.id, orderId: n.id, ...line },
            });
          }
        }
        for (const x of left.values()) {
          if (x.removedAt === null) {
            await tx.tradeIn.update({
              where: { id: x.id },
              data: { removedAt: ctx.now },
            });
          }
        }
      }

      if (
        (n.payments !== undefined || n.refunds !== undefined) &&
        (r.base === undefined ||
          !deepEqual(r.base.payments, n.payments) ||
          !deepEqual(r.base.refunds, n.refunds))
      ) {
        await syncSalePayments(ctx, n);
      }
      if (
        r.base === undefined ||
        !deepEqual(r.base.adjustments, n.adjustments)
      ) {
        await syncOrderAdjustments(ctx, n);
      }
      ctx.touch("orders", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export const returns: Adapter<"returns"> = {
  collection: "returns",
  async project(tx, _ctx, keys) {
    const rows = await tx.unitReturn.findMany({
      where: { ...byId(keys), unit: { archivedAt: null } },
      orderBy: [{ date: "desc" }, { code: "desc" }],
      include: {
        unit: { select: { serial: true } },
        exchangeUnit: { select: { serial: true } },
        // `refundReceived` is derived from these (2026-10-26).
        incomes: { where: { reason: "REFUND" }, select: { amount: true } },
      },
    });
    return rows.map((x) => ({
      id: x.id,
      code: x.code,
      kind: x.kind,
      serial: x.unit.serial,
      reason: x.reason,
      reasonDetail: x.reasonDetail ?? undefined,
      date: x.date,
      status: x.status,
      fromQc: x.fromQc ?? undefined,
      exchangeSerial: x.exchangeUnit?.serial,
      fee: x.fee ?? undefined,
      supplierId: x.supplierId ?? undefined,
      expectedCredit: x.expectedCredit ?? undefined,
      ...(x.incomes.length > 0
        ? { refundReceived: x.incomes.reduce((n, i) => n + i.amount, 0n) }
        : {}),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "UnitReturn", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("returns", r.key);
      const exchange = blankToNull(n.exchangeSerial);
      const data = {
        code: n.code,
        kind: n.kind,
        unitId: await ctx.unitId(n.serial),
        reason: n.reason,
        reasonDetail: blankToNull(n.reasonDetail),
        date: n.date,
        status: n.status,
        fromQc: n.fromQc ?? null,
        exchangeUnitId: exchange === null ? null : await ctx.unitId(exchange),
        fee: n.fee ?? null,
        supplierId: n.supplierId ?? null,
        expectedCredit: n.expectedCredit ?? null,
      };
      if (r.base === undefined) {
        await tx.unitReturn.create({
          data: { id: n.id, ...data, staffId: ctx.staffId, createdAt: ctx.now },
        });
      } else {
        await tx.unitReturn.update({ where: { id: n.id }, data });
      }
      ctx.touch("returns", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Stock takes
// ---------------------------------------------------------------------------

type Count = RowOf<"opnames">;

const RESULT_OF_LIST = {
  counted: "COCOK",
  missing: "HILANG",
  unknown: "TIDAK_DIKENAL",
} as const satisfies Record<string, ScanResult>;

function scanPlan(
  c: Count,
): Map<string, { result: ScanResult; sortOrder: number; note: string | null }> {
  const plan = new Map<
    string,
    { result: ScanResult; sortOrder: number; note: string | null }
  >();
  for (const list of ["counted", "missing", "unknown"] as const) {
    for (const [sortOrder, serial] of c[list].entries()) {
      plan.set(serial, {
        result: RESULT_OF_LIST[list],
        sortOrder,
        note: c.notes[serial] ?? null,
      });
    }
  }
  return plan;
}

async function syncScans(
  ctx: WriteContext,
  base: Count | undefined,
  next: Count,
): Promise<void> {
  const { tx } = ctx;
  const was = base === undefined ? new Map() : scanPlan(base);
  const now = scanPlan(next);
  const changed = new Set<string>();
  for (const [serial, p] of now)
    if (!deepEqual(was.get(serial), p)) changed.add(serial);
  for (const serial of was.keys()) if (!now.has(serial)) changed.add(serial);
  const baseNotes = base?.notes ?? {};
  for (const serial of new Set([
    ...Object.keys(baseNotes),
    ...Object.keys(next.notes),
  ])) {
    if (baseNotes[serial] !== next.notes[serial]) changed.add(serial);
  }
  if (changed.size === 0) return;

  const existing = await tx.opnameScan.findMany({
    where: { sessionId: next.id, serial: { in: [...changed] } },
  });
  const rowOf = new Map(existing.map((s) => [s.serial, s]));
  for (const serial of changed) {
    const plan = now.get(serial);
    const had = rowOf.get(serial);
    const note = next.notes[serial] ?? null;
    if (plan !== undefined) {
      // A serial counted as belonging to another warehouse stays marked so;
      // the browser shows both kinds on one "unknown" list.
      const result =
        had?.result === "SALAH_LOKASI" && plan.result === "TIDAK_DIKENAL"
          ? "SALAH_LOKASI"
          : plan.result;
      if (had === undefined) {
        await tx.opnameScan.create({
          data: {
            sessionId: next.id,
            serial,
            unitId: (await ctx.findUnitId(serial)) ?? null,
            result,
            at: ctx.now,
            note,
            sortOrder: plan.sortOrder,
          },
        });
      } else {
        await tx.opnameScan.update({
          where: { id: had.id },
          data: { result, sortOrder: plan.sortOrder, note, removedAt: null },
        });
      }
    } else if (had !== undefined) {
      await tx.opnameScan.update({
        where: { id: had.id },
        data: { removedAt: had.removedAt ?? ctx.now, note },
      });
    } else if (note !== null) {
      // A note about a serial on no list — kept, on a row nobody counts.
      await tx.opnameScan.create({
        data: {
          sessionId: next.id,
          serial,
          unitId: (await ctx.findUnitId(serial)) ?? null,
          result: "TIDAK_DIKENAL",
          at: ctx.now,
          note,
          sortOrder: 0,
          removedAt: ctx.now,
        },
      });
    }
  }
}

async function syncScope<T extends string>(
  wanted: readonly T[],
  existing: readonly {
    id: string;
    key: T;
    removedAt: Date | null;
    sortOrder: number;
  }[],
  create: (key: T, sortOrder: number) => Promise<unknown>,
  update: (
    id: string,
    data: { sortOrder: number; removedAt: Date | null },
  ) => Promise<unknown>,
  now: Date,
): Promise<void> {
  const left = new Map(existing.map((e) => [e.key, e]));
  for (const [sortOrder, key] of wanted.entries()) {
    const had = left.get(key);
    if (had === undefined) {
      await create(key, sortOrder);
    } else {
      left.delete(key);
      if (had.sortOrder !== sortOrder || had.removedAt !== null) {
        await update(had.id, { sortOrder, removedAt: null });
      }
    }
  }
  for (const e of left.values()) {
    if (e.removedAt === null)
      await update(e.id, { sortOrder: e.sortOrder, removedAt: now });
  }
}

export const opnames: Adapter<"opnames"> = {
  collection: "opnames",
  async project(tx, _ctx, keys) {
    const rows = await tx.opnameSession.findMany({
      where: { ...byId(keys), NOT: { status: "BATAL" } },
      orderBy: [{ startedAt: "desc" }, { code: "desc" }],
      include: {
        scopeLocations: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
        },
        scopeRacks: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
        },
        scopeCategories: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
          include: { category: { select: { name: true } } },
        },
        scopeConditions: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
        },
        scans: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        surplus: { where: { removedAt: null } },
        counts: {
          where: { removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });
    return rows.map((s) => {
      const live = s.scans.filter((x) => x.removedAt === null);
      const listOf = (results: readonly ScanResult[]) =>
        live.filter((x) => results.includes(x.result)).map((x) => x.serial);
      return {
        id: s.id,
        code: s.code,
        label: s.label ?? undefined,
        locationIds: s.scopeLocations.map((x) => x.locationId),
        rackIds: s.scopeRacks.map((x) => x.rackId),
        categories: s.scopeCategories.map((x) => x.category.name),
        conditions: s.scopeConditions.map((x) => x.condition),
        date: s.countDate ?? dayOf(s.startedAt),
        at: isoOf(s.startedAt),
        counted: listOf(["COCOK"]),
        missing: listOf(["HILANG"]),
        unknown: listOf(["TIDAK_DIKENAL", "SALAH_LOKASI"]),
        notes: Object.fromEntries(
          s.scans.flatMap((x) =>
            x.note === null ? [] : [[x.serial, x.note] as const],
          ),
        ),
        // What was found of each product the shop counts rather than scans
        // (2026-09-15). Absent is "not reached"; zero is "looked, found none".
        counts: Object.fromEntries(s.counts.map((x) => [x.skuId, x.qty])),
        surplus: Object.fromEntries(
          s.surplus.map((x) => [
            x.serial,
            {
              skuId: x.skuId,
              locationId: x.locationId,
              reason: x.reason,
              condition: x.condition,
            },
          ]),
        ),
        status: OPNAME_STATUS_FROM[s.status] ?? "DRAFT",
      };
    });
  },
  lock: (tx, keys) => lockRows(tx, "OpnameSession", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        // A draft count is cancelled, not deleted — the owner decision left
        // open on 2026-09-01, taken the soft way (docs/store-on-postgres.md).
        const session = await tx.opnameSession.findUnique({
          where: { id: r.key },
          select: { status: true },
        });
        if (session === null) continue;
        if (session.status !== "BERJALAN") {
          throw new StoreValidationError(
            "Stock opname yang sudah diposting tidak bisa dihapus.",
            "opnames",
            r.key,
          );
        }
        await tx.opnameSession.update({
          where: { id: r.key },
          data: { status: "BATAL", closedAt: ctx.now },
        });
        ctx.touch("opnames", r.key);
        continue;
      }
      const posted = n.status === "POSTED";
      const existing =
        r.base === undefined
          ? null
          : await tx.opnameSession.findUnique({
              where: { id: n.id },
              select: { closedAt: true },
            });
      const data = {
        code: n.code,
        label: blankToNull(n.label),
        locationId: n.locationIds[0] ?? (await defaultLocationId(ctx)),
        status: posted ? ("DIPOSTING" as const) : ("BERJALAN" as const),
        startedAt: instantOf(n.at),
        countDate: n.date,
        closedAt: posted ? (existing?.closedAt ?? ctx.now) : null,
      };
      if (r.base === undefined) {
        await tx.opnameSession.create({
          data: { id: n.id, ...data, staffId: ctx.staffId },
        });
      } else {
        await tx.opnameSession.update({ where: { id: n.id }, data });
      }

      const sessionId = n.id;
      if (
        r.base === undefined ||
        !deepEqual(r.base.locationIds, n.locationIds)
      ) {
        const had = await tx.opnameScopeLocation.findMany({
          where: { sessionId },
        });
        await syncScope(
          n.locationIds,
          had.map((x) => ({ ...x, key: x.locationId })),
          (locationId, sortOrder) =>
            tx.opnameScopeLocation.create({
              data: { sessionId, locationId, sortOrder },
            }),
          (id, d) => tx.opnameScopeLocation.update({ where: { id }, data: d }),
          ctx.now,
        );
      }
      if (r.base === undefined || !deepEqual(r.base.rackIds, n.rackIds)) {
        const had = await tx.opnameScopeRack.findMany({ where: { sessionId } });
        await syncScope(
          n.rackIds,
          had.map((x) => ({ ...x, key: x.rackId })),
          (rackId, sortOrder) =>
            tx.opnameScopeRack.create({
              data: { sessionId, rackId, sortOrder },
            }),
          (id, d) => tx.opnameScopeRack.update({ where: { id }, data: d }),
          ctx.now,
        );
      }
      if (r.base === undefined || !deepEqual(r.base.categories, n.categories)) {
        const ids: string[] = [];
        for (const name of n.categories) ids.push(await ctx.categoryId(name));
        const had = await tx.opnameScopeCategory.findMany({
          where: { sessionId },
        });
        await syncScope(
          ids,
          had.map((x) => ({ ...x, key: x.categoryId })),
          (categoryId, sortOrder) =>
            tx.opnameScopeCategory.create({
              data: { sessionId, categoryId, sortOrder },
            }),
          (id, d) => tx.opnameScopeCategory.update({ where: { id }, data: d }),
          ctx.now,
        );
      }
      if (r.base === undefined || !deepEqual(r.base.conditions, n.conditions)) {
        const had = await tx.opnameScopeCondition.findMany({
          where: { sessionId },
        });
        await syncScope(
          n.conditions,
          had.map((x) => ({ ...x, key: x.condition })),
          (condition, sortOrder) =>
            tx.opnameScopeCondition.create({
              data: { sessionId, condition, sortOrder },
            }),
          (id, d) => tx.opnameScopeCondition.update({ where: { id }, data: d }),
          ctx.now,
        );
      }

      await syncScans(ctx, r.base, n);

      if (r.base === undefined || !deepEqual(r.base.counts, n.counts)) {
        const had = await tx.opnameCount.findMany({ where: { sessionId } });
        const left = new Map(had.map((x) => [x.skuId, x]));
        for (const [sortOrder, [skuId, qty]] of Object.entries(
          n.counts,
        ).entries()) {
          if (left.has(skuId)) {
            left.delete(skuId);
            await tx.opnameCount.update({
              where: { sessionId_skuId: { sessionId, skuId } },
              data: { qty, sortOrder, removedAt: null },
            });
          } else {
            await tx.opnameCount.create({
              data: { sessionId, skuId, qty, sortOrder },
            });
          }
        }
        // A count taken off the list is marked rather than deleted, as every
        // other row this adapter stops carrying is.
        for (const x of left.values()) {
          if (x.removedAt === null) {
            await tx.opnameCount.update({
              where: { id: x.id },
              data: { removedAt: ctx.now },
            });
          }
        }
      }

      if (r.base === undefined || !deepEqual(r.base.surplus, n.surplus)) {
        const had = await tx.opnameSurplus.findMany({ where: { sessionId } });
        const left = new Map(had.map((x) => [x.serial, x]));
        for (const [serial, s] of Object.entries(n.surplus)) {
          const row = {
            skuId: s.skuId,
            locationId: s.locationId,
            reason: s.reason,
            condition: s.condition,
            removedAt: null,
          };
          if (left.has(serial)) {
            left.delete(serial);
            await tx.opnameSurplus.update({
              where: { sessionId_serial: { sessionId, serial } },
              data: row,
            });
          } else {
            await tx.opnameSurplus.create({
              data: { sessionId, serial, ...row },
            });
          }
        }
        for (const x of left.values()) {
          if (x.removedAt === null) {
            await tx.opnameSurplus.update({
              where: { id: x.id },
              data: { removedAt: ctx.now },
            });
          }
        }
      }
      ctx.touch("opnames", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Service visits
// ---------------------------------------------------------------------------

/**
 * A service charge or a whole visit taken out (owner 2026-10-26, spec §2).
 * This REVERSES 2026-09-08's "a charge is edited, never removed" and is the
 * sixth sanctioned hard delete: `nusantara_app` holds DELETE on
 * `ServiceVisit` and `ServiceFee` and nothing else of the kind.
 *
 * Refused inside a closed book, judged on the charge's JAKARTA DAY (a visit:
 * the day it opened and every charge's day) — the same reading the browser's
 * `lib/serviceActions.ts` and an Income & Expense adjustment's deletion use,
 * so a charge typed at 06:00 on the first of a month is not "closed" by a book
 * closed to the last day of the month before. Never refused since the book
 * close was retired on 2026-10-27 (`booksClosedUntil`).
 */
function assertServiceBooksOpen(visitId: string, at: Date): void {
  const until = booksClosedUntil();
  if (until !== null && dateOfDay(dayOf(at)) <= until) {
    throw new StoreValidationError(
      `Bukunya sudah ditutup untuk tanggal ${dayOf(at)}; biaya servis ini tidak bisa dihapus (services ${visitId}).`,
      "services",
      visitId,
    );
  }
}

/**
 * The charge OWNS its expense (2026-10-26, decided after the foundation).
 *
 * A paid charge is an `Expense` of kind UNIT naming it. An account without
 * finance access is sent no expenses and may not edit or remove one
 * (`apps/api/src/auth/financeScope.ts`) — so if removing the charge needed the
 * browser to remove the expense too, only Ersen and Dina could ever delete a
 * paid charge. Here the server removes it instead, in the same transaction,
 * after every adapter has run: a finance account's browser may already have
 * removed it in the same changeset (the `expenses` adapter runs after this
 * one), in which case there is nothing left to do. A closed book keeps the
 * expense, and therefore the charge.
 */
function removeServiceFeesLater(
  ctx: WriteContext,
  visitId: string,
  feeIds: readonly string[],
  thenVisit: boolean,
): void {
  ctx.later.push(async () => {
    const { tx } = ctx;
    if (feeIds.length > 0) {
      const paid = await tx.expense.findMany({
        where: { serviceFeeId: { in: [...feeIds] } },
        select: { id: true, date: true },
      });
      const until = booksClosedUntil();
      for (const e of paid) {
        if (until !== null && dateOfDay(e.date) <= until) {
          throw new StoreValidationError(
            `Bukunya sudah ditutup untuk tanggal ${e.date}; pembayaran biaya servis ini tidak bisa dihapus (services ${visitId}).`,
            "services",
            visitId,
          );
        }
      }
      if (paid.length > 0) {
        await releaseReconciliationRefs(
          ctx,
          "expenseId",
          paid.map((e) => e.id),
          "services",
          visitId,
        );
        await tx.expense.deleteMany({
          where: { id: { in: paid.map((e) => e.id) } },
        });
        for (const e of paid) ctx.touch("expenses", e.id);
      }
      await tx.serviceFee.deleteMany({ where: { id: { in: [...feeIds] } } });
    }
    if (thenVisit) await tx.serviceVisit.delete({ where: { id: visitId } });
  });
}

/**
 * A paid charge's amount corrected: its expense follows, for the reason
 * `removeServiceFeesLater` gives — the person correcting it may not be able to
 * see the expense. After every adapter, so a finance account's browser that
 * edited both in one changeset ends at the same figure either way.
 */
function syncFeeExpenseLater(
  ctx: WriteContext,
  feeId: string,
  amount: bigint,
): void {
  ctx.later.push(async () => {
    const e = await ctx.tx.expense.findUnique({
      where: { serviceFeeId: feeId },
      select: { id: true, amount: true },
    });
    if (e === null || e.amount === amount) return;
    await ctx.tx.expense.update({ where: { id: e.id }, data: { amount } });
    ctx.touch("expenses", e.id);
  });
}

async function removeServiceVisit(
  ctx: WriteContext,
  id: string,
): Promise<void> {
  const visit = await ctx.tx.serviceVisit.findUnique({
    where: { id },
    select: { openedAt: true, fees: { select: { id: true, at: true } } },
  });
  if (visit === null) return;
  assertServiceBooksOpen(id, visit.openedAt);
  for (const f of visit.fees) assertServiceBooksOpen(id, f.at);
  removeServiceFeesLater(
    ctx,
    id,
    visit.fees.map((f) => f.id),
    true,
  );
  ctx.touch("services", id);
}

export const services: Adapter<"services"> = {
  collection: "services",
  async project(tx, _ctx, keys) {
    const rows = await tx.serviceVisit.findMany({
      where: { ...byId(keys), unit: { archivedAt: null } },
      orderBy: [{ openedAt: "desc" }, { id: "asc" }],
      include: {
        unit: { select: { serial: true } },
        staff: { select: { name: true } },
        fees: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            staff: { select: { name: true } },
            expense: { select: { id: true } },
          },
        },
      },
    });
    return rows.map((v) => ({
      id: v.id,
      serial: v.unit.serial,
      fromLocationId: v.fromLocationId,
      openedAt: isoOf(v.openedAt),
      arrivedAt: optionalIso(v.arrivedAt),
      closedAt: optionalIso(v.closedAt),
      toLocationId: v.toLocationId ?? undefined,
      fees: v.fees.map((f) => ({
        id: f.id,
        kind: f.kind,
        label: f.label ?? undefined,
        amount: f.amount,
        at: isoOf(f.at),
        staff: f.staff.name,
        // Derived from the expense, never written: see the contract.
        ...(f.expense === null ? {} : { paid: true as const }),
      })),
      note: v.note ?? undefined,
      raisedBy: v.raisedBy,
      poId: v.purchaseOrderId ?? undefined,
      staff: v.staff.name,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "ServiceVisit", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await removeServiceVisit(ctx, r.key);
        continue;
      }
      const data = {
        unitId: await ctx.unitId(n.serial),
        fromLocationId: n.fromLocationId,
        openedAt: instantOf(n.openedAt),
        arrivedAt: n.arrivedAt === undefined ? null : instantOf(n.arrivedAt),
        closedAt: n.closedAt === undefined ? null : instantOf(n.closedAt),
        toLocationId: n.toLocationId ?? null,
        note: blankToNull(n.note),
        raisedBy: n.raisedBy,
        purchaseOrderId: n.poId ?? null,
      };
      if (r.base === undefined) {
        await tx.serviceVisit.create({
          data: { id: n.id, ...data, staffId: await ctx.staffFor(n.staff) },
        });
      } else {
        await tx.serviceVisit.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.fees, n.fees)) {
        const existing = await tx.serviceFee.findMany({
          where: { visitId: n.id },
        });
        const left = new Map(existing.map((f) => [f.id, f]));
        for (const [sortOrder, f] of n.fees.entries()) {
          const fee = {
            kind: f.kind,
            label: blankToNull(f.label),
            amount: f.amount,
            sortOrder,
          };
          const was = left.get(f.id);
          if (was !== undefined) {
            left.delete(f.id);
            await tx.serviceFee.update({ where: { id: f.id }, data: fee });
            if (was.amount !== BigInt(f.amount))
              syncFeeExpenseLater(ctx, f.id, BigInt(f.amount));
          } else {
            await tx.serviceFee.create({
              data: {
                id: f.id,
                visitId: n.id,
                ...fee,
                at: instantOf(f.at),
                staffId: await ctx.staffFor(f.staff),
              },
            });
          }
        }
        if (left.size > 0) {
          for (const f of left.values()) assertServiceBooksOpen(n.id, f.at);
          removeServiceFeesLater(ctx, n.id, [...left.keys()], false);
        }
      }
      ctx.touch("services", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Marketplace settlements
// ---------------------------------------------------------------------------

export const settlements: Adapter<"settlements"> = {
  collection: "settlements",
  async project(tx, _ctx, keys) {
    const rows = await tx.settlement.findMany({
      where: byId(keys),
      orderBy: [{ at: "desc" }, { id: "asc" }],
      include: {
        staff: { select: { name: true } },
        fees: {
          where: { removedAt: null },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      paymentId: s.paymentId,
      orderId: s.orderId,
      channel: SOURCE_OF_PLATFORM[s.channel],
      gross: s.gross,
      fees: s.fees.map((f) => ({
        id: f.id,
        kind: f.kind,
        label: f.label ?? undefined,
        amount: f.amount,
      })),
      received: s.received,
      reason: s.reason ?? undefined,
      at: isoOf(s.at),
      staff: s.staff.name,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Settlement", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("settlements", r.key);
      const data = {
        paymentId: n.paymentId,
        orderId: n.orderId,
        channel: PLATFORM_OF_SOURCE[n.channel],
        gross: n.gross,
        received: n.received,
        reason: blankToNull(n.reason),
        at: instantOf(n.at),
      };
      if (r.base === undefined) {
        await tx.settlement.create({
          data: { id: n.id, ...data, staffId: await ctx.staffFor(n.staff) },
        });
      } else {
        await tx.settlement.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.fees, n.fees)) {
        const existing = await tx.settlementFee.findMany({
          where: { settlementId: n.id },
        });
        const left = new Map(existing.map((f) => [f.id, f]));
        for (const [sortOrder, f] of n.fees.entries()) {
          const fee = {
            kind: f.kind,
            label: blankToNull(f.label),
            amount: f.amount,
            sortOrder,
            removedAt: null,
          };
          if (left.has(f.id)) {
            left.delete(f.id);
            await tx.settlementFee.update({ where: { id: f.id }, data: fee });
          } else {
            await tx.settlementFee.create({
              data: { id: f.id, settlementId: n.id, ...fee },
            });
          }
        }
        for (const f of left.values()) {
          if (f.removedAt === null) {
            await tx.settlementFee.update({
              where: { id: f.id },
              data: { removedAt: ctx.now },
            });
          }
        }
      }
      ctx.touch("settlements", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// The two edit logs — written once
// ---------------------------------------------------------------------------

export const paymentLog: Adapter<"paymentLog"> = {
  collection: "paymentLog",
  async project(tx, _ctx, keys) {
    const rows = await tx.paymentLog.findMany({
      where: byId(keys),
      orderBy: [{ at: "asc" }, { id: "asc" }],
      include: { staff: { select: { name: true } } },
    });
    return rows.map((l) => ({
      id: l.id,
      paymentId: l.paymentId,
      at: isoOf(l.at),
      staff: l.staff.name,
      action: l.action,
      before:
        l.beforeAmount === null
          ? undefined
          : {
              amount: l.beforeAmount,
              state: STATE_OF_PAY_STATUS[l.beforeStatus ?? "LUNAS"],
            },
      after:
        l.afterAmount === null
          ? undefined
          : {
              amount: l.afterAmount,
              state: STATE_OF_PAY_STATUS[l.afterStatus ?? "LUNAS"],
            },
      reason: l.reason ?? undefined,
    }));
  },
  // Inserted only — see `noRowLock`.
  lock: noRowLock,
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("paymentLog", r.key);
      if (r.base !== undefined) throw refuseEdit("paymentLog", r.key);
      const payment = await tx.payment.findUnique({
        where: { id: n.paymentId },
        select: { id: true },
      });
      if (payment === null) {
        // A sale recorded before payments were a list has one IMPLIED payment
        // (`legacyPayments` in lib/salePayments.ts, id `<order>-legacy`). An
        // edit that removed it names a payment no row ever held; the row is
        // written now, already voided, so the log can point at it.
        const orderId = n.paymentId.endsWith("-legacy")
          ? n.paymentId.slice(0, -"-legacy".length)
          : undefined;
        const order =
          orderId === undefined
            ? null
            : await tx.order.findUnique({
                where: { id: orderId },
                select: { id: true, payMethodId: true, total: true },
              });
        if (order === null) {
          throw new StoreValidationError(
            `Pembayaran ${n.paymentId} tidak ditemukan.`,
            "paymentLog",
            n.id,
          );
        }
        const amount = n.before?.amount ?? n.after?.amount ?? order.total;
        await tx.payment.create({
          data: {
            id: n.paymentId,
            orderId: order.id,
            direction: "MASUK",
            methodId: order.payMethodId ?? (await ctx.paymentMethodId("TUNAI")),
            amount: amount > 0n ? amount : 1n,
            status: PAY_STATUS_OF_STATE[n.before?.state ?? "SETTLED"],
            staffId: ctx.staffId,
            recordedAt: ctx.now,
            voidedAt: ctx.now,
          },
        });
      }
      await tx.paymentLog.create({
        data: {
          id: n.id,
          paymentId: n.paymentId,
          at: instantOf(n.at),
          staffId: await ctx.staffFor(n.staff),
          action: n.action,
          beforeAmount: n.before?.amount ?? null,
          beforeStatus:
            n.before === undefined ? null : PAY_STATUS_OF_STATE[n.before.state],
          afterAmount: n.after?.amount ?? null,
          afterStatus:
            n.after === undefined ? null : PAY_STATUS_OF_STATE[n.after.state],
          reason: blankToNull(n.reason),
        },
      });
      ctx.touch("paymentLog", n.id);
    }
  },
};

export const settlementLog: Adapter<"settlementLog"> = {
  collection: "settlementLog",
  async project(tx, _ctx, keys) {
    const rows = await tx.settlementLog.findMany({
      where: byId(keys),
      orderBy: [{ at: "asc" }, { id: "asc" }],
      include: { staff: { select: { name: true } } },
    });
    return rows.map((l) => ({
      id: l.id,
      settlementId: l.settlementId,
      at: isoOf(l.at),
      staff: l.staff.name,
      action: l.action,
      before:
        l.beforeReceived === null
          ? undefined
          : { received: l.beforeReceived, deducted: l.beforeDeducted ?? 0n },
      after:
        l.afterReceived === null
          ? undefined
          : { received: l.afterReceived, deducted: l.afterDeducted ?? 0n },
      reason: l.reason ?? undefined,
    }));
  },
  // Inserted only — see `noRowLock`.
  lock: noRowLock,
  async write(ctx, rows) {
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("settlementLog", r.key);
      if (r.base !== undefined) throw refuseEdit("settlementLog", r.key);
      await ctx.tx.settlementLog.create({
        data: {
          id: n.id,
          settlementId: n.settlementId,
          at: instantOf(n.at),
          staffId: await ctx.staffFor(n.staff),
          action: n.action,
          beforeReceived: n.before?.received ?? null,
          beforeDeducted: n.before?.deducted ?? null,
          afterReceived: n.after?.received ?? null,
          afterDeducted: n.after?.deducted ?? null,
          reason: blankToNull(n.reason),
        },
      });
      ctx.touch("settlementLog", n.id);
    }
  },
};
