/**
 * The phone card (owner-approved mockup, 2026-11-16): one anatomy for every
 * list, a chevron on a card that opens something, sticky day headings, and
 * nothing that scrolls sideways — an expandable table and a tree become
 * cards whose details open inside them.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Tag } from "antd";
import { DataTable } from "../src/components/DataTable.js";

interface Sale {
  id: string;
  code: string;
  day: string;
  total: number;
  children?: Sale[];
}

const SALES: Sale[] = [
  { id: "a", code: "SI-1", day: "Today", total: 100 },
  { id: "b", code: "SI-2", day: "Today", total: 200 },
  { id: "c", code: "SI-3", day: "Yesterday", total: 50 },
];

const columns = [
  { title: "Order", dataIndex: "code" },
  { title: "Total", dataIndex: "total" },
];

describe("the phone card", () => {
  it("draws the card model a list gives it, with a chevron when the card opens something", () => {
    const open = vi.fn();
    render(
      <DataTable<Sale>
        rowKey="id"
        dataSource={SALES}
        columns={columns}
        onRow={(r) => ({ onClick: () => open(r.code) })}
        card={(r) => ({
          title: r.code,
          tag: <Tag>Paid</Tag>,
          subtitle: "Walk-in",
          facts: ["MacBook Air"],
          meta: "10:42",
          amount: `Rp ${r.total}`,
        })}
      />,
    );
    const first = document.querySelector(".ant-card")!;
    expect(first.textContent).toContain("SI-1");
    expect(first.textContent).toContain("Paid");
    expect(first.textContent).toContain("Rp 100");
    expect(first.querySelector(".anticon-right")).not.toBeNull();
    fireEvent.click(first);
    expect(open).toHaveBeenCalledWith("SI-1");
    // No table, so nothing to scroll sideways.
    expect(document.querySelector("table")).toBeNull();
  });

  it("groups cards under a heading per day", () => {
    render(
      <DataTable<Sale>
        rowKey="id"
        dataSource={SALES}
        columns={columns}
        cardGroup={(r) => ({ key: r.day, label: r.day, aside: "Rp" })}
      />,
    );
    const heads = Array.from(
      document.querySelectorAll(".nusantara-card-group"),
    ).map((h) => h.textContent);
    expect(heads).toEqual(["TodayRp", "YesterdayRp"]);
  });

  it("opens an expandable row's detail inside its card", () => {
    render(
      <DataTable<Sale>
        rowKey="id"
        dataSource={SALES}
        columns={columns}
        expandable={{
          expandedRowRender: (r) => <div>Units of {r.code}</div>,
        }}
      />,
    );
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByText("Units of SI-1")).toBeNull();
    const card = document.querySelector<HTMLElement>(".ant-card")!;
    fireEvent.click(within(card).getByRole("button", { name: /Show details/ }));
    expect(screen.getByText("Units of SI-1")).toBeInTheDocument();
  });

  it("draws a tree's children as cards under their group", () => {
    render(
      <DataTable<Sale>
        rowKey="id"
        dataSource={[
          {
            id: "g",
            code: "Apel Segar",
            day: "",
            total: 0,
            children: [
              { id: "g1", code: "PI-1", day: "", total: 1 },
              { id: "g2", code: "PI-2", day: "", total: 2 },
            ],
          },
        ]}
        columns={columns}
      />,
    );
    expect(screen.queryByText("PI-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show 2/ }));
    expect(screen.getByText("PI-1")).toBeInTheDocument();
    expect(screen.getByText("PI-2")).toBeInTheDocument();
  });
});
