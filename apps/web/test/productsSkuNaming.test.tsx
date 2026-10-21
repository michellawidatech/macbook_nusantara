/**
 * SKU codes in the shop's naming (owner ask 2026-10-21): the Add product hint
 * shows the codes it will create from what is PICKED, and *Rename SKU codes*
 * turns every machine-made `SKU_…` code into the shop's naming.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsPage } from "../src/routes/products/ProductsPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { pressPageAction } from "./pageActions";

vi.setConfig({ testTimeout: 90_000 });

const MODEL = "m-sku-naming-test";

function renderPage() {
  render(
    <AntdApp>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

describe("SKU codes follow the shop's naming", () => {
  beforeEach(() => {
    mutate((d) => {
      d.models = d.models.filter((m) => m.id !== MODEL);
      d.skus = d.skus.filter(
        (s) => s.modelId !== MODEL && !s.code.startsWith("SKU_"),
      );
      d.models.unshift({
        id: MODEL,
        name: 'MacBook Air 13" 2020',
        category: "MacBook Air",
        releaseYear: 2020,
        source: "MANUAL",
        axes: [
          { name: "Chip", values: ["i3", "i7"] },
          { name: "RAM", values: ["8GB"] },
          { name: "SSD", values: ["128GB"] },
        ],
      });
      d.skus.push(
        {
          id: "sku-naming-a",
          modelId: MODEL,
          code: "SKU_18FQN1UTLADWLAI8",
          name: 'MacBook Air 13" 2020',
          variantLabel: "i7 / 8GB / 128GB",
          price: 0,
        },
        {
          id: "sku-naming-b",
          modelId: MODEL,
          code: "SKU_BKX7QIXSTV4VRUYJ",
          name: 'MacBook Air 13" 2020',
          variantLabel: "i3 / 8GB / 128GB",
          price: 0,
        },
      );
    });
  });

  it("renames every SKU_ code from its variant", async () => {
    renderPage();
    pressPageAction(/Rename SKU codes \(2\)/);
    const user = userEvent.setup();
    await user.click((await screen.findByText("Rename")).closest("button")!);
    await vi.waitFor(() => {
      const codes = getDb()
        .skus.filter((s) => s.modelId === MODEL)
        .map((s) => s.code)
        .sort();
      expect(codes).toEqual(['AIR 13" 2020 I3 8/128', 'AIR 13" 2020 I7 8/128']);
    });
  });

  it("previews and creates the codes for what is picked", async () => {
    renderPage();
    pressPageAction(/Add product/);
    const user = userEvent.setup();
    const dialog = (
      await screen.findByText("Create product and variants")
    ).closest(".ant-modal") as HTMLElement;
    await user.type(
      within(dialog).getByLabelText("Model name"),
      'AIR 13" 2020 i7 16/256',
    );
    const pick = async (label: string, value: string) => {
      const box = within(dialog).getByLabelText(label);
      await user.click(box);
      await user.type(box, `${value}{enter}`);
    };
    await user.type(within(dialog).getByLabelText("Release year"), "2020");
    await user.click(within(dialog).getByLabelText("Category"));
    await user.click((await screen.findAllByTitle("MacBook Air")).at(-1)!);
    await pick("RAM options", "16GB");
    await pick("SSD options", "256GB");
    // The form starts with 8GB and 256GB/512GB picked; 16GB joins them.
    const hint = await within(dialog).findByText(/^SKU codes will read:/);
    await vi.waitFor(() =>
      expect(hint.textContent).toBe(
        'SKU codes will read: AIR 13" 2020 I7 8/256, AIR 13" 2020 I7 8/512, ' +
          'AIR 13" 2020 I7 16/256, AIR 13" 2020 I7 16/512',
      ),
    );
    await user.click(
      within(dialog)
        .getByText("Create product and variants")
        .closest("button")!,
    );
    await vi.waitFor(() => {
      const model = getDb().models.find(
        (m) => m.name === 'AIR 13" 2020 i7 16/256',
      )!;
      expect(
        getDb()
          .skus.filter((s) => s.modelId === model.id)
          .map((s) => s.code),
      ).toContain('AIR 13" 2020 I7 16/256');
    });
  });
});
