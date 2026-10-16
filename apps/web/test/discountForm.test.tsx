/**
 * The discount form (owner report 2026-10-02): saving one was refused by the
 * store — "pct: Invalid input: expected number, received string; usageLimit:
 * … received string" — because its count boxes were `<Input type="number">`,
 * which hands the form text. And a discount could not be corrected at all.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscountFormPage } from "../src/routes/discounts/DiscountFormPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { scopeKindOf } from "../src/lib/pricing.js";

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
      (x) => !["ZZPCT10", "ZZEDIT", "ZZEDITED", "ZZSCOPE"].includes(x.code),
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

/** Pick an option, by its text, in the Select labelled `label`. */
async function choose(label: string, text: string) {
  const box = screen.getByRole("combobox", { name: label });
  fireEvent.mouseDown(box);
  const option = await waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      ),
    );
    const found = Array.from(
      open[open.length - 1]?.querySelectorAll<HTMLElement>(
        ".ant-select-item-option",
      ) ?? [],
    ).find((el) => el.textContent === text);
    if (!found) throw new Error(`no option ${text} open`);
    return found;
  });
  fireEvent.click(option);
}

describe("what a discount applies to (owner ask 2026-10-08)", () => {
  it("is all, a category or a product, asked as two questions", async () => {
    const db = getDb();
    const category = db.categories[0]!.name;
    const product = db.models[0]!.name;
    renderAt("/discounts/new");
    await userEvent.type(screen.getByLabelText("Name"), "Scoped");
    await userEvent.type(screen.getByLabelText("Code"), "zzscope");
    await userEvent.type(
      screen.getByLabelText("Percentage off", {
        selector: "input.ant-input-number-input",
      }),
      "5",
    );

    // All products by default, with nothing more to ask.
    expect(
      screen.queryByRole("combobox", { name: "Which category" }),
    ).toBeNull();
    await userEvent.click(screen.getByText("Category"));
    await choose("Which category", category);
    // Switching kind drops the other kind's answer.
    await userEvent.click(screen.getByText("Product"));
    expect(
      screen.queryByRole("combobox", { name: "Which category" }),
    ).toBeNull();
    await choose("Which product", product);

    await userEvent.click(screen.getByText("Save discount").closest("button")!);
    await screen.findByText("the list");
    expect(byCode("ZZSCOPE")!.scope).toBe(product);
  });

  it("refuses a category scope with no category chosen", async () => {
    renderAt("/discounts/new");
    await userEvent.type(screen.getByLabelText("Name"), "Scoped");
    await userEvent.type(screen.getByLabelText("Code"), "zzscope");
    await userEvent.type(
      screen.getByLabelText("Percentage off", {
        selector: "input.ant-input-number-input",
      }),
      "5",
    );
    await userEvent.click(screen.getByText("Category"));
    await userEvent.click(screen.getByText("Save discount").closest("button")!);
    expect(
      await screen.findByText(/Which category.*required|required/i),
    ).toBeTruthy();
    expect(byCode("ZZSCOPE")).toBeUndefined();
  });

  it("reads a saved scope back as its kind, category first", () => {
    const db = getDb();
    expect(scopeKindOf(db, "All products")).toBe("ALL");
    expect(scopeKindOf(db, "")).toBe("ALL");
    expect(scopeKindOf(db, db.categories[0]!.name)).toBe("CATEGORY");
    expect(scopeKindOf(db, db.models[0]!.name)).toBe("PRODUCT");
  });
});
