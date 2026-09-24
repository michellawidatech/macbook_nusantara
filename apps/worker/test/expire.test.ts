/**
 * Letting go of a hold nobody came for.
 *
 * The owner chose a booking that really reserves the unit, which is the useful
 * version and the one with teeth: a held unit leaves everybody's stock, so a
 * booking made at 2am by an unauthenticated phone number can quietly cost the
 * shop a sale to somebody standing at the counter. `Reservation` has no expiry
 * column and nothing has ever swept it, so this pass is the only thing that
 * gives a hold an end.
 *
 * The two claims that matter: an agent booking eventually lets go, and a STAFF
 * booking never does. The second is the one worth guarding, because expiring a
 * colleague's booking automatically is overruling a person who spoke to the
 * customer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { expirePass } from "../src/expire.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

const AGENT_STAFF = "staff_agent";
const NOW = new Date("2026-08-20T03:00:00.000Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

/**
 * Empty the schema, then write this file's own shop.
 *
 * Was a hand-written chain of `deleteMany` calls in child-before-parent order,
 * which never listed `ModelAxis`: whenever another suite had left a catalogue
 * in the shared test database, all twelve tests failed in this hook on
 * `ModelAxis_modelId_fkey` (2026-09-11, and again rehearsing CI's clean run on
 * 2026-09-18). `truncateAll` cannot fall behind the schema.
 */
beforeEach(async () => {
  await truncateAll(db);
  await seedShop();
});

/** One sellable unit, held. Reaching TERSEDIA goes through the ledger. */
async function seedShop() {
  await db.staff.upsert({
    where: { id: AGENT_STAFF },
    update: {},
    create: {
      id: AGENT_STAFF,
      username: "agent",
      name: "Agen WhatsApp",
      role: "STAFF",
      canApprove: false,
      active: false,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await db.location.create({
    data: {
      id: "loc_e",
      code: "E1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_e",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await db.catalogModel.create({
    data: {
      id: "mdl_e",
      categoryId: "cat_e",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_e",
      modelId: "mdl_e",
      code: "SKU-E1",
      name: "MacBook Air M2 256GB",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  await db.unit.create({
    data: {
      id: "u_e",
      serial: "EXP1",
      skuId: "sku_e",
      status: "QC",
      locationId: "loc_e",
      buy: 12_000_000n,
      landed: 12_000_000n,
      grade: "A",
      intakeAt: ago(10 * HOUR),
      version: 1,
    },
  });
  await db.$transaction(async (tx) => {
    await appendUnitEvent(tx, {
      serial: "EXP1",
      type: "DITERIMA",
      staffId: AGENT_STAFF,
      at: ago(9 * HOUR),
      toLocationId: "loc_e",
    });
    await appendUnitEvent(tx, {
      serial: "EXP1",
      type: "QC_SELESAI",
      staffId: AGENT_STAFF,
      at: ago(9 * HOUR),
    });
  });
}

/** A booking holding EXP1. */
async function booking(opts: {
  source: "AGEN" | "STAF";
  scheduledFor: Date | null;
  createdAt: Date;
  hold?: boolean;
}) {
  if (opts.hold !== false) {
    await db.$transaction(async (tx) => {
      await appendUnitEvent(tx, {
        serial: "EXP1",
        type: "DIRESERVASI",
        staffId: AGENT_STAFF,
        at: opts.createdAt,
      });
    });
  }
  return db.reservation.create({
    data: {
      phone: "+628111000321",
      status: "TERJADWAL",
      source: opts.source,
      scheduledFor: opts.scheduledFor,
      createdAt: opts.createdAt,
      items: { create: [{ skuId: "sku_e", unitId: "u_e", qty: 1 }] },
    },
    select: { id: true, code: true },
  });
}

const sweep = (over: Record<string, unknown> = {}) =>
  expirePass({
    db,
    logger,
    agentStaffId: AGENT_STAFF,
    graceMs: 4 * HOUR,
    ttlMs: 48 * HOUR,
    maxPerTick: 10,
    now: () => NOW,
    ...over,
  });

describe("a hold that has run out", () => {
  it("releases a unit whose appointment passed hours ago", async () => {
    await booking({
      source: "AGEN",
      scheduledFor: ago(6 * HOUR),
      createdAt: ago(30 * HOUR),
    });

    const result = await sweep();

    expect(result).toEqual({ expired: 1, released: 1 });
    const unit = await db.unit.findUniqueOrThrow({ where: { serial: "EXP1" } });
    expect(unit.status).toBe("TERSEDIA");
    expect((await db.reservation.findFirstOrThrow()).status).toBe("BATAL");
  });

  it("writes the event that says why the unit came back", async () => {
    // A status flipped without a ledger entry is exactly the drift the
    // append-only rule exists to prevent.
    await booking({
      source: "AGEN",
      scheduledFor: ago(6 * HOUR),
      createdAt: ago(30 * HOUR),
    });
    await sweep();

    const event = await db.unitEvent.findFirstOrThrow({
      where: { serial: "EXP1", type: "RESERVASI_BATAL" },
    });
    expect(event.toStatus).toBe("TERSEDIA");
    expect(event.staffId).toBe(AGENT_STAFF);
    expect(event.note).toMatch(/kedaluwarsa/);
  });

  it("leaves an appointment still inside its grace period alone", async () => {
    // They may simply be late.
    await booking({
      source: "AGEN",
      scheduledFor: ago(1 * HOUR),
      createdAt: ago(30 * HOUR),
    });

    expect(await sweep()).toEqual({ expired: 0, released: 0 });
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "EXP1" } })).status,
    ).toBe("DIRESERVASI");
  });

  it("leaves a future appointment alone", async () => {
    await booking({
      source: "AGEN",
      scheduledFor: new Date(NOW.getTime() + 24 * HOUR),
      createdAt: ago(1 * HOUR),
    });
    expect(await sweep()).toEqual({ expired: 0, released: 0 });
  });

  it("ages out a booking that never got an appointment at all", async () => {
    await booking({
      source: "AGEN",
      scheduledFor: null,
      createdAt: ago(72 * HOUR),
    });
    expect(await sweep()).toEqual({ expired: 1, released: 1 });
  });

  it("gives an appointment-less booking its full time first", async () => {
    await booking({
      source: "AGEN",
      scheduledFor: null,
      createdAt: ago(10 * HOUR),
    });
    expect(await sweep()).toEqual({ expired: 0, released: 0 });
  });
});

describe("whose booking it is", () => {
  it("never expires a booking a member of staff made", async () => {
    // A colleague spoke to this customer and decided to hold the unit.
    // Overruling that automatically is not the sweeper's call.
    await booking({
      source: "STAF",
      scheduledFor: ago(100 * HOUR),
      createdAt: ago(200 * HOUR),
    });

    expect(await sweep()).toEqual({ expired: 0, released: 0 });
    expect((await db.reservation.findFirstOrThrow()).status).toBe("TERJADWAL");
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: "EXP1" } })).status,
    ).toBe("DIRESERVASI");
  });

  it("leaves a booking a customer already turned up for", async () => {
    const made = await booking({
      source: "AGEN",
      scheduledFor: ago(6 * HOUR),
      createdAt: ago(30 * HOUR),
    });
    await db.reservation.update({
      where: { id: made.id },
      data: { status: "SELESAI" },
    });

    expect(await sweep()).toEqual({ expired: 0, released: 0 });
  });

  it("does not touch a booking already cancelled", async () => {
    const made = await booking({
      source: "AGEN",
      scheduledFor: ago(6 * HOUR),
      createdAt: ago(30 * HOUR),
    });
    await db.reservation.update({
      where: { id: made.id },
      data: { status: "BATAL" },
    });

    expect(await sweep()).toEqual({ expired: 0, released: 0 });
  });
});

describe("safety", () => {
  it("cancels the booking even when its unit was already released by hand", async () => {
    // Staff released the unit through the POS but left the booking open. The
    // sweeper should still tidy the booking and not try to release twice.
    await booking({
      source: "AGEN",
      scheduledFor: ago(6 * HOUR),
      createdAt: ago(30 * HOUR),
      hold: false,
    });

    const result = await sweep();

    expect(result.expired).toBe(1);
    expect(result.released).toBe(0);
    expect((await db.reservation.findFirstOrThrow()).status).toBe("BATAL");
  });

  it("caps how many it releases in one tick", async () => {
    await booking({
      source: "AGEN",
      scheduledFor: ago(6 * HOUR),
      createdAt: ago(30 * HOUR),
    });
    await db.reservation.create({
      data: {
        phone: "+628111000999",
        status: "TERJADWAL",
        source: "AGEN",
        scheduledFor: ago(6 * HOUR),
        createdAt: ago(29 * HOUR),
      },
    });

    expect((await sweep({ maxPerTick: 1 })).expired).toBe(1);
    expect(await db.reservation.count({ where: { status: "TERJADWAL" } })).toBe(
      1,
    );
  });

  it("does nothing at all when there is nothing stale", async () => {
    expect(await sweep()).toEqual({ expired: 0, released: 0 });
  });
});
