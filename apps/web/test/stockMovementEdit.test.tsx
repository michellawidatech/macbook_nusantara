/** Edit stock movement asks no battery (owner list 2026-11-03). */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StockMovementEditModal } from "../src/routes/stock/StockMovementEditModal.js";
import { stockHistoryRows } from "../src/lib/stockHistory.js";
import { getDb } from "../src/mock/store.js";

describe("Edit stock movement", () => {
  it("asks when, reason and description, and no battery", async () => {
    const row = stockHistoryRows(getDb()).find((r) => r.counted === undefined);
    expect(row).toBeDefined();
    render(
      <AntdApp>
        <StockMovementEditModal open row={row!} onClose={() => undefined} />
      </AntdApp>,
    );
    await screen.findByLabelText("Description");
    expect(screen.queryByText("Battery")).toBeNull();
    // Grey until something changes (2026-11-04).
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "x" },
    });
    expect(save).toBeEnabled();
  });
});
