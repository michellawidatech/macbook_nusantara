/**
 * A variant's marketplace links (owner, 2026-10-28) and QC's "never serviced
 * / opened" answer — what the bot reads to send a link and to say "belum
 * pernah servis".
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ListingLinksModal,
  listingUrlProblem,
} from "../src/routes/stock/ListingLinksModal.js";
import { UnitEditModal } from "../src/routes/stock/UnitEditModal.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

describe("listingUrlProblem", () => {
  it("takes an https link or nothing, and refuses anything else", () => {
    expect(listingUrlProblem("")).toBeNull();
    expect(listingUrlProblem("https://shopee.co.id/product/1/2")).toBeNull();
    expect(listingUrlProblem("http://shopee.co.id/x")).toBe("HTTPS");
    expect(listingUrlProblem("shopee.co.id/x")).toBe("HTTPS");
    expect(listingUrlProblem(`https://${"a".repeat(500)}`)).toBe("LONG");
  });
});

describe("the Listing links dialog", () => {
  it("writes the variant's links and refuses a link that is not https", async () => {
    const sku = getDb().skus[0]!;
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ListingLinksModal skuId={sku.id} title="Air M2" onClose={onClose} />
      </AntdApp>,
    );
    const shopee = await screen.findByLabelText("Shopee");
    // Grey until something changes (2026-11-04).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(shopee);
    await userEvent.type(shopee, "shopee.co.id/x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("A link starts with https://"),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.clear(shopee);
    await userEvent.type(shopee, "https://shopee.co.id/product/1/2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(getDb().skus.find((s) => s.id === sku.id)?.shopeeUrl).toBe(
      "https://shopee.co.id/product/1/2",
    );
  });
});

describe("Edit unit", () => {
  it("records QC's never-serviced answer", async () => {
    const unit = getDb().units.find((u) => u.status === "TERSEDIA")!;
    render(
      <AntdApp>
        <UnitEditModal open unit={unit} onClose={() => undefined} />
      </AntdApp>,
    );
    // Grey until something changes (2026-11-04).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // A dropdown since 2026-11-03, not a three-way switch.
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Never serviced / opened" }),
    );
    await userEvent.click(
      (await screen.findAllByText("Never")).find((n) =>
        n.closest(".ant-select-item-option"),
      )!,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        getDb().units.find((u) => u.serial === unit.serial)?.neverServiced,
      ).toBe(true),
    );
  });
});

/**
 * Owner, 2026-11-05: the unit price / COGS is never edited directly — it comes
 * from the invoice and the service or other fees, and editing it by hand
 * broke the COGS breakdown. Edit unit shows it and offers no box for it.
 */
describe("Edit unit's COGS", () => {
  it("shows the COGS read-only, and saving leaves Unit.buy alone", async () => {
    const unit = getDb().units.find((u) => u.status === "TERSEDIA")!;
    const buy = unit.buy;
    render(
      <AntdApp>
        <UnitEditModal open unit={unit} onClose={() => undefined} />
      </AntdApp>,
    );
    const dialog = (
      await screen.findByText("Edit unit", {
        selector: ".ant-modal-title",
      })
    ).closest(".ant-modal") as HTMLElement;
    expect(within(dialog).getByText("COGS")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Unit price")).toBeNull();
    expect(within(dialog).queryByLabelText("COGS")).toBeNull();
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Never serviced / opened" }),
    );
    await userEvent.click(
      (await screen.findAllByText("Never")).find((n) =>
        n.closest(".ant-select-item-option"),
      )!,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        getDb().units.find((u) => u.serial === unit.serial)?.neverServiced,
      ).toBe(true),
    );
    expect(getDb().units.find((u) => u.serial === unit.serial)!.buy).toBe(buy);
  });
});
