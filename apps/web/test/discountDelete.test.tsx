/**
 * Deleting a discount (owner decision 2026-10-02): one no sale has redeemed
 * goes, behind a confirm; one that has been used stays on record and its
 * button is drawn disabled, pointing at the switch instead.
 */
import { App as AntdApp } from "antd";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscountsPage } from "../src/routes/discounts/DiscountsPage.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

function renderList() {
  render(
    <AntdApp>
      <MemoryRouter>
        <DiscountsPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

const has = (id: string) => getDb().discounts.some((d) => d.id === id);

beforeEach(() => {
  localStorage.clear();
  mutate((d) => {
    d.discounts = d.discounts.filter((x) => !x.id.startsWith("d-zz-del"));
    d.discounts.unshift(
      {
        id: "d-zz-del-unused",
        code: "ZZUNUSED",
        name: "Never used",
        type: "NOMINAL",
        amountRp: 100_000,
        used: 0,
        active: true,
        scope: "All products",
      },
      {
        id: "d-zz-del-used",
        code: "ZZUSED",
        name: "Used once",
        type: "NOMINAL",
        amountRp: 100_000,
        used: 1,
        active: true,
        scope: "All products",
      },
    );
  });
});

describe("deleting a discount", () => {
  it("removes one nobody has used, after the confirm", async () => {
    renderList();
    await userEvent.click(
      screen.getByRole("button", { name: /Delete Never used/ }),
    );
    const confirm = await screen.findByRole("tooltip", {
      name: /Delete Never used\?/,
    });
    expect(has("d-zz-del-unused")).toBe(true);
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Delete" }),
    );
    expect(has("d-zz-del-unused")).toBe(false);
    expect(has("d-zz-del-used")).toBe(true);
  });

  it("keeps one a sale has redeemed, with its button disabled", () => {
    renderList();
    expect(
      screen.getByRole("button", { name: /Delete Used once/ }),
    ).toBeDisabled();
  });

  it("counts a sale carrying the code even when the counter says zero", () => {
    mutate((d) => {
      d.orders[0]!.discountId = "d-zz-del-unused";
    });
    try {
      renderList();
      expect(
        screen.getByRole("button", { name: /Delete Never used/ }),
      ).toBeDisabled();
    } finally {
      mutate((d) => {
        delete d.orders[0]!.discountId;
      });
    }
  });
});
