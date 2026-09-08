/**
 * Inbound & QC: a serial becomes a machine, and then becomes sellable stock.
 *
 * This is the flow the owner reported broken on the deployed app — "I have
 * inbound that I accept to inventory and I want to see it in S/N tracker, I
 * cannot see it". The cause was not these functions; it was that Inbound & QC
 * wrote to a browser-memory mock while S/N tracking read the database, so the
 * two could never agree. These are the writes that put both on the same data,
 * and the last case here is that complaint stated as an assertion: accept a
 * machine, then find it through the query the S/N tracker actually calls.
 *
 * Runs against a real database — see agentRole.test.ts for how to create one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/client.js";
import { seed, SYSTEM_STAFF_ID } from "../src/seed.js";
import { acceptUnits, receiveUnit } from "../src/inbound.js";
import { searchUnits, unitTimeline } from "../src/units.js";
import { isClean, reconcile } from "../src/reconcile.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

let db: PrismaClient;
let skuId: string;
let locationId: string;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  // Reference data only: these tests are about units this file creates, and a
  // fixture that already contains three dozen of them would hide a query
  // returning the wrong row.
  await seed(db, { referenceOnly: true });
  skuId = (await db.sku.findFirstOrThrow({ select: { id: true } })).id;
  locationId = (
    await db.location.findFirstOrThrow({
      where: { code: "GDG-SRP" },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  // Between cases, not between runs: every case here mints its own serial, and
  // TRUNCATE would take the reference data with it.
  // One statement per call: Prisma sends these as prepared statements, and
  // PostgreSQL refuses more than one command in a prepared statement (42601).
  // Children before parents — every FK here is onDelete: Restrict, because
  // nothing in this system cascades.
  await db.$executeRawUnsafe('DELETE FROM "UnitEvent"');
  await db.$executeRawUnsafe('DELETE FROM "UnitNotePhoto"');
  await db.$executeRawUnsafe('DELETE FROM "UnitNote"');
  await db.$executeRawUnsafe('DELETE FROM "UnitAttribute"');
  await db.$executeRawUnsafe('DELETE FROM "Unit"');
});

const receive = (serial: string) =>
  db.$transaction((tx) =>
    receiveUnit(tx, {
      serial,
      skuId,
      buy: 10_000_000n,
      landed: 10_250_000n,
      locationId,
      staffId: SYSTEM_STAFF_ID,
    }),
  );

describe("receiveUnit", () => {
  it("puts a brand-new serial into QC, not onto the shelf", async () => {
    await receive("SC02AA001AAA");

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA001AAA" },
      select: {
        status: true,
        locationId: true,
        grade: true,
        description: true,
      },
    });
    // QC, because a machine nobody has inspected is not sellable — and the
    // status was derived from the ledger, never passed in.
    expect(unit.status).toBe("QC");
    expect(unit.locationId).toBe(locationId);
    expect(unit.grade).toBeNull();
    expect(unit.description).toBeNull();
  });

  it("writes the genesis event in the same breath as the row", async () => {
    await receive("SC02AA002AAA");

    const events = await db.unitEvent.findMany({
      where: { serial: "SC02AA002AAA" },
      select: { type: true, seq: true, toStatus: true },
    });
    // Exactly one, and it is the genesis: a unit that exists without the event
    // that created it is a hole in an append-only ledger.
    expect(events).toEqual([{ type: "DITERIMA", seq: 1, toStatus: "QC" }]);
  });

  it("refuses a serial the shop already holds", async () => {
    await receive("SC02AA003AAA");
    // The unique index is the guard, not a lookup-then-insert in application
    // code, which two tills could both pass on the same scan.
    await expect(receive("SC02AA003AAA")).rejects.toThrow();
  });
});

describe("acceptUnits", () => {
  it("moves QC to sellable and records what QC concluded", async () => {
    await receive("SC02AA004AAA");

    await db.$transaction((tx) =>
      acceptUnits(tx, {
        units: [
          {
            serial: "SC02AA004AAA",
            grade: "B",
            description: "lecet halus di lid, baterai sehat",
          },
        ],
        staffId: SYSTEM_STAFF_ID,
        refCode: "PO-0001",
      }),
    );

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA004AAA" },
      select: { status: true, grade: true, description: true },
    });
    expect(unit.status).toBe("TERSEDIA");
    expect(unit.grade).toBe("B");
    expect(unit.description).toBe("lecet halus di lid, baterai sehat");

    const events = await db.unitEvent.findMany({
      where: { serial: "SC02AA004AAA" },
      orderBy: { seq: "asc" },
      select: { type: true, seq: true, toStatus: true, note: true },
    });
    // Appended, never rewritten: DITERIMA is still there underneath.
    expect(events.map((e) => e.type)).toEqual(["DITERIMA", "QC_SELESAI"]);
    expect(events[1]?.toStatus).toBe("TERSEDIA");
    expect(events[1]?.note).toContain("PO-0001");
  });

  it("accepts a sealed machine with no description at all", async () => {
    await receive("SC02AA005AAA");
    await db.$transaction((tx) =>
      acceptUnits(tx, {
        units: [{ serial: "SC02AA005AAA", grade: "NEW" }],
        staffId: SYSTEM_STAFF_ID,
      }),
    );
    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA005AAA" },
      select: { status: true, grade: true, description: true },
    });
    // "New needs neither" — there is nothing to inspect in an unopened box.
    expect(unit.status).toBe("TERSEDIA");
    expect(unit.grade).toBe("NEW");
    expect(unit.description).toBeNull();
  });

  it("takes the whole invoice or none of it", async () => {
    await receive("SC02AA006AAA");
    await receive("SC02AA007AAA");

    await expect(
      db.$transaction((tx) =>
        acceptUnits(tx, {
          units: [
            { serial: "SC02AA006AAA", grade: "A", description: "mulus" },
            // Never received, so appendUnitEvent cannot find it.
            { serial: "SC02AA999ZZZ", grade: "A", description: "hantu" },
          ],
          staffId: SYSTEM_STAFF_ID,
        }),
      ),
    ).rejects.toThrow();

    // The good one must NOT have been accepted: a half-accepted invoice leaves
    // the operator working out which rows went through by reading the grid.
    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SC02AA006AAA" },
      select: { status: true },
    });
    expect(unit.status).toBe("QC");
  });
});

describe("the owner's complaint, as an assertion", () => {
  it("shows an accepted machine in the S/N tracker's own queries", async () => {
    await receive("SC02AA008AAA");
    await db.$transaction((tx) =>
      acceptUnits(tx, {
        units: [{ serial: "SC02AA008AAA", grade: "A", description: "mulus" }],
        staffId: SYSTEM_STAFF_ID,
        refCode: "PO-0002",
      }),
    );

    // searchUnits is what the tracker's picker calls...
    const found = await searchUnits(db, { q: "SC02AA008" });
    expect(found.map((u) => u.serial)).toContain("SC02AA008AAA");

    // ...and unitTimeline is what it renders once you pick one.
    // Newest first — the order the screen reads in, so the machine's most
    // recent fact is the one at the top.
    const timeline = await unitTimeline(db, "SC02AA008AAA");
    expect(timeline.unit.serial).toBe("SC02AA008AAA");
    expect(timeline.events.map((e) => e.type)).toEqual([
      "QC_SELESAI",
      "DITERIMA",
    ]);
  });

  it("leaves the shop reconcilable after an intake", async () => {
    await receive("SC02AA009AAA");
    await db.$transaction((tx) =>
      acceptUnits(tx, {
        units: [{ serial: "SC02AA009AAA", grade: "A", description: "mulus" }],
        staffId: SYSTEM_STAFF_ID,
      }),
    );

    // Check 6 is orphan units — a unit with no event — which is exactly what a
    // half-written intake produces.
    const reports = await reconcile(db);
    for (const r of reports) {
      expect(r.findings, `${r.name}`).toEqual([]);
    }
    expect(isClean(reports)).toBe(true);
  });
});
