/**
 * Where a unit goes for its repair is a choice (owner ask 2026-10-22: *"make
 * sure we can choose where we send the product / send back the item after
 * service"*). Inventory's stock-out to service used to file every unit at the
 * one SERVIS-kind warehouse; the bench is the default now, not the only
 * answer. (Inbound & QC's dialog is covered in inboundQcPage.test.tsx, and
 * *Back in stock* on the service page has always asked.)
 */
import { App as AntdApp } from "antd";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

async function choose(control: HTMLElement, title: string) {
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
    ).find((el) => el.getAttribute("title") === title);
    if (!found) throw new Error(`no option “${title}” open`);
    return found;
  });
  fireEvent.click(item);
}

describe("sending units to service from Inventory", () => {
  it("files them in the warehouse the dialog names", async () => {
    const unit = getDb().units.find(
      (u) => u.status === "TERSEDIA" && u.locationId !== "wh-3",
    )!;
    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/stock/inventory?adjust=OUT"]}>
          <InventoryPage />
        </MemoryRouter>
      </AntdApp>,
    );
    const dialog = (await screen.findByText(/^Stock out/)).closest(
      ".ant-modal",
    ) as HTMLElement;

    await choose(within(dialog).getAllByRole("combobox")[1]!, "On service");
    const sendTo = await within(dialog).findByLabelText("Send to");
    await choose(sendTo, "03 · Gudang Bandung");

    // Reason, Units become, Send to, then the first line's product box.
    const [reasonBox, , , serialBox] = within(dialog).getAllByRole("combobox");
    fireEvent.change(serialBox!, { target: { value: unit.serial } });
    await userEvent.type(reasonBox!, "On Service");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Log 1 adjustment" }),
    );

    await vi.waitFor(() => {
      const u = getDb().units.find((x) => x.serial === unit.serial)!;
      expect(u.status).toBe("SERVIS");
      expect(u.locationId).toBe("wh-3");
    });
    const visit = getDb().services.find(
      (r) => r.serial === unit.serial && r.closedAt === undefined,
    )!;
    expect(visit.fromLocationId).toBe(unit.locationId);
  });
});
