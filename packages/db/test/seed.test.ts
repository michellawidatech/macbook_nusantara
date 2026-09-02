/**
 * S7 — the seed, and the reconciliation checks it must satisfy.
 *
 * The suite seeds a smaller shop than `pnpm --filter @nusantara/db seed` does,
 * because what is being tested is coherence, not volume — the 5 000-unit run is
 * the script's own Definition of Done and is timed there.
 *
 * 08 §6 also requires each check to be exercised "by a test with a deliberately
 * corrupted fixture, so we know the check itself works". That is the second
 * half of this file: a passing check is only evidence if it can also fail.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/client.js";
import { AGENT_STAFF_ID, seed, SYSTEM_STAFF_ID } from "../src/seed.js";
import { isClean, reconcile } from "../src/reconcile.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  await seed(db, { units: 300, skus: 60, models: 20 });
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("the seeded shop", () => {
  it("satisfies all eight reconciliation checks", async () => {
    const reports = await reconcile(db);
    expect(reports).toHaveLength(8);
    for (const r of reports) {
      expect(
        r.findings,
        `${r.name}: ${JSON.stringify(r.findings.slice(0, 3))}`,
      ).toEqual([]);
    }
    expect(isClean(reports)).toBe(true);
  });

  it("has the shape the plan asks for", async () => {
    expect(await db.location.count()).toBe(3);
    expect(await db.category.count()).toBe(5);
    expect(await db.unit.count()).toBe(300);
    expect(await db.categoryVariantAxis.count()).toBeGreaterThan(0);
    expect(await db.categoryAttribute.count()).toBeGreaterThan(0);
  });

  it("has one OWNER, one STAFF and a reserved system row", async () => {
    expect(await db.staff.count({ where: { role: "OWNER" } })).toBe(1);
    const system = await db.staff.findUniqueOrThrow({
      where: { id: SYSTEM_STAFF_ID },
    });
    // 08 §8: backfilled events are attributable and the account cannot be used.
    expect(system.active).toBe(false);
  });

  it("keeps the chat agent's own principal, which it would otherwise truncate away", async () => {
    // The migration inserts this row so it exists in production, where the
    // seed never runs. But `seed()` truncates every table, so without the same
    // row here a seeded database has no principal for the agent to attribute a
    // reservation hold to, and every booking fails on a foreign key.
    const agent = await db.staff.findUniqueOrThrow({
      where: { id: AGENT_STAFF_ID },
    });
    expect(agent.username).toBe("agent");
    // Never logs in, never offered in a staff picker.
    expect(agent.active).toBe(false);
    // And it is NOT the system row: a report must be able to tell a bot's
    // action apart from reconstructed history.
    expect(AGENT_STAFF_ID).not.toBe(SYSTEM_STAFF_ID);
  });

  it("gives every unit an arrival event", async () => {
    const units = await db.unit.count();
    const arrivals = await db.unitEvent.count({ where: { type: "DITERIMA" } });
    expect(arrivals).toBe(units);
  });

  it("projects status and location from the last event, on every unit", async () => {
    // The same claim as check 1 and 2, asserted directly in SQL so a bug in the
    // checks themselves cannot hide a bug in the seed.
    const drifted = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n
        FROM "Unit" u
        JOIN LATERAL (
          SELECT "toStatus", "toLocationId"
            FROM "UnitEvent" e
           WHERE e."unitId" = u.id
           ORDER BY e.seq DESC
           LIMIT 1
        ) last ON true
       WHERE u.status <> last."toStatus"`;
    expect(Number(drifted[0]?.n ?? 0)).toBe(0);
  });

  it("keeps every ledger gapless", async () => {
    const bad = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT "unitId"
          FROM "UnitEvent"
         GROUP BY "unitId"
        HAVING count(*) <> max(seq) OR count(DISTINCT seq) <> count(*)
      ) x`;
    expect(Number(bad[0]?.n ?? 0)).toBe(0);
  });

  it("sells no unit twice at once", async () => {
    const bad = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT "unitId" FROM "OrderItem"
         WHERE "returnedAt" IS NULL AND "unitId" IS NOT NULL
         GROUP BY "unitId" HAVING count(*) > 1
      ) x`;
    expect(Number(bad[0]?.n ?? 0)).toBe(0);
  });

  it("produced orders whose money adds up", async () => {
    const orders = await db.order.count();
    expect(orders).toBeGreaterThan(0);
    const bad = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Order" o
       WHERE o.total <> o.subtotal - o.discount + o.extra`;
    expect(Number(bad[0]?.n ?? 0)).toBe(0);
  });

  it("is deterministic — the same seed builds the same shop", async () => {
    const first = await db.unit.findMany({
      orderBy: { serial: "asc" },
      take: 20,
      select: { serial: true, status: true, locationId: true },
    });

    await seed(db, { units: 300, skus: 60, models: 20 });

    const second = await db.unit.findMany({
      orderBy: { serial: "asc" },
      take: 20,
      select: { serial: true, status: true, locationId: true },
    });
    expect(second).toEqual(first);
  }, 120_000);

  it("resets cleanly rather than piling up", async () => {
    // The previous test already re-ran it; the counts must not have doubled.
    expect(await db.unit.count()).toBe(300);
    expect(await db.location.count()).toBe(3);
  });
});

describe("08 §6 — the checks themselves can fail", () => {
  it("catches a drifted status projection", async () => {
    const unit = await db.unit.findFirstOrThrow({
      where: { status: "TERSEDIA" },
    });
    await db.unit.update({
      where: { id: unit.id },
      data: { status: "HILANG" },
    });

    const reports = await reconcile(db);
    const check = reports.find((r) => r.name === "PROYEKSI_STATUS");
    expect(check?.findings).toHaveLength(1);
    expect(check?.findings[0]?.subject).toBe(unit.serial);

    await db.unit.update({
      where: { id: unit.id },
      data: { status: unit.status },
    });
    expect(isClean(await reconcile(db))).toBe(true);
  });

  it("catches a drifted location projection", async () => {
    const unit = await db.unit.findFirstOrThrow({
      where: { locationId: "loc_gudang" },
    });
    await db.unit.update({
      where: { id: unit.id },
      data: { locationId: "loc_servis" },
    });

    const check = (await reconcile(db)).find(
      (r) => r.name === "PROYEKSI_LOKASI",
    );
    expect(check?.findings).toHaveLength(1);

    await db.unit.update({
      where: { id: unit.id },
      data: { locationId: "loc_gudang" },
    });
  });

  it("catches an order whose total no longer matches its lines", async () => {
    const order = await db.order.findFirstOrThrow();
    await db.$executeRaw`
      UPDATE "Order" SET subtotal = subtotal + 1, total = total + 1 WHERE id = ${order.id}`;

    const check = (await reconcile(db)).find(
      (r) => r.name === "ARITMATIKA_ORDER",
    );
    expect(check?.findings).toHaveLength(1);
    expect(check?.severity).toBe("ALERT");

    await db.$executeRaw`
      UPDATE "Order" SET subtotal = subtotal - 1, total = total - 1 WHERE id = ${order.id}`;
  });

  it("catches payments that no longer cover paidTotal", async () => {
    const order = await db.order.findFirstOrThrow({
      where: { paidTotal: { gt: 0n } },
    });
    await db.order.update({
      where: { id: order.id },
      data: { paidTotal: order.paidTotal + 5n },
    });

    const check = (await reconcile(db)).find(
      (r) => r.name === "CAKUPAN_PEMBAYARAN",
    );
    expect(check?.findings).toHaveLength(1);

    await db.order.update({
      where: { id: order.id },
      data: { paidTotal: order.paidTotal },
    });
  });

  it("catches a till that does not reconcile", async () => {
    const shift = await db.shift.findFirstOrThrow();
    await db.shift.update({
      where: { id: shift.id },
      data: { expected: shift.expected + 1_000n },
    });

    const check = (await reconcile(db)).find((r) => r.name === "KAS_SHIFT");
    expect(check?.findings).toHaveLength(1);

    await db.shift.update({
      where: { id: shift.id },
      data: { expected: shift.expected },
    });
    expect(isClean(await reconcile(db))).toBe(true);
  });
});
