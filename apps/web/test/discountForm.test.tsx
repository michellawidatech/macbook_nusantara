/**
 * The discount form (owner report 2026-10-02): saving one was refused by the
 * store — "pct: Invalid input: expected number, received string; usageLimit:
 * … received string" — because its count boxes were `<Input type="number">`,
 * which hands the form text. And a discount could not be corrected at all.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscountFormPage } from "../src/routes/discounts/DiscountFormPage.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

function renderAt(path: string) {
  render(
    <AntdApp>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/discounts/new" element={<DiscountFormPage />} />
          <Route
            path="/discounts/:discountId/edit"
            element={<DiscountFormPage />}
          />
          <Route path="/discounts" element={<div>the list</div>} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

const byCode = (code: string) => getDb().discounts.find((d) => d.code === code);

beforeEach(() => {
  localStorage.clear();
  mutate((d) => {
    d.discounts = d.discounts.filter(
      (x) => !["ZZPCT10", "ZZEDIT", "ZZEDITED"].includes(x.code),
    );
  });
});

describe("adding a discount", () => {
  it("stores the percentage and the usage limit as numbers", async () => {
    renderAt("/discounts/new");
    await userEvent.type(screen.getByLabelText("Name"), "Ten off");
    await userEvent.type(screen.getByLabelText("Code"), "zzpct10");
    await userEvent.type(
      screen.getByLabelText("Percentage off", {
        selector: "input.ant-input-number-input",
      }),
      "10",
    );
    await userEvent.type(screen.getByLabelText("Max uses"), "5");
    await userEvent.click(screen.getByText("Save discount").closest("button")!);
    await screen.findByText("the list");
    const d = byCode("ZZPCT10")!;
    expect(d.pct).toBe(10);
    expect(d.usageLimit).toBe(5);
    expect(typeof d.pct).toBe("number");
    expect(typeof d.usageLimit).toBe("number");
  });
});

describe("editing a discount", () => {
  beforeEach(() => {
    mutate((d) => {
      d.discounts.unshift({
        id: "d-zz-edit",
        code: "ZZEDIT",
        name: "Old name",
        type: "NOMINAL",
        amountRp: 500_000,
        usageLimit: 3,
        used: 2,
        active: false,
        scope: "All products",
      });
    });
  });

  it("opens on its values and corrects it in place", async () => {
    renderAt("/discounts/d-zz-edit/edit");
    expect(await screen.findByText("Edit Discount")).toBeInTheDocument();
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Old name");
    await userEvent.clear(name);
    await userEvent.type(name, "New name");
    const code = screen.getByLabelText("Code");
    await userEvent.clear(code);
    await userEvent.type(code, "zzedited");
    const limit = screen.getByLabelText("Max uses");
    await userEvent.clear(limit);
    await userEvent.type(limit, "7");
    await userEvent.click(screen.getByText("Save discount").closest("button")!);
    await screen.findByText("the list");

    const all = getDb().discounts.filter((d) => d.id === "d-zz-edit");
    expect(all).toHaveLength(1);
    const d = all[0]!;
    expect(d.name).toBe("New name");
    expect(d.code).toBe("ZZEDITED");
    expect(d.usageLimit).toBe(7);
    expect(d.amountRp).toBe(500_000);
    // Counted by sales and switched on the list — not the form's.
    expect(d.used).toBe(2);
    expect(d.active).toBe(false);
  });

  it("says so when the discount does not exist", async () => {
    renderAt("/discounts/nope/edit");
    expect(
      await screen.findByText("This discount does not exist."),
    ).toBeInTheDocument();
  });
});
