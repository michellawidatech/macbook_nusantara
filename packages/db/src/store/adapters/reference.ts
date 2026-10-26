/**
 * The reference lists and the people: payment methods, warehouses and racks,
 * suppliers, the managed lists, salespeople, the knowledge base, customers,
 * discounts, and money typed in by hand.
 *
 * Nothing here is ever removed. Every one of these rows is pointed at by
 * history — a sale names its payment method, an expense its category — so a
 * removal is refused and the page offers "inactive" instead, which is what
 * every one of these screens already does. The exceptions are a discount
 * no sale has redeemed (`removeUnusedDiscount`), a supplier or customer no
 * document names (`removeUnusedSupplier`, `removeUnusedCustomer`), and money
 * typed in by hand (`removeAdjustment`), which nothing points at.
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
      code: r.code,
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
            // The shop's number for it (2026-10-08), printed beside the name
            // on every screen. A warehouse made without one takes its id,
            // which is unique and so satisfies the column's index.
            code: n.code ?? n.id,
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
            ...(n.code === undefined ? {} : { code: n.code }),
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
 * `Customer.openingBalance` is a debt no sale explains, so money paid against
 * one is a `Payment` naming the customer itself (owner answer 2026-09-22) —
 * `Payment_one_parent_check` allows exactly one of order, invoice and
 * customer. The opening figure is never rewritten: what was owed on the day
 * and what has been paid since are two facts, and the page subtracts one from
 * the other.
 *
 * The supplier half of this went on 2026-09-24 with `Supplier.openingBalance`
 * (*"we don't track it anymore"*), and `Payment.supplierId` with it.
 */

type OpeningPayment = NonNullable<
  RowOf<"customers">["openingPayments"]
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
  partyId: string,
  list: readonly OpeningPayment[],
): Promise<void> {
  const { tx } = ctx;
  const collection = "customers" as const;
  const existing = await tx.payment.findMany({
    where: { customerId: partyId },
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
          customerId: partyId,
          // A customer pays the shop — Payment_customer_direction_check holds
          // it to that.
          direction: "MASUK",
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
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.wa ?? undefined,
      // The fixture seed wrote the address into `note` before the column
      // existed; a row written since carries its own.
      address: s.address ?? s.note ?? undefined,
      code: s.code ?? undefined,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Supplier", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await removeUnusedSupplier(ctx, r.key);
        continue;
      }
      const data = {
        name: n.name.trim(),
        wa: blankToNull(n.phone),
        address: blankToNull(n.address),
        code: n.code ?? null,
      };
      if (r.base === undefined) {
        await tx.supplier.create({
          data: { id: n.id, ...data, active: true, createdAt: ctx.now },
        });
      } else {
        await tx.supplier.update({ where: { id: n.id }, data });
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
      if (n === undefined) {
        await removeUnusedCustomer(ctx, r.key);
        continue;
      }
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
        await syncOpeningPayments(ctx, n.id, n.openingPayments ?? []);
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
      if (n === undefined) {
        await removeUnusedDiscount(ctx, r.key);
        continue;
      }
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

/**
 * The one removal in this file (owner decision 2026-10-02): a discount no sale
 * has redeemed is deleted outright, because it is litter rather than history —
 * nothing points at it but its own SKU list. One that has been used is refused
 * and stays switchable off, since a receipt names it. Both tests read the
 * DATABASE, not the browser's copy: a till may have redeemed the code since
 * this page loaded. `Order.discountId` is ON DELETE RESTRICT besides, so a
 * redemption racing this commit fails the DELETE rather than orphaning a sale.
 */
async function removeUnusedDiscount(
  ctx: WriteContext,
  id: string,
): Promise<void> {
  const { tx } = ctx;
  const row = await tx.discount.findUnique({
    where: { id },
    select: { used: true, _count: { select: { orders: true } } },
  });
  if (row === null) return;
  if (row.used > 0 || row._count.orders > 0) {
    throw new StoreValidationError(
      `Diskon ini sudah dipakai di penjualan dan tidak bisa dihapus — nonaktifkan saja (discounts ${id}).`,
      "discounts",
      id,
    );
  }
  await tx.discountSku.deleteMany({ where: { discountId: id } });
  await tx.discount.delete({ where: { id } });
  ctx.touch("discounts", id);
}

/**
 * A supplier or customer no document names can be deleted outright (owner
 * decision 2026-10-21: "hard delete it as long as there are no transaction
 * linked"). Same footing as `removeUnusedDiscount`: the counts are read from
 * the DATABASE, and every link is ON DELETE RESTRICT, so a document written
 * by another till in the meantime fails the DELETE instead of orphaning.
 */
async function removeUnusedSupplier(
  ctx: WriteContext,
  id: string,
): Promise<void> {
  const { tx } = ctx;
  const row = await tx.supplier.findUnique({
    where: { id },
    select: {
      _count: {
        select: {
          purchaseOrders: true,
          supplierReturns: true,
          warrantyClaims: true,
          unitReturns: true,
          deposits: true,
        },
      },
    },
  });
  if (row === null) return;
  if (Object.values(row._count).some((n) => n > 0)) {
    throw new StoreValidationError(
      `Supplier ini punya transaksi dan tidak bisa dihapus (suppliers ${id}).`,
      "suppliers",
      id,
    );
  }
  await tx.supplier.delete({ where: { id } });
  ctx.touch("suppliers", id);
}

/**
 * A chat thread counts as a link too: the inbox's history names the person,
 * and the chatbot's rows are the agent role's to write, not this one's.
 * Saved addresses are the customer's own and go with it.
 */
async function removeUnusedCustomer(
  ctx: WriteContext,
  id: string,
): Promise<void> {
  const { tx } = ctx;
  const row = await tx.customer.findUnique({
    where: { id },
    select: {
      openingBalance: true,
      _count: {
        select: {
          orders: true,
          reservations: true,
          openingPayments: true,
          waMessages: true,
          waThreadMemories: true,
          chatActions: true,
          chatProfiles: true,
        },
      },
    },
  });
  if (row === null) return;
  if (
    (row.openingBalance ?? 0n) !== 0n ||
    Object.values(row._count).some((n) => n > 0)
  ) {
    throw new StoreValidationError(
      `Pelanggan ini punya transaksi atau percakapan dan tidak bisa dihapus (customers ${id}).`,
      "customers",
      id,
    );
  }
  await tx.customerAddress.deleteMany({ where: { customerId: id } });
  await tx.customer.delete({ where: { id } });
  ctx.touch("customers", id);
}

// ---------------------------------------------------------------------------
// Money typed in by hand
// ---------------------------------------------------------------------------

/**
 * An adjustment typed into Income & Expense can be deleted (owner ask
 * 2026-10-24: "we should be able to delete the income expense adjustment").
 * No foreign key points at `Expense` or `ManualIncome`, so nothing is
 * orphaned; what IS checked here is the book close — a day inside a closed
 * month keeps its adjustments, as it keeps its finished sales, and the browser
 * asks the same (`lib/adjustmentDeletion.ts`). A cash ↔ bank move arrives as
 * both halves in one changeset, because the browser removes both.
 */
async function removeAdjustment(
  ctx: WriteContext,
  collection: "expenses" | "incomes",
  id: string,
): Promise<void> {
  const { tx } = ctx;
  const row =
    collection === "expenses"
      ? await tx.expense.findUnique({ where: { id }, select: { date: true } })
      : await tx.manualIncome.findUnique({
          where: { id },
          select: { date: true },
        });
  if (row === null) return;
  const closed = await tx.appSetting.findUnique({
    where: { key: "finance.booksClosedAt" },
    select: { value: true },
  });
  if (closed && closed.value.trim() !== "") {
    const until = new Date(closed.value);
    // `date` is a Jakarta day; it is inside the close when its first instant is.
    const starts = new Date(`${row.date}T00:00:00+07:00`);
    if (!Number.isNaN(until.getTime()) && starts <= until) {
      throw new StoreValidationError(
        `Bukunya sudah ditutup untuk tanggal ${row.date}; penyesuaian ini tidak bisa dihapus (${collection} ${id}).`,
        collection,
        id,
      );
    }
  }
  if (collection === "expenses") await tx.expense.delete({ where: { id } });
  else await tx.manualIncome.delete({ where: { id } });
  ctx.touch(collection, id);
}

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
      serviceFeeId: e.serviceFeeId ?? undefined,
      createdAt: isoOf(e.createdAt),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Expense", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await removeAdjustment(ctx, "expenses", r.key);
        continue;
      }
      const data = {
        label: blankToNull(n.label),
        kind: n.kind,
        amount: n.amount,
        date: n.date,
        note: blankToNull(n.note),
        referralSourceId: n.referralSourceId ?? null,
        methodId: await ctx.paymentMethodId(n.method),
        orderId: n.orderId ?? null,
        serviceFeeId: n.serviceFeeId ?? null,
      };
      if (n.serviceFeeId !== undefined) {
        // One expense per charge (`Expense.serviceFeeId` is unique): say so
        // in words rather than as a unique violation.
        const other = await tx.expense.findFirst({
          where: { serviceFeeId: n.serviceFeeId, id: { not: n.id } },
          select: { id: true },
        });
        if (other !== null) {
          throw new StoreValidationError(
            "Biaya servis ini sudah dibayar oleh pengeluaran lain.",
            "expenses",
            n.id,
          );
        }
      }
      if (r.base === undefined) {
        await tx.expense.create({
          data: {
            id: n.id,
            ...data,
            staffId: ctx.staffId,
            // The till's clock when it sent one: it is what ordered the row
            // on screen, and it orders nothing but a day's typed rows.
            createdAt: n.createdAt ? new Date(n.createdAt) : ctx.now,
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
      returnId: i.unitReturnId ?? undefined,
      createdAt: isoOf(i.createdAt),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "ManualIncome", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        await removeAdjustment(ctx, "incomes", r.key);
        continue;
      }
      const data = {
        reason: n.reason,
        amount: n.amount,
        date: n.date,
        note: blankToNull(n.note),
        methodId: await ctx.paymentMethodId(n.method),
        orderId: n.orderId ?? null,
        // A `returns` row's id; returns are written before incomes.
        unitReturnId: n.returnId ?? null,
      };
      if (r.base === undefined) {
        await tx.manualIncome.create({
          data: {
            id: n.id,
            ...data,
            staffId: ctx.staffId,
            createdAt: n.createdAt ? new Date(n.createdAt) : ctx.now,
          },
        });
      } else {
        await tx.manualIncome.update({ where: { id: n.id }, data });
      }
      ctx.touch("incomes", n.id);
    }
  },
};
