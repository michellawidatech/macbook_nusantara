/**
 * Inventory & Stock Movement, driven the way staff use it (owner ask
 * 2026-09-19): one flat line per variant, grade and warehouse; a click opens
 * the units behind a line; Set price reprices a line; Export stock hands over
 * a spreadsheet.
 *
 * ⚠️ No `getByRole` over the page. A role query asks jsdom for the computed
 * style of every element and every ancestor to decide what is hidden, and
 * with antd's stylesheet in the document that is minutes of CPU for a table
 * of twenty lines — the first cut of this file spent eleven of them on one
 * query. Everything here is found by its text, its label or its aria-label,
 * inside the smallest container that holds it.
 */
import { averageCost, stockLevels } from "../src/lib/stock.js";
import { App as AntdApp } from "antd";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { inventoryLines, type InventoryLine } from "../src/lib/inventory.js";
import { costIndex } from "../src/lib/service.js";
import { fmtRp } from "../src/lib/format.js";
import { variantMarketPrice } from "../src/lib/unitPrice.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";

vi.setConfig({ testTimeout: 90_000 });

/**
 * The desktop layout — `test/setup.ts` answers "no" to every media query,
 * which puts a test on the phone's cards unless it says otherwise.
 */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1600,
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

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/stock/inventory"]}>
        <InventoryPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

/** The lines the page should be listing, from the store as it stands. */
function expectedLines(): InventoryLine[] {
  const db = getDb();
  const cost = costIndex(db);
  return inventoryLines(db.units, db, {
    costOf: (u) => cost(u).total,
    counted: {
      levels: stockLevels(db.stockMoves),
      averageCost: (skuId) => averageCost(db, skuId),
    },
  });
}

/** The table's body rows — the product table, not a dialog's. */
function tableRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".ant-table-tbody > tr.ant-table-row",
    ),
  ).filter((tr) => tr.closest(".ant-modal") === null);
}

/** The row showing a line: its product, variant and code, grade and warehouse. */
function rowOf(line: InventoryLine): HTMLElement {
  const db = getDb();
  const wh = db.warehouses.find((w) => w.id === line.locationId)!.name;
  // The grade is the row's one tag; an ungraded line has none.
  const grade =
    line.grade === undefined ? [] : [line.grade === "NEW" ? "New" : line.grade];
  const row = tableRows().find((tr) => {
    const text = tr.textContent ?? "";
    const tags = Array.from(tr.querySelectorAll(".ant-tag")).map(
      (e) => e.textContent,
    );
    return (
      text.includes(`${line.product} ${line.specs}`) &&
      text.includes(line.code) &&
      text.includes(wh) &&
      JSON.stringify(tags) === JSON.stringify(grade)
    );
  });
  expect(row, line.key).toBeDefined();
  return row!;
}

/**
 * The row for a line, wherever the pager put it: the table is narrowed to the
 * line's variant through the search box first — the way staff reach a line —
 * so a line past the first page is still on screen.
 */
async function rowFor(line: InventoryLine): Promise<HTMLElement> {
  fireEvent.change(
    screen.getByPlaceholderText(
      "Search product, specs, code or a serial number",
    ),
    { target: { value: line.code } },
  );
  await settle();
  return rowOf(line);
}

/** The modal on top: the last one open. */
async function topModal(): Promise<HTMLElement> {
  return waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-modal-wrap"),
    ).filter((w) => w.style.display !== "none");
    expect(open.length).toBeGreaterThan(0);
    return open.at(-1)!.querySelector<HTMLElement>(".ant-modal")!;
  });
}

/**
 * A table's column headings. Read off the `<th>`s: rc-table repeats every
 * title in a zero-height measuring row when the table scrolls sideways, so a
 * text query finds each one twice.
 */
function headings(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("th")).map(
    (th) => th.textContent ?? "",
  );
}

/** A button by its aria-label, inside a container. */
function labelled(container: HTMLElement, label: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    `button[aria-label="${label}"]`,
  );
  expect(el, label).not.toBeNull();
  return el!;
}

/** A button by its visible words, inside a container. */
function worded(container: HTMLElement, words: string): HTMLElement {
  const el = within(container).getByText(words).closest("button");
  expect(el, words).not.toBeNull();
  return el!;
}

beforeEach(() => {
  useDesktopViewport();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the flat table", () => {
  it("lists a variant once per grade and warehouse it is held at", async () => {
    renderPage();
    await settle();
    // A variant the demo shelf holds at more than one grade: the case the
    // nesting used to hide two levels down.
    const perSku = new Map<string, InventoryLine[]>();
    for (const l of expectedLines()) {
      perSku.set(l.skuId, [...(perSku.get(l.skuId) ?? []), l]);
    }
    const split = [...perSku.values()].find((ls) => ls.length > 1);
    expect(split, "the seed should hold a variant on two lines").toBeDefined();
    await rowFor(split![0]!);
    // Narrowed to the variant: exactly its lines, each with its own count.
    expect(tableRows()).toHaveLength(split!.length);
    for (const line of split!) {
      expect(rowOf(line).textContent).toContain(String(line.onHand));
    }
  });

  it("shows the variant's marketplace price — its dearest unit's — on the line", async () => {
    renderPage();
    await settle();
    const db = getDb();
    const line = expectedLines().find((l) => l.store.count > 0)!;
    const sku = db.skus.find((s) => s.id === line.skuId)!;
    const market = variantMarketPrice(
      db.units,
      sku.id,
      sku.price,
      db.settings.marketplaceMarkupPct ?? 10,
    )!;
    expect((await rowFor(line)).textContent).toContain(
      `marketplace ${fmtRp(market)}`,
    );
  });
});

describe("the units behind a line", () => {
  it("opens on a click with every unit of the line, and its cost taken apart", async () => {
    renderPage();
    await settle();
    const cost = costIndex(getDb());
    const line = expectedLines().find(
      (l) => l.tracksSerial && l.units.some((u) => u.poId !== null),
    )!;
    await userEvent.click(within(await rowFor(line)).getByText(line.code));
    const dialog = await topModal();
    for (const u of line.units) {
      expect(within(dialog).getByText(u.serial)).toBeInTheDocument();
    }
    expect(headings(dialog)).toContain("Battery");

    // The "i" breaks the unit's COGS down: invoice line, expenses share,
    // repairs — and the total is `costIndex`'s, share included.
    const unit = line.units.find((u) => u.poId !== null)!;
    await userEvent.click(
      labelled(dialog, `How the cost of ${unit.serial} adds up`),
    );
    const parts = cost(unit);
    const title = await screen.findByText(`What ${unit.serial} cost`);
    const card = title.closest(".ant-popover") as HTMLElement;
    expect(
      within(card).getByText("Shipping, tax & fees share"),
    ).toBeInTheDocument();
    expect(within(card).getByText(fmtRp(parts.total))).toBeInTheDocument();
    expect(parts.total).toBe(parts.buy + parts.shippingTax + parts.repair);
  });

  it("shows a counted product's stock moves, not units", async () => {
    // Accessories are quantities on the stock ledger (2026-09-19): the popup
    // lists what moved the shelf, and asks nothing about a battery.
    renderPage();
    await settle();
    const db = getDb();
    const line = expectedLines().find((l) => !skuTracksSerial(db, l.skuId));
    expect(line, "the seed should hold an accessory").toBeDefined();
    await userEvent.click(within(await rowFor(line!)).getByText(line!.code));
    const dialog = await topModal();
    expect(headings(dialog)).not.toContain("Battery");
    expect(headings(dialog)).toContain("Qty");
    expect(
      within(dialog).getAllByText("Arrived on an invoice").length,
    ).toBeGreaterThan(0);
  });

  it("opens Edit unit above the popup", async () => {
    // The per-unit action is Edit unit since 2026-09-23 (owner ask), and it
    // opens the dialog that corrects the serial, grade, battery, shelf,
    // description and unit price — not the old warehouse-and-note form.
    renderPage();
    await settle();
    const line = expectedLines().find((l) => l.tracksSerial)!;
    const unit = line.units[0]!;
    await userEvent.click(within(await rowFor(line)).getByText(line.code));
    const popup = await topModal();
    await userEvent.click(labelled(popup, `Edit ${unit.serial}`));
    const title = await screen.findByText("Edit unit", {
      selector: ".ant-modal-title, .ant-modal-title *",
    });
    const wrap = title.closest(".ant-modal-wrap") as HTMLElement;
    const under = popup.closest(".ant-modal-wrap") as HTMLElement;
    expect(Number(wrap.style.zIndex)).toBeGreaterThan(
      Number(under.style.zIndex || 1000),
    );
  });
});

describe("Set price", () => {
  it("reprices only the line's units, and hands a hand-typed marketplace price back to the rule", async () => {
    const line = expectedLines().find((l) => l.available > 0)!;
    const unit = line.units.find((u) => u.status === "TERSEDIA")!;
    // A marketplace price typed per unit before 2026-09-19.
    await act(async () => {
      await mutate((d) => {
        d.units.find((u) => u.serial === unit.serial)!.marketPrice = 99_000_000;
      });
    });
    renderPage();
    await settle();
    const row = await rowFor(line);
    await userEvent.click(worded(row, "Set price"));
    const grid = await topModal();
    // Only this line's serials — one grade in one warehouse.
    expect(
      grid.querySelectorAll(".ant-table-tbody > tr.ant-table-row"),
    ).toHaveLength(line.units.length);
    for (const u of line.units) {
      expect(within(grid).getByText(u.serial)).toBeInTheDocument();
    }
    // No per-unit marketplace box any more.
    expect(grid.querySelector('[aria-label^="Marketplace price for"]')).toBe(
      null,
    );
    // The legacy override is still the listing until the unit is repriced.
    expect(
      within(grid).getByText("Marketplace price: Rp 99.000.000"),
    ).toBeInTheDocument();

    const box = grid.querySelector<HTMLInputElement>(
      `input[aria-label="Store price for ${unit.serial}"]`,
    )!;
    expect(box).not.toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "7000000");
    expect(
      within(grid).getByText(/^Marketplace price after saving:/),
    ).toBeInTheDocument();
    await userEvent.click(worded(grid, "Save prices"));
    await settle();

    const after = getDb().units.find((u) => u.serial === unit.serial)!;
    expect(after.price).toBe(7_000_000);
    expect(after.marketPrice).toBeUndefined();
    const last = getDb()
      .events.filter((e) => e.serial === unit.serial)
      .at(-1)!;
    expect(last.type).toBe("DICATAT");
    expect(last.note).toContain(`→ ${fmtRp(7_000_000)}`);
    expect(last.note).toContain("set by hand dropped");
  });
});

describe("Export stock", () => {
  it("offers the owner's three columns by default and downloads an .xlsx", async () => {
    const created: Blob[] = [];
    const clicked: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (b: Blob) => {
        created.push(b);
        return "blob:stock";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    renderPage();
    await settle();
    await userEvent.click(worded(document.body, "Export stock"));
    const dialog = await topModal();
    const boxes = Array.from(
      dialog.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    );
    const label = (b: HTMLInputElement) => b.closest("label")!.textContent;
    // The file format is a checkbox group too since 2026-09-21 ("PDF or excel
    // file or both"), and Excel is what the export was until then.
    expect(boxes.filter((b) => b.checked).map(label)).toEqual([
      "Excel (.xlsx)",
      "Unit (product & variant)",
      "Qty",
      "Warehouse",
    ]);
    // Unit is what a row IS, so it cannot be switched off.
    expect(
      boxes.find((b) => label(b) === "Unit (product & variant)"),
    ).toBeDisabled();

    const held = getDb().units.filter((u) =>
      ["QC", "TERSEDIA", "DIRESERVASI", "SERVIS"].includes(u.status),
    ).length;
    expect(
      within(dialog).getByText(
        new RegExp(`^${held} units on [0-9]+ rows will be exported`),
      ),
    ).toBeInTheDocument();

    await userEvent.click(worded(dialog, "Download .xlsx"));
    expect(created).toHaveLength(1);
    expect(created[0]!.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(created[0]!.size).toBeGreaterThan(1000);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^Persediaan-Barang-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    // Back to what `test/setup.ts` installs: every media query says no.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    });
  });

  it("draws a card per line, and a tap on one opens the same units", async () => {
    renderPage();
    await settle();
    const line = expectedLines().find((l) => l.tracksSerial)!;
    fireEvent.change(
      screen.getByPlaceholderText(
        "Search product, specs, code or a serial number",
      ),
      { target: { value: line.code } },
    );
    await settle();
    // Nothing expands any more, so the list is cards, not a sideways grid.
    expect(tableRows()).toHaveLength(0);
    const card = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-card"),
    ).find((c) => (c.textContent ?? "").includes(line.code))!;
    expect(card).toBeDefined();
    await userEvent.click(within(card).getByText(line.code));
    const dialog = await topModal();
    for (const u of line.units) {
      expect(within(dialog).getByText(u.serial)).toBeInTheDocument();
    }
  });
});
