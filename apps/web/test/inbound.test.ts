import { describe, expect, it } from "vitest";
import type { Po, Unit } from "../src/mock/seed.js";
import {
  canReopenQc,
  paymentFor,
  poClosed,
  poStage,
  poTotals,
  unitStage,
} from "../src/lib/inbound.js";

const po = (over: Partial<Po> = {}): Po => ({
  id: "po-t",
  code: "PI-T",
  supplierId: "sup-1",
  invoice: "INV-1",
  date: "2026-08-24",
  locationId: "wh-1",
  items: [],
  payments: [],
  shippingFee: 0,
  taxFee: 0,
  discount: 0,
  status: "ORDERED",
  ...over,
});

const unit = (over: Partial<Unit> = {}): Unit => ({
  serial: "S1",
  skuId: "sku-1",
  status: "QC",
  locationId: "wh-1",
  buy: 1_000_000,
  description: "",
  poId: "po-t",
  ...over,
});

const line = (id: string, cost: number, notReceived = false) => ({
  id,
  skuId: "sku-1",
  serial: null,
  qty: 1,
  unitCost: cost,
  ...(notReceived ? { notReceived: true } : {}),
});

describe("unitStage", () => {
  it("is Arrived while the box is open but nothing is recorded", () => {
    expect(unitStage(unit())).toBe("ARRIVED");
  });

  it("becomes In QC once anything at all has been recorded", () => {
    // A price used to count here, and stopped on 2026-08-27 when it moved to
    // the variant: the same number now sits on every unit of a SKU including
    // the ones nobody has unboxed, so it says nothing about THIS machine.
    // What is left is what someone recorded about this one.
    expect(unitStage(unit({ description: "Mulus" }))).toBe("IN_QC");
    expect(unitStage(unit({ batteryHealth: 91 }))).toBe("IN_QC");
  });

  it("is In inventory once QC let it out", () => {
    expect(unitStage(unit({ status: "TERSEDIA", description: "Mulus" }))).toBe(
      "IN_INVENTORY",
    );
  });
});

describe("poStage", () => {
  it("is Pending for an order paid before anyone knew what it bought", () => {
    // Story 3. Fully paid, no lines, no units — and still Pending, because
    // nothing has physically turned up.
    const p = po({
      payments: [{ id: "p1", method: "TUNAI", amount: 18_500_000, at: "x" }],
    });
    expect(poStage(p, [])).toBe("PENDING");
  });

  it("is Pending until somebody says the goods turned up", () => {
    // `po.status` is the only thing that can say so since 2026-08-26. Arrival
    // used to mint a unit per line-quantity, so "are there units?" stood in
    // for "has it arrived?"; now a unit exists only once a serial has been
    // read off a machine, and an order can be on the bench with none read.
    const p = po({ items: [line("a", 1), line("b", 1)] });
    expect(poStage(p, [unit()])).toBe("PENDING");
  });

  it("is Arrived once received, with every serial still unread", () => {
    const p = po({ status: "RECEIVED", items: [line("a", 1), line("b", 1)] });
    expect(poStage(p, [])).toBe("ARRIVED");
  });

  it("counts quantities, not lines, when deciding what is still out", () => {
    // One line of qty 3 is three machines. Counting lines (the reading until
    // 2026-08-26) let one graded unit satisfy the whole line, so the order
    // read "In inventory" with two machines nobody had touched.
    const three = { ...line("a", 1), qty: 3 };
    const p = po({ status: "RECEIVED", items: [three] });
    const graded = unit({
      serial: "S1",
      status: "TERSEDIA",
      description: "Mulus",
    });
    expect(poStage(p, [graded])).toBe("ARRIVED");
  });

  it("ignores a line the supplier never sent when deciding completeness", () => {
    // Story 2: one line will never arrive, so one unit IS the whole order.
    const p = po({
      status: "RECEIVED",
      items: [line("a", 1), line("b", 1, true)],
    });
    expect(poStage(p, [unit()])).toBe("ARRIVED");
  });

  it("reports the least-far unit, not the furthest", () => {
    // Nine graded and one still in its box is not a finished order — showing
    // it as done is how the tenth unit gets forgotten.
    const p = po({ status: "RECEIVED", items: [line("a", 1), line("b", 1)] });
    const graded = unit({
      serial: "S1",
      status: "TERSEDIA",
      description: "Mulus",
    });
    const untouched = unit({ serial: "S2" });
    expect(poStage(p, [graded, untouched])).toBe("ARRIVED");
  });

  it("is In inventory only when every unit got there", () => {
    const p = po({ status: "RECEIVED", items: [line("a", 1), line("b", 1)] });
    const a = unit({ serial: "S1", status: "TERSEDIA", description: "Mulus" });
    const b = unit({ serial: "S2", status: "TERSEDIA", description: "Mulus" });
    expect(poStage(p, [a, b])).toBe("IN_INVENTORY");
  });

  it("ignores units belonging to another order", () => {
    const p = po({ status: "RECEIVED", items: [line("a", 1)] });
    const mine = unit({
      serial: "S1",
      status: "TERSEDIA",
      description: "Mulus",
    });
    const theirs = unit({ serial: "S9", poId: "po-other" });
    expect(poStage(p, [mine, theirs])).toBe("IN_INVENTORY");
  });
});

describe("poTotals", () => {
  it("adds fees and takes off the negotiated discount", () => {
    const t = poTotals(
      po({
        items: [line("a", 4_000_000), line("b", 3_000_000)],
        shippingFee: 150_000,
        taxFee: 50_000,
        discount: 100_000,
      }),
    );
    expect(t.subtotal).toBe(7_000_000);
    expect(t.fees).toBe(100_000);
    expect(t.total).toBe(7_100_000);
  });

  it("does not charge for a line the supplier never sent", () => {
    const t = poTotals(
      po({ items: [line("a", 4_000_000), line("b", 3_000_000, true)] }),
    );
    expect(t.subtotal).toBe(4_000_000);
  });

  it("tracks a deposit as an outstanding balance", () => {
    // Item 8: pay part now, finish later.
    const t = poTotals(
      po({
        items: [line("a", 5_000_000)],
        payments: [{ id: "p", method: "DEPOSIT", amount: 2_000_000, at: "x" }],
      }),
    );
    expect(t.paid).toBe(2_000_000);
    expect(t.outstanding).toBe(3_000_000);
    expect(t.fullyPaid).toBe(false);
  });

  it("treats an overpayment as settled, never as a negative debt", () => {
    const t = poTotals(
      po({
        items: [line("a", 1_000_000)],
        payments: [{ id: "p", method: "TUNAI", amount: 3_000_000, at: "x" }],
      }),
    );
    expect(t.outstanding).toBe(0);
    expect(t.fullyPaid).toBe(true);
  });

  it("reports money paid against an order with nothing invoiced yet", () => {
    // Story 3 again: the shop holds credit with that supplier, and the screen
    // has to be able to say so rather than showing a zero.
    const t = poTotals(
      po({
        payments: [{ id: "p", method: "TUNAI", amount: 18_500_000, at: "x" }],
      }),
    );
    expect(t.total).toBe(0);
    expect(t.paid).toBe(18_500_000);
    expect(t.outstanding).toBe(0);
    // Not "fully paid": there is nothing to have paid FOR.
    expect(t.fullyPaid).toBe(false);
  });

  it("never lets a discount push a total below zero", () => {
    const t = poTotals(po({ items: [line("a", 100)], discount: 10_000 }));
    expect(t.total).toBe(0);
  });
});

describe("closing an invoice", () => {
  it("outranks whatever the goods would have said", () => {
    // The order is finished with because a person said so — a machine still
    // sitting in QC does not make it unfinished any more (owner revision
    // 2026-08-27). Without the short-circuit this would read "Arrived".
    const p = po({
      status: "RECEIVED",
      items: [line("a", 1_000_000)],
      closedAt: "2026-08-27T04:00:00.000Z",
    });
    expect(poStage(p, [])).toBe("CLOSED");
    expect(poClosed(p)).toBe(true);
  });

  it("is not closed by an empty string", () => {
    // `delete` is what reopening does, but a serialised store that round-trips
    // through a form could hand back "" — and "" is not a date.
    expect(poClosed(po({ closedAt: "" }))).toBe(false);
    expect(poClosed(po())).toBe(false);
  });
});

describe("paymentFor", () => {
  it("reads a payment from before the buckets existed as the goods", () => {
    // Shipping and tax were separate figures long before anyone could pay them
    // separately, so a bare transfer was always against the machines. The
    // alternative — a fourth, unlabelled bucket — would strand every row the
    // shop already has.
    expect(paymentFor({ id: "p", method: "TUNAI", amount: 1, at: "x" })).toBe(
      "ORDER",
    );
  });
});

describe("poTotals by bucket", () => {
  const paid = (
    id: string,
    amount: number,
    appliedTo?: "ORDER" | "TAX" | "SHIPPING",
  ) => ({
    id,
    method: "TUNAI",
    amount,
    at: "x",
    ...(appliedTo && { appliedTo }),
  });

  it("splits what is owed the way the invoice is built", () => {
    const t = poTotals(
      po({
        items: [line("a", 10_000_000)],
        shippingFee: 250_000,
        taxFee: 100_000,
      }),
    );
    expect(t.due).toEqual({
      ORDER: 10_000_000,
      SHIPPING: 250_000,
      TAX: 100_000,
    });
    // The buckets are the invoice, seen a second way.
    expect(t.due.ORDER + t.due.SHIPPING + t.due.TAX).toBe(t.total);
  });

  it("takes the discount off the goods, not off the forwarder", () => {
    // A supplier knocking a million off the machines does not reduce what the
    // forwarder charges to ship them.
    const t = poTotals(
      po({
        items: [line("a", 10_000_000)],
        shippingFee: 250_000,
        discount: 1_000_000,
      }),
    );
    expect(t.due.ORDER).toBe(9_000_000);
    expect(t.due.SHIPPING).toBe(250_000);
  });

  it("settles the bucket the money was aimed at, and only that one", () => {
    const t = poTotals(
      po({
        items: [line("a", 10_000_000)],
        shippingFee: 250_000,
        payments: [paid("p1", 250_000, "SHIPPING")],
      }),
    );
    // The whole question the column exists to answer: the ongkir is paid and
    // the machines are not.
    expect(t.owedFor.SHIPPING).toBe(0);
    expect(t.owedFor.ORDER).toBe(10_000_000);
    expect(t.paidFor).toEqual({ ORDER: 0, SHIPPING: 250_000, TAX: 0 });
    // And the order overall still owes what it owes.
    expect(t.outstanding).toBe(10_000_000);
  });

  it("never turns an overpaid bucket into a credit", () => {
    // Same rule as `outstanding`: paying the forwarder too much is a credit
    // with the forwarder, not a discount on the machines.
    const t = poTotals(
      po({
        items: [line("a", 1_000_000)],
        shippingFee: 100_000,
        payments: [paid("p1", 500_000, "SHIPPING")],
      }),
    );
    expect(t.owedFor.SHIPPING).toBe(0);
    expect(t.owedFor.ORDER).toBe(1_000_000);
  });
});

describe("canReopenQc", () => {
  it("takes back the three decisions QC itself makes", () => {
    // The owner's ask: staff accept the wrong machine, or send the wrong one
    // back, and the remedy has to be on the row where the mistake was made.
    expect(canReopenQc(unit({ status: "TERSEDIA" }))).toBe(true);
    expect(canReopenQc(unit({ status: "SERVIS" }))).toBe(true);
    expect(canReopenQc(unit({ status: "RETUR_SUPPLIER" }))).toBe(true);
  });

  it("stops where the machine stops being the shop's alone", () => {
    // Reserved or sold means somebody outside this screen has acted on it, and
    // pulling such a unit back to a QC bench would be a claim about a machine
    // that is promised to a customer or already gone.
    expect(canReopenQc(unit({ status: "DIRESERVASI" }))).toBe(false);
    expect(canReopenQc(unit({ status: "TERJUAL" }))).toBe(false);
    expect(canReopenQc(unit({ status: "HILANG" }))).toBe(false);
  });
});
