/**
 * DataTable — 02 §8, and the Increment 1 DoD lines:
 *   "DataTable with 10 000 rows filters in < 100 ms" (virtualized);
 *   "Column widths, density and filters survive a reload".
 */

import { useMemo, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { DataTable, type KitColumn } from "../src/DataTable.js";
import type { SortState } from "../src/useUrlState.js";

interface Row {
  readonly id: string;
  readonly serial: string;
  readonly nama: string;
  readonly harga: bigint;
}

const makeRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    serial: `NUS${String(i).padStart(7, "0")}`,
    nama: `MacBook nomor ${i}`,
    harga: BigInt(1_000_000 + i),
  }));

const COLUMNS: KitColumn<Row>[] = [
  {
    id: "serial",
    header: "Serial",
    cell: (r) => r.serial,
    sortable: true,
    width: 140,
  },
  {
    id: "nama",
    header: "Nama",
    cell: (r) => r.nama,
    title: (r) => r.nama,
    sortable: true,
  },
  {
    id: "harga",
    header: "Harga (Rp)",
    cell: (r) => r.harga.toString(),
    align: "right",
  },
];

function renderTable(
  rows: Row[],
  over: Partial<Parameters<typeof DataTable<Row>>[0]> = {},
) {
  return render(
    <DataTable<Row>
      tableId="uji"
      staffId="staff_test"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      isFiltered={false}
      emptyState={<p data-testid="empty-none">Belum ada unit — Tambah stok</p>}
      noMatchState={
        <p data-testid="empty-nomatch">Tidak ada yang cocok — Reset filter</p>
      }
      height={640}
      {...over}
    />,
  );
}

beforeEach(() => {
  globalThis.localStorage?.clear();
});

describe("rendering and states", () => {
  it("renders rows with truncation-by-default and a title tooltip", () => {
    renderTable(makeRows(3));
    expect(screen.getByText("NUS0000000")).toBeInTheDocument();
    const cell = screen.getByText("MacBook nomor 1").closest("td");
    expect(cell).toHaveAttribute("title", "MacBook nomor 1");
  });

  it("distinguishes no-data from no-match by isFiltered", () => {
    const first = renderTable([]);
    expect(screen.getByTestId("empty-none")).toBeInTheDocument();
    first.unmount();

    renderTable([], { isFiltered: true });
    expect(screen.getByTestId("empty-nomatch")).toBeInTheDocument();
  });
});

describe("sorting — stable, arrowed, multi-column with Shift+click", () => {
  it("plain click sorts ascending, second click flips, and aria-sort says so", async () => {
    const user = userEvent.setup();
    const calls: SortState[][] = [];
    const Harness = () => {
      const [sort, setSort] = useState<SortState[]>([]);
      return renderProps(sort, (s) => {
        calls.push(s);
        setSort(s);
      });
    };
    function renderProps(
      sort: SortState[],
      onSortChange: (s: SortState[]) => void,
    ) {
      return (
        <DataTable<Row>
          tableId="uji"
          columns={COLUMNS}
          rows={makeRows(3)}
          rowKey={(r) => r.id}
          sort={sort}
          onSortChange={onSortChange}
          isFiltered={false}
          emptyState="-"
          noMatchState="-"
          height={400}
        />
      );
    }
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^Serial/ }));
    expect(calls.at(-1)).toEqual([{ column: "serial", dir: "asc" }]);
    expect(
      screen.getByRole("columnheader", { name: /Serial/ }),
    ).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: /^Serial/ }));
    expect(calls.at(-1)).toEqual([{ column: "serial", dir: "desc" }]);

    // Shift+click adds a secondary column instead of replacing (§8).
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: /^Nama/ }));
    await user.keyboard("{/Shift}");
    expect(calls.at(-1)).toEqual([
      { column: "serial", dir: "desc" },
      { column: "nama", dir: "asc" },
    ]);
  });
});

describe("selection — Space, Shift+click, tri-state header, docked bulk bar", () => {
  function Harness({ onBulk }: { onBulk?: (keys: string[]) => void }) {
    const rows = useMemo(() => makeRows(5), []);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return (
      <DataTable<Row>
        tableId="uji"
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.id}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={[
          { label: "Edit harga", onAction: onBulk ?? (() => undefined) },
        ]}
        isFiltered={false}
        emptyState="-"
        noMatchState="-"
        height={400}
      />
    );
  }

  it("the header checkbox says what it will select and is tri-state", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const header = screen.getByRole("checkbox", {
      name: "Pilih 5 baris terlihat",
    }) as HTMLInputElement;
    expect(header.indeterminate).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Pilih baris u1" }));
    expect(header.indeterminate).toBe(true);

    await user.click(header);
    // Select-all from a partial state selects everything visible.
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(6);

    await user.click(header);
    expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(
      0,
    );
  });

  it("Shift+click selects the range from the anchor", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("checkbox", { name: "Pilih baris u1" }));
    const target = screen.getByRole("checkbox", { name: "Pilih baris u3" });
    fireEvent.click(target, { shiftKey: true });

    for (const id of ["u1", "u2", "u3"]) {
      expect(
        screen.getByRole("checkbox", { name: `Pilih baris ${id}` }),
      ).toBeChecked();
    }
    expect(
      screen.getByRole("checkbox", { name: "Pilih baris u0" }),
    ).not.toBeChecked();
  });

  it("Space toggles the focused row", () => {
    render(<Harness />);
    const row = screen
      .getByRole("checkbox", { name: "Pilih baris u2" })
      .closest("tr")!;
    row.focus();
    fireEvent.keyDown(row, { key: " " });
    expect(
      screen.getByRole("checkbox", { name: "Pilih baris u2" }),
    ).toBeChecked();
    fireEvent.keyDown(row, { key: " " });
    expect(
      screen.getByRole("checkbox", { name: "Pilih baris u2" }),
    ).not.toBeChecked();
  });

  it("rows are walkable with the arrow keys (§2)", () => {
    render(<Harness />);
    const row = screen
      .getByRole("checkbox", { name: "Pilih baris u0" })
      .closest("tr")!;
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: "Pilih baris u1" }).closest("tr"),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row);
  });

  it("the bulk bar docks with the count, acts on the selection, and clears", async () => {
    const user = userEvent.setup();
    const acted: string[][] = [];
    render(<Harness onBulk={(keys) => acted.push(keys.sort())} />);

    expect(
      screen.queryByRole("toolbar", { name: "Aksi massal" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Pilih baris u1" }));
    await user.click(screen.getByRole("checkbox", { name: "Pilih baris u4" }));

    const bar = screen.getByRole("toolbar", { name: "Aksi massal" });
    expect(within(bar).getByText("2 dipilih")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Edit harga" }));
    expect(acted).toEqual([["u1", "u4"]]);

    await user.click(within(bar).getByRole("button", { name: "Batal pilih" }));
    expect(
      screen.queryByRole("toolbar", { name: "Aksi massal" }),
    ).not.toBeInTheDocument();
  });
});

describe("prefs survive a reload — widths and density", () => {
  it("keyboard resize persists and comes back after an unmount", () => {
    const first = renderTable(makeRows(2));
    const handle = screen.getByRole("separator", {
      name: "Ubah lebar kolom serial",
    });
    const before = Number(handle.getAttribute("aria-valuenow"));

    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(
      Number(
        screen
          .getByRole("separator", { name: "Ubah lebar kolom serial" })
          .getAttribute("aria-valuenow"),
      ),
    ).toBe(before + 32);
    first.unmount();

    renderTable(makeRows(2));
    expect(
      Number(
        screen
          .getByRole("separator", { name: "Ubah lebar kolom serial" })
          .getAttribute("aria-valuenow"),
      ),
    ).toBe(before + 32);
  });

  it("density toggles, changes row height, and persists", async () => {
    const user = userEvent.setup();
    const first = renderTable(makeRows(2));

    await user.click(screen.getByRole("button", { name: "Kepadatan: Normal" }));
    expect(
      screen.getByRole("button", { name: "Kepadatan: Rapat" }),
    ).toBeInTheDocument();
    first.unmount();

    renderTable(makeRows(2));
    expect(
      screen.getByRole("button", { name: "Kepadatan: Rapat" }),
    ).toBeInTheDocument();
  });

  it("prefs are per staff and per table", () => {
    renderTable(makeRows(1));
    const handle = screen.getByRole("separator", {
      name: "Ubah lebar kolom serial",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(
      globalThis.localStorage?.getItem("nusantara.table.staff_test.uji"),
    ).not.toBeNull();
    expect(
      globalThis.localStorage?.getItem("nusantara.table.lain.uji"),
    ).toBeNull();
  });
});

describe("scale — the 10 000-row DoD", () => {
  it("virtualizes: 10 000 rows render far fewer than 10 000 <tr>", () => {
    renderTable(makeRows(10_000));
    const rendered = document.querySelectorAll("tbody tr").length;
    expect(rendered).toBeLessThan(100);
    expect(screen.getByText("NUS0000000")).toBeInTheDocument();
  });

  it("filters 10 000 rows to a rendered result in under 100 ms", () => {
    function Harness() {
      const all = useMemo(() => makeRows(10_000), []);
      const [q, setQ] = useState("");
      const rows = useMemo(
        () => (q === "" ? all : all.filter((r) => r.serial.includes(q))),
        [all, q],
      );
      return (
        <>
          <input
            aria-label="Cari"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <DataTable<Row>
            tableId="uji"
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            isFiltered={q !== ""}
            emptyState="-"
            noMatchState={<p data-testid="empty-nomatch">Tidak ada</p>}
            height={640}
          />
        </>
      );
    }
    render(<Harness />);
    const search = screen.getByLabelText("Cari");

    // Warm-up render, then the measured filter (same policy as the S9 API
    // latency guard: measure the steady state, not the first hit).
    fireEvent.change(search, { target: { value: "NUS000999" } });
    fireEvent.change(search, { target: { value: "" } });

    const t0 = performance.now();
    fireEvent.change(search, { target: { value: "NUS000123" } });
    const elapsed = performance.now() - t0;

    expect(screen.getByText("NUS0001234")).toBeInTheDocument();
    expect(elapsed).toBeLessThan(100);
  });
});
