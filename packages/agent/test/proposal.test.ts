/**
 * Chatbot v2 step 5 against a real database: a visit is proposed (nothing is
 * held), then confirmed by code (the units are held, under the customer's own
 * number), and a profile keeps a budget range and its facts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { dispatchTool, type ToolContext } from "../src/index.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

const FROM = "628111000801";
const OTHER = "628111000802";
const AGENT_STAFF = "staff_agent";
/** Thursday 20 August 2026, 10:00 Jakarta. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const TOMORROW_2PM = "2026-08-21T14:00";

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
  await db.staff.create({
    data: {
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
      name: "MacBook Pro 16 M3",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_t",
      modelId: "mdl_t",
      code: "SKU-T1",
      name: "MacBook Pro 16 M3 512GB",
      variantLabel: "18/512",
      grade: "A",
      price: 32_500_000n,
      landed: 28_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  for (const [i, serial] of ["MBP1", "MBP2"].entries()) {
    await db.unit.create({
      data: {
        id: `u_${i}`,
        serial,
        skuId: "sku_t",
        status: "QC",
        locationId: "loc_t",
        buy: 28_000_000n,
        landed: 28_000_000n,
        grade: "A",
        intakeAt: NOW,
        version: 1,
      },
    });
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
});

const ctx = (from = FROM, at = NOW): ToolContext => ({
  from,
  now: at,
  reserve: { write: db, staffId: AGENT_STAFF, graceMs: 4 * 3_600_000 },
  profile: { write: db },
  writesUsed: new Set(),
  onError: (_t, e) => {
    throw e;
  },
});

const propose = (args: Record<string, unknown>, c = ctx()) =>
  dispatchTool(db, "propose_reservation", args, c) as Promise<
    Record<string, unknown>
  >;
const confirm = (c = ctx()) =>
  dispatchTool(db, "confirm_reservation", {}, c) as Promise<
    Record<string, unknown>
  >;

describe("proposing a visit", () => {
  it("records the units and the time and holds nothing", async () => {
    const out = await propose({
      serials: "MBP1, MBP2",
      when: TOMORROW_2PM,
      custName: "Budi",
    });
    expect(out).toMatchObject({ ok: true, proposed: true, custName: "Budi" });
    expect((out["units"] as unknown[]).length).toBe(2);
    expect(await db.reservation.count()).toBe(0);
    const units = await db.unit.findMany({ select: { status: true } });
    expect(units.every((u) => u.status === "TERSEDIA")).toBe(true);
  });

  it("refuses a time the shop is shut, as a hold would", async () => {
    expect(
      await propose({
        serials: "MBP1",
        when: "2026-08-21T23:00",
        custName: "Budi",
      }),
    ).toMatchObject({ closedThen: true });
    expect(await db.reservationProposal.count()).toBe(0);
  });

  it("asks for a name before anything else is written", async () => {
    expect(
      await propose({ serials: "MBP1", when: TOMORROW_2PM }),
    ).toMatchObject({ needName: true });
  });

  it("replaces the customer's earlier proposal", async () => {
    await propose({ serials: "MBP1", when: TOMORROW_2PM, custName: "Budi" });
    await propose({ serials: "MBP2", when: TOMORROW_2PM, custName: "Budi" });
    expect(
      await db.reservationProposal.count({
        where: { cancelledAt: null, confirmedAt: null },
      }),
    ).toBe(1);
  });
});

describe("confirming it", () => {
  it("books a visit under the customer's own number, holding none of the units (2026-10-27)", async () => {
    await propose({
      serials: "MBP1, MBP2",
      when: TOMORROW_2PM,
      custName: "Budi",
    });
    const out = await confirm();
    expect(out).toMatchObject({ ok: true, visit: true, custName: "Budi" });
    expect(String(out["code"])).toMatch(/^RV-/);
    const visit = await db.reservation.findFirstOrThrow({
      select: { phone: true, custName: true, items: true, status: true },
    });
    expect(visit).toMatchObject({
      phone: `+${FROM}`,
      custName: "Budi",
      status: "TERJADWAL",
    });
    // A visit: nothing leaves the shelf, and the proposal keeps which units.
    expect(visit.items).toHaveLength(0);
    expect(await db.unit.count({ where: { status: "DIRESERVASI" } })).toBe(0);
    expect(await db.reservationProposalItem.count()).toBe(2);
    expect(
      await db.reservationProposal.count({
        where: { confirmedAt: { not: null } },
      }),
    ).toBe(1);
  });

  it("confirms nothing for a customer with no proposal of their own", async () => {
    await propose({ serials: "MBP1", when: TOMORROW_2PM, custName: "Budi" });
    expect(await confirm(ctx(OTHER))).toMatchObject({ noProposal: true });
    expect(await db.reservation.count()).toBe(0);
  });

  it("lets a proposal go stale after half an hour", async () => {
    await propose({ serials: "MBP1", when: TOMORROW_2PM, custName: "Budi" });
    const late = new Date(NOW.getTime() + 31 * 60_000);
    expect(await confirm(ctx(FROM, late))).toMatchObject({ noProposal: true });
  });

  it("books once, however many times the yes arrives", async () => {
    await propose({ serials: "MBP1", when: TOMORROW_2PM, custName: "Budi" });
    await confirm();
    expect(await confirm()).toMatchObject({ noProposal: true });
    expect(await db.reservation.count()).toBe(1);
  });
});

describe("remembering the customer", () => {
  it("keeps a budget range, estimates and facts, once each", async () => {
    const save = (args: Record<string, unknown>) =>
      dispatchTool(db, "remember_customer", args, ctx());
    await save({
      name: "Ayu",
      budget_min: 12_000_000,
      budget_max: 15_000_000,
      age_estimate: "19-22",
      occupation: "mahasiswa DKV",
      usage: "design, kuliah",
      apps: "Photoshop, Figma",
      preferences: "14 inch",
    });
    await save({ apps: "photoshop, Premiere" });

    const p = await db.customerProfile.findUniqueOrThrow({
      where: { from: FROM },
      include: { facts: true },
    });
    expect(p).toMatchObject({
      name: "Ayu",
      budgetMin: 12_000_000n,
      budgetMax: 15_000_000n,
      ageEstimate: "19-22",
      occupation: "mahasiswa DKV",
    });
    expect(
      p.facts
        .filter((f) => f.kind === "APP")
        .map((f) => f.value)
        .sort(),
    ).toEqual(["Figma", "Photoshop", "Premiere"]);
    expect(p.facts.every((f) => f.source === "BOT")).toBe(true);
  });

  it("reads one stated figure as a range of one", async () => {
    await dispatchTool(db, "remember_customer", { budget: 15_000_000 }, ctx());
    expect(
      await db.customerProfile.findUniqueOrThrow({ where: { from: FROM } }),
    ).toMatchObject({ budgetMin: 15_000_000n, budgetMax: 15_000_000n });
  });
});

describe("no placeholder for a name (owner report 2026-10-27)", () => {
  it.each(["unknown", "-", "tidak tahu", "N/A", "628111000801"])(
    "remember_customer drops the name %j and keeps the rest",
    async (name) => {
      const out = await dispatchTool(
        db,
        "remember_customer",
        { name, usage: "kuliah" },
        ctx(),
      );
      expect(out).toMatchObject({ saved: true });
      const p = await db.customerProfile.findUniqueOrThrow({
        where: { from: FROM },
        include: { facts: true },
      });
      expect(p.name).toBeNull();
      expect(p.facts.map((f) => f.value)).toEqual(["kuliah"]);
      // And no Customer row is made under it.
      expect(await db.customer.count()).toBe(0);
    },
  );

  it("a placeholder alone saves nothing", async () => {
    expect(
      await dispatchTool(db, "remember_customer", { name: "unknown" }, ctx()),
    ).toEqual({ saved: false });
  });

  it("a visit is not proposed under one: the name is asked for", async () => {
    expect(
      await propose({ when: TOMORROW_2PM, custName: "unknown" }),
    ).toMatchObject({ needName: true });
  });
});

describe("how many photos each unit has (2026-10-27)", () => {
  const photograph = async (serial: string, n: number) => {
    const unit = await db.unit.findUniqueOrThrow({ where: { serial } });
    await db.unitNote.create({
      data: {
        unitId: unit.id,
        serial,
        body: "QC",
        tag: "QC",
        staffId: AGENT_STAFF,
        at: NOW,
        photos: {
          create: Array.from({ length: n }, (_, i) => ({
            url: `qc/${serial}/${i}.jpg`,
            sortOrder: i,
          })),
        },
      },
    });
  };

  it("search_stock and check_serial carry the count, 0 included", async () => {
    await photograph("MBP1", 2);
    const live = {
      ...ctx(),
      capabilities: { stock: true, price: true, reserve: true, photos: true },
    };
    const out = (await dispatchTool(
      db,
      "search_stock",
      { query: "macbook pro" },
      live,
    )) as {
      units: Array<{ serial: string; photos?: number }>;
      photosNote?: string;
    };
    const by = new Map(out.units.map((u) => [u.serial, u.photos]));
    expect(by.get("MBP1")).toBe(2);
    expect(by.get("MBP2")).toBe(0);
    expect(out.photosNote).toMatch(
      /only for a unit you named whose photos is above 0/,
    );
    expect(
      await dispatchTool(db, "check_serial", { serial: "MBP2" }, live),
    ).toMatchObject({ photos: 0 });
  });
});
