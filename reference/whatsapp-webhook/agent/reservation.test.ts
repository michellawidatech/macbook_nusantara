import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "../test/harness.js";
import { addDays, today } from "./clock.js";

const { db } = mockDb();
const { createReservation, listReservations, cancelReservation } = await import("./reservation.js");

const CTX = { from: "628111", name: "Budi" };
const okArgs = { product: "MacBook Air M2", custName: "Budi", date: "2026-07-28" };

const sku = (over: Record<string, unknown> = {}) => ({
  id: "sku1",
  name: "MacBook Air M2",
  chip: "M2",
  storage: "256GB",
  grade: "A",
  price: 15_000_000n,
  lokasi: "Rak A",
  model: { name: "MacBook Air M2" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createReservation — validation", () => {
  it("asks for the missing required field before touching the DB", async () => {
    const anon = { from: "628111", name: null };
    expect(await createReservation(CTX, {})).toEqual({ needProduct: true });
    expect(await createReservation(anon, { product: "MacBook Air M2" })).toEqual({ needName: true });
    expect(await createReservation(CTX, { product: "MacBook Air M2", custName: "Budi" })).toEqual({
      needDate: true,
    });
    // Free text we cannot turn into a real day is treated as missing, not stored.
    expect(
      await createReservation(CTX, { product: "MacBook Air M2", custName: "Budi", date: "kapan aja" }),
    ).toEqual({ needDate: true });
    expect(db.sku.findMany).not.toHaveBeenCalled();
  });

  it("falls back to the WhatsApp profile name when the model omits custName", async () => {
    db.sku.findMany.mockResolvedValue([]);
    // Gets past the name check on ctx.name alone (fails later, on stock).
    expect(
      await createReservation(CTX, { product: "MacBook Air M2", date: "2026-07-28" }),
    ).toMatchObject({ unavailable: true, product: "MacBook Air M2" });
  });

  it("resolves a relative date to a real one before saving", async () => {
    db.sku.findMany.mockResolvedValue([sku()]);
    db.unit.findFirst.mockResolvedValue({ id: "u1", lokasi: null });
    db.unit.update.mockResolvedValue({});
    db.customer.upsert.mockResolvedValue({ id: "c1" });
    db.reservation.create.mockResolvedValue({});

    const out = await createReservation(CTX, { ...okArgs, date: "besok" });
    expect(out).toMatchObject({ ok: true });
    // Stored as a real day (see clock.test.ts for the resolution rules), never "besok".
    expect(db.reservation.create.mock.calls[0]![0].data.date).toBe(addDays(today(), 1));
  });
});

describe("createReservation — resolution", () => {
  it("reports unavailable — without a reason it cannot know — when nothing matches", async () => {
    db.sku.findMany.mockResolvedValue([]);
    const out = (await createReservation(CTX, okArgs)) as { unavailable: true; note: string };
    expect(out).toMatchObject({ unavailable: true, product: "MacBook Air M2" });
    // The agent once turned this into "unit-nya baru sold tadi"; the result now
    // tells it outright that it does not know why.
    expect(out.note).toMatch(/baru sold/);
    expect(out.note).toMatch(/TIDAK tahu kenapa/);
  });

  it("offers real alternatives (same model, any variant) when the exact one misses", async () => {
    db.sku.findMany
      .mockResolvedValueOnce([]) // exact variant: nothing available
      .mockResolvedValueOnce([sku({ storage: "1TB", price: 16_000_000n })]); // relaxed retry
    const out = (await createReservation(CTX, okArgs)) as { alternatives: string[] };
    expect(out.alternatives).toHaveLength(1);
    expect(out.alternatives[0]).toContain("MacBook Air M2");
    expect(out.alternatives[0]).toContain("1TB");
    // The retry drops capacity/grade but keeps the model name.
    const relaxed = db.sku.findMany.mock.calls[1]![0].where;
    expect(relaxed.grade).toBeUndefined();
    expect(JSON.stringify(relaxed)).toContain("MacBook");
  });

  it("matches the product against the SKU name too, not only the linked model", async () => {
    db.sku.findMany.mockResolvedValue([sku()]);
    db.unit.findFirst.mockResolvedValue({ id: "u1", lokasi: null });
    db.unit.update.mockResolvedValue({});
    db.customer.upsert.mockResolvedValue({ id: "c1" });
    db.reservation.create.mockResolvedValue({});
    await createReservation(CTX, { product: "iPad Air", custName: "Budi", date: "2026-07-28" });
    const where = db.sku.findMany.mock.calls[0]![0].where;
    // Each word is matched against the linked model name OR the SKU's own name
    // (modelId is nullable) — the shared filter from ./catalog.ts.
    expect(where.AND[0].OR[0].model.is.name.contains).toBe("iPad");
    expect(where.AND[1].OR[1].name.contains).toBe("Air");
  });

  it("returns variant candidates (does not guess) when ambiguous", async () => {
    db.sku.findMany.mockResolvedValue([
      sku({ id: "a", storage: "256GB" }),
      sku({ id: "b", storage: "512GB", price: 18_000_000n }),
    ]);
    const out = (await createReservation(CTX, okArgs)) as { ambiguous: boolean; candidates: string[] };
    expect(out.ambiguous).toBe(true);
    expect(out.candidates).toHaveLength(2);
    expect(db.reservation.create).not.toHaveBeenCalled();
  });
});

describe("createReservation — write path", () => {
  beforeEach(() => {
    db.sku.findMany.mockResolvedValue([sku()]);
    db.unit.findFirst.mockResolvedValue({ id: "u1", lokasi: null });
    db.unit.update.mockResolvedValue({});
    db.customer.upsert.mockResolvedValue({ id: "c1" });
    db.reservation.create.mockResolvedValue({});
  });

  it("holds a unit, upserts the customer by phone, and creates the reservation", async () => {
    const out = (await createReservation(CTX, { ...okArgs, time: "14:00" })) as {
      ok: boolean;
      code: string;
      model: string;
      variant: string;
      time?: string;
    };

    expect(out.ok).toBe(true);
    expect(out.code).toMatch(/^RSV-/);
    expect(out.model).toBe("MacBook Air M2");
    expect(out.variant).toBe("M2 256GB Grade A"); // spoken, not machine-punctuated
    expect(out.time).toBe("14:00");

    // TERSEDIA → DIRESERVASI on the specific unit
    expect(db.unit.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { status: "DIRESERVASI" } });
    // durable per-phone profile
    expect(db.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: "628111" } }),
    );
    // reservation row, phone from ctx (not the model)
    expect(db.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: expect.stringMatching(/^RSV-/),
          phone: "628111",
          custName: "Budi",
          status: "TERJADWAL",
        }),
      }),
    );
  });

  it("reports unavailable if the last unit was taken inside the transaction", async () => {
    db.unit.findFirst.mockResolvedValue(null); // raced away
    const out = (await createReservation(CTX, okArgs)) as { unavailable: true; note: string };
    expect(out).toMatchObject({ unavailable: true, product: "MacBook Air M2" });
    // Here the unit really was just taken — the one case where saying so is true.
    expect(out.note).toMatch(/baru saja diambil/);
    expect(db.reservation.create).not.toHaveBeenCalled();
  });
});

describe("cancelReservation", () => {
  it("returns none when the sender has no active reservation", async () => {
    db.reservation.findMany.mockResolvedValue([]);
    expect(await cancelReservation(CTX, {})).toEqual({ none: true });
    // scoped strictly to this phone + scheduled only
    expect(db.reservation.findMany.mock.calls[0]![0].where).toEqual({
      phone: "628111",
      status: "TERJADWAL",
    });
  });

  it("auto-cancels the sole active reservation, releasing its held unit", async () => {
    db.reservation.findMany.mockResolvedValue([
      { id: "r1", code: "RSV-1", items: [{ unitId: "u1" }] },
    ]);
    db.unit.updateMany.mockResolvedValue({ count: 1 });
    db.reservation.update.mockResolvedValue({});

    const out = await cancelReservation(CTX, {});
    expect(out).toEqual({ ok: true, code: "RSV-1" });
    expect(db.unit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["u1"] }, status: "DIRESERVASI" },
      data: { status: "TERSEDIA" },
    });
    expect(db.reservation.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "BATAL" },
    });
  });

  it("asks which code when several are active and none was given", async () => {
    db.reservation.findMany.mockResolvedValue([
      { id: "r1", code: "RSV-1", items: [] },
      { id: "r2", code: "RSV-2", items: [] },
    ]);
    expect(await cancelReservation(CTX, {})).toEqual({ ambiguous: true, codes: ["RSV-1", "RSV-2"] });
    expect(db.reservation.update).not.toHaveBeenCalled();
  });

  it("reports notFound for a code that isn't the sender's", async () => {
    db.reservation.findMany.mockResolvedValue([{ id: "r1", code: "RSV-1", items: [] }]);
    expect(await cancelReservation(CTX, { code: "RSV-9" })).toEqual({ notFound: true, code: "RSV-9" });
    expect(db.reservation.update).not.toHaveBeenCalled();
  });
});

describe("listReservations", () => {
  it("returns this phone's reservations, newest first", async () => {
    db.reservation.findMany.mockResolvedValue([
      {
        code: "RSV-1",
        whenText: "Senin, 28 Jul",
        date: "2026-07-28",
        time: "14:00",
        status: "TERJADWAL",
        items: [{ unit: "MacBook Air M2", variant: "M2 256GB Grade A" }],
      },
    ]);
    const out = (await listReservations(CTX)) as {
      reservations: { code: string; when: string; status: string; units: string[] }[];
    };
    expect(db.reservation.findMany.mock.calls[0]![0].where).toEqual({ phone: "628111" });
    expect(out.reservations[0]!.code).toBe("RSV-1");
    expect(out.reservations[0]!.when).toContain("Senin");
    expect(out.reservations[0]!.units[0]).toContain("MacBook Air M2");
  });
});
