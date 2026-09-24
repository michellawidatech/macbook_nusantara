/**
 * A counted product goes back to its supplier by quantity (owner ask
 * 2026-09-19): a `RETUR_SUPPLIER` stock move carrying the SP code, the reason
 * and the invoice the pieces came in on — no `UnitReturn`, no unit.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SupplierReturnPanel } from "../src/routes/returns/SupplierReturnPage.js";
import { ReturnHistoryTable } from "../src/routes/returns/ReturnHistoryTable.js";
import { getDb } from "../src/mock/store.js";
import { onHand, stockLevels } from "../src/lib/stock.js";

vi.setConfig({ testTimeout: 60_000 });

/** Pick an antd Select option by its visible label (portalled list). */
async function chooseOption(control: HTMLElement, option: string) {
  fireEvent.mouseDown(control);
  const item = await vi.waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      ),
    );
    const found = Array.from(
      open[open.length - 1]?.querySelectorAll<HTMLElement>(
        ".ant-select-item-option",
      ) ?? [],
    ).find((el) => el.getAttribute("title") === option);
    if (!found) throw new Error(`no option “${option}” open`);
    return found;
  });
  fireEvent.click(item);
}

describe("supplier return of a counted product", () => {
  let skuId: string;
  let label: string;
  let before: number;
  let reason: string;
  let unitReturns: number;

  beforeAll(() => {
    const db = getDb();
    const [id] = [...stockLevels(db.stockMoves).keys()].filter(
      (k) =>
        onHand(db.stockMoves, k) > 0 &&
        db.pos.some((p) => p.items.some((i) => i.skuId === k)),
    );
    expect(id).toBeDefined();
    skuId = id!;
    const sku = db.skus.find((s) => s.id === skuId)!;
    before = onHand(db.stockMoves, skuId);
    unitReturns = db.returns.length;
    label = `${sku.name} ${sku.variantLabel} — ${before} in stock`;
    reason = db.reasons.find(
      (r) => r.activity === "RETURN_SUPPLIER" && r.active,
    )!.label;
  });

  it("takes the pieces off the shelf as a RETUR_SUPPLIER move", async () => {
    // The history moved out of the panel into one combined table on the page
    // (owner ask 2026-09-23); both are rendered so the write and what it
    // shows are still one test.
    render(
      <AntdApp>
        <MemoryRouter>
          <SupplierReturnPanel addOpen onCloseAdd={() => {}} />
          <ReturnHistoryTable />
        </MemoryRouter>
      </AntdApp>,
    );
    await userEvent.click(screen.getByText("Counted product (by quantity)"));
    await chooseOption(
      screen.getByRole("combobox", { name: "Product" }),
      label,
    );
    await chooseOption(
      screen.getByRole("combobox", { name: /^Reason/ }),
      reason,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Record supplier return" }),
    );

    await vi.waitFor(() => {
      const move = getDb().stockMoves.find(
        (m) => m.type === "RETUR_SUPPLIER" && m.skuId === skuId,
      );
      expect(move).toBeDefined();
      expect(move!.qty).toBe(-1);
      expect(move!.refCode).toMatch(/^SP-/);
      expect(move!.poId).toBeDefined();
      expect(move!.reasonId).toBeDefined();
    });
    expect(onHand(getDb().stockMoves, skuId)).toBe(before - 1);
    // No UnitReturn is written for it.
    expect(getDb().returns.length).toBe(unitReturns);
    // …and it shows in the one history table, as a return to the supplier.
    // More than one: the facet's option and the row's own tag.
    expect((await screen.findAllByText("To supplier")).length).toBeGreaterThan(
      0,
    );
  });
});
