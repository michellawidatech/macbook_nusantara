/**
 * The fixture has to be coherent, and this is where that is enforced.
 *
 * A seed that produces incoherent data is worse than no seed: every screen
 * built on it inherits the incoherence, and the bug reads as a bug in the
 * screen. These are the invariants the old data broke — serials the app would
 * refuse, descriptions from no vocabulary, grades that disagreed with the
 * words beside them, sold serials on two receipts, totals that did not add up.
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOMERS,
  INTAKE,
  ORDERS,
  PAYMENT_METHOD_CODES,
  RESERVATIONS,
  SKUS,
  SUPPLIER_RETURNS,
  CYCLE_ERA_MAX_YEAR,
  askingPriceOf,
  buildShop,
  cyclesForHealth,
  modelOf,
  serialAt,
  skuOf,
  type FixtureSku,
} from "../src/index.js";

/** Pinned so the assertions are about the shop, not about today. */
const shop = buildShop(Date.parse("2026-09-07T03:00:00.000Z"));

/**
 * `ORIGINAL_PATTERN` from `apps/web/src/lib/serialScan.ts`, restated.
 *
 * Restated rather than imported because this package may not depend on the
 * web app — but a copy that could drift is exactly the sort of thing this
 * repo does not want, so `apps/web/test/fixtureSerials.test.ts` runs the real
 * `validateSerial` over the same serials. This one keeps the failure local.
 */
const APPLE_SERIAL = /^S[A-HJ-NP-Z0-9]{10,12}$/;

describe("serials", () => {
  it("are Apple-shaped, so the app can scan and print them", () => {
    for (const u of shop.units) {
      expect(u.serial, u.serial).toMatch(APPLE_SERIAL);
    }
  });

  it("carry no I and no O — a scanner reading one misread a 1 or a 0", () => {
    for (const u of shop.units) expect(u.serial).not.toMatch(/[IO]/);
  });

  it("are unique", () => {
    const seen = new Set(shop.units.map((u) => u.serial));
    expect(seen.size).toBe(shop.units.length);
  });

  it("are stable in the intake index, so both seeds agree", () => {
    expect(serialAt(1)).toBe(shop.units[0]!.serial);
    expect(serialAt(1)).toBe("SC027400137LM");
  });
});

describe("the catalogue", () => {
  it("prices every variant above what it cost", () => {
    for (const s of SKUS) expect(s.price).toBeGreaterThan(s.landed);
  });

  it("gives every variant its own code — `Sku.code` is UNIQUE", () => {
    const codes = SKUS.map((s) => s.code);
    const duplicated = codes.filter((c, i) => codes.indexOf(c) !== i);
    expect(duplicated).toEqual([]);
    for (const c of codes) expect(c).not.toBe("");
  });

  it("gives every variant its own id", () => {
    const ids = SKUS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices a bigger machine above a smaller one of the same model", () => {
    const air = (id: string) => SKUS.find((s) => s.id === id)!.price;
    // 8/256 < 8/512 < 16/512 on the M2 Air.
    expect(air("m-air-m2-v1")).toBeLessThan(air("m-air-m2-v2"));
    expect(air("m-air-m2-v2")).toBeLessThan(air("m-air-m2-v4"));
  });
});

describe("condition", () => {
  const QC_VOCABULARY = new Set([
    "Mulus",
    "Normal",
    "Lecet halus",
    "Lecet di casing bawah",
    "Dent di sudut",
    "Layar ada garis",
    "Keyboard aus",
    "Baterai lemah",
    "Engsel longgar",
    "Sudah ganti SSD",
    "Fullset dus",
    "Charger original",
    "Unit only",
    "Tanpa charger",
  ]);

  it("describes a machine only in phrases QC can pick from", () => {
    for (const it of INTAKE) {
      for (const phrase of (it.description ?? "").split(", ").filter(Boolean)) {
        expect(QC_VOCABULARY.has(phrase), `${it.ref}: ${phrase}`).toBe(true);
      }
    }
  });

  it("grades a machine the way its own description reads", () => {
    for (const it of INTAKE) {
      const words = it.description ?? "";
      if (words.includes("Mulus")) expect(it.grade, it.ref).toBe("A");
      if (words.includes("Keyboard aus") || words.includes("Baterai lemah")) {
        expect(it.grade, it.ref).toBe("C");
      }
    }
  });

  it("puts a tired battery under the fair floor and a good one over it", () => {
    for (const it of INTAKE) {
      if (it.battery === undefined) continue;
      const tired = (it.description ?? "").includes("Baterai lemah");
      if (tired) expect(it.battery, it.ref).toBeLessThan(76);
      else expect(it.battery, it.ref).toBeGreaterThanOrEqual(76);
    }
  });

  it("leaves a machine still in QC ungraded and undescribed", () => {
    for (const it of INTAKE.filter((x) => x.fate === "QC")) {
      expect(it.grade, it.ref).toBeUndefined();
      expect(it.description ?? "", it.ref).toBe("");
    }
  });

  it("grades sealed stock NEW and measures no battery on it", () => {
    for (const u of shop.units) {
      if (u.grade !== "NEW") continue;
      expect(u.battery, u.serial).toBeUndefined();
      expect(u.cycleCount, u.serial).toBeUndefined();
    }
  });

  /*
   * The 2026-09-08 split. A machine records the reading its own era reports,
   * and never both — a row carrying a percentage AND a cycle count would let
   * two columns disagree about one battery.
   */
  it("records each machine's battery in its own era's units", () => {
    for (const u of shop.units) {
      const year = modelOf(skuOf(u.skuId).modelId).releaseYear;
      if (year <= CYCLE_ERA_MAX_YEAR) {
        expect(u.battery, u.serial).toBeUndefined();
      } else {
        expect(u.cycleCount, u.serial).toBeUndefined();
        expect(u.fcc, u.serial).toBeUndefined();
      }
    }
  });

  it("puts a cycles machine in the band its health would have put it in", () => {
    // Same story, different units. `cyclesForHealth` is the translation; these
    // are the boundaries the app's default thresholds use.
    expect(cyclesForHealth(100)).toBe(0);
    expect(cyclesForHealth(80)).toBe(400);
    expect(cyclesForHealth(76)).toBe(800);
    expect(cyclesForHealth(68)).toBeGreaterThan(800);
    // Monotone, so sorting a mixed shelf by battery cannot swap two machines.
    for (let h = 60; h < 100; h += 1) {
      expect(cyclesForHealth(h), `${h}%`).toBeGreaterThan(
        cyclesForHealth(h + 1),
      );
    }
  });

  it("gives every cycles machine a capacity, except where there is no cell", () => {
    for (const u of shop.units) {
      if (u.cycleCount === undefined) continue;
      // Every category the shop grades has a cell. A capacity of zero would
      // be a screen printing "0 mAh" beside a working battery.
      expect(u.fcc, u.serial).toBeGreaterThan(0);
    }
  });
});

describe("what one machine is worth", () => {
  /*
   * The per-serial price of 2026-09-08. What is checked here is that the
   * fixture's numbers agree with its own words — a C is cheaper than an A of
   * the same variant, and no machine is priced before it has been graded.
   */
  it("prices a graded machine and leaves one in QC unpriced", () => {
    for (const u of shop.units) {
      if (u.status === "QC") expect(u.price, u.serial).toBeUndefined();
      else expect(u.price, u.serial).toBeGreaterThan(0);
    }
  });

  it("asks less for a worse grade of the same variant", () => {
    const price = (grade: "A" | "B" | "C") =>
      askingPriceOf(20_000_000, grade, 90);
    expect(price("A")).toBeGreaterThan(price("B"));
    expect(price("B")).toBeGreaterThan(price("C"));
    // Sealed asks the full price, which is what sealed means.
    expect(askingPriceOf(20_000_000, "NEW", undefined)).toBe(20_000_000);
  });

  it("asks less for a tired battery within one grade", () => {
    // The spread Inventory's per-variant-per-grade range exists to show. A
    // fixture where every A costs the same renders every range as one figure.
    expect(askingPriceOf(20_000_000, "A", 95)).toBeGreaterThan(
      askingPriceOf(20_000_000, "A", 70),
    );
  });

  it("stocks more than one machine of some variants, at different prices", () => {
    /*
     * The shape a second-hand shop actually has, and a guard on the demo
     * rather than on the logic. Until 2026-09-08 the fixture held exactly one
     * machine of every variant — tidy, and it taught every screen the wrong
     * lesson: Inventory shows a price RANGE per variant-grade, and a shelf of
     * one-offs renders every range as a single figure.
     */
    const bySku = new Map<string, number[]>();
    for (const u of shop.units) {
      if (u.price === undefined) continue;
      if (u.status !== "TERSEDIA" && u.status !== "DIRESERVASI") continue;
      bySku.set(u.skuId, [...(bySku.get(u.skuId) ?? []), u.price]);
    }
    const spreads = [...bySku.values()].filter(
      (ps) => ps.length > 1 && Math.min(...ps) !== Math.max(...ps),
    );
    expect(
      spreads.length,
      "no variant on the shelf spans a price range",
    ).toBeGreaterThan(0);

    // …and within ONE grade, which is the case the range actually exists for:
    // two A-grade machines differing only by their batteries.
    const byGrade = new Map<string, number[]>();
    for (const u of shop.units) {
      if (u.price === undefined || u.grade === undefined) continue;
      if (u.status !== "TERSEDIA" && u.status !== "DIRESERVASI") continue;
      const key = `${u.skuId}/${u.grade}`;
      byGrade.set(key, [...(byGrade.get(key) ?? []), u.price]);
    }
    expect(
      [...byGrade.values()].some(
        (ps) => ps.length > 1 && Math.min(...ps) !== Math.max(...ps),
      ),
      "no variant-and-grade on the shelf spans a price range",
    ).toBe(true);
  });

  it("never asks more than the variant's own asking price", () => {
    for (const u of shop.units) {
      if (u.price === undefined) continue;
      expect(u.price, u.serial).toBeLessThanOrEqual(skuOf(u.skuId).price);
    }
  });
});

describe("how a bill was paid", () => {
  /*
   * The split of 2026-09-08. What is guarded here is that the parts add up to
   * the bill — a demo shop whose money does not balance teaches every finance
   * screen the wrong lesson — and that the demo contains at least one of each
   * interesting shape, or the screens have nothing to demonstrate.
   */
  it("accounts for every rupiah of every bill", () => {
    for (const o of shop.orders) {
      const paid = o.parts.reduce((n, p) => n + p.amount, 0);
      expect(paid, o.code).toBe(o.total);
    }
  });

  it("holds a split, a promise and a marketplace payout", () => {
    const states = shop.orders.flatMap((o) => o.parts.map((p) => p.state));
    expect(states).toContain("SETTLED");
    expect(states).toContain("PENDING");
    expect(states).toContain("DUE");
    // …and one sale that is genuinely split across two methods, which is the
    // owner's own example and the case a single method cannot describe.
    expect(shop.orders.some((o) => o.parts.length > 1)).toBe(true);
  });

  it("dates a promise and nothing else", () => {
    for (const o of shop.orders) {
      for (const p of o.parts) {
        if (p.state === "DUE") continue;
        expect(p.dueAt, `${o.code} ${p.id}`).toBeUndefined();
      }
    }
  });

  it("names the marketplace holding each pending part", () => {
    // Without it "Rp23jt pending" is a figure nobody can act on: withdrawing
    // is a per-channel errand.
    for (const o of shop.orders) {
      for (const p of o.parts) {
        if (p.state !== "PENDING") continue;
        expect(p.channel, `${o.code} ${p.id}`).toBeTruthy();
      }
    }
  });
});

describe("the ledger", () => {
  it("opens every machine's history with DITERIMA", () => {
    for (const u of shop.units) {
      const mine = shop.events.filter((e) => e.serial === u.serial);
      expect(mine[0]?.type, u.serial).toBe("DITERIMA");
      expect(mine[0]?.fromStatus).toBeNull();
    }
  });

  it("is gapless and in order", () => {
    for (const u of shop.units) {
      const mine = shop.events.filter((e) => e.serial === u.serial);
      expect(mine.map((e) => e.seq)).toEqual(mine.map((_, i) => i + 1));
    }
  });

  it("chains each event's from-status to the one before it", () => {
    for (const u of shop.units) {
      const mine = shop.events.filter((e) => e.serial === u.serial);
      mine.forEach((e, i) => {
        expect(e.fromStatus, `${u.serial} #${e.seq}`).toBe(
          i === 0 ? null : mine[i - 1]!.toStatus,
        );
      });
    }
  });

  it("never records an event before the machine arrived", () => {
    for (const u of shop.units) {
      const mine = shop.events.filter((e) => e.serial === u.serial);
      const times = mine.map((e) => e.at.daysAgo);
      // Days AGO, so time runs downward.
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]!, `${u.serial} #${i + 1}`).toBeLessThanOrEqual(
          times[i - 1]!,
        );
      }
    }
  });

  it("ends each machine on the status the unit projects", () => {
    for (const u of shop.units) {
      const mine = shop.events.filter((e) => e.serial === u.serial);
      expect(mine.at(-1)?.toStatus, u.serial).toBe(u.status);
    }
  });

  it("ends each machine in the location the unit projects", () => {
    for (const u of shop.units) {
      const mine = shop.events.filter((e) => e.serial === u.serial);
      expect(mine.at(-1)?.toLocationId, u.serial).toBe(u.locationId);
    }
  });
});

describe("stock", () => {
  it("hangs every machine off a line of a real purchase order", () => {
    for (const u of shop.units) {
      const po = shop.purchaseOrders.find((p) => p.id === u.poId);
      expect(po, u.serial).toBeDefined();
      expect(
        po!.lines.some((l) => l.id === u.poLineId),
        u.serial,
      ).toBe(true);
    }
  });

  it("shelves a sellable machine and leaves one in QC on no shelf", () => {
    for (const u of shop.units) {
      if (u.status === "QC" || u.status === "RETUR_SUPPLIER") {
        expect(u.rackId, u.serial).toBeUndefined();
      }
      if (u.rackId !== undefined) {
        expect(u.rackId.startsWith(u.locationId), u.serial).toBe(true);
      }
    }
  });

  it("lands every machine at its cost plus its share of the freight", () => {
    for (const po of shop.purchaseOrders) {
      const allocated = po.lines.reduce((n, l) => n + l.allocatedFee, 0);
      expect(allocated, po.id).toBe(po.feesTotal);
    }
    for (const u of shop.units) {
      expect(u.landed, u.serial).toBeGreaterThanOrEqual(u.buy);
    }
  });

  it("totals an invoice as its lines plus its fees", () => {
    for (const po of shop.purchaseOrders) {
      const lines = po.lines.reduce((n, l) => n + l.lineTotal, 0);
      expect(po.subtotal, po.id).toBe(lines);
      expect(po.total, po.id).toBe(po.subtotal + po.feesTotal);
    }
  });

  it("settles a closed invoice in full", () => {
    const closed = shop.purchaseOrders.filter((p) => p.closed !== undefined);
    expect(closed.length).toBeGreaterThan(0);
    for (const po of closed) {
      const paid = po.payments.reduce((n, p) => n + p.rupiah, 0);
      expect(paid, po.id).toBe(po.total);
    }
  });
});

describe("sales", () => {
  it("sells every machine on exactly one receipt", () => {
    const sold = shop.orders.flatMap((o) => o.builtLines.map((l) => l.serial));
    expect(new Set(sold).size).toBe(sold.length);
  });

  it("only sells a machine the ledger says was sold", () => {
    for (const o of shop.orders) {
      for (const l of o.builtLines) {
        const u = shop.units.find((x) => x.serial === l.serial)!;
        // A returned sale puts the machine back on the shelf.
        expect(
          o.returnedAt === undefined ? u.status : "TERSEDIA",
          l.serial,
        ).toBe(u.status);
      }
    }
  });

  it("leaves no sold machine off a receipt", () => {
    const onReceipts = new Set(
      shop.orders.flatMap((o) => o.builtLines.map((l) => l.serial)),
    );
    for (const u of shop.units.filter((x) => x.status === "TERJUAL")) {
      expect(onReceipts.has(u.serial), u.serial).toBe(true);
    }
  });

  it("totals a sale as subtotal minus discount plus extra", () => {
    // The same arithmetic `Order_total_arithmetic_check` enforces in Postgres.
    for (const o of shop.orders) {
      expect(o.subtotal, o.code).toBe(
        o.builtLines.reduce((n, l) => n + l.sub, 0),
      );
      expect(o.total, o.code).toBe(o.subtotal - o.discount + (o.extra ?? 0));
    }
  });

  it("matches paidTotal to the payments that actually cleared", () => {
    for (const o of shop.orders) {
      const cleared = o.payments
        .filter((p) => p.status === "LUNAS")
        .reduce(
          (n, p) => n + (p.direction === "KELUAR" ? -p.amount : p.amount),
          0,
        );
      expect(cleared, o.code).toBe(o.paidTotal);
    }
  });

  it("sells above cost on every line", () => {
    for (const o of shop.orders) {
      for (const l of o.builtLines) {
        expect(l.price, `${o.code} ${l.serial}`).toBeGreaterThan(l.cogs);
      }
    }
  });

  it("keeps a bargain a bargain — charged under list, never invented", () => {
    const haggled = shop.orders
      .flatMap((o) => o.builtLines)
      .filter((l) => l.price !== l.listPrice);
    expect(haggled.length).toBeGreaterThan(0);
    for (const l of haggled) expect(l.price).toBeLessThan(l.listPrice);
  });

  it("names a customer the shop has", () => {
    const known = new Set(CUSTOMERS.map((c) => c.id));
    for (const o of shop.orders)
      expect(known.has(o.customerId), o.code).toBe(true);
    for (const r of RESERVATIONS)
      expect(known.has(r.customerId), r.id).toBe(true);
  });
});

describe("holds", () => {
  it("holds every machine on exactly one reservation", () => {
    const held = shop.reservations.flatMap((r) => r.serials);
    expect(new Set(held).size).toBe(held.length);
  });

  it("agrees with the units it claims", () => {
    const held = new Set(shop.reservations.flatMap((r) => r.serials));
    for (const u of shop.units) {
      expect(held.has(u.serial), u.serial).toBe(u.status === "DIRESERVASI");
    }
  });

  it("schedules a pickup in the future", () => {
    for (const r of shop.reservations) {
      expect(r.scheduledFor.daysAgo, r.code).toBeLessThan(0);
      expect(r.created.daysAgo, r.code).toBeGreaterThan(0);
    }
  });
});

describe("returns", () => {
  it("returns to the supplier only a machine that failed QC", () => {
    for (const r of shop.supplierReturns) {
      const u = shop.units.find((x) => x.serial === r.serial)!;
      expect(u.status, r.code).toBe("RETUR_SUPPLIER");
      expect(u.poId, r.code).toBe(r.poId);
    }
    expect(SUPPLIER_RETURNS.length).toBeGreaterThan(0);
  });

  it("re-grades a customer return rather than restocking it as it went out", () => {
    const returned = shop.orders.filter((o) => o.returnedAt !== undefined);
    expect(returned.length).toBeGreaterThan(0);
    for (const o of returned) {
      for (const l of o.builtLines) {
        const u = shop.units.find((x) => x.serial === l.serial)!;
        expect(u.status, l.serial).toBe("TERSEDIA");
        const regrade = shop.events.find(
          (e) => e.serial === l.serial && e.type === "RETUR_PELANGGAN",
        );
        expect(regrade, l.serial).toBeDefined();
      }
    }
  });
});

describe("the shop as a whole", () => {
  it("has something in every state a screen can show", () => {
    const states = new Set(shop.units.map((u) => u.status));
    expect(states).toEqual(
      new Set([
        "TERSEDIA",
        "DIRESERVASI",
        "TERJUAL",
        "QC",
        "RETUR_SUPPLIER",
        "HILANG",
      ]),
    );
  });

  it("keeps stock in more than one room", () => {
    const rooms = new Set(shop.units.map((u) => u.locationId));
    expect(rooms.size).toBeGreaterThan(1);
  });

  it("sells through more than one channel", () => {
    expect(new Set(ORDERS.map((o) => o.channel)).size).toBeGreaterThan(2);
  });
});

describe("money leaves and arrives through methods the shop has", () => {
  it("spends only through a declared payment method", () => {
    const known = new Set<string>(PAYMENT_METHOD_CODES);
    for (const po of shop.purchaseOrders) {
      for (const p of po.payments)
        expect(known.has(p.method), po.id).toBe(true);
    }
    for (const o of shop.orders) {
      for (const p of o.payments)
        expect(known.has(p.method), o.code).toBe(true);
    }
  });
});

describe("the price grid", () => {
  /** Two variants of one model, differing in exactly one axis. */
  function neighbours(): [FixtureSku, FixtureSku, string][] {
    const pairs: [FixtureSku, FixtureSku, string][] = [];
    for (const a of SKUS) {
      for (const b of SKUS) {
        if (a.modelId !== b.modelId || a.id === b.id) continue;
        const keys = Object.keys(a.axisValues);
        const differing = keys.filter(
          (k) => a.axisValues[k] !== b.axisValues[k],
        );
        if (differing.length === 1) pairs.push([a, b, differing[0]!]);
      }
    }
    return pairs;
  }

  const GB = (v: string): number | null => {
    const m = /^(\d+)\s*(GB|TB)$/i.exec(v);
    return m === null
      ? null
      : Number(m[1]) * (m[2]!.toUpperCase() === "TB" ? 1024 : 1);
  };

  it("charges more for more of anything measured in gigabytes", () => {
    for (const [a, b, axis] of neighbours()) {
      const lo = GB(a.axisValues[axis]!);
      const hi = GB(b.axisValues[axis]!);
      if (lo === null || hi === null || lo >= hi) continue;
      expect(a.price, `${a.code} vs ${b.code}`).toBeLessThan(b.price);
    }
  });

  it("gives no two variants of one model the same price", () => {
    // The failure this guards: a flag-shaped ladder priced 16/512, 16/1TB,
    // 32/512 and 32/1TB of the MacBook Pro 14 identically, so the whole grid
    // collapsed to one number.
    const byModel = new Map<string, number[]>();
    for (const s of SKUS) {
      byModel.set(s.modelId, [...(byModel.get(s.modelId) ?? []), s.price]);
    }
    for (const [modelId, prices] of byModel) {
      // Accessories vary by colour, which is free — and rightly so.
      if (modelId.startsWith("m-magic") || modelId.startsWith("m-usbc"))
        continue;
      if (modelId === "m-sleeve") continue;
      expect(new Set(prices).size, modelId).toBe(prices.length);
    }
  });
});
