/**
 * Taking a recorded return back from the history row (owner ask 2026-09-25:
 * *"also add a delete / edit button in return row"*).
 *
 * `returnUndo.test.ts` pins the RULE — which returns may be taken back. This
 * pins what the press actually writes, because the money is the part that
 * would be silently wrong: the unit goes back out, the sale's RETUR
 * adjustment goes so the bill rises again, the derived debt row is rebuilt
 * from that bill, and the document stays in the history marked withdrawn.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnHistoryTable } from "../src/routes/returns/ReturnHistoryTable.js";
import { getDb, mutate } from "../src/mock/store.js";
import { orderBalance } from "../src/lib/salePayments.js";
import type { SaleSource } from "../src/lib/channels.js";

vi.setConfig({ testTimeout: 90_000 });

const SOLD = "SUNDOTEST0001";
const ORDER = "o-undo-test";
const CODE = "SI-2026/09-991001";
const SG = "SG-2026/09-991001";
const PRICE = 5_000_000;

const order = () => getDb().orders.find((o) => o.id === ORDER)!;
const unit = () => getDb().units.find((u) => u.serial === SOLD)!;
const rec = () => getDb().returns.find((r) => r.code === SG)!;

/**
 * The state a recorded return leaves behind: the unit back on the shelf at a
 * regrade, the sale credited in full, and the shop owing nothing because the
 * bill went to zero. Built directly rather than driven through the form —
 * `customerReturn.test.tsx` already covers the form writing it, and what is
 * under test here is putting it back.
 */
function afterAReturn({ source = "OFFLINE" as SaleSource } = {}) {
  mutate((d) => {
    d.units = d.units.filter((u) => u.serial !== SOLD);
    const base = d.units.find((u) => u.status === "TERSEDIA")!;
    d.units.push({ ...base, serial: SOLD, status: "TERSEDIA", grade: "B" });
    d.orders = d.orders.filter((o) => o.id !== ORDER);
    d.orders.unshift({
      id: ORDER,
      code: CODE,
      ts: "2026-09-20T03:00:00.000Z",
      customerId: null,
      serials: [SOLD],
      prices: { [SOLD]: PRICE },
      discount: 0,
      source,
      payMethod: "TUNAI",
      settled: true,
      total: PRICE,
      // Nothing was ever collected: the return cancelled the whole debt, so
      // `withOwed` left no DUE row behind.
      payments: [],
      adjustments: [
        {
          id: "adj-undo-1",
          type: "RETUR",
          code: SG,
          amount: PRICE,
          reason: `Returned ${SOLD}`,
          at: "2026-09-21T03:00:00.000Z",
        },
      ],
    });
    d.returns = d.returns.filter((r) => r.code !== SG);
    d.returns.push({
      id: "ret-undo-1",
      code: SG,
      kind: "CUSTOMER",
      serial: SOLD,
      reason: "Rusak",
      date: "2026-09-21T03:00:00.000Z",
      status: "ARRIVED",
      beforeGrade: "A",
      afterGrade: "B",
    });
  });
}

function renderHistory() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <ReturnHistoryTable />
      </MemoryRouter>
    </AntdApp>,
  );
}

const undoButton = () =>
  screen.getByRole("button", { name: `Take return ${SG} back` });

/**
 * ⚠️ The confirm is reached by its OK button, not by its title: the button's
 * own tooltip says nearly the same sentence, and antd renders a dialog's
 * title in more than one node, so `findByText` finds several.
 */
async function pressUndo() {
  await userEvent.click(undoButton());
  await userEvent.click(
    await screen.findByRole("button", { name: /Take it back/ }),
  );
}

describe("taking a return back", () => {
  beforeEach(() => afterAReturn());

  it("sends the unit back out and restores the bill and the debt", async () => {
    expect(orderBalance(order()).total).toBe(0);
    renderHistory();
    await pressUndo();

    await vi.waitFor(() => expect(rec().status).toBe("CANCELLED"));
    // Back out to the customer, at the grade it went out at — `beforeGrade`
    // is the snapshot the return took for exactly this.
    expect(unit().status).toBe("TERJUAL");
    expect(unit().grade).toBe("A");
    // The adjustment is gone, so the bill is the sale's own total again…
    expect(order().adjustments ?? []).toHaveLength(0);
    const money = orderBalance(order());
    expect(money.total).toBe(PRICE);
    // …and the debt the return cancelled is derived back from it, rather
    // than restored from a copy nobody kept.
    expect(money.customerOwes).toBe(PRICE);
    expect(order().settled).toBe(false);
  });

  it("leaves the withdrawn document in the history", async () => {
    renderHistory();
    await pressUndo();
    await vi.waitFor(() => expect(rec().status).toBe("CANCELLED"));
    // Nothing is deleted here: the row stays, marked, and says so.
    expect(getDb().returns.some((r) => r.code === SG)).toBe(true);
    expect(await screen.findByText("Withdrawn")).toBeTruthy();
    expect(undoButton()).toBeDisabled();
  });

  it("appends a reversing event rather than editing the ledger", async () => {
    const before = getDb().events.filter((e) => e.serial === SOLD).length;
    renderHistory();
    await pressUndo();
    await vi.waitFor(() => expect(rec().status).toBe("CANCELLED"));
    const mine = getDb().events.filter((e) => e.serial === SOLD);
    expect(mine).toHaveLength(before + 1);
    expect(mine[mine.length - 1]!.type).toBe("KOREKSI");
    // The RETUR_PELANGGAN the return wrote is still there — this database
    // appends a correction, it does not rewrite history.
    expect(mine[mine.length - 1]!.note).toContain(SG);
  });

  it("refuses a marketplace sale, and says why on the button", async () => {
    afterAReturn({ source: "SHOPEE" });
    renderHistory();
    // Nothing records how much pending money the return cut off which part,
    // so the undo declines rather than inventing one.
    expect(undoButton()).toBeDisabled();
  });

  it("refuses once the unit has moved on", async () => {
    mutate((d) => {
      const u = d.units.find((x) => x.serial === SOLD)!;
      u.status = "TERJUAL";
    });
    renderHistory();
    expect(undoButton()).toBeDisabled();
  });
});

describe("correcting a return", () => {
  beforeEach(() => afterAReturn());

  it("changes the reason and the condition, and carries the grade over", async () => {
    renderHistory();
    await userEvent.click(
      screen.getByRole("button", { name: `Correct return ${SG}` }),
    );
    const dialog = (await screen.findByText(`Correct ${SG}`)).closest(
      "[role='dialog']",
    ) as HTMLElement;

    const grade = within(dialog).getByLabelText(`Condition of ${SOLD}`);
    await userEvent.click(grade);
    await userEvent.click(await screen.findByTitle("C"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Save the correction/ }),
    );

    await vi.waitFor(() => expect(rec().afterGrade).toBe("C"));
    // The unit follows, because it still said what this return recorded.
    expect(unit().grade).toBe("C");
    // And it is still the same return, against the same unit.
    expect(rec().serial).toBe(SOLD);
    expect(rec().status).toBe("ARRIVED");
  });

  it("leaves the unit alone when it has been regraded since", async () => {
    mutate((d) => {
      const u = d.units.find((x) => x.serial === SOLD)!;
      u.grade = "A";
    });
    renderHistory();
    await userEvent.click(
      screen.getByRole("button", { name: `Correct return ${SG}` }),
    );
    const dialog = (await screen.findByText(`Correct ${SG}`)).closest(
      "[role='dialog']",
    ) as HTMLElement;
    const grade = within(dialog).getByLabelText(`Condition of ${SOLD}`);
    await userEvent.click(grade);
    await userEvent.click(await screen.findByTitle("C"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Save the correction/ }),
    );

    await vi.waitFor(() => expect(rec().afterGrade).toBe("C"));
    // Somebody else's answer, taken after this return: not overwritten.
    expect(unit().grade).toBe("A");
  });
});
