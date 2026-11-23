/**
 * Following up once, politely (owner, 2026-10-27) — when the worker writes
 * to a customer by itself, and above all when it does NOT. The positive
 * paths run as nusantara_agent in agentRole.test.ts; this file is the rules.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { dueReminder, followUpPass } from "../src/followUp.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });
/** Thursday 20 August 2026, 10:00 Jakarta. */
const NOW = new Date("2026-08-20T03:00:00.000Z");
const FROM = "628111000611";

let db: PrismaClient;
beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("when a visit is reminded (owner, 2026-11-23)", () => {
  // Friday 21 August, 15:00 Jakarta.
  const VISIT = new Date("2026-08-21T08:00:00.000Z");
  const at = (iso: string) => new Date(iso);
  const BOOKED_EARLY = at("2026-08-18T03:00:00.000Z");

  it("the day before at the same time, then an hour before", () => {
    expect(
      dueReminder(VISIT, BOOKED_EARLY, at("2026-08-20T07:59:00.000Z")),
    ).toBeNull();
    expect(
      dueReminder(VISIT, BOOKED_EARLY, at("2026-08-20T08:00:00.000Z")),
    ).toBe("visit_reminder");
    // Still the day-before one through the morning of the visit…
    expect(
      dueReminder(VISIT, BOOKED_EARLY, at("2026-08-21T06:59:00.000Z")),
    ).toBe("visit_reminder");
    // …and the hour one from an hour before, until the visit.
    expect(
      dueReminder(VISIT, BOOKED_EARLY, at("2026-08-21T07:00:00.000Z")),
    ).toBe("visit_reminder_hour");
    expect(
      dueReminder(VISIT, BOOKED_EARLY, at("2026-08-21T08:00:00.000Z")),
    ).toBeNull();
  });

  it("skips the day-before one for a visit booked a few hours before it", () => {
    // Booked 10:00 Jakarta the day before: its "besok" moment is 5 hours away.
    const booked = at("2026-08-20T03:00:00.000Z");
    expect(
      dueReminder(VISIT, booked, at("2026-08-20T08:00:00.000Z")),
    ).toBeNull();
    expect(dueReminder(VISIT, booked, at("2026-08-21T07:00:00.000Z"))).toBe(
      "visit_reminder_hour",
    );
    // Booked 00:19 for 11:00 the next day (the owner's test chat): 10½ hours.
    const late = at("2026-11-22T17:19:00.000Z");
    const eleven = at("2026-11-24T04:00:00.000Z");
    expect(dueReminder(eleven, late, at("2026-11-23T04:00:00.000Z"))).toBe(
      "visit_reminder",
    );
  });

  it("never reminds a visit booked after the moment", () => {
    const booked = at("2026-08-21T07:30:00.000Z");
    expect(
      dueReminder(VISIT, booked, at("2026-08-21T07:40:00.000Z")),
    ).toBeNull();
  });
});

describe("the quiet hot lead is left alone when", () => {
  const ASKED = new Date(NOW.getTime() - 21 * 3_600_000);

  beforeEach(async () => {
    await truncateAll(db);
    await db.location.create({
      data: {
        id: "loc_f",
        code: "01",
        name: "Toko",
        kind: "TOKO",
        active: true,
        sortOrder: 1,
      },
    });
    await db.category.create({
      data: {
        id: "cat_f",
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
        id: "mdl_f",
        categoryId: "cat_f",
        name: "MacBook Air M2",
        archived: false,
        createdAt: NOW,
      },
    });
    await db.sku.create({
      data: {
        id: "sku_f",
        modelId: "mdl_f",
        code: "F1",
        name: "MacBook Air M2",
        variantLabel: "8/256",
        price: 11_000_000n,
        landed: 1n,
        archived: false,
        createdAt: NOW,
      },
    });
    await db.unit.create({
      data: {
        id: "u_f",
        serial: "SERF",
        skuId: "sku_f",
        status: "TERSEDIA",
        locationId: "loc_f",
        buy: 1n,
        landed: 1n,
        grade: "A",
        intakeAt: NOW,
        version: 1,
      },
    });
    await db.waMessage.create({
      data: {
        waMessageId: "f.1",
        from: FROM,
        text: "air m2 ada kak?",
        msgType: "text",
        ts: ASKED,
        direction: "IN",
        status: "DIJAWAB_AGEN",
        entities: { units: ["SERF"] },
        replyText: "Ada kak",
        answeredByAgent: true,
        answeredAt: new Date(ASKED.getTime() + 10_000),
      },
    });
    await db.waThreadMemory.create({
      data: {
        from: FROM,
        summaryTurns: 0,
        clarifyCount: 0,
        updatedAt: ASKED,
        leadScore: 80,
        leadAt: ASKED,
      },
    });
  });

  const nudged = async (now = NOW) =>
    (await followUpPass({ db, logger, transport: "cloud", now: () => now }))
      .nudged;

  it("is nudged when nothing below applies — the control", async () => {
    expect(await nudged()).toBe(1);
  });

  it("they have not been quiet twenty hours", async () => {
    expect(await nudged(new Date(ASKED.getTime() + 3_600_000))).toBe(0);
  });

  it("the 24-hour window has (nearly) closed", async () => {
    expect(await nudged(new Date(ASKED.getTime() + 23.9 * 3_600_000))).toBe(0);
  });

  it("the bot is off for them", async () => {
    await db.waThreadMemory.update({
      where: { from: FROM },
      data: { autoReply: false },
    });
    expect(await nudged()).toBe(0);
  });

  it("staff cleared the chat", async () => {
    await db.staff.create({
      data: {
        id: "st_f",
        username: "kasir_f",
        name: "Kasir",
        role: "STAFF",
        canApprove: false,
        active: true,
        passwordHash: "unusable",
        createdAt: NOW,
      },
    });
    await db.waThreadMemory.update({
      where: { from: FROM },
      data: { clearedAt: NOW, clearedById: "st_f" },
    });
    expect(await nudged()).toBe(0);
  });

  it("something of theirs is waiting for a colleague", async () => {
    await db.chatAction.create({
      data: {
        from: FROM,
        kind: "PRICE",
        topic: "price",
        summary: "Perlu cek harga",
        createdAt: ASKED,
        updatedAt: ASKED,
      },
    });
    expect(await nudged()).toBe(0);
  });

  it("they already have a visit booked", async () => {
    await db.reservation.create({
      data: {
        phone: `+${FROM}`,
        status: "TERJADWAL",
        source: "AGEN",
        scheduledFor: NOW,
        createdAt: ASKED,
      },
    });
    expect(await nudged()).toBe(0);
  });

  it("they said no", async () => {
    await db.waMessage.update({
      where: { waMessageId: "f.1" },
      data: { text: "ga dulu kak, makasih" },
    });
    expect(await nudged()).toBe(0);
  });

  it("the sale cleared the lead", async () => {
    await db.waThreadMemory.update({
      where: { from: FROM },
      data: { leadClearedAt: NOW },
    });
    expect(await nudged()).toBe(0);
  });

  it("the unit and every one like it has gone, and nothing close is in", async () => {
    await db.unit.update({
      where: { serial: "SERF" },
      data: { status: "TERJUAL" },
    });
    expect(await nudged()).toBe(0);
  });
});
