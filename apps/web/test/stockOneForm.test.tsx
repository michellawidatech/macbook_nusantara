/**
 * Stock In / Stock Out as ONE form each (owner ask 2026-11-16): the type is
 * picked at the top and the form below changes in place — no second dialog
 * ever opens. Stock Out is Internal use, Send to service, Return to supplier
 * and Stock transfer; Stock In is Stock transfer, Return from customer and
 * Back from service.
 *
 * The forms themselves are the ones every other door uses, so their rules are
 * reviewed in their own files (`supplierReturnModal.test.tsx`,
 * `customerReturn.test.tsx`, `serviceBatchMany.test.tsx`, …). What is checked
 * here is that each still writes what it wrote from inside this dialog, and
 * that switching type keeps what was typed.
 */
import { App as AntdApp } from "antd";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";

vi.setConfig({ testTimeout: 120_000 });

function renderPage(path = "/stock/inventory") {
  render(
    <AntdApp>
      <MemoryRouter initialEntries={[path]}>
        <InventoryPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

async function openStock(direction: "IN" | "OUT"): Promise<HTMLElement> {
  renderPage(`/stock/inventory?adjust=${direction}`);
  return dialogTitled(direction === "IN" ? "Stock In" : "Stock Out");
}

async function dialogTitled(title: string): Promise<HTMLElement> {
  return (
    await screen.findByText(title, { selector: ".ant-modal-title" })
  ).closest(".ant-modal") as HTMLElement;
}

/** The dialogs on screen. One, whatever type is picked. */
const openDialogs = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".ant-modal-wrap")).filter(
    (w) => w.style.display !== "none",
  );

const pickType = (dialog: HTMLElement, name: string) =>
  fireEvent.click(within(dialog).getByRole("radio", { name }));

/** The batch grid's first serial box (Internal use / Stock transfer). */
const batchSerial = (dialog: HTMLElement) =>
  dialog.querySelector<HTMLInputElement>(
    ".ant-modal-body > form .ant-select-auto-complete input",
  );

/** Pick an antd Select option by its title (portalled list). */
async function chooseOption(
  control: HTMLElement,
  option: string,
  { search = false, startsWith = false } = {},
) {
  fireEvent.mouseDown(control);
  if (search) fireEvent.change(control, { target: { value: option } });
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
    ).find((el) => {
      const title = el.getAttribute("title") ?? "";
      return startsWith ? title.startsWith(option) : title === option;
    });
    if (!found) throw new Error(`no option “${option}” open`);
    return found;
  });
  fireEvent.click(item);
}

/** Add a unit to the service form by its serial, as a scan would. */
async function addToService(dialog: HTMLElement, serial: string) {
  fireEvent.change(
    within(dialog).getByRole("combobox", { name: "Add a unit" }),
    { target: { value: serial } },
  );
  await vi.waitFor(() =>
    expect(
      within(
        dialog.querySelector(".ant-table-tbody") as HTMLElement,
      ).getAllByText(serial).length,
    ).toBeGreaterThan(0),
  );
}

const statusOf = (serial: string) =>
  getDb().units.find((u) => u.serial === serial)!.status;

describe("the buttons", () => {
  it("read Stock In and Stock Out as words on a phone, not a float fan", async () => {
    // test/setup.ts answers "no" to every media query: this IS the phone.
    renderPage();
    // By text, not by role: a page-wide role query over Inventory's phone
    // cards takes minutes.
    const stockIn = (await screen.findByText("Stock In")).closest("button")!;
    expect(stockIn).not.toBeNull();
    expect(screen.getByText("Stock Out").closest("button")).not.toBeNull();
    // No float fan: nothing on this page is behind one any more.
    expect(screen.queryByLabelText("Page actions")).toBeNull();
    fireEvent.click(stockIn);
    expect(await dialogTitled("Stock In")).toBeInTheDocument();
  });
});

describe("switching type", () => {
  it("swaps the form in place, keeping each type's draft", async () => {
    const [a, b] = getDb().units.filter((u) => u.status === "TERSEDIA");
    const dialog = await openStock("OUT");
    expect(openDialogs()).toHaveLength(1);

    pickType(dialog, "Internal use");
    fireEvent.change(batchSerial(dialog)!, { target: { value: a!.serial } });
    expect(
      within(dialog).getByRole("button", { name: /Log 1 write-off/ }),
    ).toBeInTheDocument();

    pickType(dialog, "Send to service");
    expect(openDialogs()).toHaveLength(1);
    expect(batchSerial(dialog)).toBeNull();
    // The footer is the service form's now.
    expect(within(dialog).queryByRole("button", { name: /Log/ })).toBeNull();
    await addToService(dialog, b!.serial);
    expect(
      within(dialog).getByRole("button", { name: "Send to service" }),
    ).toBeInTheDocument();

    pickType(dialog, "Internal use");
    expect(openDialogs()).toHaveLength(1);
    await vi.waitFor(() => expect(batchSerial(dialog)!.value).toBe(a!.serial));
    expect(
      within(dialog).queryByRole("button", { name: "Send to service" }),
    ).toBeNull();

    pickType(dialog, "Send to service");
    expect(
      within(dialog).getByLabelText(`Description of ${b!.serial}`),
    ).toBeInTheDocument();
    // Nothing was written by any of it.
    expect(statusOf(a!.serial)).toBe("TERSEDIA");
    expect(statusOf(b!.serial)).toBe("TERSEDIA");
    expect(
      screen.getAllByText("Stock Out", { selector: ".ant-modal-title" }),
    ).toHaveLength(1);
  });
});

describe("each type writes what it wrote before", () => {
  it("sends a unit to service, then brings it back to QC", async () => {
    const unit = getDb().units.find(
      (u) => u.status === "TERSEDIA" && skuTracksSerial(getDb(), u.skuId),
    )!;
    const out = await openStock("OUT");
    pickType(out, "Send to service");
    await addToService(out, unit.serial);
    fireEvent.click(
      within(out).getByRole("button", { name: "Send to service" }),
    );
    await vi.waitFor(() => expect(statusOf(unit.serial)).toBe("SERVIS"));
    cleanup();

    const back = await openStock("IN");
    pickType(back, "Back from service");
    await addToService(back, unit.serial);
    fireEvent.change(
      within(back).getByLabelText(`Repair cost of ${unit.serial}`),
      { target: { value: "150000" } },
    );
    fireEvent.click(
      within(back).getByRole("button", { name: /^Back in stock/ }),
    );
    await vi.waitFor(() => expect(statusOf(unit.serial)).toBe("QC"));
    const visit = getDb().services.find((v) => v.serial === unit.serial)!;
    expect(visit.fees.map((f) => [f.kind, f.amount])).toContainEqual([
      "LABOUR",
      150_000,
    ]);
  });

  it("returns a unit to its supplier", async () => {
    const db = getDb();
    const unit = db.units.find(
      (u) =>
        u.status === "TERSEDIA" &&
        u.poId != null &&
        u.buy > 0 &&
        skuTracksSerial(db, u.skuId) &&
        !db.returns.some((r) => r.serial === u.serial) &&
        db.pos.some((p) => p.id === u.poId),
    )!;
    // An unpaid invoice: rule C takes the credit off it and asks nothing
    // about a refund (supplierReturnModal.test.tsx covers the refund half).
    mutate((d) => {
      d.pos.find((p) => p.id === unit.poId)!.payments = [];
    });
    const dialog = await openStock("OUT");
    pickType(dialog, "Return to supplier");
    await chooseOption(
      within(dialog).getByRole("combobox", { name: "Unit in inventory" }),
      unit.serial,
      { search: true, startsWith: true },
    );
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Dead pixel" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record supplier return" }),
    );
    await vi.waitFor(() =>
      expect(statusOf(unit.serial)).toBe("RETUR_SUPPLIER"),
    );
    expect(
      getDb().returns.find(
        (r) => r.serial === unit.serial && r.kind === "SUPPLIER",
      ),
    ).toMatchObject({ status: "DONE", expectedCredit: unit.buy });
  });

  it("takes a unit back from a customer", async () => {
    const unit = getDb().units.find((u) => u.status === "TERSEDIA")!;
    const price = 5_000_000;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === unit.serial)!;
      u.status = "TERJUAL";
      d.orders.unshift({
        id: "o-stock-one-form",
        code: "SI-2026/11-990901",
        ts: "2026-11-10T03:00:00.000Z",
        customerId: null,
        serials: [unit.serial],
        prices: { [unit.serial]: price },
        discount: 0,
        source: "OFFLINE",
        payMethod: "TUNAI",
        settled: true,
        payments: [
          {
            id: "pay-stock-one-form",
            method: "TUNAI",
            amount: price,
            state: "SETTLED",
            at: "2026-11-10T03:00:00.000Z",
          },
        ],
        total: price,
      });
    });

    const dialog = await openStock("IN");
    pickType(dialog, "Return from customer");
    await userEvent.type(
      within(dialog).getByLabelText("Transaction number"),
      `${unit.serial}{Enter}`,
    );
    // The return's own unit picker — inline in that form, as on Returns.
    await userEvent.click(
      await screen.findByRole("button", { name: /^Add \d+ units?$/ }),
    );
    const reason = getDb().reasons.find(
      (r) => r.activity === "RETURN_CUSTOMER" && r.active,
    )!;
    await chooseOption(within(dialog).getByLabelText("Reason"), reason.label, {
      search: true,
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record return" }),
    );
    await vi.waitFor(() => expect(statusOf(unit.serial)).toBe("TERSEDIA"));
    expect(
      getDb().returns.some(
        (r) => r.kind === "CUSTOMER" && r.serial === unit.serial,
      ),
    ).toBe(true);
  });
});
