/**
 * A variant's marketplace links (owner, 2026-10-28) and QC's "never serviced
 * / opened" answer — what the bot reads to send a link and to say "belum
 * pernah servis".
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor } from "@testing-library/react";
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
    await userEvent.click(await screen.findByText("Never"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        getDb().units.find((u) => u.serial === unit.serial)?.neverServiced,
      ).toBe(true),
    );
  });
});
