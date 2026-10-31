/**
 * One scrolling page instead of a pager (owner 2026-10-31): a `lazy` list
 * draws a batch, says how many of how many, and draws the next batch as its
 * foot comes into view — or on *Show more* where nothing can watch the
 * scroll, as in this test's browser.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataTable, LAZY_BATCH } from "../src/components/DataTable.js";

const rows = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, n: i }));
const columns = [{ title: "N", dataIndex: "n", key: "n" }];

describe("a lazy list", () => {
  it("draws a batch, then more, and never a pager", async () => {
    render(<DataTable lazy rowKey="id" dataSource={rows} columns={columns} />);
    expect(screen.queryByRole("listitem", { name: /page/i })).toBeNull();
    expect(screen.queryByTitle("Next Page")).toBeNull();
    expect(screen.getByText(`${LAZY_BATCH} of 120`)).toBeInTheDocument();
    expect(screen.queryByText(String(LAZY_BATCH))).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText(String(LAZY_BATCH))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("120 of 120")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
