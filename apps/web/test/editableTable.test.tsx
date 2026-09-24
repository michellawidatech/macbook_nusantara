/**
 * The line-item editor surface, driven the way a keyboard drives it.
 *
 * Three owner complaints on 2026-09-01 are what this file guards, and all three
 * are invisible to a unit test of anything smaller: *Add product* had to move
 * under the rows and answer ⌘⏎; every cell had to be fillable without a mouse,
 * which mostly means landing IN the row the shortcut just created; and no
 * column was allowed to be squeezed by its neighbour — Qty came out narrower
 * than its own stepper arrows when a product label wanted 700px.
 *
 * The width assertions read the `<colgroup>` and the table's own inline width
 * rather than measuring anything: jsdom lays nothing out, so every box is 0×0.
 * What is actually being pinned is the instruction handed to the browser, which
 * is the part this code is responsible for.
 */
import { useState } from "react";
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditableTable } from "../src/components/EditableTable.js";
import {
  CountInput,
  COUNT_COLUMN_WIDTH,
  COUNT_INPUT_CLASS,
} from "../src/components/CountInput.js";
import { InboundFormPage } from "../src/routes/inbound/InboundFormPage.js";
import { InboundDetailPage } from "../src/routes/inbound/InboundDetailPage.js";
import { getDb } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

/**
 * What `Grid.useBreakpoint` is told the window is.
 *
 * `test/setup.ts` answers "no" to every media query, which puts every test in
 * this repo on the COMPACT layout — `useLayoutMode` reads `compact` as
 * `!screens.md`, and an unmatched `md` is a phone. That is the right default
 * for the rest of the suite and the wrong one here, where the whole point is
 * that the two layouts differ, so this replaces the stub with one that answers
 * a `min-width`/`max-width` query against a width the test names.
 *
 * Call it BEFORE `render`: antd subscribes once, on mount, and the stub's
 * listeners are no-ops — nothing re-reads it later.
 */
function setViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    },
  });
}

const DESKTOP = 1440;
const PHONE = 375;

interface Line {
  name: string;
  qty: number;
}

/** An editor of the shape every converted call site has: a text cell, a count
 *  cell, and an actions column with no title. */
function Editor({ initial = [] as Line[] }) {
  const [lines, setLines] = useState<Line[]>(initial);
  return (
    <EditableTable<Line>
      rowKey={(_, i) => String(i)}
      dataSource={lines}
      onAdd={() => setLines((ls) => [...ls, { name: "", qty: 1 }])}
      addLabel="Add product"
      emptyText="Nothing yet."
      columns={[
        {
          title: "Product",
          key: "name",
          width: 360,
          render: (_, l, i) => (
            <input
              aria-label={`Product ${i + 1}`}
              value={l.name}
              onChange={(e) =>
                setLines((ls) =>
                  ls.map((x, j) =>
                    i === j ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          ),
        },
        {
          title: "Qty",
          key: "qty",
          width: COUNT_COLUMN_WIDTH,
          render: (_, l, i) => (
            <CountInput
              min={1}
              value={l.qty}
              aria-label={`Qty ${i + 1}`}
              onChange={(v) =>
                setLines((ls) =>
                  ls.map((x, j) => (i === j ? { ...x, qty: v ?? 1 } : x)),
                )
              }
            />
          ),
        },
        {
          title: "",
          key: "remove",
          width: 48,
          render: (_, __, i) => (
            <button
              aria-label={`Remove ${i + 1}`}
              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
            />
          ),
        },
      ]}
    />
  );
}

describe("adding a row", () => {
  beforeEach(() => setViewport(DESKTOP));

  it("puts the button under the rows, not above them", async () => {
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    const button = screen.getByRole("button", { name: "Add product" });
    const grid = document.querySelector("table")!;
    // `compareDocumentPosition` rather than a screenshot: what the owner asked
    // for is an ORDER, and order is a fact about the document.
    expect(
      grid.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("adds a line on Ctrl+Enter from inside a cell", async () => {
    const user = userEvent.setup();
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    await user.click(screen.getByLabelText("Product 1"));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(screen.getByLabelText("Product 2")).toBeInTheDocument();
  });

  it("adds a line on ⌘Enter, for the Macs the shop runs", async () => {
    const user = userEvent.setup();
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    await user.click(screen.getByLabelText("Qty 1"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(screen.getByLabelText("Product 2")).toBeInTheDocument();
  });

  it("leaves the caret in the line it just made", async () => {
    const user = userEvent.setup();
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    await user.click(screen.getByLabelText("Product 1"));
    await user.keyboard("{Control>}{Enter}{/Control}");
    // The whole point of the shortcut: without this you land nowhere and have
    // to tab back down through the row you just left.
    expect(document.activeElement).toBe(screen.getByLabelText("Product 2"));
  });

  it("adds the first line from an empty editor too", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(screen.getByLabelText("Product 1")).toBeInTheDocument();
  });

  it("fills a whole line with Tab and typing, and nothing else", async () => {
    const user = userEvent.setup();
    render(<Editor initial={[{ name: "", qty: 1 }]} />);
    await user.click(screen.getByLabelText("Product 1"));
    await user.keyboard("MacBook Air M2");
    await user.tab();
    // Tab off the product lands on the count, which is the next cell across —
    // the row's own order, not the page's.
    expect(document.activeElement).toBe(screen.getByLabelText("Qty 1"));
    await user.keyboard("{Control>}a{/Control}12");
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove 1" }),
    );
    expect(screen.getByLabelText("Product 1")).toHaveValue("MacBook Air M2");
    expect(screen.getByLabelText("Qty 1")).toHaveValue("12");
  });
});

describe("what a column is allowed to take from its neighbour", () => {
  beforeEach(() => setViewport(DESKTOP));

  it("sizes the grid from its own columns, so none of them is divided up", () => {
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    const table = document.querySelector("table")!;
    // 360 + COUNT_COLUMN_WIDTH + 48. A number here is what puts rc-table into
    // `table-layout: fixed`, where a column gets the width it asked for and a
    // seventy-character product label wraps rather than bidding for more.
    expect(table.style.width).toBe(`${360 + COUNT_COLUMN_WIDTH + 48}px`);
    expect(table.style.tableLayout).toBe("fixed");
  });

  it("gives the count column room for three digits and its arrows", () => {
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    const cols = [...document.querySelectorAll("colgroup col")];
    expect(cols[1]!.getAttribute("style")).toContain(`${COUNT_COLUMN_WIDTH}px`);
    // The floor under the input itself, for a caller who forgets the column.
    // The rule is a `min-width` in `ch`, in global.css.
    expect(
      screen.getByLabelText("Qty 1").closest(`.${COUNT_INPUT_CLASS}`),
    ).not.toBeNull();
  });
});

describe("below md, where the grid stops being a grid", () => {
  beforeEach(() => setViewport(PHONE));

  it("gives every column its own labelled field", () => {
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    expect(document.querySelector("table")).toBeNull();
    // The labels are the column headers, which a grid says once at the top and
    // a stack has to say per row.
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
    expect(screen.getByLabelText("Product 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Qty 1")).toBeInTheDocument();
  });

  it("names each card, since there is no row number to read", () => {
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    expect(screen.getByText("Line 1")).toBeInTheDocument();
  });

  it("still adds a row, and still lands in it", async () => {
    const user = userEvent.setup();
    render(<Editor initial={[{ name: "a", qty: 1 }]} />);
    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(screen.getByLabelText("Product 2")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText("Product 2"));
  });
});

describe("the inbound order form's Products step", () => {
  beforeEach(() => setViewport(DESKTOP));

  /** Steps 1 → 2, which is where the product lines live. */
  async function openProducts() {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AntdApp>
          <InboundFormPage />
        </AntdApp>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    return user;
  }

  it("offers Add a product once, under the table", async () => {
    await openProducts();
    const buttons = screen.getAllByRole("button", { name: /Add a product/ });
    // One, not two: the empty state carried a duplicate (owner decision
    // 2026-08-26) precisely because the real button was a whole table away in
    // the card header. Moving it under the rows retires that.
    expect(buttons).toHaveLength(1);
  });

  it("adds a line on Ctrl+Enter and lands in its picker", async () => {
    const user = await openProducts();
    await user.click(screen.getByRole("button", { name: /Add a product/ }));
    const price = screen.getAllByLabelText(/^Unit price of /)[0]!;
    await user.click(price);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(screen.getAllByLabelText(/^Unit price of /)).toHaveLength(2);
    // The product picker of the new line, which is antd's combobox input.
    expect(document.activeElement).toBe(
      screen.getAllByRole("combobox", { name: "Product" })[1],
    );
  });

  it("keeps Qty typable — three digits and its arrows", async () => {
    const user = await openProducts();
    await user.click(screen.getByRole("button", { name: /Add a product/ }));
    const qty = screen.getByLabelText("Qty");
    expect(qty.closest(`.${COUNT_INPUT_CLASS}`)).not.toBeNull();
    await userEvent.clear(qty);
    await userEvent.type(qty, "144");
    expect(qty).toHaveValue("144");
  });

  it("adds one line of that quantity, priced once", async () => {
    // Owner ask 2026-09-20: *"user will input: unit, qty, price … it will not
    // automatically expand the unit below it."*
    const user = await openProducts();
    const code = getDb().skus.find((s) => s.id === "m-pro13-2016-v1")!.code;
    await user.click(screen.getByRole("button", { name: /Add a product/ }));
    const picker = screen.getByRole("combobox", { name: "Product" });
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: code } });
    const option = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        `.ant-select-item-option[title="${CSS.escape(code)}"]`,
      );
      if (!found) throw new Error("option not open");
      return found;
    });
    fireEvent.click(option);
    const qty = screen.getByLabelText("Qty");
    await userEvent.clear(qty);
    await userEvent.type(qty, "3{Enter}");

    // ONE row, of three, with one price box and one discount box.
    expect(screen.getAllByLabelText("Qty")).toHaveLength(1);
    expect(screen.getByLabelText("Qty")).toHaveValue("3");
    expect(screen.getAllByLabelText(/^Unit price of /)).toHaveLength(1);
    expect(screen.getAllByLabelText(/^Discount on /)).toHaveLength(1);
  });
});

describe("a product label that will not fit on one line", () => {
  /** The two variants on `po-5`, which is the order in the owner's screenshot. */
  function skusOnPo5() {
    const db: MockDb = getDb();
    const po = db.pos.find((p) => p.id === "po-5")!;
    return po.items.map((i) => db.skus.find((s) => s.id === i.skuId)!);
  }

  function openOrder() {
    render(
      <MemoryRouter initialEntries={["/inbound/po-5"]}>
        <AntdApp>
          <Routes>
            <Route path="/inbound/:poId" element={<InboundDetailPage />} />
          </Routes>
        </AntdApp>
      </MemoryRouter>,
    );
  }

  /**
   * The invoice's lines — product, qty, one price, a discount. One table on
   * the page since 2026-09-20; the folded *Inbound* section it doubled is
   * gone, so there is nothing to open.
   */
  function openInvoice(): HTMLElement {
    return document.querySelector(".nusantara-editable-table") as HTMLElement;
  }

  it("shows the code and the model name as two separate lines", () => {
    setViewport(DESKTOP);
    const [first] = skusOnPo5();
    openOrder();
    // The code goes in the picker; the model and variant go under it, where
    // they are free to take a second line. Both are on screen — the split is
    // about where the text sits, not about hiding half of it.
    expect(screen.getAllByText(first!.code).length).toBeGreaterThan(0);
    const full = screen.getByText(`${first!.name} ${first!.variantLabel}`);
    expect(full).toBeInTheDocument();
    // …and the long half is NOT inside the box, which is what stops it asking
    // the column for seventy characters of width.
    expect(full.closest(".ant-select")).toBeNull();
  });

  it("holds every column, so Qty and Total keep their own width", () => {
    setViewport(DESKTOP);
    openOrder();
    const editor = openInvoice();
    const table = editor.querySelector("table") as HTMLElement;
    // Fixed, not auto: rc-table only picks `fixed` on its own when a column is
    // pinned, and `auto` is what let the product label take Qty's room.
    expect(table.style.tableLayout).toBe("fixed");
    const widths = [...editor.querySelectorAll("colgroup col")].map(
      (c) => (c as HTMLElement).style.width,
    );
    expect(widths).toEqual([
      "44px",
      "300px",
      `${COUNT_COLUMN_WIDTH + 24}px`,
      "170px",
      "170px",
      "150px",
      "150px",
      "260px",
    ]);
  });

  it("becomes a card of labelled fields below md", () => {
    setViewport(PHONE);
    openOrder();
    const editor = openInvoice();
    expect(editor.querySelector("table")).toBeNull();
    // Every cell is still there and still typable, now at full width: one
    // card per line, each with its product, its quantity, its one price and
    // its discount.
    expect(editor.querySelectorAll(".nusantara-stacked-row")).toHaveLength(2);
    expect(
      editor.querySelectorAll('[role="combobox"][aria-label="Product"]'),
    ).toHaveLength(2);
    expect(editor.querySelectorAll('[aria-label="Qty"]')).toHaveLength(2);
    expect(
      editor.querySelectorAll('[aria-label^="Unit price of "]'),
    ).toHaveLength(2);
    expect(
      editor.querySelectorAll('[aria-label^="Discount on "]'),
    ).toHaveLength(2);
  });
});
