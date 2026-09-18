/**
 * What the bot knows about the person it is talking to.
 *
 * Two opposite failures are possible here and both are bad. Knowing nothing
 * means asking a returning customer their name for the fourth time. Knowing too
 * much means reading somebody's home address out to whoever currently holds
 * that phone number.
 *
 * So the rule this file guards is narrow on purpose: **name and customer-since,
 * plus their own purchases and bookings, and nothing else.** `Customer.email`,
 * `street`, `zip` and `note` are never returned, not even to the sender. A
 * WhatsApp number changes hands, and a number is not authentication.
 *
 * The other half is the join. `WaMessage.from` is a bare wa_id (`62812…`) and
 * `Customer.phone` is E.164 (`+62812…`), and nothing in this build reconciled
 * them before now. Getting that wrong in the lenient direction would match the
 * wrong customer, which is the worst outcome available.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { dispatchTool, type ToolContext } from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

/** Our customer, and a stranger whose number differs by one digit. */
const SENDER = "628111000321";
const NEIGHBOUR = "6281110003210";

const NOW = new Date("2026-08-20T03:00:00.000Z");
const DAY = 86_400_000;

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  // This suite is the only one in the workspace that writes an Order, and it
  // cleaned up only on the way IN. So the last case's order outlived the file,
  // and `Order_locationId_fkey` then blocked `location.deleteMany()` in every
  // suite that truncates locations afterwards: all twelve of
  // apps/worker/test/expire.test.ts failed, in a file that has nothing to do
  // with orders. Clean up on the way out as well.
  await db.orderItem.deleteMany({});
  await db.order.deleteMany({});
  await db.$disconnect();
});

beforeEach(async () => {
  await db.orderItem.deleteMany({});
  await db.order.deleteMany({});
  await db.reservationItem.deleteMany({});
  await db.reservation.deleteMany({});
  await db.customer.deleteMany({});
  await db.staff.deleteMany({ where: { id: "staff_crm" } });
  // The whole schema, not a hand-written chain of deleteMany in
  // child-before-parent order: that order is a property of the schema rather
  // than of this file, and it fell over as soon as the seed grew a table it
  // had not listed — a purchase order line holding the Sku being deleted.
  await truncateAll(db);

  await db.location.create({
    data: {
      id: "loc_c",
      code: "C1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.staff.create({
    data: {
      id: "staff_crm",
      username: "crm_kasir",
      name: "Kasir",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  // `OrderItem.skuId` is required, so a purchase needs a real catalogue behind
  // it even when the test only cares about the money.
  await db.category.create({
    data: {
      id: "cat_c",
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
      id: "mdl_c",
      categoryId: "cat_c",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_c",
      modelId: "mdl_c",
      code: "SKU-C1",
      name: "MacBook Air M2 256GB",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
});

const ctx = (from = SENDER): ToolContext => ({ from, now: NOW });

const lookup = (from = SENDER) =>
  dispatchTool(db, "lookup_customer", {}, ctx(from)) as Promise<
    Record<string, unknown>
  >;

/** A customer with everything the shop might store, so PII leaks are visible. */
async function customer(opts: {
  id: string;
  phone: string;
  name: string;
  since?: Date;
}) {
  return db.customer.create({
    data: {
      id: opts.id,
      name: opts.name,
      phone: opts.phone,
      email: "rahasia@example.com",
      street: "Jalan Rahasia No 1",
      note: "catatan internal staf",
      createdAt: opts.since ?? new Date(NOW.getTime() - 400 * DAY),
    },
  });
}

async function order(opts: {
  id: string;
  customerId?: string;
  phone?: string;
  status?: "LUNAS" | "BATAL" | "APPROVAL";
  ts?: Date;
  total?: bigint;
}) {
  return db.order.create({
    data: {
      id: opts.id,
      ts: opts.ts ?? new Date(NOW.getTime() - 200 * DAY),
      customerId: opts.customerId ?? null,
      phone: opts.phone ?? null,
      platform: "WA",
      fulfill: "PICKUP",
      status: opts.status ?? "LUNAS",
      subtotal: opts.total ?? 15_500_000n,
      discount: 0n,
      extra: 0n,
      total: opts.total ?? 15_500_000n,
      paidTotal: opts.total ?? 15_500_000n,
      cogs: 12_000_000n,
      tradeCredit: 0n,
      belowFloor: false,
      soldById: "staff_crm",
      locationId: "loc_c",
      items: {
        create: [
          {
            skuId: "sku_c",
            name: "MacBook Air M2 256GB",
            variant: "8/256",
            qty: 1,
            price: opts.total ?? 15_500_000n,
            sub: opts.total ?? 15_500_000n,
            cogs: 12_000_000n,
            returnedQty: 0,
          },
        ],
      },
    },
  });
}

describe("finding the customer", () => {
  it("finds a customer stored as E.164 from the bare number WhatsApp sends", async () => {
    // The join nothing in this build had made before: `62812…` against `+62812…`.
    await customer({ id: "c_1", phone: `+${SENDER}`, name: "Budi" });
    const out = await lookup();
    expect(out).toMatchObject({ known: true, name: "Budi" });
  });

  it("finds a customer whose number was saved without the plus", async () => {
    await customer({ id: "c_2", phone: SENDER, name: "Budi" });
    expect(await lookup()).toMatchObject({ known: true, name: "Budi" });
  });

  it("says how long they have been a customer, so the bot can greet them properly", async () => {
    await customer({
      id: "c_3",
      phone: `+${SENDER}`,
      name: "Budi",
      since: new Date("2025-03-14T00:00:00.000Z"),
    });
    expect(await lookup()).toMatchObject({ customerSince: "2025-03-14" });
  });

  it("reports an unknown number as a new customer rather than as an error", async () => {
    const out = await lookup("628999000111");
    expect(out).toMatchObject({ known: false });
    // And tells the bot not to ask for something it already has.
    expect(String(out["note"])).toMatch(/do not ask for their phone/i);
  });

  it("never matches a number that differs by one digit", async () => {
    // `62811100032` and `628111000321` must not collapse onto each other.
    await customer({ id: "c_n", phone: `+${NEIGHBOUR}`, name: "Orang Lain" });
    expect(await lookup(SENDER)).toMatchObject({ known: false });
  });
});

describe("what it must never hand over", () => {
  it("returns the name and nothing else about the person", async () => {
    // A WhatsApp number changes hands. Reading a stored home address back to
    // whoever holds it now is a leak, even though it is "their own" record.
    await customer({ id: "c_4", phone: `+${SENDER}`, name: "Budi" });
    const out = JSON.stringify(await lookup());
    expect(out).not.toContain("rahasia@example.com");
    expect(out).not.toContain("Jalan Rahasia");
    expect(out).not.toContain("catatan internal staf");
  });

  it("never returns another customer's purchase", async () => {
    await customer({ id: "c_5", phone: `+${SENDER}`, name: "Budi" });
    await customer({ id: "c_6", phone: `+${NEIGHBOUR}`, name: "Orang Lain" });
    await order({ id: "o_mine", customerId: "c_5" });
    await order({ id: "o_theirs", customerId: "c_6", total: 99_000_000n });

    const out = JSON.stringify(await lookup());
    expect(out).toContain("15.500.000");
    expect(out).not.toContain("99.000.000");
  });

  it("hands money over as written rupiah, never as a number", async () => {
    // A raw BigInt does not merely look wrong, it throws in JSON.stringify and
    // takes the whole turn down with it.
    await customer({ id: "c_7", phone: `+${SENDER}`, name: "Budi" });
    await order({ id: "o_1", customerId: "c_7" });

    const out = JSON.stringify(await lookup());
    expect(out).toContain("Rp");
    expect(out).not.toMatch(/\b15500000\b/);
  });
});

describe("their own history", () => {
  it("lists what they bought, newest first", async () => {
    await customer({ id: "c_8", phone: `+${SENDER}`, name: "Budi" });
    await order({
      id: "o_old",
      customerId: "c_8",
      ts: new Date(NOW.getTime() - 300 * DAY),
    });
    await order({
      id: "o_new",
      customerId: "c_8",
      ts: new Date(NOW.getTime() - 10 * DAY),
    });

    const out = (await lookup())["orders"] as Array<{ date: string }>;
    expect(out).toHaveLength(2);
    expect(out[0]!.date > out[1]!.date).toBe(true);
  });

  it("finds a walk-in purchase made against the phone with no customer record", async () => {
    await order({ id: "o_walkin", phone: `+${SENDER}` });
    expect(await lookup()).toMatchObject({ known: true });
  });

  it("does not remind a customer of an order that was cancelled", async () => {
    await customer({ id: "c_9", phone: `+${SENDER}`, name: "Budi" });
    await order({ id: "o_batal", customerId: "c_9", status: "BATAL" });
    expect(((await lookup())["orders"] as unknown[]) ?? []).toHaveLength(0);
  });

  it("hides an order still waiting on an internal price approval", async () => {
    // APPROVAL is a state about the shop's own override process, not about
    // anything the customer should be told.
    await customer({ id: "c_10", phone: `+${SENDER}`, name: "Budi" });
    await order({ id: "o_appr", customerId: "c_10", status: "APPROVAL" });
    expect(((await lookup())["orders"] as unknown[]) ?? []).toHaveLength(0);
  });

  it("lists a booking they already have, so the bot does not make a second one", async () => {
    await customer({ id: "c_11", phone: `+${SENDER}`, name: "Budi" });
    await db.reservation.create({
      data: {
        customerId: "c_11",
        phone: `+${SENDER}`,
        status: "TERJADWAL",
        source: "AGEN",
        scheduledFor: new Date("2026-08-21T08:00:00.000Z"),
        createdAt: NOW,
      },
    });
    const out = (await lookup())["reservations"] as Array<{
      code: string;
      when: string;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]!.when).toContain("2026-08-21");
  });

  it("reads a customer without writing one", async () => {
    await customer({ id: "c_12", phone: `+${SENDER}`, name: "Budi" });
    const before = await db.customer.findUniqueOrThrow({
      where: { id: "c_12" },
    });
    await lookup();
    const after = await db.customer.findUniqueOrThrow({
      where: { id: "c_12" },
    });
    expect(after).toEqual(before);
  });
});

describe("check_order", () => {
  const check = (code: string, from = SENDER) =>
    dispatchTool(db, "check_order", { code }, ctx(from)) as Promise<
      Record<string, unknown>
    >;

  it("finds the customer's own purchase by its code", async () => {
    await customer({ id: "c_13", phone: `+${SENDER}`, name: "Budi" });
    const o = await order({ id: "o_2", customerId: "c_13" });
    expect(await check(o.code)).toMatchObject({ found: true, code: o.code });
  });

  it("matches a code the customer typed in lower case", async () => {
    await customer({ id: "c_14", phone: `+${SENDER}`, name: "Budi" });
    const o = await order({ id: "o_3", customerId: "c_14" });
    expect(await check(o.code.toLowerCase())).toMatchObject({ found: true });
  });

  it("answers identically for a stranger's order and one that does not exist", async () => {
    // Otherwise this is an oracle for enumerating other people's purchases:
    // "not found" versus "not yours" tells an attacker the code was real.
    await customer({ id: "c_15", phone: `+${NEIGHBOUR}`, name: "Orang Lain" });
    const theirs = await order({ id: "o_4", customerId: "c_15" });

    const stranger = await check(theirs.code);
    const missing = await check("SI-2099/01-000001");
    expect(stranger).toEqual(missing);
    expect(stranger).toMatchObject({ found: false });
  });

  it("reports no code given rather than scanning the table", async () => {
    expect(await check("")).toMatchObject({ error: expect.any(String) });
  });
});
