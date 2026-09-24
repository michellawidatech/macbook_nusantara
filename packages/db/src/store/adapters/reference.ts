/**
 * The reference lists and the people: payment methods, warehouses and racks,
 * suppliers, the managed lists, salespeople, the knowledge base, customers,
 * discounts, and money typed in by hand.
 *
 * Nothing here is ever removed. Every one of these rows is pointed at by
 * history — a sale names its payment method, an expense its category — so a
 * removal is refused and the page offers "inactive" instead, which is what
 * every one of these screens already does.
 */
import { deepEqual } from "@nusantara/store";
import type { Tx } from "../../client.js";
import type { DiscScope } from "../../../generated/client/index.js";
import { StoreValidationError } from "../errors.js";
import {
  type Adapter,
  type RowOf,
  type WriteContext,
  blankToNull,
  dateOfDay,
  dayOf,
  indexIn,
  instantOf,
  isoOf,
  lockRows,
  optionalIso,
  refuseRemoval,
} from "../context.js";

const byId = (keys?: readonly string[]) =>
  keys === undefined ? {} : { id: { in: [...keys] } };

const after = (max: number | null | undefined): number => (max ?? -1) + 1;

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export const paymentMethods: Adapter<"paymentMethods"> = {
  collection: "paymentMethods",
  async project(tx, _ctx, keys) {
    const rows = await tx.paymentMethod.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      builtIn: r.builtIn,
      forPo: r.forPo,
      forSale: r.forSale,
      active: r.active,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "PaymentMethod", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("paymentMethods", r.key);
      const data = {
        code: n.code,
        label: n.label,
        builtIn: n.builtIn,
        forPo: n.forPo,
        forSale: n.forSale,
        active: n.active,
      };
      if (r.base === undefined) {
        const max = await tx.paymentMethod.aggregate({
          _max: { sortOrder: true },
        });
        await tx.paymentMethod.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.paymentMethod.update({ where: { id: n.id }, data });
      }
      ctx.touch("paymentMethods", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.paymentMethod.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("paymentMethods", id);
    }
  },
};

// ---------------------------------------------------------------------------
// Warehouses and racks
// ---------------------------------------------------------------------------

export const warehouses: Adapter<"warehouses"> = {
  collection: "warehouses",
  async project(tx, _ctx, keys) {
    const rows = await tx.location.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      kind: r.kind,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Location", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("warehouses", r.key);
      if (r.base === undefined) {
        const max = await tx.location.aggregate({ _max: { sortOrder: true } });
        await tx.location.create({
          data: {
            id: n.id,
            // `code` is unique and printed on nothing the browser shows; the
            // id is already unique, so it serves.
            code: n.id,
            name: n.name,
            kind: n.kind ?? "GUDANG",
            active: n.active,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
          },
        });
      } else {
        await tx.location.update({
          where: { id: n.id },
          data: {
            name: n.name,
            active: n.active,
            ...(n.kind === undefined ? {} : { kind: n.kind }),
          },
        });
      }
      ctx.touch("warehouses", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.location.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("warehouses", id);
    }
  },
};

export const racks: Adapter<"racks"> = {
  collection: "racks",
  async project(tx, _ctx, keys) {
    const rows = await tx.rack.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      warehouseId: r.locationId,
      name: r.name,
      active: r.active,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Rack", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("racks", r.key);
      const data = {
        locationId: n.warehouseId,
        name: n.name,
        active: n.active,
      };
      if (r.base === undefined) {
        const max = await tx.rack.aggregate({ _max: { sortOrder: true } });
        await tx.rack.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.rack.update({ where: { id: n.id }, data });
      }
      ctx.touch("racks", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.rack.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("racks", id);
    }
  },
};

// ---------------------------------------------------------------------------
// Payments against a debt from before this app
// ---------------------------------------------------------------------------

/*
 * `Supplier.openingBalance` and `Customer.openingBalance` are debts no invoice
 * or sale explains, so money paid against one is a `Payment` naming the party
 * itself (owner answer 2026-09-22) — `Payment_one_parent_check` allows exactly
 * one of order, invoice, supplier and customer. The opening figure is never
 * rewritten: what was owed on the day and what has been paid since are two
 * facts, and the page subtracts one from the other.
 */

type OpeningPayment = NonNullable<
  RowOf<"suppliers">["openingPayments"]
>[number];

/** The rows `openingPaymentsOf` reads — `include` them on the party. */
const OPENING_PAYMENTS = {
  where: { voidedAt: null },
  orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
  include: { method: { select: { code: true } } },
};

function openingPaymentsOf(
  rows: readonly {
    id: string;
    amount: bigint;
    paidAt: Date | null;
    recordedAt: Date | null;
    note: string | null;
    inBalance: boolean;
    method: { code: string };
  }[],
  fallbackAt: Date,
): OpeningPayment[] | undefined {
  // Absent, not [], when there are none: that is what the browser holds for a
  // party nobody has paid, and anything else would diff on every poll.
  if (rows.length === 0) return undefined;
  return rows.map((p) => ({
    id: p.id,
    method: p.method.code,
    amount: p.amount,
    at: isoOf(p.recordedAt ?? p.paidAt ?? fallbackAt),
    note: p.note ?? undefined,
    // Only a `false` is said; true is the absent key.
    inBalance: p.inBalance ? undefined : false,
  }));
}

/**
 * Synced by key like an invoice's payments (`syncPoPayments`): updated where
 * the row exists, created where it does not, voided — never deleted — where
 * the browser dropped it, because the payment log may still name it.
 */
async function syncOpeningPayments(
  ctx: WriteContext,
  collection: "suppliers" | "customers",
  partyId: string,
  list: readonly OpeningPayment[],
): Promise<void> {
  const { tx } = ctx;
  const supplier = collection === "suppliers";
  const existing = await tx.payment.findMany({
    where: supplier ? { supplierId: partyId } : { customerId: partyId },
    select: { id: true, voidedAt: true },
  });
  const left = new Map(existing.map((p) => [p.id, p]));
  for (const [sortOrder, p] of list.entries()) {
    if (p.amount <= 0n) {
      throw new StoreValidationError(
        "Pembayaran harus lebih dari nol.",
        collection,
        partyId,
      );
    }
    const at = instantOf(p.at);
    const data = {
      methodId: await ctx.paymentMethodId(p.method),
      amount: p.amount,
      status: "LUNAS" as const,
      paidAt: at,
      recordedAt: at,
      note: blankToNull(p.note),
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
          supplierId: supplier ? partyId : null,
          customerId: supplier ? null : partyId,
          // The shop pays a supplier and is paid by a customer — the CHECKs
          // Payment_supplier_direction_check / _customer_ hold it to that.
          direction: supplier ? "KELUAR" : "MASUK",
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

/** Whether a party's opening payments need writing at all. */
const openingPaymentsChanged = (
  base: { openingPayments?: readonly OpeningPayment[] } | undefined,
  next: { openingPayments?: readonly OpeningPayment[] },
): boolean =>
  base === undefined
    ? (next.openingPayments?.length ?? 0) > 0
    : !deepEqual(base.openingPayments, next.openingPayments);

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const suppliers: Adapter<"suppliers"> = {
  collection: "suppliers",
  async project(tx, _ctx, keys) {
    const rows = await tx.supplier.findMany({
      where: byId(keys),
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
      include: { openingPayments: OPENING_PAYMENTS },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.wa ?? undefined,
      // The fixture seed wrote the address into `note` before the column
      // existed; a row written since carries its own.
      address: s.address ?? s.note ?? undefined,
      code: s.code ?? undefined,
      openingBalance: s.openingBalance ?? undefined,
      openingBalanceAt: optionalIso(s.openingBalanceAt),
      openingPayments: openingPaymentsOf(
        s.openingPayments,
        s.openingBalanceAt ?? s.createdAt,
      ),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Supplier", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("suppliers", r.key);
      const data = {
        name: n.name.trim(),
        wa: blankToNull(n.phone),
        address: blankToNull(n.address),
        code: n.code ?? null,
        openingBalance: n.openingBalance ?? null,
        openingBalanceAt:
          n.openingBalanceAt === undefined
            ? null
            : instantOf(n.openingBalanceAt),
      };
      if (r.base === undefined) {
        await tx.supplier.create({
          data: { id: n.id, ...data, active: true, createdAt: ctx.now },
        });
      } else {
        await tx.supplier.update({ where: { id: n.id }, data });
      }
      // After the supplier row, which a new payment's foreign key names.
      if (openingPaymentsChanged(r.base, n)) {
        await syncOpeningPayments(
          ctx,
          "suppliers",
          n.id,
          n.openingPayments ?? [],
        );
      }
      ctx.touch("suppliers", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// The managed lists
// ---------------------------------------------------------------------------

export const reasons: Adapter<"reasons"> = {
  collection: "reasons",
  async project(tx, _ctx, keys) {
    const rows = await tx.reason.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({
      id: r.id,
      activity: r.activity,
      label: r.label,
      active: r.active,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Reason", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("reasons", r.key);
      const data = {
        activity: n.activity,
        label: n.label.trim(),
        active: n.active,
      };
      if (r.base === undefined) {
        const max = await tx.reason.aggregate({ _max: { sortOrder: true } });
        await tx.reason.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.reason.update({ where: { id: n.id }, data });
      }
      ctx.touch("reasons", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.reason.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("reasons", id);
    }
  },
};

export const qcDescriptions: Adapter<"qcDescriptions"> = {
  collection: "qcDescriptions",
  async project(tx, _ctx, keys) {
    const rows = await tx.qcDescription.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({ id: r.id, label: r.label, active: r.active }));
  },
  lock: (tx, keys) => lockRows(tx, "QcDescription", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("qcDescriptions", r.key);
      const data = { label: n.label.trim(), active: n.active };
      if (r.base === undefined) {
        const max = await tx.qcDescription.aggregate({
          _max: { sortOrder: true },
        });
        await tx.qcDescription.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.qcDescription.update({ where: { id: n.id }, data });
      }
      ctx.touch("qcDescriptions", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.qcDescription.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("qcDescriptions", id);
    }
  },
};

export const reservationSources: Adapter<"reservationSources"> = {
  collection: "reservationSources",
  async project(tx, _ctx, keys) {
    const rows = await tx.reservationSource.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));
  },
  lock: (tx, keys) => lockRows(tx, "ReservationSource", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("reservationSources", r.key);
      const data = { name: n.name.trim(), active: n.active };
      if (r.base === undefined) {
        const max = await tx.reservationSource.aggregate({
          _max: { sortOrder: true },
        });
        await tx.reservationSource.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.reservationSource.update({ where: { id: n.id }, data });
      }
      ctx.touch("reservationSources", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.reservationSource.updateMany({
        where: { id },
        data: { sortOrder },
      });
      ctx.touch("reservationSources", id);
    }
  },
};

export const referralSources: Adapter<"referralSources"> = {
  collection: "referralSources",
  async project(tx, _ctx, keys) {
    const rows = await tx.referralSource.findMany({
      where: byId(keys),
      orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));
  },
  lock: (tx, keys) => lockRows(tx, "ReferralSource", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("referralSources", r.key);
      const data = { name: n.name.trim(), active: n.active };
      if (r.base === undefined) {
        await tx.referralSource.create({
          data: { id: n.id, ...data, createdAt: ctx.now },
        });
      } else {
        await tx.referralSource.update({ where: { id: n.id }, data });
      }
      ctx.touch("referralSources", n.id);
    }
  },
};

export const salesmen: Adapter<"salesmen"> = {
  collection: "salesmen",
  async project(tx, _ctx, keys) {
    const rows = await tx.salesperson.findMany({
      where: byId(keys),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active }));
  },
  lock: (tx, keys) => lockRows(tx, "Salesperson", "id", keys),
  async write(ctx, rows, order) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("salesmen", r.key);
      const data = { name: n.name.trim(), active: n.active };
      if (r.base === undefined) {
        const max = await tx.salesperson.aggregate({
          _max: { sortOrder: true },
        });
        await tx.salesperson.create({
          data: {
            id: n.id,
            ...data,
            sortOrder: indexIn(order, n.id) ?? after(max._max.sortOrder),
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.salesperson.update({ where: { id: n.id }, data });
      }
      ctx.touch("salesmen", n.id);
    }
    for (const [sortOrder, id] of (order ?? []).entries()) {
      await tx.salesperson.updateMany({ where: { id }, data: { sortOrder } });
      ctx.touch("salesmen", id);
    }
  },
};

// ---------------------------------------------------------------------------
// The knowledge base
// ---------------------------------------------------------------------------

export const knowledge: Adapter<"knowledge"> = {
  collection: "knowledge",
  async project(tx, _ctx, keys) {
    const rows = await tx.agentKnowledge.findMany({
      where: byId(keys),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return rows.map((k) => ({
      id: k.id,
      question: k.question,
      answer: k.answer,
      active: k.active,
      updatedAt: isoOf(k.updatedAt),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "AgentKnowledge", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("knowledge", r.key);
      const data = {
        question: n.question,
        answer: n.answer,
        active: n.active,
        updatedAt: instantOf(n.updatedAt),
      };
      if (r.base === undefined) {
        await tx.agentKnowledge.create({
          data: {
            id: n.id,
            ...data,
            createdById: ctx.staffId,
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.agentKnowledge.update({ where: { id: n.id }, data });
      }
      ctx.touch("knowledge", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

type Address = NonNullable<RowOf<"customers">["addresses"]>[number];

async function syncAddresses(
  ctx: WriteContext,
  customerId: string,
  list: readonly Address[],
): Promise<void> {
  const { tx } = ctx;
  const existing = await tx.customerAddress.findMany({ where: { customerId } });
  const left = new Map(existing.map((a) => [a.id, a]));
  for (const [sortOrder, a] of list.entries()) {
    const data = {
      label: a.label ?? null,
      line: a.line,
      sortOrder,
      removedAt: null,
    };
    if (left.has(a.id)) {
      await tx.customerAddress.update({ where: { id: a.id }, data });
      left.delete(a.id);
    } else {
      await tx.customerAddress.create({
        data: { id: a.id, customerId, ...data, createdAt: ctx.now },
      });
    }
  }
  for (const a of left.values()) {
    if (a.removedAt === null) {
      await tx.customerAddress.update({
        where: { id: a.id },
        data: { removedAt: ctx.now },
      });
    }
  }
}

export const customers: Adapter<"customers"> = {
  collection: "customers",
  async project(tx, _ctx, keys) {
    const rows = await tx.customer.findMany({
      where: byId(keys),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        addresses: {
          where: { removedAt: null },
          orderBy: { sortOrder: "asc" },
        },
        openingPayments: OPENING_PAYMENTS,
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      address: c.street ?? undefined,
      addresses:
        c.addresses.length === 0
          ? undefined
          : c.addresses.map((a) => ({
              id: a.id,
              label: a.label ?? undefined,
              line: a.line,
            })),
      referralSourceId: c.referralSourceId ?? undefined,
      createdAt: isoOf(c.createdAt),
      openingBalance: c.openingBalance ?? undefined,
      openingBalanceAt: optionalIso(c.openingBalanceAt),
      openingPayments: openingPaymentsOf(
        c.openingPayments,
        c.openingBalanceAt ?? c.createdAt,
      ),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Customer", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("customers", r.key);
      const data = {
        name: n.name.trim(),
        phone: blankToNull(n.phone),
        street: blankToNull(n.address),
        referralSourceId: n.referralSourceId ?? null,
        openingBalance: n.openingBalance ?? null,
        openingBalanceAt:
          n.openingBalanceAt === undefined
            ? null
            : instantOf(n.openingBalanceAt),
      };
      if (r.base === undefined) {
        await tx.customer.create({
          data: { id: n.id, ...data, createdAt: instantOf(n.createdAt) },
        });
      } else {
        await tx.customer.update({ where: { id: n.id }, data });
      }
      if (r.base === undefined || !deepEqual(r.base.addresses, n.addresses)) {
        await syncAddresses(ctx, n.id, n.addresses ?? []);
      }
      if (openingPaymentsChanged(r.base, n)) {
        await syncOpeningPayments(
          ctx,
          "customers",
          n.id,
          n.openingPayments ?? [],
        );
      }
      ctx.touch("customers", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

/** The label every page uses for a discount that applies to everything. */
export const ALL_PRODUCTS = "All products";

async function scopeOf(
  tx: Tx,
  label: string,
): Promise<{
  scope: DiscScope;
  categoryId: string | null;
  modelId: string | null;
}> {
  const clean = label.trim();
  if (clean === "" || clean === ALL_PRODUCTS) {
    return { scope: "SEMUA", categoryId: null, modelId: null };
  }
  const category = await tx.category.findUnique({
    where: { name: clean },
    select: { id: true },
  });
  if (category !== null) {
    return { scope: "KATEGORI", categoryId: category.id, modelId: null };
  }
  const model = await tx.catalogModel.findFirst({
    where: { name: clean, archived: false },
    select: { id: true },
  });
  if (model !== null) {
    return { scope: "PRODUK", categoryId: null, modelId: model.id };
  }
  throw new StoreValidationError(
    `Diskon berlaku untuk "${clean}", yang bukan kategori maupun model.`,
    "discounts",
  );
}

export const discounts: Adapter<"discounts"> = {
  collection: "discounts",
  async project(tx, _ctx, keys) {
    const rows = await tx.discount.findMany({
      where: byId(keys),
      orderBy: { id: "asc" },
      include: {
        category: { select: { name: true } },
        model: { select: { name: true } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.description ?? "",
      type: d.type,
      pct: d.pct ?? undefined,
      amountRp: d.amountRp ?? undefined,
      maxRp: d.maxRp ?? undefined,
      bundleQty: d.bundleQty ?? undefined,
      bundlePriceRp: d.bundlePriceRp ?? undefined,
      usageLimit: d.usageLimit ?? undefined,
      used: d.used,
      fromDate: d.fromDate === null ? undefined : dayOf(d.fromDate),
      toDate: d.toDate === null ? undefined : dayOf(d.toDate),
      active: d.active,
      scope:
        d.scope === "KATEGORI"
          ? (d.category?.name ?? ALL_PRODUCTS)
          : d.scope === "PRODUK"
            ? (d.model?.name ?? ALL_PRODUCTS)
            : ALL_PRODUCTS,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Discount", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("discounts", r.key);
      const data = {
        code: n.code,
        description: n.name,
        type: n.type,
        pct: n.type === "PCT" ? (n.pct ?? null) : null,
        amountRp: n.type === "NOMINAL" ? (n.amountRp ?? null) : null,
        maxRp: n.type === "PCT" ? (n.maxRp ?? null) : null,
        bundleQty: n.type === "BUNDLE" ? (n.bundleQty ?? null) : null,
        bundlePriceRp: n.type === "BUNDLE" ? (n.bundlePriceRp ?? null) : null,
        usageLimit: n.usageLimit ?? null,
        used: n.used,
        fromDate: n.fromDate === undefined ? null : dateOfDay(n.fromDate),
        toDate: n.toDate === undefined ? null : dateOfDay(n.toDate),
        active: n.active,
        ...(await scopeOf(tx, n.scope)),
      };
      if (r.base === undefined) {
        await tx.discount.create({ data: { id: n.id, ...data } });
      } else {
        await tx.discount.update({ where: { id: n.id }, data });
      }
      ctx.touch("discounts", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Money typed in by hand
// ---------------------------------------------------------------------------

export const expenses: Adapter<"expenses"> = {
  collection: "expenses",
  async project(tx, _ctx, keys) {
    const rows = await tx.expense.findMany({
      where: byId(keys),
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { method: { select: { code: true } } },
    });
    return rows.map((e) => ({
      id: e.id,
      label: e.label ?? undefined,
      kind: e.kind,
      amount: e.amount,
      date: e.date,
      note: e.note ?? undefined,
      referralSourceId: e.referralSourceId ?? undefined,
      method: e.method.code,
      orderId: e.orderId ?? undefined,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Expense", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("expenses", r.key);
      const data = {
        label: blankToNull(n.label),
        kind: n.kind,
        amount: n.amount,
        date: n.date,
        note: blankToNull(n.note),
        referralSourceId: n.referralSourceId ?? null,
        methodId: await ctx.paymentMethodId(n.method),
        orderId: n.orderId ?? null,
      };
      if (r.base === undefined) {
        await tx.expense.create({
          data: {
            id: n.id,
            ...data,
            staffId: ctx.staffId,
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.expense.update({ where: { id: n.id }, data });
      }
      ctx.touch("expenses", n.id);
    }
  },
};

export const incomes: Adapter<"incomes"> = {
  collection: "incomes",
  async project(tx, _ctx, keys) {
    const rows = await tx.manualIncome.findMany({
      where: byId(keys),
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { method: { select: { code: true } } },
    });
    return rows.map((i) => ({
      id: i.id,
      reason: i.reason,
      amount: i.amount,
      date: i.date,
      note: i.note ?? undefined,
      method: i.method.code,
      orderId: i.orderId ?? undefined,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "ManualIncome", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("incomes", r.key);
      const data = {
        reason: n.reason,
        amount: n.amount,
        date: n.date,
        note: blankToNull(n.note),
        methodId: await ctx.paymentMethodId(n.method),
        orderId: n.orderId ?? null,
      };
      if (r.base === undefined) {
        await tx.manualIncome.create({
          data: {
            id: n.id,
            ...data,
            staffId: ctx.staffId,
            createdAt: ctx.now,
          },
        });
      } else {
        await tx.manualIncome.update({ where: { id: n.id }, data });
      }
      ctx.touch("incomes", n.id);
    }
  },
};
