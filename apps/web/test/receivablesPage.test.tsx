/**
 * Pending & receivables, driven the way the finance desk drives it (owner
 * briefs 2026-09-19 and 2026-09-20).
 *
 * What is worth guarding here is not reachable from a helper, because it
 * lives in component state and in the page's one writer:
 *
 * - only Shopee and Tokopedia money is "waiting" — an unpaid walk-in sale
 *   reads as one PENDING payment and must NOT land in this table;
 * - one row is one marketplace payment, and `Receive` records THAT payout and
 *   leaves every other row waiting;
 * - it writes one settlement per payment — the comma-joined ids it used to
 *   write are what Postgres refused;
 * - nothing is deducted until somebody says so, and what landed is the gross
 *   less what they said;
 * - a received row stays in the same table, underneath, and its pencil
 *   corrects it with both figures kept.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceivablesPage } from "../src/routes/finance/ReceivablesPage.js";
import { paymentsOf } from "../src/lib/salePayments.js";
import { getDb, mutate } from "../src/mock/store.js";

// A whole page in jsdom, queried by accessible name: the cost tracks how busy
// the computer running it is, not how much the test asserts.
vi.setConfig({ testTimeout: 90_000 });

/** Three Shopee sales waiting on a payout, each with its Shopee order number. */
const SALES = [
  {
    id: "o-rcv-1",
    code: "SI-RCV-001",
    amount: 5_000_000,
    ref: "2409150000AA01",
  },
  {
    id: "o-rcv-2",
    code: "SI-RCV-002",
    amount: 3_000_000,
    ref: "2409150000AA02",
  },
  {
    id: "o-rcv-3",
    code: "SI-RCV-003",
    amount: 2_000_000,
    ref: "2409150000AA03",
  },
] as const;

/** An unpaid counter sale: PENDING money that no marketplace is holding. */
const WALK_IN = {
  id: "o-rcv-walk",
  code: "SI-RCV-900",
  amount: 4_000_000,
} as const;

const paymentOf = (orderId: string) =>
  paymentsOf(getDb().orders.find((o) => o.id === orderId)!)[0]!;

const mine = () =>
  getDb().settlements.filter((s) => SALES.some((x) => x.id === s.orderId));

beforeEach(() => {
  mutate((d) => {
    // Only this file's sales wait at Shopee, so the marketplace table holds
    // exactly these three whatever the demo shop is holding.
    d.orders = d.orders.filter(
      (o) =>
        o.id !== WALK_IN.id &&
        !SALES.some((s) => s.id === o.id) &&
        !paymentsOf(o).some(
          (p) => p.state === "PENDING" && (p.channel ?? o.source) === "SHOPEE",
        ),
    );
    d.settlements = [];
    d.settlementLog = [];
    for (const s of SALES) {
      d.orders.push({
        id: s.id,
        code: s.code,
        ts: "2026-09-15T03:00:00.000Z",
        customerId: null,
        serials: [],
        prices: {},
        discount: 0,
        source: "SHOPEE",
        payMethod: "MARKETPLACE",
        settled: false,
        payments: [
          {
            id: `pay-${s.id}`,
            method: "MARKETPLACE",
            amount: s.amount,
            state: "PENDING",
            channel: "SHOPEE",
            at: "2026-09-15T03:00:00.000Z",
            ref: s.ref,
          },
        ],
        total: s.amount,
      });
    }
    // Written the way an order from before the payment list is read back:
    // no `payments`, `settled` false — which `legacyPayments` reads as ONE
    // PENDING payment carrying the ORDER's channel.
    d.orders.push({
      id: WALK_IN.id,
      code: WALK_IN.code,
      ts: "2026-09-15T04:00:00.000Z",
      customerId: null,
      serials: [],
      prices: {},
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: false,
      total: WALK_IN.amount,
    });
  });
});

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <ReceivablesPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });

/** The one dialog whose title says this. Antd gives every dialog the same
 *  `aria-labelledby` under test, so a title is matched by its text. */
const dialogTitled = (title: string) =>
  screen
    .getAllByRole("dialog")
    .find((d) => within(d).queryByText(title) !== null)!;

describe("receiving a payout", () => {
  it("records the row it was pressed on, and leaves the others waiting", async () => {
    renderPage();
    await settle();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Receive the payout for SI-RCV-002",
      }),
    );
    await settle();

    const dialog = dialogTitled("Receive from Shopee");
    // It opened on the sale it was pressed on, and it seeds NOTHING: the cut
    // is not always 10% and is nobody's to guess (owner, 2026-09-20).
    expect(within(dialog).getByText(/SI-RCV-002/)).toBeTruthy();
    expect(
      within(dialog).getByText("No deductions. The whole amount landed."),
    ).toBeTruthy();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mark as received" }),
    );
    await settle();

    // ONE settlement, naming exactly one payment — never "a,b".
    const written = mine();
    expect(written).toHaveLength(1);
    expect(written[0]!.paymentId).toBe("pay-o-rcv-2");
    expect(written[0]!.orderId).toBe("o-rcv-2");
    // Nothing was deducted, so the whole amount landed.
    expect(written[0]!.fees).toEqual([]);
    expect(written[0]!.received).toBe(3_000_000);
    expect(
      getDb().settlementLog.filter((l) => l.settlementId === written[0]!.id),
    ).toHaveLength(1);

    // The payment moved — that is what the balance is built from — and the
    // rest of the channel is untouched.
    expect(paymentOf("o-rcv-2").state).toBe("SETTLED");
    expect(paymentOf("o-rcv-1").state).toBe("PENDING");
    expect(paymentOf("o-rcv-3").state).toBe("PENDING");
    expect(getDb().orders.find((o) => o.id === "o-rcv-2")!.total).toBe(
      3_000_000,
    );

    // And the row is still in the same table, now with a pencil on it — and
    // its payment history, which every row carries waiting or not.
    expect(
      screen.getByRole("button", {
        name: "Correct the withdrawal for SI-RCV-002",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Payments on SI-RCV-002" }),
    ).toBeTruthy();
  });

  it("leaves an unpaid counter sale out of the marketplace table", async () => {
    renderPage();
    await settle();

    // It is PENDING money by `legacyPayments`, and it is not a marketplace's,
    // so it belongs to the customer table and nowhere near Receive.
    expect(
      screen.queryByRole("button", {
        name: `Receive the payout for ${WALK_IN.code}`,
      }),
    ).toBeNull();
    for (const s of SALES) {
      expect(
        screen.getByRole("button", {
          name: `Receive the payout for ${s.code}`,
        }),
      ).toBeTruthy();
    }
  });

  it("takes what landed from the deductions somebody typed", async () => {
    renderPage();
    await settle();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Receive the payout for SI-RCV-001",
      }),
    );
    await settle();
    const dialog = dialogTitled("Receive from Shopee");

    const add = async (label: string, amount: string) => {
      await userEvent.click(
        within(dialog).getByRole("button", { name: /Add a deduction/ }),
      );
      const amounts = within(dialog).getAllByRole("spinbutton", {
        name: "Amount deducted",
      });
      await userEvent.type(amounts[amounts.length - 1]!, amount);
      const labels = within(dialog).getAllByRole("textbox", {
        name: "What was deducted",
      });
      await userEvent.type(labels[labels.length - 1]!, label);
    };
    await add("Komisi Shopee", "500000");
    await add("Bank transfer fee", "6500");
    await settle();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mark as received" }),
    );
    await settle();

    const written = mine();
    expect(written).toHaveLength(1);
    expect(written[0]!.received).toBe(5_000_000 - 500_000 - 6_500);
    expect(written[0]!.fees.map((f) => f.label).sort()).toEqual([
      "Bank transfer fee",
      "Komisi Shopee",
    ]);
    expect(written[0]!.reason).toBeUndefined();
  });
});

describe("correcting a withdrawal", () => {
  it("rewrites the settlement, logs both figures and leaves the payment alone", async () => {
    renderPage();
    await settle();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Receive the payout for SI-RCV-001",
      }),
    );
    await settle();
    const opened = dialogTitled("Receive from Shopee");
    await userEvent.click(
      within(opened).getByRole("button", { name: /Add a deduction/ }),
    );
    await userEvent.type(
      within(opened).getByRole("spinbutton", { name: "Amount deducted" }),
      "500000",
    );
    await userEvent.type(
      within(opened).getByRole("textbox", { name: "What was deducted" }),
      "Komisi Shopee",
    );
    await userEvent.click(
      within(opened).getByRole("button", { name: "Mark as received" }),
    );
    await settle();
    const recorded = mine();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.received).toBe(4_500_000);

    // The statement says the commission was Rp600.000, not Rp500.000.
    await userEvent.click(
      screen.getByRole("button", {
        name: "Correct the withdrawal for SI-RCV-001",
      }),
    );
    await settle();
    const dialog = dialogTitled("Correct the withdrawal from Shopee");
    const box = within(dialog).getByRole("spinbutton", {
      name: "Amount deducted",
    });
    await userEvent.clear(box);
    await userEvent.type(box, "600000");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save the correction" }),
    );
    await settle();

    const corrected = mine();
    // The same row, edited in place — not a second one beside it.
    expect(corrected.map((s) => s.id)).toEqual(recorded.map((s) => s.id));
    expect(corrected[0]!.received).toBe(4_400_000);
    const amended = getDb().settlementLog.filter((l) => l.action === "AMENDED");
    expect(amended).toHaveLength(1);
    expect(amended[0]!.settlementId).toBe(recorded[0]!.id);
    expect(amended[0]!.before && amended[0]!.after).toBeTruthy();
    // The payment was settled once, and a correction leaves it alone.
    expect(paymentOf("o-rcv-1").state).toBe("SETTLED");
  });
});
