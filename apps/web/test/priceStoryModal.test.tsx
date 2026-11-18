/**
 * Export stock → Make a story image (owner ask 2026-11-17): the rows on sale
 * with their prices, a before price and NEW kept per variant on this device,
 * every word editable. The canvas itself is drawn by a real browser — jsdom
 * has none — so this pins the dialog, and the drawing is pinned by
 * `priceStoryLayout.test.ts`.
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StockExportModal } from "../src/routes/stock/StockExportModal.js";
import { draftKey } from "../src/hooks/usePersistentState.js";
import { storyStock } from "../src/lib/priceStory.js";
import { EVERYTHING } from "../src/lib/stockExport.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

/** A desktop screen: `test/setup.ts` answers every media query "no" (a phone). */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1200,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

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
    useDesktopViewport();
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
    useDesktopViewport();
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

describe("searching and reordering the rows (owner 2026-11-18)", () => {
  it("narrows the table to the search, and the arrows move a row and save the order", async () => {
    useDesktopViewport();
    localStorage.clear();
    const { products } = storyStock(getDb(), EVERYTHING);
    const rows = products.flatMap((p) =>
      p.rows.map((r) => ({ ...r, name: `${p.name} ${r.spec}` })),
    );
    const [a, b] = rows;
    const d = await openStory();
    expect(d.getByLabelText(`Show ${a!.name}`)).toBeInTheDocument();

    // Moving the first row down puts it after the second.
    await userEvent.click(d.getByLabelText(`Move ${a!.name} down`));
    const order = JSON.parse(
      localStorage.getItem(draftKey("priceStory.order")) ?? "[]",
    ) as string[];
    expect(order.slice(0, 2)).toEqual([b!.skuId, a!.skuId]);
    expect(d.getByLabelText(`Move ${b!.name} up`)).toBeDisabled();

    // A search that only the last product matches leaves only its rows.
    const last = products[products.length - 1]!;
    await userEvent.type(d.getByLabelText("Search a unit"), last.name);
    for (const r of last.rows)
      expect(
        d.getByLabelText(`Show ${last.name} ${r.spec}`),
      ).toBeInTheDocument();
    if (!a!.name.includes(last.name))
      expect(d.queryByLabelText(`Show ${a!.name}`)).toBeNull();

    await userEvent.clear(d.getByLabelText("Search a unit"));
    await userEvent.click(d.getByRole("button", { name: /Reset the order/ }));
    expect(
      JSON.parse(localStorage.getItem(draftKey("priceStory.order")) ?? "[]"),
    ).toEqual([]);
  });
});

describe("the story's saved default (owner 2026-11-18)", () => {
  it("saves the words for every device, and a fresh device starts from them", async () => {
    useDesktopViewport();
    localStorage.clear();
    let d = await openStory();
    await userEvent.click(d.getByRole("tab", { name: "Text" }));
    const location = d.getByLabelText("Location");
    await userEvent.clear(location);
    await userEvent.type(location, "BSD City");
    await userEvent.click(d.getByRole("button", { name: /Save as default/ }));

    expect(getDb().settings.storyLocation).toBe("BSD City");
    // Words nobody changed are not frozen into the default.
    expect(getDb().settings.storyPromo).toBeUndefined();
    // This device's own edits were folded into the default.
    expect(
      JSON.parse(localStorage.getItem(draftKey("priceStory.texts")) ?? "{}"),
    ).toEqual({});

    // Another device: nothing kept locally, the shop default shows.
    cleanup();
    localStorage.clear();
    d = await openStory();
    await userEvent.click(d.getByRole("tab", { name: "Text" }));
    expect(d.getByLabelText("Location")).toHaveValue("BSD City");

    await userEvent.click(
      d.getByRole("button", { name: /Use the original words/ }),
    );
    expect(getDb().settings.storyLocation).toBeUndefined();
    expect(d.getByLabelText("Location")).toHaveValue("Serpong");
  });
});

describe("the story image dialog on a phone", () => {
  it("edits the words from its Text tab", async () => {
    localStorage.clear();
    const d = await openStory();
    await userEvent.click(d.getByText("Text"));
    const location = d.getByLabelText("Location");
    await userEvent.clear(location);
    await userEvent.type(location, "BSD");
    expect(
      JSON.parse(localStorage.getItem(draftKey("priceStory.texts")) ?? "{}"),
    ).toMatchObject({ location: "BSD" });
  });

  it("shows the page's rows as cards: one tap takes a row off, and it can be put back", async () => {
    // test/setup.ts answers "no" to every media query, so this IS the phone layout.
    localStorage.clear();
    const d = await openStory();
    expect(d.getByText(/^Page 1 of \d+$/)).toBeInTheDocument();
    const { products } = storyStock(getDb(), EVERYTHING);
    const first = products[0]!;
    const row = first.rows[0]!;
    const name = `${first.name} ${row.spec}`;
    await userEvent.click(d.getByRole("button", { name: `Remove ${name}` }));
    expect(d.queryByRole("button", { name: `Remove ${name}` })).toBeNull();
    const kept = JSON.parse(
      localStorage.getItem(draftKey("priceStory.rows")) ?? "{}",
    ) as Record<string, { hidden?: boolean }>;
    expect(kept[row.skuId]?.hidden).toBe(true);

    await userEvent.click(d.getByText("Removed (1)"));
    await userEvent.click(d.getByRole("button", { name: "Put back" }));
    expect(
      d.getByRole("button", { name: `Remove ${name}` }),
    ).toBeInTheDocument();
  });

  it("moves between pages with the arrows", async () => {
    localStorage.clear();
    const d = await openStory();
    const total = Number(
      /of (\d+)/.exec(d.getByText(/^Page 1 of/).textContent ?? "")![1],
    );
    expect(d.getByRole("button", { name: "Previous page" })).toBeDisabled();
    if (total > 1) {
      await userEvent.click(d.getByRole("button", { name: "Next page" }));
      expect(d.getByText(`Page 2 of ${total}`)).toBeInTheDocument();
    }
  });
});
