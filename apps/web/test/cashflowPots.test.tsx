/**
 * Income & Expense shows what is in the drawer and in the bank, hidden until
 * asked (owner ask 2026-10-22), and an adjustment can move money between the
 * two — Pencairan Dana Bank: bank down, cash up, the total unchanged.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { getDb } from "../src/mock/store.js";
import { pressPageAction } from "./pageActions.js";

vi.setConfig({ testTimeout: 90_000 });

const rupiah = (el: HTMLElement) =>
  Number((el.textContent ?? "").replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""));

describe("the cash and bank balances", () => {
  it("are dotted until the eye is pressed, and a bank → cash move shifts them", async () => {
    render(
      <AntdApp>
        <MemoryRouter>
          <IncomeExpensePage />
        </MemoryRouter>
      </AntdApp>,
    );
    const cash = screen.getByTestId("pot-cash");
    const bank = screen.getByTestId("pot-bank");
    expect(cash.textContent).toBe("Rp ••••••");
    expect(bank.textContent).toBe("Rp ••••••");

    await userEvent.click(screen.getByRole("button", { name: "Show Cash" }));
    await userEvent.click(screen.getByRole("button", { name: "Show Bank" }));
    const cashBefore = rupiah(screen.getByTestId("pot-cash"));
    const bankBefore = rupiah(screen.getByTestId("pot-bank"));

    pressPageAction(/Add adjustment/);
    const dialog = (await screen.findByText("Record it")).closest(
      ".ant-modal",
    ) as HTMLElement;
    await userEvent.click(within(dialog).getByText("Cash ↔ bank"));
    const amount = within(dialog).getByRole("spinbutton");
    await userEvent.type(amount, "2000000");
    fireEvent.blur(amount);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record it" }),
    );

    await vi.waitFor(() =>
      expect(rupiah(screen.getByTestId("pot-cash"))).toBe(
        cashBefore + 2_000_000,
      ),
    );
    expect(rupiah(screen.getByTestId("pot-bank"))).toBe(bankBefore - 2_000_000);
    const db = getDb();
    expect(
      db.expenses.some(
        (e) =>
          e.kind === "TRANSFER" &&
          e.method === "TRANSFER" &&
          e.amount === 2_000_000,
      ),
    ).toBe(true);
    expect(
      db.incomes.some(
        (i) =>
          i.reason === "TRANSFER" &&
          i.method === "TUNAI" &&
          i.amount === 2_000_000,
      ),
    ).toBe(true);
  });
});
