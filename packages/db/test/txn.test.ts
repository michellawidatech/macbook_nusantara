/**
 * S4 — the transaction primitives, proven against a real PostgreSQL.
 *
 * docs/rebuild/08-data-integrity.md §3 and §5. The two claims that matter are
 * the ones concurrency actually breaks:
 *
 *   - ordered locking means two cashiers scanning the same devices in opposite
 *     orders never deadlock;
 *   - `seq` is gapless even when several transactions append to one unit.
 *
 * Both are tested by running the race, not by reasoning about it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Prisma,
  PrismaClient,
  UnknownSerialError,
  appendUnitEvent,
  claimOutbox,
  enqueueOutbox,
  isRetryable,
  markOutboxFailed,
  markOutboxSent,
  withRetry,
  withUnitLocks,
} from "../src/index.js";
import { IllegalUnitTransitionError } from "@nusantara/domain";

const URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

let db: PrismaClient;

const LOC = "s4_loc";
const LOC2 = "s4_loc2";
const STAFF = "s4_staff";

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT quote_ident(tablename) AS t FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`,
  );

  await db.location.createMany({
    data: [
      {
        id: LOC,
        code: "TOKO-1",
        name: "Toko",
        kind: "TOKO",
        active: true,
        sortOrder: 1,
      },
      {
        id: LOC2,
        code: "GDG-1",
        name: "Gudang",
        kind: "GUDANG",
        active: true,
        sortOrder: 2,
      },
    ],
  });
  await db.staff.create({
    data: {
      id: STAFF,
      username: "kasir",
      name: "Kasir",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: "x",
      createdAt: new Date(),
    },
  });
  await db.category.create({
    data: {
      id: "s4_cat",
      name: "Laptop",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 10n,
      marginMax: 50n,
      createdAt: new Date(),
    },
  });
  await db.catalogModel.create({
    data: {
      id: "s4_model",
      categoryId: "s4_cat",
      name: "MacBook Air M1",
      archived: false,
      createdAt: new Date(),
    },
  });
  await db.sku.create({
    data: {
      id: "s4_sku",
      modelId: "s4_model",
      code: "SKU-1",
      name: "MacBook Air M1",
      price: 12_000_000n,
      landed: 9_000_000n,
      archived: false,
      createdAt: new Date(),
    },
  });
  await db.unit.createMany({
    data: ["SER-A", "SER-B", "SER-C"].map((serial, i) => ({
      id: `s4_unit_${i}`,
      serial,
      skuId: "s4_sku",
      status: "TERSEDIA" as const,
      locationId: LOC,
      buy: 9_000_000n,
      landed: 9_000_000n,
      intakeAt: new Date(),
      version: 1,
    })),
  });
});

describe("withUnitLocks — 08 §3 ordered locking", () => {
  it("returns the units in ascending serial order, whatever order they were scanned", async () => {
    const rows = await db.$transaction((tx) =>
      withUnitLocks(tx, ["SER-C", "SER-A", "SER-B"]),
    );
    expect(rows.map((r) => r.serial)).toEqual(["SER-A", "SER-B", "SER-C"]);
  });

  it("collapses a double scan of the same device", async () => {
    const rows = await db.$transaction((tx) =>
      withUnitLocks(tx, ["SER-A", "SER-A"]),
    );
    expect(rows).toHaveLength(1);
  });

  it("locks nothing when asked for nothing", async () => {
    expect(await db.$transaction((tx) => withUnitLocks(tx, []))).toEqual([]);
  });

  it("names every serial it could not find", async () => {
    await expect(
      db.$transaction((tx) => withUnitLocks(tx, ["SER-A", "NOPE-1", "NOPE-2"])),
    ).rejects.toThrow(UnknownSerialError);

    try {
      await db.$transaction((tx) => withUnitLocks(tx, ["NOPE-1", "NOPE-2"]));
      expect.unreachable("must reject an unknown serial");
    } catch (e) {
      expect((e as UnknownSerialError).serials).toEqual(["NOPE-1", "NOPE-2"]);
    }
  });

  it("does not deadlock when two transactions want the same two serials in opposite orders", async () => {
    // The scenario 08 §3 names: two cashiers, two devices, opposite scan order.
    const hold = async (scanned: string[]) =>
      db.$transaction(
        async (tx) => {
          const units = await withUnitLocks(tx, scanned);
          // Hold both locks for long enough that the other side is definitely
          // inside its own transaction and waiting.
          await tx.$executeRaw`SELECT pg_sleep(0.05)`;
          for (const u of units) {
            await tx.unit.update({
              where: { id: u.id },
              data: { version: { increment: 1 } },
            });
          }
          return units.length;
        },
        { maxWait: 5_000, timeout: 10_000 },
      );

    const results = await Promise.all([
      hold(["SER-A", "SER-B"]),
      hold(["SER-B", "SER-A"]),
      hold(["SER-B", "SER-A"]),
      hold(["SER-A", "SER-B"]),
    ]);

    expect(results).toEqual([2, 2, 2, 2]);
  });

  it("would deadlock without the ordering — the control case", async () => {
    // Locking one at a time in opposite orders is exactly what withUnitLocks
    // prevents. If this ever stops deadlocking, the test above proves nothing.
    const unordered = (first: string, second: string) =>
      db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Unit" WHERE serial = ${first} FOR UPDATE`;
          await tx.$executeRaw`SELECT pg_sleep(0.15)`;
          await tx.$queryRaw`SELECT id FROM "Unit" WHERE serial = ${second} FOR UPDATE`;
        },
        { maxWait: 5_000, timeout: 10_000 },
      );

    const settled = await Promise.allSettled([
      unordered("SER-A", "SER-B"),
      unordered("SER-B", "SER-A"),
    ]);

    expect(settled.some((r) => r.status === "rejected")).toBe(true);
  });
});

describe("appendUnitEvent — 08 §1 and §4", () => {
  /** Arrival. Until this runs the unit has no history, so nothing else is legal. */
  const intake = (serial: string) =>
    db.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial,
        type: "DITERIMA",
        staffId: STAFF,
        toLocationId: LOC,
      }),
    );

  it("is the only legal first event", async () => {
    await expect(
      db.$transaction((tx) =>
        appendUnitEvent(tx, {
          serial: "SER-A",
          type: "TERJUAL",
          staffId: STAFF,
        }),
      ),
    ).rejects.toThrow(/belum tercatat di stok/);
  });

  it("reads the current status from the ledger, not from the projection", async () => {
    await intake("SER-A");
    // Corrupt the projection the way drift would (08 §6 check 1).
    await db.unit.update({
      where: { serial: "SER-A" },
      data: { status: "TERJUAL" },
    });

    // TERJUAL -> TERJUAL would be illegal if the cache were trusted; the ledger
    // still says TERSEDIA, so the sale is allowed and the cache is repaired.
    const ev = await db.$transaction((tx) =>
      appendUnitEvent(tx, { serial: "SER-A", type: "TERJUAL", staffId: STAFF }),
    );
    expect(ev.seq).toBe(2);
    expect(ev.toStatus).toBe("TERJUAL");
  });

  it("writes the event and the projection together", async () => {
    const ev = await db.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial: "SER-A",
        type: "DITERIMA",
        staffId: STAFF,
        toLocationId: LOC,
      }),
    );

    expect(ev.seq).toBe(1);
    expect(ev.toStatus).toBe("TERSEDIA");

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SER-A" },
    });
    expect(unit.status).toBe("TERSEDIA");
    expect(unit.version).toBe(2); // projection bumped the optimistic lock
  });

  it("moves the unit and records where it came from", async () => {
    await db.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial: "SER-A",
        type: "DITERIMA",
        staffId: STAFF,
        toLocationId: LOC,
      }),
    );
    await db.$transaction((tx) =>
      appendUnitEvent(tx, {
        serial: "SER-A",
        type: "DIPINDAH",
        staffId: STAFF,
        toLocationId: LOC2,
      }),
    );

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SER-A" },
    });
    expect(unit.locationId).toBe(LOC2);

    const ev = await db.unitEvent.findFirstOrThrow({
      where: { seq: 2, serial: "SER-A" },
    });
    expect(ev.fromLocationId).toBe(LOC);
    expect(ev.toLocationId).toBe(LOC2);
  });

  it("carries the serial as an immutable copy", async () => {
    await intake("SER-A");
    await db.$transaction((tx) =>
      appendUnitEvent(tx, { serial: "SER-A", type: "DICATAT", staffId: STAFF }),
    );
    const ev = await db.unitEvent.findFirstOrThrow({
      where: { serial: "SER-A", seq: 2 },
    });
    expect(ev.serial).toBe("SER-A");
    expect(ev.toLocationId).toBeNull(); // a note does not move anything
    expect(ev.fromStatus).toBe("TERSEDIA");
  });

  it("refuses an illegal transition by name, and writes nothing", async () => {
    await intake("SER-A");
    await db.$transaction((tx) =>
      appendUnitEvent(tx, { serial: "SER-A", type: "TERJUAL", staffId: STAFF }),
    );

    await expect(
      db.$transaction((tx) =>
        appendUnitEvent(tx, {
          serial: "SER-A",
          type: "TERJUAL",
          staffId: STAFF,
        }),
      ),
    ).rejects.toThrow(IllegalUnitTransitionError);

    expect(await db.unitEvent.count({ where: { serial: "SER-A" } })).toBe(2);
  });

  it("rolls the projection back with the event when the transaction fails", async () => {
    await intake("SER-A");
    await expect(
      db.$transaction(async (tx) => {
        await appendUnitEvent(tx, {
          serial: "SER-A",
          type: "TERJUAL",
          staffId: STAFF,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const unit = await db.unit.findUniqueOrThrow({
      where: { serial: "SER-A" },
    });
    expect(unit.status).toBe("TERSEDIA");
    expect(await db.unitEvent.count()).toBe(1); // only the intake survived
  });

  it("keeps seq gapless under concurrent appends to one unit", async () => {
    const N = 12;
    await intake("SER-A");

    await Promise.all(
      Array.from({ length: N }, () =>
        withRetry(
          db,
          (tx) =>
            appendUnitEvent(tx, {
              serial: "SER-A",
              type: "DICATAT",
              staffId: STAFF,
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        ),
      ),
    );

    const seqs = (
      await db.unitEvent.findMany({
        where: { serial: "SER-A" },
        orderBy: { seq: "asc" },
      })
    ).map((e) => e.seq);

    expect(seqs).toEqual(Array.from({ length: N + 1 }, (_, i) => i + 1));
  });

  it("stays gapless under serializable isolation too", async () => {
    const N = 8;
    await intake("SER-B");

    await Promise.all(
      Array.from({ length: N }, () =>
        withRetry(db, (tx) =>
          appendUnitEvent(tx, {
            serial: "SER-B",
            type: "DICATAT",
            staffId: STAFF,
          }),
        ),
      ),
    );

    const seqs = (
      await db.unitEvent.findMany({
        where: { serial: "SER-B" },
        orderBy: { seq: "asc" },
      })
    ).map((e) => e.seq);

    expect(seqs).toEqual(Array.from({ length: N + 1 }, (_, i) => i + 1));
  });
});

describe("withRetry — 08 §3", () => {
  it("recognises a write conflict and nothing else", () => {
    expect(isRetryable({ code: "40001" })).toBe(true);
    expect(isRetryable({ code: "40P01" })).toBe(true);
    expect(isRetryable({ code: "23505" })).toBe(false);
    expect(isRetryable(new Error("nope"))).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(
      isRetryable(
        new Prisma.PrismaClientKnownRequestError("conflict", {
          code: "P2034",
          clientVersion: "6",
        }),
      ),
    ).toBe(true);
    expect(
      isRetryable(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "6",
          meta: { code: "40001" },
        }),
      ),
    ).toBe(true);
    expect(
      isRetryable(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "6",
        }),
      ),
    ).toBe(false);
  });

  it("retries a conflict with capped, jittered backoff and then succeeds", async () => {
    const slept: number[] = [];
    let calls = 0;

    const fakeClient = {
      $transaction: async (fn: (tx: unknown) => Promise<string>) => {
        calls += 1;
        if (calls < 3) throw { code: "40001" };
        return fn({});
      },
    } as unknown as PrismaClient;

    const out = await withRetry(fakeClient, async () => "ok", {
      sleep: async (ms) => {
        slept.push(ms);
      },
      random: () => 1,
      baseDelayMs: 10,
      maxDelayMs: 15,
    });

    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(slept).toEqual([10, 15]); // 10, then 20 capped to 15
  });

  it("gives up after the last attempt and rethrows the conflict", async () => {
    const fakeClient = {
      $transaction: async () => {
        throw { code: "40001" };
      },
    } as unknown as PrismaClient;

    await expect(
      withRetry(fakeClient, async () => "never", {
        attempts: 2,
        sleep: async () => {},
        random: () => 0,
      }),
    ).rejects.toMatchObject({ code: "40001" });
  });

  it("does not retry a constraint violation", async () => {
    let calls = 0;
    const fakeClient = {
      $transaction: async () => {
        calls += 1;
        throw { code: "23514" };
      },
    } as unknown as PrismaClient;

    await expect(
      withRetry(fakeClient, async () => "never", { sleep: async () => {} }),
    ).rejects.toMatchObject({ code: "23514" });
    expect(calls).toBe(1);
  });
});

describe("outbox — 08 §5", () => {
  const intent = { to: "628123", body: "halo" };

  it("is written inside the caller's transaction, and lost if it rolls back", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await enqueueOutbox(tx, { kind: "WA_REPLY", payload: intent });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.outbox.count()).toBe(0);
  });

  it("claims one due row at a time and marks it SENDING", async () => {
    await db.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "WA_REPLY", payload: intent }),
    );

    const claimed = await claimOutbox(db);
    expect(claimed?.status).toBe("SENDING");
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.kind).toBe("WA_REPLY");

    // Nothing left that is due.
    expect(await claimOutbox(db)).toBeNull();
  });

  it("does not claim a row whose backoff has not elapsed", async () => {
    await db.$transaction((tx) =>
      enqueueOutbox(tx, {
        kind: "ALERT",
        payload: intent,
        nextAttemptAt: new Date(Date.now() + 60_000),
      }),
    );
    expect(await claimOutbox(db)).toBeNull();
  });

  it("hands two workers different rows — SKIP LOCKED is the whole story", async () => {
    for (const i of [1, 2, 3]) {
      await db.$transaction((tx) =>
        enqueueOutbox(tx, { kind: "WA_REPLY", payload: { ...intent, i } }),
      );
    }

    const [a, b] = await Promise.all([claimOutbox(db), claimOutbox(db)]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.id).not.toBe(b?.id);
  });

  it("marks a sent row and stops offering it", async () => {
    await db.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "IG_DM", payload: intent }),
    );
    const claimed = await claimOutbox(db);
    await markOutboxSent(db, claimed!.id);

    const row = await db.outbox.findUniqueOrThrow({
      where: { id: claimed!.id },
    });
    expect(row.status).toBe("SENT");
    expect(row.sentAt).not.toBeNull();
  });

  it("backs a failure off, then gives up loudly rather than dropping it", async () => {
    await db.$transaction((tx) =>
      enqueueOutbox(tx, { kind: "IG_REPLY", payload: intent }),
    );
    const claimed = await claimOutbox(db);

    const status = await markOutboxFailed(db, claimed!, "429 dari Meta", {
      random: () => 1,
    });
    expect(status).toBe("PENDING");

    const retried = await db.outbox.findUniqueOrThrow({
      where: { id: claimed!.id },
    });
    expect(retried.lastError).toBe("429 dari Meta");
    expect(retried.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Exhausted rows go to FAILED — never silently dropped.
    const exhausted = await markOutboxFailed(
      db,
      { id: claimed!.id, attempts: 6 },
      "menyerah",
      { random: () => 0 },
    );
    expect(exhausted).toBe("FAILED");
    expect(
      (await db.outbox.findUniqueOrThrow({ where: { id: claimed!.id } }))
        .status,
    ).toBe("FAILED");
  });
});
