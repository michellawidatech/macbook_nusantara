/**
 * An unpaid sale, returned, on Income & Expense (owner ask 2026-10-26):
 * *"the income should be voided or have the same status 'Unpaid, returned'"*.
 *
 * The return cut the sale's DUE row, and the row vanished from Accrual as if
 * the debt had never been. It stays as one struck-through row for what the
 * return cancelled — and it is never money: not in the running balance, not
 * in the Cash and Bank cards. Cash basis does not list it at all.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

const rupiah = (el: Element) =>
  Number((el.textContent ?? "").replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""));

/** Two days ahead, so the voided row is the newest on the page. */
const SOLD_AT = new Date(Date.now() + 2 * 86_400_000).toISOString();
const CODE = "SI-ZZ-UNPAID-BACK";

beforeEach(() => {
  mutate((d) => {
    d.orders = d.orders.filter((o) => !o.id.startsWith("o-zz-"));
  });
});

/** A sale nobody paid for, all of it returned — what the return desk leaves. */
function addUnpaidReturnedSale() {
  const serial = getDb().units[0]!.serial;
  const sale: Order = {
    id: "o-zz-unpaid-back",
    code: CODE,
    ts: SOLD_AT,
    customerId: null,
    serials: [serial],
    prices: { [serial]: 7_654_000 },
    discount: 0,
    source: "OFFLINE",
    payMethod: "TUNAI",
    settled: true,
    total: 7_654_000,
    // The return cancelled the whole DUE part, so the list is empty.
    payments: [],
    adjustments: [
      {
        id: "adj-zz",
        type: "RETUR",
        code: "SG-ZZ-1",
        amount: 7_654_000,
        reason: `Returned ${serial} — rusak`,
        at: SOLD_AT,
      },
    ],
  };
  mutate((d) => {
    d.orders.push(sale);
  });
}

function renderPage() {
  render(
    <AntdApp>
      <MemoryRouter>
        <IncomeExpensePage />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** Every row's card, top first (the page is on the phone layout in tests). */
const rowCards = () =>
  [...document.querySelectorAll(".ant-card")].filter(
    (c) =>
      // One row's card holds one; the table's own card holds them all.
      within(c as HTMLElement).queryAllByText("Latest balance").length === 1,
  ) as HTMLElement[];
/** The card of the voided row — the one whose amount is struck through. */
const voidedCard = () =>
  document
    .querySelector("[data-voided='true']")
    ?.closest(".ant-card") as HTMLElement;
const latestBalanceIn = (card: HTMLElement) =>
  within(card).getByText("Latest balance").parentElement!.lastElementChild!;

describe("a debt a return cancelled", () => {
  it("is one struck-through row in Accrual, and never money", async () => {
    addUnpaidReturnedSale();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Show Cash" }));
    await userEvent.click(screen.getByRole("button", { name: "Show Bank" }));

    // Cash basis lists no DUE row, and so no voided one either.
    expect(screen.queryByText(CODE)).toBeNull();

    await userEvent.click(screen.getByText("Accrual"));
    const card = voidedCard();
    expect(within(card).getByText(CODE)).toBeInTheDocument();
    expect(within(card).getByText("Unpaid, returned")).toBeInTheDocument();
    const amount = card.querySelector("[data-voided='true']")!;
    expect(amount).not.toBeNull();
    // antd's `delete` draws the figure inside a <del> — struck through.
    expect(amount.querySelector("del")).not.toBeNull();
    expect(rupiah(amount)).toBe(7_654_000);
    // Not a pot, so no method — and no "Not in balance" tag beside it either.
    expect(within(card).queryByText("Not in balance")).toBeNull();

    // The newest row, and the balance beside it is the one beneath it.
    const cards = rowCards();
    expect(cards[0]).toBe(card);
    expect(rupiah(latestBalanceIn(card))).toBe(
      rupiah(latestBalanceIn(cards[1]!)),
    );

    // The Cash and Bank cards do not move when it goes.
    const cash = rupiah(screen.getByTestId("pot-cash"));
    const bank = rupiah(screen.getByTestId("pot-bank"));
    const top = rupiah(latestBalanceIn(card));
    mutate((d) => {
      d.orders = d.orders.filter((o) => o.id !== "o-zz-unpaid-back");
    });
    await vi.waitFor(() => expect(screen.queryByText(CODE)).toBeNull());
    expect(rupiah(screen.getByTestId("pot-cash"))).toBe(cash);
    expect(rupiah(screen.getByTestId("pot-bank"))).toBe(bank);
    expect(rupiah(latestBalanceIn(rowCards()[0]!))).toBe(top);
  });

  it("says Partly paid, returned when a deposit came in and went back", async () => {
    addUnpaidReturnedSale();
    mutate((d) => {
      const o = d.orders.find((x) => x.id === "o-zz-unpaid-back")!;
      o.payments = [
        {
          id: "o-zz-dp",
          method: "TRANSFER",
          amount: 1_000_000,
          state: "SETTLED",
          at: SOLD_AT,
        },
      ];
      o.refunds = [
        { id: "rf-zz", method: "TRANSFER", amount: 1_000_000, at: SOLD_AT },
      ];
    });
    renderPage();
    await userEvent.click(screen.getByText("Accrual"));

    const card = voidedCard();
    expect(within(card).getByText("Partly paid, returned")).toBeInTheDocument();
    // What was cancelled is the debt, not the deposit that was handed back.
    expect(rupiah(card.querySelector("[data-voided='true']")!)).toBe(6_654_000);
  });
});
