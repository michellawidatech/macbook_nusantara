/**
 * Import sell prices through the Inventory page (owner ask 2026-10-21), and
 * the owner's condition on it: "make sure this change does not mess up the
 * existing inbound". The list is applied to the store as it is NOW.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { xlsxFile } from "../src/lib/xlsxWrite.js";
import { warehouseLabelOf } from "../src/lib/warehouses.js";

vi.setConfig({ testTimeout: 90_000 });

/** The desktop layout, where the button is in the table's toolbar. */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: /min-width:\s*(\d+)px/.test(query),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

describe("Import sell prices", () => {
  it("reprices the units on the shelf and leaves inbound alone", async () => {
    useDesktopViewport();
    const db0 = getDb();
    // A variant with units on the shelf in one warehouse…
    const shelf = db0.units.find((u) => u.status === "TERSEDIA")!;
    const shelfSku = db0.skus.find((s) => s.id === shelf.skuId)!;
    // …and a unit still in QC on an inbound invoice, priced there.
    const qcUnit = db0.units.find((u) => u.status === "QC")!;
    mutate((d) => {
      d.units.find((u) => u.serial === qcUnit.serial)!.price = 1_234_000;
    });
    const qcSku = getDb().skus.find((s) => s.id === qcUnit.skuId)!;
    const label = (id: string) => warehouseLabelOf(getDb().warehouses, id)!;
    const rowText = (s: typeof shelfSku) =>
      [s.name, s.variantLabel].filter(Boolean).join(" ");

    const before = structuredClone(getDb());
    const bytes = xlsxFile({
      name: "Persediaan",
      rows: [
        ["PERSEDIAAN BARANG"],
        ["Unit", "Qty", "Gudang", "Harga IG (Rp)"],
        [rowText(shelfSku), 1, label(shelf.locationId), 7_777_000],
        [rowText(qcSku), 1, label(qcUnit.locationId), 9_999_000],
        ["A product nobody has", 1, label(shelf.locationId), 1_000_000],
      ],
    });

    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/stock/inventory"]}>
          <InventoryPage />
        </MemoryRouter>
      </AntdApp>,
    );
    // Role queries walk the whole inventory table and are far too slow here.
    fireEvent.click(
      (await screen.findByText("Import sell prices")).closest("button")!,
    );
    const dialog = (
      await screen.findByText("Choose the price list (.xlsx)")
    ).closest(".ant-modal") as HTMLElement;
    const user = userEvent.setup();
    await user.upload(
      dialog.querySelector("input[type=file]") as HTMLInputElement,
      new File([bytes], "Harga IG.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await within(dialog).findByText("Product not found");

    const repriced = getDb().units.filter(
      (u) =>
        u.skuId === shelf.skuId &&
        u.locationId === shelf.locationId &&
        ["TERSEDIA", "DIRESERVASI", "SERVIS"].includes(u.status),
    );
    const apply = within(dialog)
      .getByText(`Update ${repriced.length} units`)
      .closest("button")!;
    await user.click(apply);

    await vi.waitFor(() =>
      expect(getDb().units.find((u) => u.serial === shelf.serial)!.price).toBe(
        7_777_000,
      ),
    );
    const after = getDb();
    for (const u of repriced) {
      expect(after.units.find((x) => x.serial === u.serial)!.price).toBe(
        7_777_000,
      );
      expect(
        after.events.filter((e) => e.serial === u.serial).at(-1)!.note,
      ).toMatch(/Harga IG\.xlsx/);
    }
    // Inbound: the QC unit keeps the price its invoice gave it…
    expect(after.units.find((u) => u.serial === qcUnit.serial)!.price).toBe(
      1_234_000,
    );
    // …and no invoice, cost, variant price or other unit moved.
    expect(after.pos).toEqual(before.pos);
    expect(after.skus).toEqual(before.skus);
    for (const u of after.units) {
      const was = before.units.find((x) => x.serial === u.serial)!;
      expect(u.buy).toBe(was.buy);
      expect(u.status).toBe(was.status);
      expect(u.locationId).toBe(was.locationId);
      if (!repriced.some((r) => r.serial === u.serial)) {
        expect(u.price).toBe(was.price);
      }
    }
  });
});
