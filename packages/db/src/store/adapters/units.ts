/**
 * The machines and everything written about them: units, the ledger, notes and
 * their photographs, QC decisions and stock adjustments.
 *
 * ## The ledger rules this file enforces
 *
 * CLAUDE.md's first rule is that every state change of a unit is an
 * append-only `UnitEvent`, and that `Unit.status` and `Unit.locationId` are its
 * projection, written in the same transaction. The browser writes both — an
 * event and the unit it moved — and this file refuses anything that would make
 * the two disagree:
 *
 * - an event is NEW, with two exceptions the owner decided on 2026-09-23 and
 *   nothing else: its `serial` may follow its unit to a corrected serial
 *   (`renameEvents` — that column alone, and only onto the unit that holds
 *   the row), and a unit's rows may be taken back (`removeEvents` — any
 *   row since 2026-10-22, never the last one standing, never the sold row of
 *   a sale that still has the unit on it). The database holds the same line:
 *   `nusantara_app` may UPDATE `UnitEvent.serial` and no other column, and
 *   its one door to a DELETE is `unit_event_drop`, which refuses to empty a
 *   unit (migration 20261022140000);
 * - events are continuous: `seq` is the previous plus one, and `fromStatus`
 *   is the status the previous event left;
 * - the commit then checks each unit row against where its ledger now leaves
 *   it (`WriteContext.ledgerAfter`).
 *
 * What it does NOT check is whether an arrow is legal in
 * `packages/domain/unitState.ts` — see docs/store-on-postgres.md, "What is
 * still not enforced".
 *
 * ## A unit removed at intake
 *
 * The Inbound & QC grid can remove a serial row typed by mistake. That unit is
 * not deleted: it is archived, a `DIARSIPKAN` event says who removed it, and
 * its serial is moved aside (`SC02…~ARSIP~<time>`) so the same machine can be
 * typed in again. Projection leaves archived units and their history out.
 *
 * ## A serial corrected
 *
 * The browser keys a unit by its serial, so a correction arrives as the old
 * row removed and a new one inserted. The ledger rows that travel with it say
 * it is one unit (`WriteContext.serialRenames`), and that unit is renamed in
 * PLACE — same `Unit.id`, its notes and its invoice line following — never
 * archived and minted again, which would strand its history on a unit that
 * no longer exists and then refuse to move it. ⚠️ That is exactly what
 * happened from 2026-09-23 to 2026-09-24, behind a gate in `commit.ts` that
 * refused the renamed rows first: every serial correction was "Not saved".
 */
import { newestRowOwnedByDocument } from "@nusantara/domain";
import { deepEqual } from "@nusantara/store";
import type { Prisma, Tx } from "../../client.js";
import { StoreValidationError } from "../errors.js";
import {
  type Adapter,
  type RowOf,
  type RowWrite,
  type WriteContext,
  blankToNull,
  instantOf,
  isoOf,
  lockRows,
  noRowLock,
  refuseEdit,
  refuseRemoval,
  sameApartFrom,
} from "../context.js";

const byId = (keys?: readonly string[]) =>
  keys === undefined ? {} : { id: { in: [...keys] } };

const QC_TAG = "QC";

/** The three battery readings, as `CategoryAttribute` keys (CLAUDE.md 2026-09-08). */
const BATTERY_KEYS = {
  baterai: { label: "Baterai", unit: "%" },
  siklus: { label: "Siklus", unit: "siklus" },
  kapasitas: { label: "Kapasitas", unit: "mAh" },
} as const;

type BatteryKey = keyof typeof BATTERY_KEYS;

const whole = (n: number | undefined): number | null =>
  n === undefined ? null : Math.round(n);

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

async function batteryAttributeIds(
  ctx: WriteContext,
  skuId: string,
): Promise<{ categoryId: string; ids: Record<BatteryKey, string> }> {
  const { tx } = ctx;
  const sku = await tx.sku.findUnique({
    where: { id: skuId },
    select: { model: { select: { categoryId: true } } },
  });
  if (sku === null) {
    throw new StoreValidationError(
      `Varian ${skuId} tidak ditemukan.`,
      "skus",
      skuId,
    );
  }
  const categoryId = sku.model.categoryId;
  const memoKey = `battery:${categoryId}`;
  const cached = ctx.memo.get(memoKey) as
    Record<BatteryKey, string> | undefined;
  if (cached !== undefined) return { categoryId, ids: cached };

  const existing = await tx.categoryAttribute.findMany({
    where: { categoryId, key: { in: Object.keys(BATTERY_KEYS) } },
    select: { id: true, key: true },
  });
  const ids = Object.fromEntries(existing.map((a) => [a.key, a.id])) as Partial<
    Record<BatteryKey, string>
  >;
  const max = await tx.categoryAttribute.aggregate({
    where: { categoryId },
    _max: { sortOrder: true },
  });
  let next = (max._max.sortOrder ?? 0) + 1;
  for (const [key, spec] of Object.entries(BATTERY_KEYS) as [
    BatteryKey,
    (typeof BATTERY_KEYS)[BatteryKey],
  ][]) {
    if (ids[key] !== undefined) continue;
    const created = await tx.categoryAttribute.create({
      data: {
        categoryId,
        key,
        label: spec.label,
        type: "NUMBER",
        unit: spec.unit,
        sortOrder: next,
      },
      select: { id: true },
    });
    next += 1;
    ids[key] = created.id;
  }
  const full = ids as Record<BatteryKey, string>;
  ctx.memo.set(memoKey, full);
  return { categoryId, ids: full };
}

async function syncBattery(
  ctx: WriteContext,
  unitId: string,
  skuId: string,
  readings: Record<BatteryKey, number | undefined>,
): Promise<void> {
  const { tx } = ctx;
  const { categoryId, ids } = await batteryAttributeIds(ctx, skuId);
  for (const key of Object.keys(BATTERY_KEYS) as BatteryKey[]) {
    const value = readings[key];
    const attributeId = ids[key];
    if (value === undefined) {
      await tx.unitAttribute.updateMany({
        where: { unitId, attributeId, NOT: { value: "" } },
        data: { value: "" },
      });
    } else {
      await tx.unitAttribute.upsert({
        where: { unitId_attributeId: { unitId, attributeId } },
        create: { unitId, attributeId, value: String(value) },
        update: { value: String(value) },
      });
    }
  }
  // A machine re-assigned to a product of another category leaves readings
  // under the old category's attributes; they would shadow the new ones.
  await tx.unitAttribute.updateMany({
    where: {
      unitId,
      attribute: {
        key: { in: Object.keys(BATTERY_KEYS) },
        NOT: { categoryId },
      },
      NOT: { value: "" },
    },
    data: { value: "" },
  });
}

async function archiveUnit(ctx: WriteContext, serial: string): Promise<void> {
  const { tx } = ctx;
  const unit = await tx.unit.findFirst({
    where: { serial, archivedAt: null },
    select: {
      id: true,
      status: true,
      _count: { select: { orderItems: true, reservationItems: true } },
    },
  });
  if (unit === null) return;
  if (
    unit.status !== "QC" ||
    unit._count.orderItems > 0 ||
    unit._count.reservationItems > 0
  ) {
    throw new StoreValidationError(
      `Unit ${serial} sudah punya riwayat di luar QC — tidak bisa dihapus.`,
      "units",
      serial,
    );
  }
  const last = await tx.unitEvent.findFirst({
    where: { unitId: unit.id },
    orderBy: { seq: "desc" },
    select: { seq: true, toStatus: true, id: true },
  });
  await tx.unitEvent.create({
    data: {
      unitId: unit.id,
      serial,
      seq: (last?.seq ?? 0) + 1,
      type: "DIARSIPKAN",
      at: ctx.now,
      fromStatus: last?.toStatus ?? null,
      toStatus: last?.toStatus ?? unit.status,
      costDelta: 0n,
      staffId: ctx.staffId,
      note: "Dihapus dari daftar QC",
    },
  });
  await tx.unit.update({
    where: { id: unit.id },
    data: {
      archivedAt: ctx.now,
      serial: `${serial}~ARSIP~${ctx.now.getTime()}`,
      version: { increment: 1 },
    },
  });
  // Every event of it leaves the projection; tell the other tills.
  const events = await tx.unitEvent.findMany({
    where: { unitId: unit.id },
    select: { id: true },
  });
  for (const e of events) ctx.touch("events", e.id);
  ctx.archivedSerials.add(serial);
  ctx.rememberUnit(serial, null);
  ctx.touch("units", serial);
}

/**
 * Rename a unit in place: the same row, the same id, under a corrected serial
 * (owner decision 2026-09-23). Every copy of the serial the database keeps
 * beside the unit's own follows it here — its notes and the invoice line it
 * came in on; its ledger rows arrive renamed in the same changeset and the
 * events adapter carries them (`renameEvents`). Rows that name the unit by
 * id — its intake decision, its adjustments — read the new serial by
 * themselves and are touched so every till redraws them.
 */
async function renameUnit(
  ctx: WriteContext,
  from: string,
  to: string,
  data: Prisma.UnitUncheckedUpdateInput,
): Promise<string> {
  const { tx } = ctx;
  const unit = await tx.unit.findFirst({
    where: { serial: from, archivedAt: null },
    select: { id: true },
  });
  if (unit === null) {
    throw new StoreValidationError(
      `Unit ${from} tidak ditemukan.`,
      "units",
      from,
    );
  }
  // An archived serial is moved aside (`~ARSIP~`), so any row under `to` is
  // a live unit and the correction would merge two units.
  const taken = await tx.unit.findFirst({
    where: { serial: to },
    select: { id: true },
  });
  if (taken !== null) {
    throw new StoreValidationError(
      `Serial ${to} sudah dipakai unit lain.`,
      "units",
      to,
    );
  }
  await tx.unit.update({
    where: { id: unit.id },
    data: { ...data, serial: to, version: { increment: 1 } },
  });
  await tx.unitNote.updateMany({
    where: { unitId: unit.id },
    data: { serial: to },
  });
  for (const n of await tx.unitNote.findMany({
    where: { unitId: unit.id },
    select: { id: true },
  })) {
    ctx.touch("unitNotes", n.id);
  }
  const lines = await tx.purchaseOrderItemSerial.findMany({
    where: { serial: from },
    select: { item: { select: { poId: true } } },
  });
  if (lines.length > 0) {
    await tx.purchaseOrderItemSerial.updateMany({
      where: { serial: from },
      data: { serial: to },
    });
    for (const l of lines) ctx.touch("pos", l.item.poId);
  }
  for (const s of await tx.stockIn.findMany({
    where: { unitId: unit.id },
    select: { id: true },
  })) {
    ctx.touch("stockIns", s.id);
  }
  for (const a of await tx.stockAdjustment.findMany({
    where: { unitId: unit.id },
    select: { id: true },
  })) {
    ctx.touch("adjustments", a.id);
  }
  ctx.rememberUnit(from, null);
  ctx.rememberUnit(to, unit.id);
  // Where the commit found it, under the name it now has — the ledger check
  // and any event appended under the new serial start from there.
  const before = ctx.unitsBefore.get(from);
  if (before !== undefined) ctx.unitsBefore.set(to, before);
  // Gone under the old serial, for every till.
  ctx.touch("units", from);
  return unit.id;
}

export const units: Adapter<"units"> = {
  collection: "units",
  async project(tx, _ctx, keys) {
    const rows = await tx.unit.findMany({
      where: {
        archivedAt: null,
        ...(keys === undefined ? {} : { serial: { in: [...keys] } }),
      },
      orderBy: [{ intakeAt: "asc" }, { serial: "asc" }],
      include: {
        poItem: { select: { poId: true } },
        attributes: {
          where: { attribute: { key: { in: Object.keys(BATTERY_KEYS) } } },
          include: { attribute: { select: { key: true } } },
        },
      },
    });
    return rows.map((u) => {
      const reading = (key: BatteryKey): number | undefined => {
        const hit = u.attributes.find(
          (a) => a.attribute.key === key && a.value !== "",
        );
        if (hit === undefined) return undefined;
        const n = Number(hit.value);
        return Number.isFinite(n) ? n : undefined;
      };
      return {
        serial: u.serial,
        skuId: u.skuId,
        status: u.status,
        locationId: u.locationId,
        rackId: u.rackId ?? undefined,
        buy: u.buy,
        description: u.description ?? "",
        poId: u.purchaseOrderId ?? u.poItem?.poId ?? null,
        grade: u.grade ?? undefined,
        batteryHealth: reading("baterai"),
        price: u.price ?? undefined,
        marketPrice: u.marketPrice ?? undefined,
        cycleCount: reading("siklus"),
        fcc: reading("kapasitas"),
        ...(u.neverServiced === null ? {} : { neverServiced: u.neverServiced }),
      };
    });
  },
  lock: (tx, keys) => lockRows(tx, "Unit", "serial", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    /*
     * A serial corrected arrives as two rows — the old key removed, the new
     * one inserted — and the renamed ledger rows in the same changeset say
     * which is which (`ctx.serialRenames`). Paired here, so the removal is
     * not an archive and the insert is not a fresh unit.
     */
    const renamedFrom = new Map<string, RowWrite<RowOf<"units">>>();
    for (const r of rows) {
      if (r.next !== undefined) continue;
      const to = ctx.serialRenames.get(r.key);
      if (to === undefined) continue;
      const inserted = rows.some(
        (x) => x.key === to && x.base === undefined && x.next !== undefined,
      );
      if (inserted) renamedFrom.set(to, r);
    }
    const renamedAway = new Set([...renamedFrom.values()].map((r) => r.key));
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        if (!renamedAway.has(r.key)) await archiveUnit(ctx, r.key);
        continue;
      }
      const data = {
        skuId: n.skuId,
        status: n.status,
        locationId: n.locationId,
        rackId: n.rackId ?? null,
        buy: n.buy,
        landed: n.buy,
        grade: n.grade ?? null,
        description: blankToNull(n.description),
        price: n.price ?? null,
        marketPrice: n.marketPrice ?? null,
        neverServiced: n.neverServiced ?? null,
        purchaseOrderId: n.poId,
      };
      let unitId: string;
      const from = renamedFrom.get(r.key);
      if (from !== undefined) {
        unitId = await renameUnit(ctx, from.key, n.serial, data);
      } else if (r.base === undefined) {
        const created = await tx.unit.create({
          data: {
            serial: n.serial,
            ...data,
            intakeAt: ctx.firstEventAt.get(n.serial) ?? ctx.now,
            version: 1,
          },
          select: { id: true },
        });
        unitId = created.id;
        ctx.rememberUnit(n.serial, unitId);
      } else {
        const updated = await tx.unit.update({
          where: { serial: n.serial },
          data: { ...data, version: { increment: 1 } },
          select: { id: true },
        });
        unitId = updated.id;
      }
      const battery = {
        baterai: n.batteryHealth,
        siklus: n.cycleCount,
        kapasitas: n.fcc,
      };
      // The row the unit was — under its old serial, if it was just corrected.
      const was = from?.base ?? r.base;
      const had = was && {
        baterai: was.batteryHealth,
        siklus: was.cycleCount,
        kapasitas: was.fcc,
      };
      if (
        was === undefined ||
        was.skuId !== n.skuId ||
        !deepEqual(had, battery)
      ) {
        await syncBattery(ctx, unitId, n.skuId, battery);
      }
      ctx.unitsWritten.add(n.serial);
      ctx.touch("units", n.serial);
    }
  },
};

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

type EventRow = RowOf<"events">;

/** The document an event's `refCode` names, as the foreign key `UnitEvent` has for it. */
async function documentLink(
  ctx: WriteContext,
  code: string | undefined,
): Promise<Record<string, string>> {
  if (code === undefined || code.trim() === "") return {};
  const memoKey = `ref:${code}`;
  const cached = ctx.memo.get(memoKey) as Record<string, string> | undefined;
  if (cached !== undefined) return cached;
  const { tx } = ctx;
  const prefix = code.split("-")[0];
  let link: Record<string, string> | undefined;
  if (prefix === "SI") {
    const row = await tx.order.findUnique({
      where: { code },
      select: { id: true },
    });
    if (row !== null) link = { orderId: row.id };
  } else if (prefix === "PI") {
    const row = await tx.purchaseOrder.findUnique({
      where: { code },
      select: { id: true },
    });
    if (row !== null) link = { purchaseOrderId: row.id };
  } else if (prefix === "RV") {
    const row = await tx.reservation.findUnique({
      where: { code },
      select: { id: true },
    });
    if (row !== null) link = { reservationId: row.id };
  } else if (prefix === "SO") {
    const row = await tx.opnameSession.findUnique({
      where: { code },
      select: { id: true },
    });
    if (row !== null) link = { opnameSessionId: row.id };
  } else if (
    prefix === "SG" ||
    prefix === "SP" ||
    prefix === "SR" ||
    prefix === "PR"
  ) {
    const row = await tx.unitReturn.findUnique({
      where: { code },
      select: { id: true },
    });
    if (row !== null) link = { unitReturnId: row.id };
  }
  if (link === undefined) {
    throw new StoreValidationError(
      `Riwayat unit menyebut dokumen ${code}, yang tidak ada.`,
      "events",
    );
  }
  ctx.memo.set(memoKey, link);
  return link;
}

export const events: Adapter<"events"> = {
  collection: "events",
  async project(tx, _ctx, keys) {
    let unitIds: string[] | undefined;
    if (keys !== undefined) {
      const hits = await tx.unitEvent.findMany({
        where: { id: { in: [...keys] } },
        select: { unitId: true },
      });
      unitIds = [...new Set(hits.map((h) => h.unitId))];
      if (unitIds.length === 0) return [];
    }
    const rows = await tx.unitEvent.findMany({
      where: {
        unit: { archivedAt: null },
        ...(unitIds === undefined ? {} : { unitId: { in: unitIds } }),
      },
      orderBy: [{ unitId: "asc" }, { seq: "asc" }],
      include: {
        unit: { select: { locationId: true } },
        staff: { select: { name: true } },
        order: { select: { code: true } },
        reservation: { select: { code: true } },
        unitReturn: { select: { code: true } },
        opnameSession: { select: { code: true } },
        purchaseOrder: { select: { code: true } },
      },
    });
    const wanted = keys === undefined ? undefined : new Set(keys);
    const out: EventRow[] = [];
    let unitId = "";
    let where = "";
    for (const e of rows) {
      if (e.unitId !== unitId) {
        unitId = e.unitId;
        where = e.toLocationId ?? e.fromLocationId ?? e.unit.locationId;
      } else if (e.toLocationId !== null) {
        where = e.toLocationId;
      }
      if (wanted !== undefined && !wanted.has(e.id)) continue;
      out.push({
        id: e.id,
        serial: e.serial,
        seq: e.seq,
        type: e.type,
        at: isoOf(e.at),
        fromStatus: e.fromStatus ?? "-",
        toStatus: e.toStatus,
        locationId: where,
        note: e.note ?? undefined,
        refCode:
          e.order?.code ??
          e.reservation?.code ??
          e.unitReturn?.code ??
          e.opnameSession?.code ??
          e.purchaseOrder?.code ??
          undefined,
        staff: e.staff.name,
      });
    }
    return out.sort(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        a.serial.localeCompare(b.serial) ||
        a.seq - b.seq,
    );
  },
  lock: (tx, keys) => lockRows(tx, "UnitEvent", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    const fresh: EventRow[] = [];
    /**
     * Events being taken OFF a unit (owner decision 2026-09-23).
     *
     * A sale's unit can be swapped from Transaction History, and the owner
     * asked for that to leave no trace of the unit it replaced — *"if we edit
     * the unit it should edit the ledger as well instead of append only"*. So
     * the LAST event of a unit may be removed. Since 2026-10-22 a row in the
     * MIDDLE may go too — *"delete the serial [history] per unit … some of
     * the history is irrelevant"* (owner) — which leaves the rows either side
     * claiming statuses that no longer meet. That is accepted: the projection
     * is still checked against whatever is the last row, and the create pass
     * only ever compares a new row with the last one.
     *
     * Everything else about the ledger is unchanged. An event may not be
     * EDITED in place, because its `seq`, its `fromStatus` and its unit are a
     * chain rather than fields; a swap is a removal and an append, which is
     * the same chain rebuilt.
     */
    const dropped: { id: string; serial: string }[] = [];
    /**
     * A unit renamed, and its history carried across with it.
     *
     * The ONLY edit an event accepts: `serial` is denormalised onto the row
     * and a unit's serial can be corrected — a mistyped one at QC, a swap on
     * a recorded sale. `unitId` does not move, the chain does not move, and
     * every other field must be identical; anything else is still refused.
     */
    const renamed: { id: string; serial: string }[] = [];
    for (const r of rows) {
      if (r.next !== undefined && r.base !== undefined) {
        const { serial: to, ...restNext } = r.next;
        const { serial: from, ...restBase } = r.base;
        if (
          to === from ||
          JSON.stringify(restNext) !== JSON.stringify(restBase)
        )
          throw refuseEdit("events", r.key);
        renamed.push({ id: r.key, serial: to });
        continue;
      }
      if (r.next === undefined) {
        if (r.base !== undefined && ctx.archivedSerials.has(r.base.serial)) {
          ctx.touch("events", r.key);
          continue;
        }
        if (r.base === undefined) {
          throw new StoreValidationError(
            "Riwayat unit tidak bisa dihapus.",
            "events",
            r.key,
          );
        }
        // Already taken off by a sale's deletion earlier in this commit.
        if (ctx.droppedEvents.has(r.key)) continue;
        dropped.push({ id: r.key, serial: r.base.serial });
        continue;
      }
      fresh.push(r.next);
    }
    if (renamed.length > 0) await renameEvents(ctx, renamed);
    if (dropped.length > 0) await removeEvents(ctx, dropped);
    if (fresh.length === 0) return;

    const bySerial = new Map<string, EventRow[]>();
    for (const e of fresh) {
      const list = bySerial.get(e.serial) ?? [];
      list.push(e);
      bySerial.set(e.serial, list);
    }
    const serials = [...bySerial.keys()];
    const unitRows = await tx.unit.findMany({
      where: { serial: { in: serials }, archivedAt: null },
      select: { id: true, serial: true },
    });
    const unitIdOf = new Map(unitRows.map((u) => [u.serial, u.id]));
    const lasts = await lastEvents(
      tx,
      unitRows.map((u) => u.id),
    );

    const data: Prisma.UnitEventCreateManyInput[] = [];
    const returned: { unitId: string; at: Date }[] = [];
    // A customer return taken back (2026-10-23): the unit goes back out to
    // the customer, so the receipt line the return closed opens again.
    const unreturned: string[] = [];
    for (const [serial, list] of bySerial) {
      const unitId = unitIdOf.get(serial);
      if (unitId === undefined) {
        throw new StoreValidationError(
          `Unit ${serial} tidak ditemukan.`,
          "events",
        );
      }
      list.sort((a, b) => a.seq - b.seq);
      const last = lasts.get(unitId);
      const before = ctx.unitsBefore.get(serial);
      let seq = last?.seq ?? 0;
      let status: string | null = last?.toStatus ?? null;
      let location: string | null = before?.locationId ?? null;
      for (const e of list) {
        if (e.seq !== seq + 1) {
          throw new StoreValidationError(
            `Urutan riwayat unit ${serial} tidak runtut: ${e.seq}, seharusnya ${seq + 1}.`,
            "events",
            e.id,
          );
        }
        const claimed = e.fromStatus === "-" ? null : e.fromStatus;
        if (seq > 0 && claimed !== status) {
          throw new StoreValidationError(
            `Riwayat unit ${serial} tidak cocok: statusnya ${status}, bukan ${claimed}.`,
            "events",
            e.id,
          );
        }
        const moved = location === null || e.locationId !== location;
        data.push({
          id: e.id,
          unitId,
          serial,
          seq: e.seq,
          type: e.type,
          at: instantOf(e.at),
          fromStatus: seq === 0 ? null : (status as EventRow["toStatus"]),
          toStatus: e.toStatus,
          fromLocationId: moved && location !== null ? location : null,
          toLocationId: moved ? e.locationId : null,
          note: blankToNull(e.note),
          costDelta: 0n,
          staffId: await ctx.staffFor(e.staff),
          ...(await documentLink(ctx, e.refCode)),
        });
        if (e.type === "RETUR_PELANGGAN")
          returned.push({ unitId, at: instantOf(e.at) });
        if (
          e.type === "KOREKSI" &&
          e.toStatus === "TERJUAL" &&
          status !== "TERJUAL" &&
          e.refCode !== undefined &&
          e.refCode.startsWith("SG-")
        )
          unreturned.push(unitId);
        seq = e.seq;
        status = e.toStatus;
        location = e.locationId;
        ctx.touch("events", e.id);
      }
      ctx.ledgerAfter.set(serial, {
        status: status ?? "",
        locationId: location ?? "",
      });
    }

    for (let i = 0; i < data.length; i += 1000) {
      await tx.unitEvent.createMany({ data: data.slice(i, i + 1000) });
    }
    // A machine the customer brought back is no longer on their receipt: the
    // line is closed, which is what lets the same serial be sold again
    // (OrderItem_unitId_unreturned_key).
    for (const { unitId, at } of returned) {
      // Only receipts from before the return. A sale of the same machine in
      // the same commit — the import replays a month at a time — is the sale
      // AFTER it, and must stay open.
      const open = await tx.orderItem.findMany({
        where: { unitId, returnedAt: null, order: { ts: { lte: at } } },
        select: { id: true },
      });
      if (open.length === 0) continue;
      const ids = open.map((i) => i.id);
      await tx.orderItem.updateMany({
        where: { id: { in: ids } },
        data: {
          returnedAt: at,
          returnedQty: 1,
          returnReason: "Retur pelanggan",
        },
      });
      await tx.unit.updateMany({
        where: { id: unitId, soldOrderItemId: { in: ids } },
        data: { soldOrderItemId: null },
      });
    }
    // The undo of a return: the newest line a return closed opens again and
    // the unit is that sale's once more — only while nothing else has it.
    for (const unitId of unreturned) {
      const open = await tx.orderItem.count({
        where: {
          unitId,
          returnedAt: null,
          order: { status: { not: "BATAL" } },
        },
      });
      if (open > 0) continue;
      const line = await tx.orderItem.findFirst({
        where: {
          unitId,
          returnReason: "Retur pelanggan",
          order: { status: { not: "BATAL" } },
        },
        orderBy: { returnedAt: "desc" },
        select: { id: true, orderId: true },
      });
      if (line === null) continue;
      await tx.orderItem.update({
        where: { id: line.id },
        data: { returnedAt: null, returnedQty: 0, returnReason: null },
      });
      await tx.unit.update({
        where: { id: unitId },
        data: { soldOrderItemId: line.id },
      });
      ctx.touch("orders", line.orderId);
    }
  },
};

/** The newest event of each unit, one query. */
/**
 * Carry a unit's history across to its new serial.
 *
 * The unit row is renamed by its own adapter in the same commit; this is the
 * denormalised copy on each event following it. Refused unless the event still
 * belongs to the unit that now holds that serial — otherwise a rename could
 * quietly move one unit's history onto another.
 */
async function renameEvents(
  ctx: WriteContext,
  renamed: readonly { id: string; serial: string }[],
): Promise<void> {
  const { tx } = ctx;
  const rows = await tx.unitEvent.findMany({
    where: { id: { in: renamed.map((r) => r.id) } },
    select: { id: true, unitId: true },
  });
  const unitOf = new Map(rows.map((r) => [r.id, r.unitId]));
  const serials = [...new Set(renamed.map((r) => r.serial))];
  const units = await tx.unit.findMany({
    where: { serial: { in: serials } },
    select: { id: true, serial: true },
  });
  const idOfSerial = new Map(units.map((u) => [u.serial, u.id]));
  for (const r of renamed) {
    const unitId = unitOf.get(r.id);
    if (unitId === undefined || idOfSerial.get(r.serial) !== unitId) {
      throw new StoreValidationError(
        `Riwayat tidak bisa dipindahkan ke serial ${r.serial}.`,
        "events",
        r.id,
      );
    }
    await tx.unitEvent.update({
      where: { id: r.id },
      data: { serial: r.serial },
    });
    ctx.touch("events", r.id);
  }
}

/**
 * Take events off their units' ledgers.
 *
 * Any row (owner, 2026-10-22), with two refusals. A unit is never emptied: a
 * unit with no history is a unit whose status nothing explains. And a SOLD
 * row stays while its sale still has the unit on it — that one goes by
 * deleting the transaction (`cancelSale`, documents.ts), or the unit would be
 * on a receipt and on the shelf at once and could be sold twice.
 *
 * Only a unit whose LAST row went has its projection re-derived
 * (`ledgerAfter`); a row out of the middle leaves the unit where it was.
 */
async function removeEvents(
  ctx: WriteContext,
  dropped: readonly { id: string; serial: string }[],
): Promise<void> {
  const { tx } = ctx;
  const rows = await tx.unitEvent.findMany({
    where: { id: { in: dropped.map((d) => d.id) } },
    select: {
      id: true,
      unitId: true,
      seq: true,
      serial: true,
      type: true,
      orderId: true,
      fromStatus: true,
      toStatus: true,
    },
  });
  const found = new Map(rows.map((r) => [r.id, r]));
  const perUnit = new Map<string, { serial: string; seqs: number[] }>();
  for (const d of dropped) {
    const row = found.get(d.id);
    if (row === undefined) {
      throw new StoreValidationError(
        `Riwayat unit ${d.serial} tidak ditemukan.`,
        "events",
        d.id,
      );
    }
    const entry = perUnit.get(row.unitId) ?? { serial: row.serial, seqs: [] };
    entry.seqs.push(row.seq);
    perUnit.set(row.unitId, entry);
  }

  // A live sale's sold row. The orders adapter runs first in a commit, so a
  // sale deleted in the same save is already off the unit here.
  for (const row of rows) {
    if (row.type !== "TERJUAL") continue;
    // An exchange's replacement names the return, not the sale (orderId
    // null), so the test is any live sale still carrying the unit with no
    // customer return after this row (audit 2026-10-23).
    const backAfter = await tx.unitEvent.count({
      where: {
        unitId: row.unitId,
        seq: { gt: row.seq },
        type: "RETUR_PELANGGAN",
      },
    });
    if (backAfter > 0) continue;
    const live = await tx.orderItem.findFirst({
      where: {
        ...(row.orderId !== null ? { orderId: row.orderId } : {}),
        unitId: row.unitId,
        returnedAt: null,
        order: { status: { not: "BATAL" } },
      },
      select: { id: true },
    });
    if (live !== null) {
      throw new StoreValidationError(
        `Riwayat terjual ${row.serial} milik transaksi yang masih ada — hapus transaksinya.`,
        "events",
        row.id,
      );
    }
  }

  const lasts = await lastEvents(tx, [...perUnit.keys()]);
  const counts = await tx.unitEvent.groupBy({
    by: ["unitId"],
    where: { unitId: { in: [...perUnit.keys()] } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.unitId, c._count._all]));
  const topDropped = new Set<string>();
  for (const [unitId, entry] of perUnit) {
    if (entry.seqs.length >= (countOf.get(unitId) ?? 0)) {
      throw new StoreValidationError(
        `Unit ${entry.serial} harus punya riwayat.`,
        "events",
        entry.serial,
      );
    }
    // The newest row a return, hold, claim or service visit stands on is
    // undone from its own screen, never deleted here (newestRowOwnedByDocument).
    const top = rows.find(
      (r) => r.unitId === unitId && r.seq === lasts.get(unitId)?.seq,
    );
    if (
      top !== undefined &&
      top.type !== "TERJUAL" &&
      newestRowOwnedByDocument(top)
    ) {
      throw new StoreValidationError(
        `Riwayat terakhir ${entry.serial} milik dokumennya (${top.type}) — batalkan dari layarnya.`,
        "events",
        top.id,
      );
    }
    if (entry.seqs.includes(lasts.get(unitId)?.seq ?? -1))
      topDropped.add(unitId);
  }

  // The database takes them off, and only these: `unit_event_drop` is the one
  // door the app role has to a DELETE on the ledger, and it refuses to empty a
  // unit — the check above, held a second time where no code path can skip it
  // (migration 20261022140000).
  const ids = [...found.keys()];
  const [result] = await tx.$queryRaw<{ n: number }[]>`
    SELECT unit_event_drop(${ids}::text[]) AS n`;
  if ((result?.n ?? 0) !== ids.length) {
    throw new StoreValidationError("Riwayat unit tidak terhapus.", "events");
  }
  for (const d of dropped) ctx.touch("events", d.id);

  // What the ledger says NOW, so the projection is checked against it. The
  // location is the newest surviving row that moved the unit — what the
  // browser reads off that row's projection — not the unit's own column,
  // which still says where the dropped row sent it.
  const after = await lastEvents(tx, [...topDropped]);
  for (const [unitId, entry] of perUnit) {
    if (!topDropped.has(unitId)) continue;
    const last = after.get(unitId);
    if (last === undefined) continue;
    const moved =
      last.toLocationId ??
      (
        await tx.unitEvent.findFirst({
          where: { unitId, toLocationId: { not: null } },
          orderBy: { seq: "desc" },
          select: { toLocationId: true },
        })
      )?.toLocationId ??
      ctx.unitsBefore.get(entry.serial)?.locationId ??
      "";
    ctx.ledgerAfter.set(entry.serial, {
      status: last.toStatus,
      locationId: moved,
    });
  }
}

export async function lastEvents(
  tx: Tx,
  unitIds: readonly string[],
): Promise<
  Map<string, { seq: number; toStatus: string; toLocationId: string | null }>
> {
  if (unitIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<
    {
      unitId: string;
      seq: number;
      toStatus: string;
      toLocationId: string | null;
    }[]
  >`SELECT DISTINCT ON ("unitId") "unitId", seq, "toStatus"::text AS "toStatus", "toLocationId"
      FROM "UnitEvent"
     WHERE "unitId" = ANY(${[...unitIds]}::text[])
     ORDER BY "unitId", seq DESC`;
  return new Map(rows.map((r) => [r.unitId, r]));
}

// ---------------------------------------------------------------------------
// Notes and their photographs
// ---------------------------------------------------------------------------

const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function photoBytes(
  url: string,
): { data: Uint8Array<ArrayBuffer>; contentType: string } | undefined {
  const m = DATA_URL.exec(url);
  if (m === null) return undefined;
  const contentType = m[1] ?? "application/octet-stream";
  const payload = m[3] ?? "";
  const decoded =
    m[2] === undefined
      ? Buffer.from(decodeURIComponent(payload), "utf8")
      : Buffer.from(payload, "base64");
  if (decoded.length > MAX_PHOTO_BYTES) {
    throw new StoreValidationError(
      "Foto terlalu besar (maksimal 8 MB).",
      "unitNotes",
    );
  }
  return { data: new Uint8Array(decoded), contentType };
}

export const unitNotes: Adapter<"unitNotes"> = {
  collection: "unitNotes",
  async project(tx, _ctx, keys) {
    const rows = await tx.unitNote.findMany({
      where: { ...byId(keys), unit: { archivedAt: null } },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      include: {
        staff: { select: { name: true } },
        photos: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, url: true, sortOrder: true },
        },
      },
    });
    return rows.map((n) => ({
      id: n.id,
      serial: n.serial,
      body: n.body,
      tag: n.tag ?? undefined,
      staff: n.staff.name,
      at: isoOf(n.at),
      photos: n.photos,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "UnitNote", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        const note = await tx.unitNote.findUnique({
          where: { id: r.key },
          select: { tag: true },
        });
        if (note === null) continue;
        if (note.tag !== QC_TAG) {
          throw new StoreValidationError(
            "Catatan unit tidak bisa dihapus.",
            "unitNotes",
            r.key,
          );
        }
        // CLAUDE.md's sanctioned exception: QC photographs, row and file.
        await tx.unitNotePhoto.deleteMany({ where: { noteId: r.key } });
        await tx.unitNote.delete({ where: { id: r.key } });
        ctx.touch("unitNotes", r.key);
        continue;
      }
      if (r.base === undefined) {
        await tx.unitNote.create({
          data: {
            id: n.id,
            unitId: await ctx.unitId(n.serial),
            serial: n.serial,
            body: n.body,
            tag: n.tag ?? null,
            staffId: await ctx.staffFor(n.staff),
            at: instantOf(n.at),
          },
        });
      } else {
        await tx.unitNote.update({
          where: { id: n.id },
          data: {
            body: n.body,
            tag: n.tag ?? null,
            // A note follows its unit to a corrected serial (2026-09-24). The
            // unit is renamed first, so the serial resolves — or it does not,
            // and a note renamed on its own is refused with it.
            ...(r.base.serial === n.serial
              ? {}
              : { serial: n.serial, unitId: await ctx.unitId(n.serial) }),
          },
        });
      }
      const existing = await tx.unitNotePhoto.findMany({
        where: { noteId: n.id },
        select: { id: true, sortOrder: true },
      });
      const left = new Map(existing.map((p) => [p.id, p]));
      for (const p of n.photos) {
        const had = left.get(p.id);
        if (had !== undefined) {
          left.delete(p.id);
          if (had.sortOrder !== p.sortOrder) {
            await tx.unitNotePhoto.update({
              where: { id: p.id },
              data: { sortOrder: p.sortOrder },
            });
          }
          continue;
        }
        const bytes = photoBytes(p.url);
        await tx.unitNotePhoto.create({
          data: {
            id: p.id,
            noteId: n.id,
            sortOrder: p.sortOrder,
            ...(bytes === undefined
              ? { url: p.url }
              : {
                  url: `/api/store/photos/${encodeURIComponent(p.id)}`,
                  data: bytes.data,
                  contentType: bytes.contentType,
                }),
          },
        });
      }
      if (left.size > 0) {
        if ((n.tag ?? null) !== QC_TAG) {
          throw new StoreValidationError(
            "Foto catatan ini tidak bisa dihapus.",
            "unitNotes",
            n.id,
          );
        }
        await tx.unitNotePhoto.deleteMany({
          where: { id: { in: [...left.keys()] } },
        });
      }
      ctx.touch("unitNotes", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// QC decisions — written once — and adjustments, written once and correctable
// ---------------------------------------------------------------------------

export const stockIns: Adapter<"stockIns"> = {
  collection: "stockIns",
  async project(tx, _ctx, keys) {
    const rows = await tx.stockIn.findMany({
      where: { ...byId(keys), unit: { archivedAt: null } },
      orderBy: [{ at: "asc" }, { id: "asc" }],
      include: {
        unit: { select: { serial: true } },
        staff: { select: { name: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      serial: s.unit.serial,
      skuId: s.skuId,
      poId: s.purchaseOrderId,
      locationId: s.locationId,
      rackId: s.rackId ?? undefined,
      decision: s.decision,
      rejectKind: s.rejectKind ?? undefined,
      reason: s.reason ?? undefined,
      buy: s.buy,
      description: s.description ?? undefined,
      batteryHealth: s.batteryHealth ?? undefined,
      cycleCount: s.cycleCount ?? undefined,
      fcc: s.fcc ?? undefined,
      at: isoOf(s.at),
      staff: s.staff.name,
    }));
  },
  // Inserted only — see `noRowLock`.
  lock: noRowLock,
  async write(ctx, rows) {
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("stockIns", r.key);
      if (r.base !== undefined) throw refuseEdit("stockIns", r.key);
      await ctx.tx.stockIn.create({
        data: {
          id: n.id,
          unitId: await ctx.unitId(n.serial),
          skuId: n.skuId,
          purchaseOrderId: n.poId,
          locationId: n.locationId,
          rackId: n.rackId ?? null,
          decision: n.decision,
          rejectKind: n.rejectKind ?? null,
          reason: blankToNull(n.reason),
          buy: n.buy,
          description: blankToNull(n.description),
          batteryHealth: whole(n.batteryHealth),
          cycleCount: whole(n.cycleCount),
          fcc: whole(n.fcc),
          at: instantOf(n.at),
          staffId: await ctx.staffFor(n.staff),
        },
      });
      ctx.touch("stockIns", n.id);
    }
  },
};

/**
 * What a correction to a recorded adjustment may change (owner ask
 * 2026-09-24: *"make the movement log editable … each row is editable"*):
 * what somebody can get wrong and find out about later — when, why, the
 * sentence, and the reading typed alongside the unit. Everything else is what
 * the row IS: its unit, its direction, its batch, whose hand, and whether it
 * minted the unit. A change to any of those is refused here, and the app
 * role's UPDATE on `StockAdjustment` names exactly these six columns, so the
 * database refuses it too.
 */
const ADJUSTMENT_CORRECTABLE: ReadonlySet<keyof RowOf<"adjustments">> = new Set<
  keyof RowOf<"adjustments">
>(["at", "reasonId", "description", "batteryHealth", "cycleCount", "fcc"]);

async function correctAdjustment(
  ctx: WriteContext,
  base: RowOf<"adjustments">,
  next: RowOf<"adjustments">,
): Promise<void> {
  if (!sameApartFrom(base, next, ADJUSTMENT_CORRECTABLE)) {
    throw new StoreValidationError(
      "Unit, arah, batch dan pencatat penyesuaian tidak bisa diubah — hanya waktu, alasan, deskripsi dan baterainya.",
      "adjustments",
      next.id,
    );
  }
  await ctx.tx.stockAdjustment.update({
    where: { id: next.id },
    data: {
      at: instantOf(next.at),
      reasonId: next.reasonId,
      description: next.description,
      batteryHealth: whole(next.batteryHealth),
      cycleCount: whole(next.cycleCount),
      fcc: whole(next.fcc),
    },
  });
  ctx.touch("adjustments", next.id);
}

export const adjustments: Adapter<"adjustments"> = {
  collection: "adjustments",
  async project(tx, _ctx, keys) {
    const rows = await tx.stockAdjustment.findMany({
      where: { ...byId(keys), unit: { archivedAt: null } },
      orderBy: [{ at: "desc" }, { id: "asc" }],
      include: {
        unit: { select: { serial: true } },
        staff: { select: { name: true } },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      serial: a.unit.serial,
      description: a.description,
      reasonId: a.reasonId,
      at: isoOf(a.at),
      staff: a.staff.name,
      kind: a.kind,
      batchId: a.batchId,
      batteryHealth: a.batteryHealth ?? undefined,
      cycleCount: a.cycleCount ?? undefined,
      fcc: a.fcc ?? undefined,
      newUnit: a.newUnit ?? undefined,
    }));
  },
  lock: (tx, keys) => lockRows(tx, "StockAdjustment", "id", keys),
  async write(ctx, rows) {
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) {
        // Undone (owner ask 2026-10-29: "undo the stock movement and it will
        // be erased from the history"). The row is a record OF the unit's
        // KOREKSI event; that event goes through the events adapter, which
        // judges the ledger, and nothing points at this row.
        const gone = await ctx.tx.stockAdjustment.deleteMany({
          where: { id: r.key },
        });
        if (gone.count === 0) throw refuseRemoval("adjustments", r.key);
        ctx.touch("adjustments", r.key);
        continue;
      }
      if (r.base !== undefined) {
        await correctAdjustment(ctx, r.base, n);
        continue;
      }
      await ctx.tx.stockAdjustment.create({
        data: {
          id: n.id,
          unitId: await ctx.unitId(n.serial),
          description: n.description,
          reasonId: n.reasonId,
          at: instantOf(n.at),
          staffId: await ctx.staffFor(n.staff),
          kind: n.kind,
          batchId: n.batchId,
          batteryHealth: whole(n.batteryHealth),
          cycleCount: whole(n.cycleCount),
          fcc: whole(n.fcc),
          newUnit: n.newUnit ?? null,
        },
      });
      ctx.touch("adjustments", n.id);
    }
  },
};
