/**
 * A list's search, kept on this device (owner ask 2026-09-21: "all the things
 * of the user input will be saved locally").
 *
 * The in-app tab strip used to keep a list mounted, and with it the search
 * somebody had typed; it is gone, so a page's own list keeps its search,
 * filters and sort by name (`persistKey`). A list without one — a picker in a
 * dialog — starts clean every time, which is the point of leaving it out.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ProTable } from "../src/components/ProTable.js";

interface Row {
  readonly id: string;
  readonly name: string;
}

const ROWS: Row[] = [
  { id: "1", name: "MacBook Air" },
  { id: "2", name: "MacBook Pro" },
  { id: "3", name: "iMac" },
];

function renderList(persistKey?: string) {
  return render(
    <ProTable<Row>
      rowKey="id"
      dataSource={ROWS}
      searchPlaceholder="Search a product"
      {...(persistKey === undefined ? {} : { persistKey })}
      columns={[
        {
          title: "Product",
          key: "name",
          dataIndex: "name",
          searchable: true,
          sortValue: (r) => r.name,
        },
      ]}
    />,
  );
}

describe("a list's search", () => {
  it("is still there after leaving the page and coming back", async () => {
    const first = renderList("test.products");
    await userEvent.type(
      screen.getByPlaceholderText("Search a product"),
      "pro",
    );
    expect(screen.queryByText("MacBook Air")).toBeNull();
    first.unmount();

    renderList("test.products");
    expect(screen.getByPlaceholderText("Search a product")).toHaveValue("pro");
    expect(screen.getByText("MacBook Pro")).toBeTruthy();
    expect(screen.queryByText("MacBook Air")).toBeNull();
  });

  it("starts clean in a list that does not ask to keep it", async () => {
    const first = renderList();
    await userEvent.type(
      screen.getByPlaceholderText("Search a product"),
      "pro",
    );
    first.unmount();

    renderList();
    expect(screen.getByPlaceholderText("Search a product")).toHaveValue("");
    expect(screen.getByText("MacBook Air")).toBeTruthy();
  });
});
