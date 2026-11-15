/**
 * A list on a phone (owner-approved mockup a1/a2/c2, 2026-11-16): search,
 * Filters (n) and Sort on one row; the filters a sheet of tap-to-select
 * chips with counts and date presets; what is on a row of removable chips.
 * The sheet writes the same state the desktop column headers write.
 *
 * `test/setup.ts` answers "no" to every media query: this is the phone.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import dayjs from "dayjs";
import { ProTable, type ProColumn } from "../src/components/ProTable.js";
import { presetOf, presetRange } from "../src/lib/datePresets.js";

interface Row {
  id: string;
  name: string;
  grade: string;
  where: string;
  at: string;
  price: number;
}

const today = dayjs().format("YYYY-MM-DD");
const old = dayjs().subtract(40, "day").format("YYYY-MM-DD");

const ROWS: Row[] = [
  { id: "1", name: "Air M1", grade: "A", where: "01", at: today, price: 8 },
  { id: "2", name: "Air M2", grade: "A", where: "02", at: today, price: 12 },
  { id: "3", name: "Pro 14", grade: "B", where: "01", at: old, price: 25 },
  { id: "4", name: "iPad", grade: "C", where: "01", at: old, price: 4 },
];

const columns: ProColumn<Row>[] = [
  { title: "Product", dataIndex: "name", searchable: true },
  { title: "Grade", dataIndex: "grade", facet: true },
  { title: "Warehouse", dataIndex: "where", facet: true },
  { title: "Date", dataIndex: "at", dateRange: true },
  { title: "Price", dataIndex: "price" },
];

const cards = () =>
  Array.from(document.querySelectorAll(".ant-card")).map(
    (c) => c.textContent ?? "",
  );

function renderList() {
  return render(
    <ProTable<Row> rowKey="id" dataSource={ROWS} columns={columns} />,
  );
}

const sheet = () => screen.getByRole("dialog");

describe("date presets", () => {
  it("writes a preset as the same day range the header picker writes", () => {
    const now = dayjs("2026-11-16T10:00:00");
    expect(presetRange("today", now)).toEqual(["2026-11-16", "2026-11-16"]);
    expect(presetRange("7d", now)).toEqual(["2026-11-10", "2026-11-16"]);
    expect(presetRange("month", now)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(presetOf(["2026-11-10", "2026-11-16"], now)).toBe("7d");
    expect(presetOf(undefined, now)).toBe("any");
    expect(presetOf(["2026-10-01", null], now)).toBe("custom");
  });
});

describe("the phone toolbar", () => {
  it("is one row of search, Filters and Sort — no stacked selects", () => {
    renderList();
    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sort/ })).toBeInTheDocument();
    // The pager's size changer is a select; the filters are not.
    expect(document.querySelectorAll(".ant-select-multiple")).toHaveLength(0);
    expect(document.querySelectorAll(".ant-picker")).toHaveLength(0);
  });
});

describe("the Filters sheet", () => {
  it("offers each value as a chip with its count, and Show n results applies", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const grade = within(sheet()).getByRole("group", { name: "Grade" });
    const a = within(grade).getByRole("button", { name: /^A\s*2$/ });
    expect(a).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(a);
    expect(a).toHaveAttribute("aria-pressed", "true");
    // Nothing applies until Show: the list behind is unchanged.
    expect(cards()).toHaveLength(4);
    // The warehouse counts follow the draft — grade A is in 01 once, 02 once.
    const wh = within(sheet()).getByRole("group", { name: "Warehouse" });
    expect(within(wh).getByRole("button", { name: /^01\s*1$/ })).toBeVisible();
    fireEvent.click(
      within(sheet()).getByRole("button", { name: "Show 2 results" }),
    );
    expect(cards()).toHaveLength(2);
    // The filter is a removable chip, and the button counts it.
    expect(screen.getByRole("button", { name: /Filters\s*1/ })).toBeVisible();
    fireEvent.click(
      screen
        .getByLabelText("Remove Grade A")
        .querySelector(".ant-tag-close-icon")!,
    );
    expect(cards()).toHaveLength(4);
  });

  it("filters dates by preset, and Reset clears the draft", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const date = within(sheet()).getByRole("group", { name: "Date" });
    expect(
      within(date).getByRole("button", { name: "Any date" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(date).getByRole("button", { name: "7 days" }));
    fireEvent.click(
      within(sheet()).getByRole("button", { name: "Show 2 results" }),
    );
    expect(cards()).toHaveLength(2);
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Reset" }));
    expect(
      within(sheet()).getByRole("button", { name: "Show 4 results" }),
    ).toBeVisible();
  });

  it("opens two date fields for Custom", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(within(sheet()).getByRole("button", { name: /Custom/ }));
    expect(within(sheet()).getByLabelText("From")).toBeInTheDocument();
    expect(within(sheet()).getByLabelText("Until")).toBeInTheDocument();
  });
});

describe("the Sort sheet", () => {
  it("sorts by a column either way, and says so above the list", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /Sort/ }));
    fireEvent.click(
      within(sheet()).getByRole("button", { name: "Price — descending" }),
    );
    expect(cards()[0]).toContain("Pro 14");
    expect(screen.getByText("Price — descending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sort/ }));
    fireEvent.click(
      within(sheet()).getByRole("button", { name: "Date — oldest first" }),
    );
    expect(cards()[0]).toMatch(/Pro 14|iPad/);
  });
});
