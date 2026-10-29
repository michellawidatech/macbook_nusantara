/**
 * Stock in moves a unit that is already on a shelf (owner report 2026-10-29:
 * C02CK4Y2ML7J in 03 could not be stocked into 05). The dialog has always
 * been titled "transfer or bring units into a warehouse"; the rule refused
 * every in-stock unit as "already in stock".
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

async function openStockIn() {
  render(
    <AntdApp>
      <MemoryRouter initialEntries={["/stock/inventory?adjust=IN"]}>
        <InventoryPage />
      </MemoryRouter>
    </AntdApp>,
  );
  return (await screen.findByText(/^Stock in/)).closest(
    ".ant-modal",
  ) as HTMLElement;
}

describe("Stock in", () => {
  it.each(["TERSEDIA", "DIRESERVASI"] as const)(
    "moves a %s unit from another warehouse into this one and keeps its status",
    async (status) => {
      const db = getDb();
      const into = db.myWarehouseId;
      const unit = db.units.find(
        (u) => u.status === status && u.locationId !== into,
      );
      if (!unit) throw new Error(`seed has no ${status} unit outside ${into}`);
      const from = unit.locationId;

      const dialog = await openStockIn();
      const [reason, , serial] = within(dialog).getAllByRole("combobox");
      fireEvent.change(reason!, { target: { value: "Pindah gudang" } });
      fireEvent.change(serial!, { target: { value: unit.serial } });
      fireEvent.click(within(dialog).getByRole("button", { name: /Log 1/ }));

      await vi.waitFor(() => {
        const after = getDb().units.find((u) => u.serial === unit.serial)!;
        expect(after.locationId).toBe(into);
        expect(after.status).toBe(status);
      });
      const last = getDb()
        .events.filter((e) => e.serial === unit.serial)
        .sort((a, b) => b.seq - a.seq)[0]!;
      expect(last.fromStatus).toBe(status);
      expect(last.toStatus).toBe(status);
      expect(last.locationId).toBe(into);
      expect(last.note).toMatch(/^Moved /);
      expect(from).not.toBe(into);
    },
  );
});
