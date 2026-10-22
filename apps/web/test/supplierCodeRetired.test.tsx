/**
 * A supplier has no origin code any more (owner ask 2026-10-22: *"remove
 * settings that are not important. Like … supplier code"*). The serial stopped
 * carrying one on 2026-09-21 and nothing has read it since, so neither place
 * that adds or edits a supplier asks for it.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/routes/settings/SettingsPage.js";
import { SuppliersPage } from "../src/routes/suppliers/SuppliersPage.js";
import { getDb } from "../src/mock/store.js";
import { pressPageAction } from "./pageActions.js";

vi.setConfig({ testTimeout: 60_000 });

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AntdApp>
        <MemoryRouter>{node}</MemoryRouter>
      </AntdApp>
    </QueryClientProvider>,
  );
}

describe("a supplier without an origin code", () => {
  it("is added in Settings with no code box and no Code column", async () => {
    wrap(<SettingsPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Suppliers" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).queryByPlaceholderText("Code (AS)")).toBeNull();
    expect(
      within(panel).queryByRole("columnheader", { name: "Code" }),
    ).toBeNull();

    await userEvent.type(
      within(panel).getByPlaceholderText("Supplier name"),
      "Toko Baru Elektronik",
    );
    await userEvent.click(within(panel).getByRole("button", { name: "Add" }));
    const added = getDb().suppliers.find(
      (s) => s.name === "Toko Baru Elektronik",
    );
    expect(added).toBeDefined();
    expect(added!.code).toBeUndefined();
  });

  it("is added on Suppliers without being asked for one", async () => {
    wrap(<SuppliersPage />);
    pressPageAction("Add supplier");
    // The page action is named "Add supplier" too; the dialog's is in a modal.
    const dialog = await vi.waitFor(() => {
      const found = screen
        .getAllByRole("button", { name: "Add supplier" })
        .map((b) => b.closest<HTMLElement>(".ant-modal"))
        .find((m) => m !== null);
      if (!found) throw new Error("the add dialog is not open");
      return found;
    });
    expect(within(dialog).queryByText("Origin code")).toBeNull();
    await userEvent.type(
      within(dialog).getByLabelText("Name"),
      "Gudang Apel Baru",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add supplier" }),
    );
    await vi.waitFor(() =>
      expect(
        getDb().suppliers.find((s) => s.name === "Gudang Apel Baru"),
      ).toBeDefined(),
    );
  });
});
