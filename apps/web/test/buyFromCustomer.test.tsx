/**
 * Inbound → Trade-in → "+ Trade-in": buying a unit from a customer with no
 * sale (owner answers 2026-10-31 — a document of its own, name and phone
 * required, paid in full on the spot, and the transfer's reference kept).
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InboundPage } from "../src/routes/inbound/InboundPage.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 90_000 });

function renderList() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/inbound"]}>
        <InboundPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** The dialog opened last — antd leaves closed ones in the DOM. */
async function lastDialog() {
  const all = await screen.findAllByRole("dialog");
  return within(all[all.length - 1]!);
}

/** Pick an antd Select option by its title (see tillPage.test.tsx). */
async function chooseOption(control: HTMLElement, option: string) {
  fireEvent.mouseDown(control);
  fireEvent.change(control, { target: { value: option } });
  const item = await vi.waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      ),
    );
    const found = Array.from(
      open[open.length - 1]?.querySelectorAll<HTMLElement>(
        ".ant-select-item-option",
      ) ?? [],
    ).find((el) => el.getAttribute("title") === option);
    if (!found) throw new Error(`no option “${option}” open`);
    return found;
  });
  fireEvent.click(item);
}

/** A variant whose category is tracked by serial. */
function trackedSku() {
  const db = getDb();
  return db.skus.find((s) =>
    db.categories.some(
      (c) =>
        c.tracksSerial &&
        c.name === db.models.find((m) => m.id === s.modelId)?.category,
    ),
  )!;
}

describe("buying a unit from a customer", () => {
  it("records the seller, the unit on the shelf, and one expense with its reference", async () => {
    const sku = trackedSku();
    renderList();
    await userEvent.click(screen.getByRole("tab", { name: /^Trade-in/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Trade-in/ }),
    );
    let d = await lastDialog();
    expect(d.getByText("Buy from a customer")).toBeInTheDocument();

    // The person is required: name AND phone.
    await userEvent.click(
      d.getByRole("button", { name: "Record the purchase" }),
    );
    expect(
      await screen.findByText("Type the seller's name and phone number."),
    ).toBeInTheDocument();
    await userEvent.type(d.getByLabelText("Name"), "Abdul Basid");
    await userEvent.type(d.getByLabelText("Phone number"), "0812 7788 0001");

    // The unit, asked exactly what the till's trade-in asks.
    await userEvent.click(d.getByRole("button", { name: /Add a unit/ }));
    const unit = await lastDialog();
    await chooseOption(unit.getByLabelText(/^Product/), sku.code);
    await chooseOption(unit.getByLabelText("Grade"), "A");
    await userEvent.type(unit.getByLabelText(/Serial/), "C6YMFXL6QW");
    await userEvent.type(unit.getByLabelText(/Description/), "Fullset{enter}");
    await userEvent.click(unit.getByLabelText(/Price/));
    await userEvent.paste("27000000");
    await userEvent.click(unit.getByRole("button", { name: "Add it" }));

    d = within(
      screen
        .getByText("Buy from a customer")
        .closest(".ant-modal") as HTMLElement,
    );
    await userEvent.type(
      d.getByLabelText("Paid to"),
      "BCA 0671705342 · Abdul Basid",
    );
    await userEvent.type(d.getByLabelText("Transfer reference"), "TRF-99");
    await userEvent.click(
      d.getByRole("button", { name: "Record the purchase" }),
    );

    const db = getDb();
    const purchase = db.customerPurchases[0]!;
    const seller = db.customers.find((c) => c.id === purchase.customerId)!;
    expect(seller).toMatchObject({
      name: "Abdul Basid",
      phone: "0812 7788 0001",
    });
    expect(purchase.code).toMatch(/^BP-/);
    expect(purchase.items).toMatchObject([
      { skuId: sku.id, serial: "C6YMFXL6QW", value: 27_000_000, qty: 1 },
    ]);
    // QC was taken in the dialog: straight onto the shelf.
    expect(db.units.find((u) => u.serial === "C6YMFXL6QW")).toMatchObject({
      status: "TERSEDIA",
      buy: 27_000_000,
      poId: null,
    });
    // One expense, the money that went to the seller.
    expect(
      db.expenses
        .filter((e) => e.customerPurchaseId === purchase.id)
        .map((e) => [e.kind, e.amount, e.method, e.note, e.ref]),
    ).toEqual([
      [
        "TUKAR_TAMBAH",
        27_000_000,
        "TRANSFER",
        "BCA 0671705342 · Abdul Basid",
        "TRF-99",
      ],
    ]);
    // …and the Trade-in tab lists it.
    expect(await screen.findByText(purchase.code)).toBeInTheDocument();
  });
});
