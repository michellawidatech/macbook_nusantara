/** Owner report 2026-11-04: "when they want to add multiple unit to service we cannot". */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceBatchModal } from "../src/components/ServiceBatchModal.js";
import { SendToServiceModal } from "../src/components/SendToServiceModal.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

const shelf = () =>
  getDb()
    .units.filter((u) => u.status === "TERSEDIA")
    .slice(0, 2);
const addBox = () => screen.getByLabelText("Add a unit");

describe("sending several units to service", () => {
  it("takes two serials typed into the batch dialog and sends both", async () => {
    const [a, b] = shelf() as [
      ReturnType<typeof shelf>[number],
      ReturnType<typeof shelf>[number],
    ];
    render(
      <AntdApp>
        <ServiceBatchModal mode="SEND" serials={[]} onClose={() => undefined} />
      </AntdApp>,
    );
    fireEvent.change(addBox(), { target: { value: a.serial } });
    fireEvent.change(addBox(), { target: { value: b.serial } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(a.serial).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(b.serial).length).toBeGreaterThan(0);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to service" }),
    );
    await vi.waitFor(() => {
      for (const u of [a, b])
        expect(getDb().units.find((x) => x.serial === u.serial)!.status).toBe(
          "SERVIS",
        );
    });
  });

  it("lets more units join when opened from one unit's Send to service", async () => {
    const [a, b] = shelf() as [
      ReturnType<typeof shelf>[number],
      ReturnType<typeof shelf>[number],
    ];
    render(
      <AntdApp>
        <SendToServiceModal
          serial={a.serial}
          raisedBy="ADJUSTMENT"
          onClose={() => undefined}
        />
      </AntdApp>,
    );
    fireEvent.change(addBox(), { target: { value: b.serial } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(b.serial).length).toBeGreaterThan(0);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send to service" }),
    );
    await vi.waitFor(() => {
      for (const u of [a, b])
        expect(getDb().units.find((x) => x.serial === u.serial)!.status).toBe(
          "SERVIS",
        );
    });
  });
});

describe("Stock Movement History", () => {
  it("lists a unit sent to service, not only stock adjustments", async () => {
    const { InventoryPage } =
      await import("../src/routes/stock/InventoryPage.js");
    const { MemoryRouter } = await import("react-router-dom");
    const sent = getDb().units.find((u) => u.status === "SERVIS")!;
    expect(sent).toBeDefined();
    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/stock/inventory"]}>
          <InventoryPage />
        </MemoryRouter>
      </AntdApp>,
    );
    fireEvent.click(
      await screen.findByRole("tab", { name: /Stock Movement History/ }),
    );
    expect(
      (await screen.findAllByText("Sent to service")).length,
    ).toBeGreaterThan(0);
  });
});
