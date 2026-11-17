/**
 * Export stock → Make a story image (owner ask 2026-11-17): the rows on sale
 * with their prices, a before price and NEW kept per variant on this device,
 * every word editable. The canvas itself is drawn by a real browser — jsdom
 * has none — so this pins the dialog, and the drawing is pinned by
 * `priceStoryLayout.test.ts`.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StockExportModal } from "../src/routes/stock/StockExportModal.js";
import { draftKey } from "../src/hooks/usePersistentState.js";
import { storyStock } from "../src/lib/priceStory.js";
import { EVERYTHING } from "../src/lib/stockExport.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

function renderExport() {
  return render(
    <AntdApp>
      <StockExportModal open onClose={() => {}} />
    </AntdApp>,
  );
}

async function openStory() {
  renderExport();
  await userEvent.click(
    screen.getByRole("button", { name: /Make a story image/ }),
  );
  const title = await screen.findByText("Story image", {
    selector: ".ant-modal-title",
  });
  return within(title.closest(".ant-modal") as HTMLElement);
}

describe("the story image dialog", () => {
  it("lists every variant on sale and keeps a before price and NEW per variant", async () => {
    localStorage.clear();
    const { products } = storyStock(getDb(), EVERYTHING);
    const first = products[0]!;
    const row = first.rows[0]!;
    const d = await openStory();
    for (const p of products.slice(0, 3))
      expect(d.getAllByText(p.name).length).toBeGreaterThan(0);

    const name = `${first.name} ${row.spec}`;
    const before = d.getByLabelText(`Before price of ${name}`);
    await userEvent.type(before, String(row.lo + 1_000_000));
    await userEvent.click(d.getByLabelText(`NEW tag on ${name}`));
    await userEvent.click(d.getByLabelText(`Show ${name}`));

    const kept = JSON.parse(
      localStorage.getItem(draftKey("priceStory.rows")) ?? "{}",
    ) as Record<string, { before?: number; isNew?: boolean; hidden?: boolean }>;
    expect(kept[row.skuId]).toEqual({
      before: row.lo + 1_000_000,
      isNew: !row.allNew,
      hidden: true,
    });
  });

  it("lets every word be changed and put back", async () => {
    localStorage.clear();
    const d = await openStory();
    await userEvent.click(d.getByRole("tab", { name: "Text" }));
    const location = d.getByLabelText("Location");
    expect(location).toHaveValue("Serpong");
    await userEvent.clear(location);
    await userEvent.type(location, "BSD City");
    const headline = d.getByLabelText("Headline, first line");
    await userEvent.clear(headline);
    await userEvent.type(headline, "Harga");
    expect(
      JSON.parse(localStorage.getItem(draftKey("priceStory.texts")) ?? "{}"),
    ).toMatchObject({ location: "BSD City", titleTop: "Harga" });

    await userEvent.click(d.getByRole("button", { name: /Reset all text/ }));
    expect(d.getByLabelText("Location")).toHaveValue("Serpong");
    expect(d.getByLabelText("Headline, first line")).toHaveValue("Best");
  });
});
