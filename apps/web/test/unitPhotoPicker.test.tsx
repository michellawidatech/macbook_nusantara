/**
 * The chat's photo picker (owner ask 2026-10-23): a product, then its units on
 * sale that have photos, ticked — several, across products — and one Send.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnitPhotoPicker } from "../src/routes/chatbot/UnitPhotoPicker.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

describe("the unit photo picker", () => {
  it("offers only units on sale with photos, and sends the ticked ones", async () => {
    const db = getDb();
    const onSale = db.units.filter((u) => u.status === "TERSEDIA");
    const unit = onSale[0]!;
    const sameSku = onSale.filter((u) => u.skuId === unit.skuId);
    const sku = db.skus.find((k) => k.id === unit.skuId)!;
    const label = `${sku.name} ${sku.variantLabel}`.trim();
    // Give the first unit a photo, and only it.
    mutate((d) => {
      d.unitNotes.push({
        id: "note-picker",
        serial: unit.serial,
        tag: "QC",
        at: new Date().toISOString(),
        staff: "Test",
        body: "",
        photos: [
          {
            id: "photo-picker",
            url: "data:image/png;base64,AA==",
            sortOrder: 0,
          },
        ],
      });
    });

    const onSend = vi.fn();
    render(
      <AntdApp>
        <UnitPhotoPicker
          open
          sending={false}
          onCancel={() => {}}
          onSend={onSend}
        />
      </AntdApp>,
    );

    const picker = screen.getByRole("combobox", { name: "Product" });
    await userEvent.type(picker, sku.name);
    fireEvent.mouseDown(picker);
    const option = await vi.waitFor(() => {
      const found = Array.from(
        document.querySelectorAll<HTMLElement>(".ant-select-item-option"),
      ).find((el) => el.getAttribute("title") === label);
      if (!found) throw new Error(`no option ${label}`);
      return found;
    });
    fireEvent.click(option);

    // Only the photographed unit is listed, not its unphotographed siblings.
    const dialog = (await screen.findByText(unit.serial)).closest(
      ".ant-modal",
    ) as HTMLElement;
    for (const other of sameSku.filter((u) => u.serial !== unit.serial))
      expect(within(dialog).queryByText(other.serial)).toBeNull();

    await userEvent.click(screen.getByRole("checkbox", { name: unit.serial }));
    await userEvent.click(
      screen.getByRole("button", { name: /Send photos of 1 unit/ }),
    );
    expect(onSend).toHaveBeenCalledWith([unit.serial]);
  });
});
