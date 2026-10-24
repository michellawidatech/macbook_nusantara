/**
 * Correcting a variant's SKU from Master Product (owner ask 2026-10-02:
 * *"make a way that they can edit the SKU"*). A model imported from AppleDB
 * arrives with machine-made codes nobody can look up, and until now the code
 * could only be set once, when the variant was created.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsPage } from "../src/routes/products/ProductsPage.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

const MODEL = "m-sku-edit-test";

function seedModel() {
  mutate((d) => {
    d.models = d.models.filter((m) => m.id !== MODEL);
    d.skus = d.skus.filter((s) => s.modelId !== MODEL);
    d.models.unshift({
      id: MODEL,
      name: 'ZZTEST 13" 2026 A18 PRO',
      category: "MacBook",
      releaseYear: 2026,
      source: "APPLEDB",
      identifier: "ZZTest1,1",
      axes: [
        { name: "RAM", values: ["8GB"] },
        { name: "SSD", values: ["256GB", "512GB"] },
      ],
    });
    d.skus.push(
      {
        id: "sku-edit-a",
        modelId: MODEL,
        code: "SKU_HIBGR8C90134KEFC",
        name: 'ZZTEST 13" 2026 A18 PRO',
        variantLabel: "8GB / 256GB",
        price: 0,
      },
      {
        id: "sku-edit-b",
        modelId: MODEL,
        code: "SKU_UIXQJI86UE32V8YC",
        name: 'ZZTEST 13" 2026 A18 PRO',
        variantLabel: "8GB / 512GB",
        price: 0,
      },
    );
  });
}

const sku = (id: string) => getDb().skus.find((s) => s.id === id)!;

async function openEdit(code: string) {
  const user = userEvent.setup();
  render(
    <AntdApp>
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    </AntdApp>,
  );
  // Role queries walk the whole catalogue table and are far too slow here;
  // the model is seeded first in the list, so its row is on page one.
  const row = (await screen.findByText('ZZTEST 13" 2026 A18 PRO')).closest(
    "tr",
  )!;
  await user.click(row.querySelector(".ant-table-row-expand-icon")!);
  await user.click(await screen.findByLabelText(`Edit ${code}`));
  const title = await screen.findByText("Edit SKU");
  const dialog = title.closest(".ant-modal") as HTMLElement;
  return { user, dialog };
}

describe("editing a SKU", () => {
  beforeEach(seedModel);

  it("saves a new code, upper-cased, and a price", async () => {
    const { user, dialog } = await openEdit("SKU_HIBGR8C90134KEFC");
    const code = within(dialog).getByLabelText("SKU code");
    await user.clear(code);
    await user.type(code, 'neo 13" a18 pro 8/256');
    await user.type(within(dialog).getByLabelText("List price"), "9500000");
    await user.click(within(dialog).getByText("Save").closest("button")!);
    await vi.waitFor(() =>
      expect(sku("sku-edit-a").code).toBe('NEO 13" A18 PRO 8/256'),
    );
    expect(sku("sku-edit-a").price).toBe(9_500_000);
  });

  it("refuses a code another variant already uses", async () => {
    const { user, dialog } = await openEdit("SKU_HIBGR8C90134KEFC");
    const code = within(dialog).getByLabelText("SKU code");
    await user.clear(code);
    await user.type(code, "SKU_UIXQJI86UE32V8YC");
    await user.click(within(dialog).getByText("Save").closest("button")!);
    expect(
      await within(dialog).findByText("Another variant already uses this code"),
    ).toBeTruthy();
    expect(sku("sku-edit-a").code).toBe("SKU_HIBGR8C90134KEFC");
  });

  it("offers the shop's naming convention", async () => {
    const { user, dialog } = await openEdit("SKU_HIBGR8C90134KEFC");
    await user.click(
      within(dialog).getByText("Use the shop's naming").closest("button")!,
    );
    const value = (
      within(dialog).getByLabelText("SKU code") as HTMLInputElement
    ).value;
    expect(value).not.toBe("SKU_HIBGR8C90134KEFC");
    expect(value).toContain("8/256");
  });
});
