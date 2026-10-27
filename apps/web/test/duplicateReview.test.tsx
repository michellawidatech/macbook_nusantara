/**
 * Review duplicates on Master Product (owner ask 2026-10-21) — the owner's
 * own case: one MacBook Air 13" 2020 as three products, an inbound unit on
 * the processor-named one.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProductsPage } from "../src/routes/products/ProductsPage.js";
import { getDb, mutate } from "../src/mock/store.js";

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

describe("Review duplicates", () => {
  it("merges the three into the one named in full, the unit with it", async () => {
    useDesktopViewport();
    const serial = getDb().units.find((u) => u.status === "TERSEDIA")!.serial;
    mutate((d) => {
      d.models.unshift(
        {
          id: "zz-full",
          name: 'MacBook Air 13" 2027',
          category: "MacBook Air",
          releaseYear: 2027,
          source: "MANUAL",
          axes: [
            { name: "Chip", values: ["i5"] },
            { name: "RAM", values: ["8GB"] },
            { name: "SSD", values: ["512GB"] },
          ],
        },
        {
          id: "zz-short",
          name: 'AIR 13" 2027',
          category: "MacBook Air",
          releaseYear: 2027,
          source: "MANUAL",
          axes: [],
        },
        {
          id: "zz-i5",
          name: 'AIR 13" 2027 I5',
          category: "MacBook Air",
          releaseYear: 2027,
          source: "MANUAL",
          axes: [
            { name: "RAM", values: ["8GB"] },
            { name: "SSD", values: ["512GB"] },
          ],
        },
      );
      d.skus.push(
        {
          id: "zz-full-v",
          modelId: "zz-full",
          code: 'AIR 13" 2027 I5 8/512',
          name: 'MacBook Air 13" 2027',
          variantLabel: "i5 / 8GB / 512GB",
          price: 0,
        },
        {
          id: "zz-i5-v",
          modelId: "zz-i5",
          code: "SKU_ZZI5",
          name: 'AIR 13" 2027 I5',
          variantLabel: "8GB · 512GB",
          price: 0,
        },
      );
      d.units.find((u) => u.serial === serial)!.skuId = "zz-i5-v";
    });

    render(
      <AntdApp>
        <MemoryRouter>
          <ProductsPage />
        </MemoryRouter>
      </AntdApp>,
    );
    fireEvent.click(
      (await screen.findByText(/^Review duplicates \(\d+\)$/)).closest(
        "button",
      )!,
    );
    const modal = (
      await screen.findByText("Review duplicate products")
    ).closest(".ant-modal") as HTMLElement;
    const card = within(modal)
      .getAllByText('MacBook Air 13" 2027')[0]!
      .closest(".ant-card") as HTMLElement;
    expect(
      within(card).getByText(/Joins AIR 13" 2027 I5 8\/512 · 1 unit/),
    ).toBeTruthy();
    fireEvent.click(
      within(card)
        .getByText('Merge into MacBook Air 13" 2027')
        .closest("button")!,
    );
    fireEvent.click((await screen.findByText("Merge")).closest("button")!);

    await vi.waitFor(() =>
      expect(getDb().models.some((m) => m.id === "zz-i5")).toBe(false),
    );
    expect(getDb().models.some((m) => m.id === "zz-short")).toBe(false);
    expect(getDb().units.find((u) => u.serial === serial)!.skuId).toBe(
      "zz-full-v",
    );
    // It held a unit, so it is kept — marked merged, under the kept product.
    expect(getDb().skus.find((s) => s.id === "zz-i5-v")).toMatchObject({
      mergedIntoId: "zz-full-v",
      modelId: "zz-full",
    });
    expect(
      getDb()
        .events.filter((e) => e.serial === serial)
        .at(-1)!.note,
    ).toMatch(/Product merged: SKU_ZZI5 → AIR 13" 2027 I5 8\/512/);
  });
});
