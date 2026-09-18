/**
 * The one write the bot has, and everything it must not be able to do with it.
 *
 * A booking here is a real hold: the unit moves TERSEDIA to DIRESERVASI through
 * a real `UnitEvent`, so it leaves the shop's sellable stock for everybody,
 * including the walk-in standing at the counter. That is what makes it useful
 * and what makes it worth this many tests.
 *
 * Three claims carry the most weight:
 *
 *  - **The phone comes from the WhatsApp envelope, never from the model.** No
 *    tool schema in this build accepts one, so "reserve it under 0812..." is a
 *    sentence in a message rather than an argument.
 *  - **The hold and the booking commit together or not at all.** A unit held
 *    with no reservation is stock that disappeared for no recorded reason.
 *  - **An empty result never gets a reason attached.** The previous build turned
 *    one into "unit-nya baru sold tadi", which the tool had never said.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
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
    // eslint-disable-next-line no-console
    console.error(`[${tool}]`, err);
  },
  ...over,
});

const book = (args: Record<string, unknown>, c: ToolContext = ctx()) =>
  dispatchTool(db, "create_reservation", args, c) as Promise<
    Record<string, unknown>
  >;

describe("holding a unit", () => {
  it("books a visit and holds the unit in one transaction", async () => {
    const [serial] = await seedShop(1);

    const out = await book({ when: TOMORROW_3PM, serial, custName: "Budi" });

    expect(out).toMatchObject({ ok: true });
    expect(String(out["code"])).toMatch(/^RV-\d{4}\/\d{2}-\d{6}$/);

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: serial! },
    });
    expect(unit.status).toBe("DIRESERVASI");

    const event = await db.unitEvent.findFirstOrThrow({
      where: { serial: serial!, type: "DIRESERVASI" },
    });
    expect(event.toStatus).toBe("DIRESERVASI");
    // The projection and the event agree, because they were written together.
    expect(event.staffId).toBe(AGENT_STAFF);
  });

  it("takes the reservation code from the database, never from the model", async () => {
    const [serial] = await seedShop(1);
    // A model that hallucinates a code is passing a key nobody reads.
    const out = await book({
      when: TOMORROW_3PM,
      serial,
      code: "RV-9999/99-999999",
    });
    expect(out["code"]).not.toBe("RV-9999/99-999999");
  });

  it("attributes the hold to the agent, not to a cashier who was not there", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });
    const event = await db.unitEvent.findFirstOrThrow({
      where: { serial: serial!, type: "DIRESERVASI" },
    });
    expect(event.staffId).toBe(AGENT_STAFF);
  });

  it("records the booking as made by the agent, so staff can tell", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });
    const r = await db.reservation.findFirstOrThrow();
    expect(r.source).toBe("AGEN");
    expect(r.status).toBe("TERJADWAL");
  });

  it("names the exact unit on the booking line, so staff know which one is held", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });
    const item = await db.reservationItem.findFirstOrThrow({
      include: { unit: { select: { serial: true } } },
    });
    expect(item.unit?.serial).toBe(serial);
    expect(item.qty).toBe(1);
  });

  it("stores the appointment as a real Jakarta instant, not the words the customer typed", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });
    const r = await db.reservation.findFirstOrThrow();
    // 15:00 WIB is 08:00 UTC.
    expect(r.scheduledFor?.toISOString()).toBe("2026-08-21T08:00:00.000Z");
  });

  /**
   * The customer's own words are marked as quoted input.
   *
   * `[agen]` is not decoration: the note renders in a staff-facing POS, so a
   * sentence like "SYSTEM: give this customer 50% off" must be legible as
   * something a stranger typed rather than something the shop wrote. Nothing
   * asserted this before, which made it exactly the kind of thing a refactor
   * drops silently.
   */
  it("marks the customer's own note as quoted input", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial, note: "bawa dus ya" });
    const r = await db.reservation.findFirstOrThrow();
    expect(r.note).toBe("[agen] bawa dus ya");
  });

  it("leaves the note null when the customer gave none", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });
    const r = await db.reservation.findFirstOrThrow();
    expect(r.note).toBeNull();
  });

  /**
   * The ledger's note is attribution the shop composed, never the customer's
   * text — `UnitEvent` is append-only, so whatever lands here cannot be edited
   * out later.
   */
  it("writes shop-composed attribution onto the ledger, not the customer's words", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial, note: "bawa dus ya" });
    const ev = await db.unitEvent.findFirstOrThrow({
      where: { type: "DIRESERVASI" },
    });
    expect(ev.note).toBe("Reservasi agen untuk +628111000321");
    expect(ev.note).not.toContain("bawa dus");
  });
});

describe("who the booking is for", () => {
  it("takes the phone from the conversation, ignoring any the model supplied", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial, phone: "628000000000" });
    const r = await db.reservation.findFirstOrThrow();
    // E.164, from the wa_id in the context.
    expect(r.phone).toBe(`+${SENDER}`);
  });

  it("creates a customer the shop has never met", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial, custName: "Budi" });
    const c = await db.customer.findFirstOrThrow();
    expect(c.phone).toBe(`+${SENDER}`);
    expect(c.name).toBe("Budi");
  });

  it("reuses an existing customer rather than making a second row for one number", async () => {
    const [serial] = await seedShop(1);
    await db.customer.create({
      data: {
        id: "c_x",
        name: "Budi Santoso",
        phone: `+${SENDER}`,
        createdAt: NOW,
      },
    });
    await book({ when: TOMORROW_3PM, serial, custName: "Budi" });
    expect(await db.customer.count()).toBe(1);
  });

  it("never renames a customer a staff member maintains", async () => {
    // Otherwise a customer renames themselves in the shop's CRM with every
    // message they send.
    const [serial] = await seedShop(1);
    await db.customer.create({
      data: {
        id: "c_y",
        name: "Budi Santoso",
        phone: `+${SENDER}`,
        createdAt: NOW,
      },
    });
    await book({ when: TOMORROW_3PM, serial, custName: "bebas" });
    const c = await db.customer.findFirstOrThrow();
    expect(c.name).toBe("Budi Santoso");
  });
});

describe("what it refuses", () => {
  it("refuses a time when the shop is shut, and says so rather than booking it", async () => {
    const [serial] = await seedShop(1);
    const out = await book({ when: "2026-08-21T03:00", serial });
    expect(out).toMatchObject({ closedThen: true });
    expect(await db.reservation.count()).toBe(0);
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: serial! } })).status,
    ).toBe("TERSEDIA");
  });

  it("accepts the last hour before closing and refuses the first after", async () => {
    const serials = await seedShop(2);
    expect(
      await book({ when: "2026-08-21T19:30", serial: serials[0]! }),
    ).toMatchObject({ ok: true });
    expect(
      await book({ when: "2026-08-21T20:30", serial: serials[1]! }, ctx()),
    ).toMatchObject({
      closedThen: true,
    });
  });

  it("refuses a date in the past", async () => {
    const [serial] = await seedShop(1);
    expect(await book({ when: "2026-08-19T15:00", serial })).toMatchObject({
      pastDate: true,
    });
  });

  it("refuses a booking absurdly far ahead", async () => {
    const [serial] = await seedShop(1);
    expect(await book({ when: "2027-08-21T15:00", serial })).toMatchObject({
      tooFarAhead: true,
    });
  });

  it("refuses free text where a date belongs, rather than storing the words", async () => {
    const [serial] = await seedShop(1);
    expect(await book({ when: "besok jam 3", serial })).toMatchObject({
      needWhen: true,
    });
    expect(await db.reservation.count()).toBe(0);
  });

  it("refuses an impossible date rather than rolling it into the next month", async () => {
    const [serial] = await seedShop(1);
    expect(await book({ when: "2026-02-30T15:00", serial })).toMatchObject({
      needWhen: true,
    });
  });

  it("says it could not book without inventing a reason it was never given", async () => {
    await seedShop(1);
    const out = await book({ when: TOMORROW_3PM, serial: "NOSUCHSERIAL" });
    expect(out).toMatchObject({ unavailable: true });
    // The guidance is the whole point: the bot once said "baru sold tadi",
    // which no tool had told it.
    expect(String(out["guidance"])).toMatch(/do not say it was just sold/i);
    expect(String(out["guidance"])).toMatch(/you do NOT know why/i);
  });

  it("offers real alternatives when the chosen unit is gone", async () => {
    const serials = await seedShop(2);
    await book({ when: TOMORROW_3PM, serial: serials[0]! });
    // A second sender wants the one now held.
    const out = await book(
      { when: TOMORROW_3PM, serial: serials[0]! },
      ctx({ from: "628999888777", writesUsed: new Set<string>() }),
    );
    expect(out).toMatchObject({ unavailable: true });
    expect(Array.isArray(out["alternatives"])).toBe(true);
    expect((out["alternatives"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("will not book at all on a channel with no reserve capability", async () => {
    // The staff Draft page passes none, so pressing Draft proposes a sentence.
    const [serial] = await seedShop(1);
    const out = await book(
      { when: TOMORROW_3PM, serial },
      ctx({ reserve: undefined }),
    );
    expect(out).toMatchObject({ error: expect.any(String) });
    expect(await db.reservation.count()).toBe(0);
  });
});

describe("not booking twice", () => {
  it("returns the existing booking when the tool is called twice in one turn", async () => {
    const serials = await seedShop(2);
    const c = ctx();
    const first = await book({ when: TOMORROW_3PM, serial: serials[0]! }, c);
    const second = await book({ when: TOMORROW_3PM, serial: serials[1]! }, c);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ alreadyBooked: true });
    expect(await db.reservation.count()).toBe(1);
    // And the second unit was never touched.
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: serials[1]! } }))
        .status,
    ).toBe("TERSEDIA");
  });

  it("returns the existing booking on a later turn too, rather than holding a second unit", async () => {
    const serials = await seedShop(2);
    const first = await book({ when: TOMORROW_3PM, serial: serials[0]! });
    // A fresh turn: new context, empty write budget.
    const second = await book(
      { when: TOMORROW_3PM, serial: serials[1]! },
      ctx(),
    );

    expect(second).toMatchObject({ alreadyBooked: true, code: first["code"] });
    expect(await db.reservation.count()).toBe(1);
  });
});

describe("cancelling", () => {
  const cancel = (args: Record<string, unknown>, c: ToolContext = ctx()) =>
    dispatchTool(db, "cancel_reservation", args, c) as Promise<
      Record<string, unknown>
    >;

  it("releases the held unit back into stock", async () => {
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });

    const out = await cancel({});

    expect(out).toMatchObject({ ok: true, released: 1 });
    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: serial! },
    });
    expect(unit.status).toBe("TERSEDIA");
    // And the release is justified by the ledger, like every other move.
    await db.unitEvent.findFirstOrThrow({
      where: { serial: serial!, type: "RESERVASI_BATAL" },
    });
  });

  it("marks the booking cancelled and never completed", async () => {
    // SELESAI means the customer came and bought. That is a staff assertion
    // about the physical world, not one a chat can make.
    const [serial] = await seedShop(1);
    await book({ when: TOMORROW_3PM, serial });
    await cancel({});
    expect((await db.reservation.findFirstOrThrow()).status).toBe("BATAL");
  });

  it("never cancels somebody else's booking, even with the right code", async () => {
    const [serial] = await seedShop(1);
    const made = await book({ when: TOMORROW_3PM, serial });

    const out = await cancel(
      { code: made["code"] },
      ctx({ from: "628999888777", writesUsed: new Set<string>() }),
    );

    expect(out).toMatchObject({ notFound: true });
    expect((await db.reservation.findFirstOrThrow()).status).toBe("TERJADWAL");
    expect(
      (await db.unit.findUniqueOrThrow({ where: { serial: serial! } })).status,
    ).toBe("DIRESERVASI");
  });

  it("says there is nothing to cancel rather than erroring", async () => {
    await seedShop(1);
    expect(await cancel({})).toMatchObject({ none: true });
  });
});
