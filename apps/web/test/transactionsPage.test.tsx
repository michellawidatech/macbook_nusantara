/**
 * Transaction History, as laid out on 2026-09-19 and trimmed on 2026-09-20:
 * order and reference, unit, payment status, received, and the actions.
 *
 * Three things this file guards, each a bug the survey found or a question
 * the columns answer:
 *
 * - the channel prints its LABEL, not the raw `Order.source` code;
 * - the payment status tells a half-collected bill from one nobody has paid,
 *   and a marketplace holding the money from a customer owing it;
 * - the UNIT a customer brought back is the one marked. The whole-sale
 *   Returned / Partly returned column left on 2026-09-20 (owner ask), and
 *   the per-line tag is what it was standing in front of: "which one came
 *   back" is the question somebody opening this screen actually has.
 *
 * The page is on the phone layout here (`test/setup.ts`), so each sale is a
 * card headed by its order number, and a row is found by that heading.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionsPage } from "../src/routes/finance/TransactionsPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { fmtRp } from "../src/lib/format.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 60_000 });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/finance/transactions"]}>
        <TransactionsPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

/**
 * A seed sale's order number by its sequence. The month in it comes from the
 * sale's date, which the fixture sets relative to "now" — hard-coding it broke
 * the moment the calendar turned a month.
 */
function seedCode(seq: string): string {
  const o = getDb().orders.find((x) => x.code.endsWith(`-${seq}`));
  expect(o).toBeDefined();
  return o!.code;
}

/** The card of one sale, found by its order number. */
function saleCard(code: string): HTMLElement {
  const card = screen.getByText(code).closest(".ant-card");
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

/** This file's own sales, and nothing of anybody else's. */
beforeEach(() => {
  mutate((d) => {
    d.orders = d.orders.filter((o) => !o.id.startsWith("o-tx-"));
    d.events = d.events.filter((e) => !e.id.startsWith("ev-tx-"));
  });
});

/** A sale of one seed unit that the test can shape. */
function addSale(over: Partial<Order> & Pick<Order, "id" | "code">) {
  const serial = getDb().units[0]!.serial;
  const sale: Order = {
    ts: "2026-09-18T03:00:00.000Z",
    customerId: "c-3",
    serials: [serial],
    prices: { [serial]: 2_000_000 },
    discount: 0,
    source: "OFFLINE",
    payMethod: "TUNAI",
    settled: false,
    total: 2_000_000,
    ...over,
  };
  mutate((d) => {
    d.orders.push(sale);
  });
  return sale;
}

describe("the order column", () => {
  it("prints the channel's label, never its code", async () => {
    renderPage();
    await settle();

    expect(screen.queryByText(/OFFLINE|WHATSAPP|INSTAGRAM|SHOPEE/)).toBeNull();
    expect(screen.getAllByText(/In store/).length).toBeGreaterThan(0);
    expect(
      within(saleCard(seedCode("000204"))).getByText(/Shopee/),
    ).toBeInTheDocument();
  });

  it("puts the marketplace's order number under the SI code", async () => {
    addSale({
      id: "o-tx-ref",
      code: "SI-TEST-REF",
      source: "TOKOPEDIA",
      payMethod: "MARKETPLACE",
      payments: [
        {
          id: "o-tx-ref-1",
          method: "MARKETPLACE",
          amount: 2_000_000,
          state: "PENDING",
          channel: "TOKOPEDIA",
          at: "2026-09-18T03:00:00.000Z",
          ref: "INV/20260918/MPL/4411",
        },
      ],
    });
    renderPage();
    await settle();

    // Its own column since 2026-09-23 (owner ask), rather than a second line
    // under the SI code.
    const card = saleCard("SI-TEST-REF");
    expect(within(card).getByText("INV/20260918/MPL/4411")).toBeInTheDocument();
    expect(within(card).getByText(/Tokopedia/)).toBeInTheDocument();
  });
});

describe("the payment status", () => {
  it("tells a deposit with the rest promised from a bill nobody has paid", async () => {
    addSale({
      id: "o-tx-owed",
      code: "SI-TEST-OWED",
      payments: [
        {
          id: "o-tx-owed-1",
          method: "TRANSFER",
          amount: 2_000_000,
          state: "DUE",
          at: "2026-09-18T03:00:00.000Z",
          dueAt: "2099-01-31T03:00:00.000Z",
        },
      ],
    });
    renderPage();
    await settle();

    // The seed's DP sale: Rp500rb in, Rp980rb promised. The old screen read
    // this "Owed", exactly as it read the sale below.
    const dp = saleCard(seedCode("000205"));
    expect(within(dp).getByText("Partly paid")).toBeInTheDocument();
    expect(within(dp).getByText(/^Due /)).toBeInTheDocument();
    expect(within(dp).getByText(fmtRp(500_000))).toBeInTheDocument();
    expect(within(dp).getByText(`of ${fmtRp(1_480_000)}`)).toBeInTheDocument();

    const owed = saleCard("SI-TEST-OWED");
    expect(within(owed).getByText("Owed")).toBeInTheDocument();
    expect(within(owed).getByText(fmtRp(0))).toBeInTheDocument();
  });

  it("says a marketplace holds the money when the customer has paid it all", async () => {
    renderPage();
    await settle();

    // Rp5jt cash and the rest on Shopee PayLater: paid, not all received.
    const split = saleCard(seedCode("000203"));
    expect(within(split).getByText("With a marketplace")).toBeInTheDocument();
    expect(within(split).getByText(fmtRp(5_000_000))).toBeInTheDocument();

    const settled = saleCard(seedCode("000201"));
    expect(within(settled).getByText("Settled")).toBeInTheDocument();
  });

  it("warns once a promise date has passed", async () => {
    addSale({
      id: "o-tx-late",
      code: "SI-TEST-LATE",
      payments: [
        {
          id: "o-tx-late-1",
          method: "TRANSFER",
          amount: 2_000_000,
          state: "DUE",
          at: "2026-09-01T03:00:00.000Z",
          dueAt: "2026-09-05T03:00:00.000Z",
        },
      ],
    });
    renderPage();
    await settle();

    expect(
      within(saleCard("SI-TEST-LATE")).getByText(/^Overdue since /),
    ).toBeInTheDocument();
  });
});

/*
 * An unpaid sale, returned (owner ask 2026-10-26). The return cancelled the
 * customer's debt, so the balance owes nothing — and the screen read Settled,
 * the word for money that came in.
 */
describe("a debt a return cancelled", () => {
  const RETURN_AT = "2026-09-20T03:00:00.000Z";
  const retur = (id: string, amount: number) => ({
    id,
    type: "RETUR" as const,
    code: `SG-TEST-${id}`,
    amount,
    reason: "Returned — rusak",
    at: RETURN_AT,
  });

  function addReturnedSales() {
    // Nothing paid; the whole bill came back, and the DUE row went with it.
    addSale({
      id: "o-tx-unpaid-back",
      code: "SI-TEST-UNPAID-BACK",
      payments: [],
      adjustments: [retur("a1", 2_000_000)],
    });
    // A Rp500rb deposit, the rest owed; all of it back, the deposit refunded.
    addSale({
      id: "o-tx-part-back",
      code: "SI-TEST-PART-BACK",
      payments: [
        {
          id: "o-tx-part-back-1",
          method: "TRANSFER",
          amount: 500_000,
          state: "SETTLED",
          at: "2026-09-18T03:00:00.000Z",
        },
      ],
      refunds: [
        { id: "rf-tx", method: "TUNAI", amount: 500_000, at: RETURN_AT },
      ],
      adjustments: [retur("a2", 2_000_000)],
    });
    // Paid in full, then returned: a refund, and still Settled.
    addSale({
      id: "o-tx-paid-back",
      code: "SI-TEST-PAID-BACK",
      settled: true,
      payments: [
        {
          id: "o-tx-paid-back-1",
          method: "TUNAI",
          amount: 2_000_000,
          state: "SETTLED",
          at: "2026-09-18T03:00:00.000Z",
        },
      ],
      refunds: [
        { id: "rf-tx-2", method: "TUNAI", amount: 2_000_000, at: RETURN_AT },
      ],
      adjustments: [retur("a3", 2_000_000)],
    });
  }

  it("reads Unpaid, returned and Partly paid, returned — and Settled for a refund", async () => {
    addReturnedSales();
    renderPage();
    await settle();

    expect(
      within(saleCard("SI-TEST-UNPAID-BACK")).getByText("Unpaid, returned"),
    ).toBeInTheDocument();
    expect(
      within(saleCard("SI-TEST-PART-BACK")).getByText("Partly paid, returned"),
    ).toBeInTheDocument();
    const paid = saleCard("SI-TEST-PAID-BACK");
    expect(within(paid).getByText("Settled")).toBeInTheDocument();
    expect(within(paid).queryByText(/returned$/)).toBeNull();
  });

  it("carries the words into the CSV export", async () => {
    addReturnedSales();
    const created: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (b: Blob) => {
        created.push(b);
        return "blob:csv";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    renderPage();
    await settle();
    act(() => {
      screen.getByRole("button", { name: /Export all/ }).click();
    });
    click.mockRestore();

    expect(created).toHaveLength(1);
    // jsdom's Blob has no text(); FileReader reads it.
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    const line = (code: string) =>
      csv.split("\r\n").find((l) => l.startsWith(`"${code}"`)) ?? "";
    expect(line("SI-TEST-UNPAID-BACK")).toContain('"Unpaid, returned"');
    expect(line("SI-TEST-PART-BACK")).toContain('"Partly paid, returned"');
    expect(line("SI-TEST-PAID-BACK")).toContain('"Settled"');
  });
});

describe("what came back", () => {
  it("marks the unit on the sale a customer brought it back from", async () => {
    renderPage();
    await settle();

    // The seed's o-2: sold on the 11th, brought back — its RETUR_PELANGGAN
    // is in the ledger, which is what the mark is read from.
    const back = saleCard(seedCode("000202"));
    expect(within(back).getAllByText("Returned").length).toBeGreaterThan(0);
    // And a sale nothing came back from says nothing at all — there is no
    // "Completed" to print since the Status column left.
    expect(
      within(saleCard(seedCode("000201"))).queryByText("Returned"),
    ).toBeNull();
  });

  it("marks only the unit that came back, when one of several did", async () => {
    const db = getDb();
    const [a, b] = db.units.filter((u) => u.status === "TERSEDIA");
    addSale({
      id: "o-tx-part",
      code: "SI-TEST-PART",
      serials: [a!.serial, b!.serial],
      prices: { [a!.serial]: 1_000_000, [b!.serial]: 1_000_000 },
      payments: [
        {
          id: "o-tx-part-1",
          method: "TUNAI",
          amount: 2_000_000,
          state: "SETTLED",
          at: "2026-09-18T03:00:00.000Z",
        },
      ],
      settled: true,
    });
    mutate((d) => {
      d.events.push({
        id: "ev-tx-back",
        serial: a!.serial,
        seq: 999,
        type: "RETUR_PELANGGAN",
        at: "2026-09-18T09:00:00.000Z",
        fromStatus: "TERJUAL",
        toStatus: "TERSEDIA",
        locationId: "wh-1",
        staff: "Michella",
      });
    });
    renderPage();
    await settle();

    const card = saleCard("SI-TEST-PART");
    /*
     * The mark rides on the PRODUCT line since 2026-09-23: the serial has a
     * column of its own, so the two are no longer in one cell. Exactly one of
     * the two units came back, so exactly one line carries it.
     */
    expect(within(card).getAllByText("Returned")).toHaveLength(1);
    // And both serials are still on the sale, in the serial column.
    expect(within(card).getByText(a!.serial)).toBeInTheDocument();
    expect(within(card).getByText(b!.serial)).toBeInTheDocument();
  });
});

describe("what a marketplace kept (owner 2026-10-30)", () => {
  it("shows what landed, and says what Shopee deducted", async () => {
    mutate((d) => {
      d.settlements = d.settlements.filter((x) => x.id !== "stl-tx-1");
    });
    addSale({
      id: "o-tx-kept",
      code: "SI-TX-KEPT",
      source: "SHOPEE",
      payMethod: "MARKETPLACE",
      settled: true,
      payments: [
        {
          id: "o-tx-kept-p1",
          method: "MARKETPLACE",
          amount: 2_000_000,
          state: "SETTLED",
          at: "2026-09-18T03:00:00.000Z",
        },
      ],
    });
    mutate((d) => {
      d.settlements.push({
        id: "stl-tx-1",
        paymentId: "o-tx-kept-p1",
        orderId: "o-tx-kept",
        channel: "SHOPEE",
        gross: 2_000_000,
        fees: [{ id: "f1", kind: "OTHER", label: "Komisi", amount: 230_000 }],
        received: 1_770_000,
        at: "2026-09-18T03:00:00.000Z",
        staff: "Dina",
      });
    });
    renderPage();
    await settle();

    const card = saleCard("SI-TX-KEPT");
    expect(within(card).getByText(fmtRp(1_770_000))).toBeInTheDocument();
    expect(
      within(card).getByText(`Deducted ${fmtRp(230_000)} by Shopee`),
    ).toBeInTheDocument();
    mutate((d) => {
      d.settlements = d.settlements.filter((x) => x.id !== "stl-tx-1");
    });
  });
});
