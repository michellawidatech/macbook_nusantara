/**
 * Inventory's toolbar and line buttons, pared back (owner list 2026-11-03):
 * no Import sell prices, no battery-band help, and a line's Print barcode and
 * Listing links behind one ⋯ beside Set price.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";

vi.setConfig({ testTimeout: 90_000 });

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

describe("Inventory toolbar", () => {
  it("has no price import or battery help, and folds a line's extras into ⋯", async () => {
    useDesktopViewport();
    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/stock/inventory"]}>
          <InventoryPage />
        </MemoryRouter>
      </AntdApp>,
    );
    await screen.findByText("Export stock");
    expect(screen.queryByText("Import sell prices")).toBeNull();
    expect(screen.queryByLabelText("What the battery bands mean")).toBeNull();
    expect(screen.queryByText("Print barcode")).toBeNull();

    const more = (await screen.findAllByLabelText(/^More actions for /))[0]!;
    fireEvent.click(more);
    expect(await screen.findByText("Print barcode")).toBeTruthy();
    expect(screen.getByText("Listing links")).toBeTruthy();
  });
});
