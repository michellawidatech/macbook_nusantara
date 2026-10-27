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

  it("adds variants to the product that already exists, renaming it in full", async () => {
    mutate((d) => {
      d.models = d.models.filter((m) => m.id !== "m-short-name");
      d.models.unshift({
        id: "m-short-name",
        name: 'AIR 13" 2019',
        category: "MacBook Air",
        releaseYear: 2019,
        source: "MANUAL",
        axes: [
          { name: "RAM", values: [] },
          { name: "SSD", values: [] },
        ],
      });
    });
    renderPage();
    pressPageAction(/Add product/);
    const user = userEvent.setup();
    const dialog = (
      await screen.findByText("Create product and variants")
    ).closest(".ant-modal") as HTMLElement;
    await user.click(within(dialog).getByLabelText("Category"));
    await user.click((await screen.findAllByTitle("MacBook Air")).at(-1)!);
    await user.type(within(dialog).getByLabelText("Screen size"), "13");
    const year = within(dialog).getByLabelText("Release year");
    await user.clear(year);
    await user.type(year, "2019");
    await user.click(within(dialog).getByText("Intel (i3, i5, i7…)"));
    const procs = within(dialog).getByLabelText("Processor options");
    await user.click(procs);
    await user.click((await screen.findAllByTitle("i5")).at(-1)!);
    await vi.waitFor(() =>
      expect(within(dialog).getByTestId("add-product-codes").textContent).toBe(
        'AIR 13" 2019 I5 8/256, AIR 13" 2019 I5 8/512, AIR 13" 2019 I5 16/256, AIR 13" 2019 I5 16/512',
      ),
    );
    expect(
      within(dialog).getByText(
        'MacBook Air 13" 2019 already exists — the 4 missing variant(s) will be added to it.',
      ),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByText("Add 4 variant(s)").closest("button")!,
    );
    await vi.waitFor(() => {
      const m = getDb().models.find((x) => x.id === "m-short-name")!;
      expect(m.name).toBe('MacBook Air 13" 2019');
      expect(
        getDb()
          .skus.filter((s) => s.modelId === "m-short-name")
          .map((s) => s.code),
      ).toContain('AIR 13" 2019 I5 8/256');
    });
    expect(
      getDb().models.filter((m) => m.name.includes('13" 2019')),
    ).toHaveLength(1);
  });

  it("deletes a product nothing has traded under, and refuses one with stock", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: 'Delete MacBook Air 13" 2020',
      }),
    );
    await user.click(
      (await screen.findAllByText("Delete")).at(-1)!.closest("button")!,
    );
    await vi.waitFor(() =>
      expect(getDb().models.some((m) => m.id === MODEL)).toBe(false),
    );
    expect(getDb().skus.some((s) => s.modelId === MODEL)).toBe(false);

    const stocked = getDb().units[0]!;
    const stockedModel = getDb().models.find(
      (m) => m.id === getDb().skus.find((s) => s.id === stocked.skuId)!.modelId,
    )!;
    expect(
      (
        screen.queryAllByRole("button", {
          name: `Delete ${stockedModel.name}`,
        })[0] as HTMLButtonElement | undefined
      )?.disabled ?? true,
    ).toBe(true);
  });
});
