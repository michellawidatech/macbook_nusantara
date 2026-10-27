/**
 * Edit transaction takes an accessory (owner report 2026-10-22: *"cannot add
 * accessories / stuff without serial number, e.g. magsafe"*). A counted
 * product is a line with a quantity and a price per piece; its pieces leave
 * the shelf as a TERJUAL move and the sale's total follows the lines.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditTransactionModal } from "../src/routes/finance/EditTransactionModal.js";
import { getDb, mutate } from "../src/mock/store.js";
import { onHand, stockLevels } from "../src/lib/stock.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";
import type { Order } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

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

describe("Edit transaction with an accessory", () => {
  it("adds a counted product by quantity and re-totals the sale", async () => {
    const db = getDb();
    const skuId = [...stockLevels(db.stockMoves).keys()].find(
      (k) => onHand(db.stockMoves, k) >= 2 && !skuTracksSerial(db, k),
    )!;
    expect(skuId).toBeDefined();
    const sku = db.skus.find((s) => s.id === skuId)!;
    const label = `${sku.name} ${sku.variantLabel}`.trim();
    const shelfBefore = onHand(db.stockMoves, skuId);

    const order: Order = {
      ...db.orders.find((o) => o.serials.length > 0 && !o.adjustments)!,
    };
    const id = "o-edit-counted";
    mutate((d) => {
      d.orders.push({ ...structuredClone(order), id, code: "SI-EDIT-ACC" });
    });
    const sale = getDb().orders.find((o) => o.id === id)!;
    const totalBefore = sale.total;

    render(
      <AntdApp>
        <EditTransactionModal open order={sale} onClose={() => {}} />
      </AntdApp>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Add an item/ }));
    const picker = screen.getAllByRole("combobox", { name: "Item" }).at(-1)!;
    // The list holds every product; it renders only what is in view, so
    // narrow it the way a person would.
    await userEvent.type(picker, sku.name);
    await chooseOption(picker, label);
    const qty = screen.getAllByRole("spinbutton", { name: "Quantity" }).at(-1)!;
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    fireEvent.blur(qty);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const after = getDb().orders.find((o) => o.id === id)!;
    const line = (after.lines ?? []).find(
      (l) =>
        l.skuId === skuId && !(sale.lines ?? []).some((x) => x.id === l.id),
    );
    expect(line).toBeDefined();
    expect(line!.qty).toBe(2);
    expect(after.total).toBe(totalBefore + 2 * line!.price);
    expect(onHand(getDb().stockMoves, skuId)).toBe(shelfBefore - 2);
    expect(
      getDb().stockMoves.some(
        (m) =>
          m.orderId === id &&
          m.orderLineId === line!.id &&
          m.type === "TERJUAL",
      ),
    ).toBe(true);
  });
});
