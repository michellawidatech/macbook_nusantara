/**
 * A service charge paid is an Income & Expense line (owner ask 2026-10-26):
 * an `Expense` of kind UNIT, listed under "Unit expense", and NOT offered by
 * Add adjustment — it is written only from a charge.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { mutate } from "../src/mock/store.js";
import { EXPENSE_CATEGORIES } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

const TODAY = new Date().toISOString().slice(0, 10);

afterEach(() => {
  mutate((d) => {
    d.expenses = d.expenses.filter((e) => e.id !== "zz-unit-exp");
  });
});

describe("a paid service charge on Income & Expense", () => {
  it("is listed under Unit expense", async () => {
    mutate((d) => {
      d.expenses.unshift({
        id: "zz-unit-exp",
        kind: "UNIT",
        amount: 800_000,
        date: TODAY,
        method: "TRANSFER",
        note: "ZZSERIAL01 · Keyboard",
        serviceFeeId: "sf-zz",
        createdAt: new Date().toISOString(),
      });
    });
    render(
      <AntdApp>
        <MemoryRouter>
          <IncomeExpensePage />
        </MemoryRouter>
      </AntdApp>,
    );
    const card = (await screen.findByText("ZZSERIAL01 · Keyboard")).closest(
      ".ant-card",
    ) as HTMLElement;
    expect(card.textContent).toContain("Unit expense");
  });

  it("is a category Add adjustment does not offer", () => {
    const unit = EXPENSE_CATEGORIES.find((c) => c.value === "UNIT")!;
    expect(unit).toMatchObject({ label: "Unit expense", automatic: true });
  });
});
