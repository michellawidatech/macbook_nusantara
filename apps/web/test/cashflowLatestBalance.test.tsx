/**
 * Income & Expense's top row says the balance as it stands now, and a typed
 * adjustment can be deleted (owner report and ask, 2026-10-24).
 *
 * The report: three adjustments typed on one day — a Rp 2.100.000 "balance
 * mismatch" income and two expenses, Rp 60.200 and Rp 40.100 — and the first
 * row of the newest-first table read Rp 21.722.500, the figure BEFORE the two
 * expenses. A day's typed rows share an instant, and the table kept them in
 * the walk's own oldest-first order, so the shop counted Rp 100.300 missing.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import {
  adjustmentDeletionBlock,
  deleteAdjustment,
  transferPartner,
} from "../src/lib/adjustmentDeletion.js";

vi.setConfig({ testTimeout: 90_000 });

const rupiah = (el: Element) =>
  Number((el.textContent ?? "").replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""));

/** Tomorrow, so the three rows are the newest the page has. */
const DAY = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
/** When each was typed — what orders three rows of one date. */
const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  mutate((d) => {
    d.expenses = d.expenses.filter((e) => !e.id.startsWith("zz-"));
    d.incomes = d.incomes.filter((i) => !i.id.startsWith("zz-"));
    delete d.settings.booksClosedAt;
  });
});

/**
 * Typed in the client's order — the mismatch first — each unshifted as
 * `AdjustmentPanel` does, so collection order alone would put it on top.
 */
function typeTheClientsDay() {
  mutate((d) => {
    d.incomes.unshift({
      id: "zz-mismatch",
      createdAt: `${TODAY}T10:00:00.000Z`,
      reason: "SELISIH",
      amount: 2_100_000,
      date: DAY,
      method: "TRANSFER",
      note: "ZZ penyesuaian test input",
    });
  });
  mutate((d) => {
    d.expenses.unshift({
      id: "zz-cling",
      createdAt: `${TODAY}T10:05:00.000Z`,
      kind: "OPERATIONAL",
      amount: 60_200,
      date: DAY,
      method: "TRANSFER",
      note: "ZZ BELI CLING",
    });
  });
  mutate((d) => {
    d.expenses.unshift({
      id: "zz-bensin",
      createdAt: `${TODAY}T10:07:00.000Z`,
      kind: "OPERATIONAL",
      amount: 40_100,
      date: DAY,
      method: "TRANSFER",
      note: "ZZ ISI BENSIN",
    });
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

const cardOf = (text: string) =>
  screen.getByText(text).closest(".ant-card") as HTMLElement;
const latestBalanceIn = (card: HTMLElement) =>
  within(card).getByText("Latest balance").parentElement!.lastElementChild!;

describe("the latest balance", () => {
  it("is on the top row, after every row of the same day", async () => {
    typeTheClientsDay();
    renderPage();

    const order = [
      "ZZ ISI BENSIN",
      "ZZ BELI CLING",
      "ZZ penyesuaian test input",
    ]
      .map((text) => cardOf(text))
      .map((card) => [...document.querySelectorAll(".ant-card")].indexOf(card));
    // Newest first: the last one typed is on top, the first one at the bottom.
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const bensin = rupiah(latestBalanceIn(cardOf("ZZ ISI BENSIN")));
    const cling = rupiah(latestBalanceIn(cardOf("ZZ BELI CLING")));
    const mismatch = rupiah(
      latestBalanceIn(cardOf("ZZ penyesuaian test input")),
    );
    expect(cling).toBe(mismatch - 60_200);
    // Each row says the hour and minute it was typed, on its picked day.
    const typedAt = new Date(`${TODAY}T10:07:00.000Z`);
    const hhmm = new RegExp(
      `${String(typedAt.getHours()).padStart(2, "0")}[.:]07`,
    );
    expect(cardOf("ZZ ISI BENSIN").textContent).toMatch(hhmm);
    expect(bensin).toBe(cling - 40_100);

    // …and it is what the two pots add up to.
    await userEvent.click(screen.getByRole("button", { name: "Show Cash" }));
    await userEvent.click(screen.getByRole("button", { name: "Show Bank" }));
    expect(
      rupiah(screen.getByTestId("pot-cash")) +
        rupiah(screen.getByTestId("pot-bank")),
    ).toBe(bensin);
  });
});

describe("deleting an adjustment", () => {
  it("removes it after a confirm, and the balance follows", async () => {
    typeTheClientsDay();
    renderPage();
    const before = rupiah(latestBalanceIn(cardOf("ZZ ISI BENSIN")));

    await userEvent.click(
      screen.getByRole("button", { name: "Delete ZZ penyesuaian test input" }),
    );
    // antd's confirm draws its title twice (the visible one and a labelled
    // heading), so take the first and climb to its dialog.
    const dialog = (
      await screen.findAllByText("Delete this adjustment?")
    )[0]!.closest(".ant-modal") as HTMLElement;
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete adjustment" }),
    );

    await vi.waitFor(() =>
      expect(getDb().incomes.some((i) => i.id === "zz-mismatch")).toBe(false),
    );
    expect(screen.queryByText("ZZ penyesuaian test input")).toBeNull();
    expect(rupiah(latestBalanceIn(cardOf("ZZ ISI BENSIN")))).toBe(
      before - 2_100_000,
    );
  });

  it("is not refused by a book closed before the close was retired (2026-10-27)", () => {
    typeTheClientsDay();
    mutate((d) => {
      d.settings.booksClosedAt = new Date(
        Date.now() + 3 * 86_400_000,
      ).toISOString();
    });
    renderPage();
    expect(
      screen.getByRole("button", { name: "Delete ZZ ISI BENSIN" }),
    ).toBeEnabled();
    expect(adjustmentDeletionBlock(DAY, getDb().settings)).toBeUndefined();
  });

  it("takes both halves of a cash ↔ bank move, and only those", () => {
    const db = {
      expenses: [
        {
          id: "x1",
          kind: "TRANSFER" as const,
          label: "Pencairan",
          amount: 2_000_000,
          date: DAY,
          method: "TRANSFER",
        },
        {
          id: "x2",
          kind: "OPERATIONAL" as const,
          amount: 2_000_000,
          date: DAY,
          method: "TUNAI",
        },
      ],
      incomes: [
        {
          id: "y1",
          reason: "TRANSFER" as const,
          amount: 2_000_000,
          date: DAY,
          method: "TUNAI",
          note: "Pencairan",
        },
      ],
    };
    expect(transferPartner(db, { kind: "income", id: "y1" })).toEqual({
      kind: "expense",
      id: "x1",
    });
    expect(transferPartner(db, { kind: "expense", id: "x2" })).toBeUndefined();
    expect(deleteAdjustment(db, { kind: "income", id: "y1" })).toBe(2);
    expect(db.expenses.map((e) => e.id)).toEqual(["x2"]);
    expect(db.incomes).toEqual([]);
  });
});
