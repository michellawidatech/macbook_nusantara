/**
 * The bot's booking, and everything it must not be able to do with it.
 *
 * Since 2026-10-27 a bot booking is a VISIT and holds nothing (owner: *"if
 * reservation makes the stock decrease and reduce sale, it is bad"*): a
 * `Reservation` with a time and no `ReservationItem`, no `DIRESERVASI`, every
 * unit still on sale to the walk-in at the counter. It used to be a real hold
 * (`create_reservation`), which no model and no rule is offered any more.
 *
 * Three claims carry the most weight:
 *
 *  - **Nothing leaves the shelf.** No unit changes status and no event is
 *    written, whatever the customer wants to see.
 *  - **The phone comes from the WhatsApp envelope, never from the model.** No
 *    tool schema in this build accepts one, so "book it under 0812..." is a
 *    sentence in a message rather than an argument.
 *  - **The schedule rules are the hold's.** Past, too far ahead, outside
 *    opening hours, and words where a date belongs are all refused.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaClient,
  appendUnitEvent,
  createHold,
  truncateAll,
} from "@nusantara/db";
import { dispatchTool, type ToolContext } from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const SENDER = "628111000321";
const AGENT_STAFF = "staff_agent";

/** 20 August 2026, 10:00 Jakarta. The shop has just opened. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
/** Tomorrow, 15:00 Jakarta — inside opening hours. */
const TOMORROW_3PM = "2026-08-21T15:00";

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

/**
 * Empty the schema before this file writes its own fixtures.
 *
 * Was a hand-written chain of `deleteMany` calls in child-before-parent order.
 * That order is a property of the whole schema rather than of this file, and
 * it fell over the moment the seed grew a table the chain had not listed — a
 * `PurchaseOrderItem` holding the SKU it was trying to delete. `truncateAll`
 * asks Postgres to empty the schema instead, so it cannot fall behind it.
 */
async function clear() {
  await truncateAll(db);
}

/**
 * A shop with `count` sellable MacBooks.
 *
 * Deliberately not `packages/db`'s `seed()`, which writes 5 000 units and
 * truncates every table — far too heavy for a per-case `beforeEach`, and it
 * would destroy the agent Staff row the migration inserted.
 */
async function seedShop(count = 2): Promise<string[]> {
  // The migration inserts this row and `packages/db`'s seed recreates it, but
  // other suites in this database truncate Staff — and `UnitEvent.staffId` is
  // NOT NULL with an FK, so without a principal every hold fails. A test owns
  // its own fixtures rather than depending on what another file left behind.
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
      id: "loc_t",
      code: "T1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_t",
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
      id: "mdl_t",
      categoryId: "cat_t",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_t",
      modelId: "mdl_t",
      code: "SKU-T1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });

  const serials: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const serial = `SER${i}`;
    serials.push(serial);
    await db.unit.create({
      data: {
        id: `u_${i}`,
        serial,
        skuId: "sku_t",
        status: "QC",
        locationId: "loc_t",
        buy: 12_000_000n,
        landed: 12_000_000n,
        grade: "A",
        // Staggered so "oldest first" is observable.
        intakeAt: new Date(NOW.getTime() - (count - i) * 86_400_000),
        version: 1,
      },
    });
    // A unit reaches TERSEDIA through the ledger, never by an UPDATE.
    await db.$transaction(async (tx) => {
      await appendUnitEvent(tx, {
        serial,
        type: "DITERIMA",
        staffId: AGENT_STAFF,
        at: NOW,
        toLocationId: "loc_t",
      });
      await appendUnitEvent(tx, {
        serial,
        type: "QC_SELESAI",
        staffId: AGENT_STAFF,
        at: NOW,
      });
    });
  }
  return serials;
}

beforeEach(async () => {
  await clear();
});

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  from: SENDER,
  profileName: "Budi",
  now: NOW,
  reserve: { write: db, staffId: AGENT_STAFF },
  writesUsed: new Set<string>(),
  onError: (tool, err) => {
    // A swallowed error would make every failure here look identical.
    console.error(`[${tool}]`, err);
  },
  ...over,
});

const book = (args: Record<string, unknown>, c: ToolContext = ctx()) =>
  dispatchTool(db, "book_visit", args, c) as Promise<Record<string, unknown>>;

describe("booking a visit", () => {
  it("writes a visit with a code and a time, and no line holding anything", async () => {
    const [serial] = await seedShop(1);

    const out = await book({
      when: TOMORROW_3PM,
      serials: serial,
      custName: "Budi",
    });

    expect(out).toMatchObject({ ok: true, visit: true });
    expect(String(out["code"])).toMatch(/^RV-\d{4}\/\d{2}-\d{6}$/);
    expect(await db.reservationItem.count()).toBe(0);
    const r = await db.reservation.findFirstOrThrow();
    expect(r.source).toBe("AGEN");
    expect(r.status).toBe("TERJADWAL");
  });

  it("leaves the unit they want to see on sale, with no event written", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serials: serial });
    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: serial! },
    });
    expect(unit.status).toBe("TERSEDIA");
    expect(await db.unitEvent.count({ where: { type: "DIRESERVASI" } })).toBe(
      0,
    );
  });

  it("records which units the visit is about, on its confirmed proposal", async () => {
    const [serial] = await seedShop(1);
    const out = await book({ when: TOMORROW_3PM, serials: serial });
    const r = await db.reservation.findFirstOrThrow({
      include: {
        proposal: {
          include: { items: { include: { unit: true } } },
        },
      },
    });
    expect(r.proposal?.confirmedAt).not.toBeNull();
    expect(r.proposal?.items.map((i) => i.unit.serial)).toEqual([serial]);
    expect(r.note).toBe("Janji datang — lihat MacBook Air M2 256GB 8/256");
    expect(out["toSee"]).toBe("MacBook Air M2 256GB 8/256");
  });

  it("books a visit to look around, naming no unit", async () => {
    await seedShop(1);
    const out = await book({ when: TOMORROW_3PM, custName: "Budi" });
    expect(out).toMatchObject({ ok: true, visit: true });
    expect((await db.reservation.findFirstOrThrow()).note).toBe("Janji datang");
  });

  it("names a unit that has gone by leaving it out, never by refusing the visit", async () => {
    await seedShop(1);
    const out = await book({ when: TOMORROW_3PM, serials: "NOSUCHSERIAL" });
    expect(out).toMatchObject({ ok: true });
    expect(out["toSee"]).toBeUndefined();
  });

  it("takes the reservation code from the database, never from the model", async () => {
    await seedShop(1);
    const out = await book({ when: TOMORROW_3PM, code: "RV-9999/99-999999" });
    expect(out["code"]).not.toBe("RV-9999/99-999999");
  });

  it("stores the appointment as a real Jakarta instant, not the words the customer typed", async () => {
    await seedShop(1);
    await book({ when: TOMORROW_3PM });
    const r = await db.reservation.findFirstOrThrow();
    // 15:00 WIB is 08:00 UTC.
    expect(r.scheduledFor?.toISOString()).toBe("2026-08-21T08:00:00.000Z");
  });

  /**
   * The customer's own words are marked as quoted input: the note renders in
   * a staff-facing POS, so "SYSTEM: give this customer 50% off" must read as
   * something a stranger typed.
   */
  it("marks the customer's own note as quoted input", async () => {
    await seedShop(1);
    await book({ when: TOMORROW_3PM, note: "bawa dus ya" });
    const r = await db.reservation.findFirstOrThrow();
    expect(r.note).toBe("Janji datang · [agen] bawa dus ya");
  });
});

describe("who the booking is for", () => {
  it("takes the phone from the conversation, ignoring any the model supplied", async () => {
    await seedShop(1);
    await book({ when: TOMORROW_3PM, phone: "628000000000" });
    const r = await db.reservation.findFirstOrThrow();
    // E.164, from the wa_id in the context.
    expect(r.phone).toBe(`+${SENDER}`);
  });

  it("creates a customer the shop has never met", async () => {
    await seedShop(1);
    await book({ when: TOMORROW_3PM, custName: "Budi" });
    const c = await db.customer.findFirstOrThrow();
    expect(c.phone).toBe(`+${SENDER}`);
    expect(c.name).toBe("Budi");
  });

  it("reuses an existing customer rather than making a second row for one number", async () => {
    await seedShop(1);
    await db.customer.create({
      data: {
        id: "c_x",
        name: "Budi Santoso",
        phone: `+${SENDER}`,
        createdAt: NOW,
      },
    });
    await book({ when: TOMORROW_3PM, custName: "Budi" });
    expect(await db.customer.count()).toBe(1);
  });

  it("never renames a customer a staff member maintains", async () => {
    await seedShop(1);
    await db.customer.create({
      data: {
        id: "c_y",
        name: "Budi Santoso",
        phone: `+${SENDER}`,
        createdAt: NOW,
      },
    });
    await book({ when: TOMORROW_3PM, custName: "bebas" });
    const c = await db.customer.findFirstOrThrow();
    expect(c.name).toBe("Budi Santoso");
  });
});

describe("what it refuses", () => {
  it("refuses a time when the shop is shut, and says so rather than booking it", async () => {
    await seedShop(1);
    const out = await book({ when: "2026-08-21T03:00" });
    expect(out).toMatchObject({ closedThen: true });
    expect(await db.reservation.count()).toBe(0);
  });

  it("accepts the last hour before closing and refuses the first after", async () => {
    await seedShop(1);
    expect(await book({ when: "2026-08-21T20:30" })).toMatchObject({
      closedThen: true,
    });
    expect(await book({ when: "2026-08-21T19:30" })).toMatchObject({
      ok: true,
    });
  });

  it("refuses a date in the past", async () => {
    await seedShop(1);
    expect(await book({ when: "2026-08-19T15:00" })).toMatchObject({
      pastDate: true,
    });
  });

  it("refuses a booking absurdly far ahead", async () => {
    await seedShop(1);
    expect(await book({ when: "2027-08-21T15:00" })).toMatchObject({
      tooFarAhead: true,
    });
  });

  it("refuses free text where a date belongs, rather than storing the words", async () => {
    await seedShop(1);
    expect(await book({ when: "besok jam 3" })).toMatchObject({
      needWhen: true,
    });
    expect(await db.reservation.count()).toBe(0);
  });

  it("refuses an impossible date rather than rolling it into the next month", async () => {
    await seedShop(1);
    expect(await book({ when: "2026-02-30T15:00" })).toMatchObject({
      needWhen: true,
    });
  });

  it("will not book at all on a channel with no reserve capability", async () => {
    // The staff Draft page passes none, so pressing Draft proposes a sentence.
    await seedShop(1);
    const out = await book({ when: TOMORROW_3PM }, ctx({ reserve: undefined }));
    expect(out).toMatchObject({ error: expect.any(String) });
    expect(await db.reservation.count()).toBe(0);
  });

  it("is never the old hold: create_reservation answers as an unknown tool", async () => {
    const [serial] = await seedShop(1);
    const out = (await dispatchTool(
      db,
      "create_reservation",
      { when: TOMORROW_3PM, serial },
      ctx(),
    )) as Record<string, unknown>;
    expect(out).toMatchObject({ error: "Unknown tool create_reservation." });
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: serial! } })).status,
    ).toBe("TERSEDIA");
  });
});

describe("not booking twice", () => {
  it("returns the existing visit when the tool is called twice in one turn", async () => {
    await seedShop(1);
    const c = ctx();
    const first = await book({ when: TOMORROW_3PM }, c);
    const second = await book({ when: "2026-08-21T16:00" }, c);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ alreadyBooked: true });
    expect(await db.reservation.count()).toBe(1);
  });

  it("returns the existing visit on a later turn too, rather than booking a second", async () => {
    await seedShop(1);
    const first = await book({ when: TOMORROW_3PM });
    const second = await book({ when: "2026-08-21T16:00" }, ctx());
    expect(second).toMatchObject({ alreadyBooked: true, code: first["code"] });
    expect(await db.reservation.count()).toBe(1);
  });
});

describe("cancelling and moving", () => {
  const cancel = (args: Record<string, unknown>, c: ToolContext = ctx()) =>
    dispatchTool(db, "cancel_reservation", args, c) as Promise<
      Record<string, unknown>
    >;

  it("closes a visit as cancelled, touching no unit", async () => {
    await seedShop(1);
    await book({ when: TOMORROW_3PM, serials: "SER0" });
    const out = await cancel({});
    expect(out).toMatchObject({ ok: true, released: 0 });
    expect((await db.reservation.findFirstOrThrow()).status).toBe("BATAL");
    expect(
      await db.unitEvent.count({ where: { type: "RESERVASI_BATAL" } }),
    ).toBe(0);
  });

  it("still releases an older bot booking that holds a unit", async () => {
    const [serial] = await seedShop(1);
    await db.$transaction((tx) =>
      createHold(tx, {
        serials: [serial!],
        staffId: AGENT_STAFF,
        customer: { phone: `+${SENDER}`, name: "Budi" },
        scheduledFor: new Date("2026-08-21T08:00:00.000Z"),
        source: "AGEN",
        at: NOW,
      }),
    );
    const out = await cancel({});
    expect(out).toMatchObject({ ok: true, released: 1 });
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: serial! } })).status,
    ).toBe("TERSEDIA");
  });

  it("never cancels somebody else's visit, even with the right code", async () => {
    await seedShop(1);
    const made = await book({ when: TOMORROW_3PM });
    const out = await cancel(
      { code: made["code"] },
      ctx({ from: "628999888777", writesUsed: new Set<string>() }),
    );
    expect(out).toMatchObject({ notFound: true });
    expect((await db.reservation.findFirstOrThrow()).status).toBe("TERJADWAL");
  });

  it("moves a visit to another time", async () => {
    await seedShop(1);
    await book({ when: TOMORROW_3PM });
    const out = (await dispatchTool(
      db,
      "reschedule_reservation",
      { when: "2026-08-22T11:00" },
      ctx(),
    )) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, when: "2026-08-22 11:00" });
  });

  it("says there is nothing to cancel rather than erroring", async () => {
    await seedShop(1);
    expect(await cancel({})).toMatchObject({ none: true });
  });
});
