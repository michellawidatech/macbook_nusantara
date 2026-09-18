/**
 * The keyboard, where it meets the components (owner ask 2026-09-15).
 *
 * > *"All of the UI has to be keyboard friendly (enter key to move to the next
 * > column focus, arrow buttons, and other navigation helpers."*
 *
 * `lib/keyboardNav.ts` decides every one of these questions and is tested by
 * asking it directly. What cannot be tested that way is the WIRING — that
 * `EditableTable` actually calls it for the arrows, that a `DataTable` row a
 * caller marked is really in the tab order, that `/` finds the box `ProTable`
 * marked. A whole page is rendered for each, because the answer depends on the
 * real markup antd produces.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { EditableTable } from "../src/components/EditableTable";
import { ProTable } from "../src/components/ProTable";
import { installKeyboardNav } from "../src/components/KeyboardNav";
import { InputNumber, Input } from "antd";
import { __resetScanner } from "../src/lib/scanner";

interface Row {
  key: string;
  name: string;
  qty: number;
}

function Grid() {
  const [rows, setRows] = useState<Row[]>([
    { key: "a", name: "Air", qty: 1 },
    { key: "b", name: "Pro", qty: 2 },
    { key: "c", name: "Mini", qty: 3 },
  ]);
  return (
    <EditableTable<Row>
      rowKey="key"
      dataSource={rows}
      columns={[
        {
          title: "Name",
          key: "name",
          width: 200,
          render: (_, r) => (
            <Input
              aria-label={`Name ${r.key}`}
              value={r.name}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x) =>
                    x.key === r.key ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          ),
        },
        {
          title: "Qty",
          key: "qty",
          width: 120,
          render: (_, r) => (
            <InputNumber
              aria-label={`Qty ${r.key}`}
              value={r.qty}
              onChange={(v) =>
                setRows((all) =>
                  all.map((x) =>
                    x.key === r.key ? { ...x, qty: v ?? 0 } : x,
                  ),
                )
              }
            />
          ),
        },
      ]}
    />
  );
}

beforeEach(() => {
  // `useLayoutMode` reads matchMedia; the stub answers "no", which is the
  // phone. The grid layout is the one with cells to arrow between.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: /min-width:\s*(\d+)px/.test(query)
          ? Number(/min-width:\s*(\d+)px/.exec(query)![1]) <= 1200
          : false,
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

describe("the arrows in a line-item grid", () => {
  it("moves down the same column", async () => {
    render(<Grid />);
    const qtyA = screen.getByLabelText("Qty a");
    qtyA.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByLabelText("Qty b"));
  });

  it("moves back up, and stops at the top rather than wrapping", async () => {
    render(<Grid />);
    screen.getByLabelText("Qty b").focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByLabelText("Qty a"));
    // A wrap would take somebody correcting the first row to the last one,
    // which on a long invoice is a scroll they did not ask for.
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByLabelText("Qty a"));
  });

  it("leaves ← → to the text until the caret reaches its edge", async () => {
    render(<Grid />);
    const name = screen.getByLabelText("Name a") as HTMLInputElement;
    name.focus();
    name.setSelectionRange(1, 1);
    await userEvent.keyboard("{ArrowRight}");
    // Mid-word: the caret moved, the cell did not.
    expect(document.activeElement).toBe(name);
  });

  it("crosses to the next cell once it has", async () => {
    render(<Grid />);
    const name = screen.getByLabelText("Name a") as HTMLInputElement;
    name.focus();
    name.setSelectionRange(name.value.length, name.value.length);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByLabelText("Qty a"));
  });
});

describe("`/` and the page's search box", () => {
  let uninstall = () => {};
  let helped = 0;
  beforeEach(() => {
    /*
     * The scanner is a module singleton with a keystroke BUFFER, and it is
     * not a test artefact that it matters here: a character typed with
     * nothing focused, within `burstGapMs` of the one before it, is taken as
     * part of a scan and swallowed (`lib/scanner.ts`). Two tests typing `/`
     * milliseconds apart look exactly like a barcode, so the `?` after them
     * never reaches the page.
     *
     * A person pressing `?` a few hundred milliseconds after a scan gets the
     * help. `userEvent` is faster than any person, so the buffer is cleared
     * between tests — the same reason `tillPage.test.tsx` pins the clock.
     */
    __resetScanner();
    helped = 0;
    uninstall = installKeyboardNav({ onHelp: () => (helped += 1) });
  });
  afterEach(() => uninstall());

  it("jumps to the box ProTable marked", async () => {
    render(
      <main>
        <ProTable<{ id: string; name: string }>
          rowKey="id"
          searchPlaceholder="Search things"
          dataSource={[{ id: "1", name: "Air" }]}
          columns={[{ title: "Name", dataIndex: "name" }]}
        />
      </main>,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText("Search things"),
    );
  });

  it("types a slash into a field rather than leaving it", async () => {
    render(
      <main>
        <Input aria-label="Note" />
        <ProTable<{ id: string }>
          rowKey="id"
          searchPlaceholder="Search things"
          dataSource={[]}
          columns={[{ title: "Id", dataIndex: "id" }]}
        />
      </main>,
    );
    const note = screen.getByLabelText("Note");
    note.focus();
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(note);
  });

  it("opens the shortcut list on ?", async () => {
    render(<main />);
    // jsdom leaves `document.activeElement` pointing at an input that has
    // been unmounted, where a browser resets it to `<body>` — and the test
    // before this one ends with the caret in a field. `?` inside a field is a
    // question mark, so without this the handler correctly does nothing.
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("?");
    expect(helped).toBe(1);
  });
});

describe("a list row that opens something", () => {
  const rows = [
    { id: "po-1", code: "PI-0001" },
    { id: "po-2", code: "PI-0002" },
  ];

  function List({ onOpen }: { onOpen: (id: string) => void }) {
    return (
      <ProTable<(typeof rows)[number]>
        rowKey="id"
        search={false}
        dataSource={rows}
        keyboardRows={(r) => `Open ${r.code}`}
        onRow={(r) => ({ onClick: () => onOpen(r.id) })}
        columns={[{ title: "Order", dataIndex: "code" }]}
      />
    );
  }

  it("is in the tab order, and says what it opens", () => {
    render(<List onOpen={() => undefined} />);
    const row = screen.getByRole("button", { name: "Open PI-0001" });
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("walks the list with the arrows", async () => {
    render(<List onOpen={() => undefined} />);
    const first = screen.getByRole("button", { name: "Open PI-0001" });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Open PI-0002" }),
    );
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(first);
  });

  it("opens on Enter and on Space", async () => {
    const opened: string[] = [];
    render(<List onOpen={(id) => opened.push(id)} />);
    screen.getByRole("button", { name: "Open PI-0001" }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(opened).toEqual(["po-1", "po-1"]);
  });

  it("leaves a list nobody marked out of the tab order", () => {
    // Forty read-only rows would otherwise put forty presses of Tab between
    // the filter above the list and the pager below it.
    render(
      <ProTable<(typeof rows)[number]>
        rowKey="id"
        search={false}
        dataSource={rows}
        columns={[{ title: "Order", dataIndex: "code" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Open/ })).toBeNull();
  });
});
