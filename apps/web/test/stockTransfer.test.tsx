/**
 * Stock In / Stock Out by type (owner asks 2026-10-30 and 2026-11-16). The
 * type is a fixed list, and each one does its own job: Internal use writes
 * off, Stock transfer moves units keeping their status, Service is the batch
 * service form and the two returns the Returns forms — all drawn in the SAME
 * dialog since 2026-11-16, swapped in place by the type picked at the top.
 *
 * The transfer cases are the 2026-10-29 owner report (C02CK4Y2ML7J in 03
 * could not be stocked into 05), now under their own reason.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

async function openStock(direction: "IN" | "OUT") {
  render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/stock/inventory?adjust=${direction}`]}>
        <InventoryPage />
      </MemoryRouter>
    </AntdApp>,
  );
  const title = direction === "IN" ? "Stock In" : "Stock Out";
  return (
    await screen.findByText(title, { selector: ".ant-modal-title" })
  ).closest(".ant-modal") as HTMLElement;
}

/** Press a type, then the serial box is the last combobox on the grid. */
function pickReason(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("radio", { name }));
}

/** The first row's serial box — the grid's one AutoComplete. */
function serialBox(dialog: HTMLElement) {
  return dialog.querySelector<HTMLElement>(".ant-select-auto-complete input")!;
}

/** Wait for a serial to be a row of a table in the dialog. */
async function inTable(batch: HTMLElement, serial: string) {
  await vi.waitFor(() =>
    expect(
      within(
        batch.querySelector(".ant-table-tbody") as HTMLElement,
      ).getAllByText(serial).length,
    ).toBeGreaterThan(0),
  );
}

/** The dialogs on screen — one, whatever type is picked (2026-11-16). */
const openDialogs = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".ant-modal-wrap")).filter(
    (w) => w.style.display !== "none",
  );

async function pickOption(control: HTMLElement, title: string) {
  fireEvent.mouseDown(control);
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
    ).find((el) => (el.getAttribute("title") ?? "") === title);
    if (!found) throw new Error(`no option “${title}” open`);
    return found;
  });
  fireEvent.click(item);
}

describe("Stock transfer", () => {
  it.each(["TERSEDIA", "DIRESERVASI"] as const)(
    "moves a %s unit from another warehouse into this one and keeps its status",
    async (status) => {
      const db = getDb();
      const into = db.myWarehouseId;
      const unit = db.units.find(
        (u) => u.status === status && u.locationId !== into,
      );
      if (!unit) throw new Error(`seed has no ${status} unit outside ${into}`);
      const from = unit.locationId;

      const dialog = await openStock("IN");
      pickReason(dialog, "Stock transfer");
      fireEvent.change(serialBox(dialog), { target: { value: unit.serial } });
      fireEvent.click(within(dialog).getByRole("button", { name: /Log 1/ }));

      await vi.waitFor(() => {
        const after = getDb().units.find((u) => u.serial === unit.serial)!;
        expect(after.locationId).toBe(into);
        expect(after.status).toBe(status);
      });
      const last = getDb()
        .events.filter((e) => e.serial === unit.serial)
        .sort((a, b) => b.seq - a.seq)[0]!;
      expect(last.fromStatus).toBe(status);
      expect(last.toStatus).toBe(status);
      expect(last.locationId).toBe(into);
      expect(last.note).toMatch(/^Moved .* — Stock transfer/i);
      expect(from).not.toBe(into);
      const adj = getDb().adjustments.find((a) => a.serial === unit.serial)!;
      expect(
        getDb()
          .reasons.find((r) => r.id === adj.reasonId)
          ?.label.toLowerCase(),
      ).toBe("stock transfer");
    },
  );

  it("is offered from Stock out too, and keeps a reservation's status", async () => {
    const db = getDb();
    const unit = db.units.find((u) => u.status === "DIRESERVASI")!;
    const to = db.warehouses.find((w) => w.active && w.id !== unit.locationId)!;
    const into = to.id;
    const dialog = await openStock("OUT");
    pickReason(dialog, "Stock transfer");
    await pickOption(
      within(dialog).getByRole("combobox", { name: "To warehouse" }),
      to.code ? `${to.code} · ${to.name}` : to.name,
    );
    fireEvent.change(serialBox(dialog), { target: { value: unit.serial } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Log 1/ }));
    await vi.waitFor(() =>
      expect(
        getDb().units.find((u) => u.serial === unit.serial)!.locationId,
      ).toBe(into),
    );
    const after = getDb().units.find((u) => u.serial === unit.serial)!;
    expect(after.status).toBe("DIRESERVASI");
    // A transfer releases nothing.
    expect(
      getDb().reservations.some((r) =>
        r.items.some((i) => i.serial === unit.serial),
      ),
    ).toBe(true);
  });

  it("undoes the move from Stock Movement History, and the row leaves it", async () => {
    const db = getDb();
    const into = db.myWarehouseId;
    const unit = db.units.find(
      (u) => u.status === "TERSEDIA" && u.locationId !== into,
    )!;
    const from = unit.locationId;
    const dialog = await openStock("IN");
    pickReason(dialog, "Stock transfer");
    fireEvent.change(serialBox(dialog), { target: { value: unit.serial } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Log 1/ }));
    await vi.waitFor(() =>
      expect(
        getDb().units.find((u) => u.serial === unit.serial)!.locationId,
      ).toBe(into),
    );
    const adj = getDb().adjustments.find((a) => a.serial === unit.serial)!;

    fireEvent.click(
      screen.getByRole("tab", { name: /Stock Movement History/ }),
    );
    const undo = await screen.findByRole("button", {
      name: new RegExp(`Undo the movement of .*${unit.serial}`),
    });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    fireEvent.click(await screen.findByRole("button", { name: /^Undo$/ }));

    await vi.waitFor(() => {
      const after = getDb().units.find((u) => u.serial === unit.serial)!;
      expect(after.locationId).toBe(from);
      expect(after.status).toBe("TERSEDIA");
    });
    expect(getDb().adjustments.some((a) => a.id === adj.id)).toBe(false);
  });
});

describe("Internal use", () => {
  it("writes a unit off from Stock Out", async () => {
    const unit = getDb().units.find((u) => u.status === "TERSEDIA")!;
    const out = await openStock("OUT");
    pickReason(out, "Internal use");
    fireEvent.change(serialBox(out), { target: { value: unit.serial } });
    fireEvent.click(
      within(out).getByRole("button", { name: /Log 1 write-off/ }),
    );
    await vi.waitFor(() =>
      expect(getDb().units.find((u) => u.serial === unit.serial)!.status).toBe(
        "HILANG",
      ),
    );
  });

  it("is not a way into stock any more (owner, 2026-11-16)", async () => {
    const dialog = await openStock("IN");
    expect(within(dialog).queryByRole("radio", { name: "Internal use" })).toBe(
      null,
    );
  });
});

describe("an unknown serial", () => {
  /**
   * Stock In → Stock transfer with a serial nothing carries: the row asks
   * what QC asks. Comboboxes in order: To warehouse, the serial, product,
   * specs, grade. (It was Stock In → Internal use until 2026-11-16.)
   */
  async function bringIn(serial: string, grade: string | undefined) {
    const db = getDb();
    const sku = db.skus.find((s) =>
      db.units.some((u) => u.skuId === s.id && u.status === "TERSEDIA"),
    )!;
    const model = db.models.find((m) => m.id === sku.modelId)!;
    const dialog = await openStock("IN");
    pickReason(dialog, "Stock transfer");
    fireEvent.change(serialBox(dialog), { target: { value: serial } });
    await pickOption(within(dialog).getAllByRole("combobox")[2]!, model.name);
    await pickOption(
      within(dialog).getAllByRole("combobox")[3]!,
      sku.variantLabel,
    );
    if (grade)
      await pickOption(within(dialog).getAllByRole("combobox")[4]!, grade);
    fireEvent.change(
      within(dialog).getByRole("spinbutton", { name: "Sell price" }),
      { target: { value: "9000000" } },
    );
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Description / condition" }),
      { target: { value: "Mulus" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /Log 1/ }));
    return sku;
  }

  it("goes on the shelf when it has a grade, a price and a description", async () => {
    const serial = "ZZUNKNOWN01";
    const sku = await bringIn(serial, "A");
    await vi.waitFor(() =>
      expect(getDb().units.find((u) => u.serial === serial)?.status).toBe(
        "TERSEDIA",
      ),
    );
    const unit = getDb().units.find((u) => u.serial === serial)!;
    expect(unit).toMatchObject({ skuId: sku.id, grade: "A", price: 9_000_000 });
  });

  it("lands in QC when something QC asks is missing", async () => {
    const serial = "ZZUNKNOWN02";
    await bringIn(serial, undefined);
    await vi.waitFor(() =>
      expect(getDb().units.find((u) => u.serial === serial)?.status).toBe("QC"),
    );
    expect(getDb().units.find((u) => u.serial === serial)!.poId).toBeNull();
  });
});

describe("Service", () => {
  it("is the batch service form in the same dialog, and splits the courier into their cost", async () => {
    const db = getDb();
    const into = db.warehouses.find(
      (w) => w.active && w.id !== db.myWarehouseId,
    )!;
    const [a, b] = db.units.filter(
      (u) => u.status === "TERSEDIA" && u.locationId !== into.id,
    );
    const dialog = await openStock("OUT");
    // Type first, then scan — the form below swaps, the dialog stays.
    pickReason(dialog, "Send to service");
    const batch = dialog;
    expect(openDialogs()).toHaveLength(1);
    for (const u of [a!, b!]) {
      const add = within(batch).getByRole("combobox", { name: "Add a unit" });
      fireEvent.change(add, { target: { value: u.serial } });
      await inTable(batch, u.serial);
    }
    fireEvent.change(
      within(batch).getByRole("textbox", {
        name: `Description of ${a!.serial}`,
      }),
      { target: { value: "Ganti baterai" } },
    );
    fireEvent.click(within(batch).getByRole("button", { name: "Fill down" }));
    const label = into.code ? `${into.code} · ${into.name}` : into.name;
    await pickOption(
      within(batch).getByRole("combobox", { name: "Where is it serviced?" }),
      label,
    );
    fireEvent.change(
      await within(batch).findByRole("spinbutton", {
        name: "Cost of getting it there",
      }),
      { target: { value: "100001" } },
    );
    fireEvent.click(
      within(batch).getByRole("button", { name: "Send to service" }),
    );

    await vi.waitFor(() =>
      expect(
        getDb().units.filter(
          (u) =>
            [a!.serial, b!.serial].includes(u.serial) && u.status === "SERVIS",
        ),
      ).toHaveLength(2),
    );
    const visits = getDb().services.filter((v) =>
      [a!.serial, b!.serial].includes(v.serial),
    );
    expect(visits.map((v) => v.note)).toEqual([
      "Ganti baterai",
      "Ganti baterai",
    ]);
    // One courier, split evenly; the rupiah that does not divide goes first.
    expect(
      visits.map((v) => v.fees.map((f) => [f.kind, f.amount])).flat(),
    ).toEqual([
      ["SHIPPING", 50_001],
      ["SHIPPING", 50_000],
    ]);
    // No repair price is asked.
    expect(
      visits.every((v) => v.fees.every((f) => f.kind === "SHIPPING")),
    ).toBe(true);
  });

  it("keeps the courier as one shop expense when the split is off", async () => {
    const db = getDb();
    const into = db.warehouses.find(
      (w) => w.active && w.id !== db.myWarehouseId,
    )!;
    const [a, b] = db.units.filter(
      (u) => u.status === "TERSEDIA" && u.locationId !== into.id,
    );
    const dialog = await openStock("OUT");
    pickReason(dialog, "Send to service");
    const batch = dialog;
    for (const u of [a!, b!]) {
      const add = within(batch).getByRole("combobox", { name: "Add a unit" });
      fireEvent.change(add, { target: { value: u.serial } });
      await inTable(batch, u.serial);
    }
    const label = into.code ? `${into.code} · ${into.name}` : into.name;
    await pickOption(
      within(batch).getByRole("combobox", { name: "Where is it serviced?" }),
      label,
    );
    fireEvent.change(
      await within(batch).findByRole("spinbutton", {
        name: "Cost of getting it there",
      }),
      { target: { value: "80000" } },
    );
    fireEvent.click(
      await within(batch).findByRole("switch", {
        name: "Split the courier fee into each unit's cost",
      }),
    );
    fireEvent.click(
      within(batch).getByRole("button", { name: "Send to service" }),
    );

    await vi.waitFor(() =>
      expect(getDb().expenses.some((e) => e.kind === "ONGKIR")).toBe(true),
    );
    const ongkir = getDb().expenses.find((e) => e.kind === "ONGKIR")!;
    expect(ongkir).toMatchObject({ amount: 80_000, method: "TRANSFER" });
    const visits = getDb().services.filter((v) =>
      [a!.serial, b!.serial].includes(v.serial),
    );
    expect(visits.flatMap((v) => v.fees)).toEqual([]);
  });
});

describe("Return to supplier", () => {
  it("is the supplier return form, in the same dialog", async () => {
    const dialog = await openStock("OUT");
    pickReason(dialog, "Return to supplier");
    expect(
      await within(dialog).findByRole("button", {
        name: "Record supplier return",
      }),
    ).toBeInTheDocument();
    expect(openDialogs()).toHaveLength(1);
  });
});

/*
 * Owner report 2026-11-04: "the stock in stock out for multiple item did not
 * work", and the same serial appeared twice on one batch.
 */
describe("a batch of several units", () => {
  const serialBoxes = (dialog: HTMLElement) =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(".ant-select-auto-complete input"),
    );

  it("transfers two units in one batch", async () => {
    const db = getDb();
    const to = db.warehouses.find((w) => w.active)!;
    const units = db.units
      .filter((u) => u.status === "TERSEDIA" && u.locationId !== to.id)
      .slice(0, 2);
    expect(units).toHaveLength(2);
    const dialog = await openStock("OUT");
    pickReason(dialog, "Stock transfer");
    await pickOption(
      within(dialog).getByRole("combobox", { name: "To warehouse" }),
      to.code ? `${to.code} · ${to.name}` : to.name,
    );
    fireEvent.change(serialBoxes(dialog)[0]!, {
      target: { value: units[0]!.serial },
    });
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: /Add line/ })[0]!,
    );
    await vi.waitFor(() => expect(serialBoxes(dialog)).toHaveLength(2));
    fireEvent.change(serialBoxes(dialog)[1]!, {
      target: { value: units[1]!.serial },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Log 2/ }));
    await vi.waitFor(() => {
      for (const u of units)
        expect(
          getDb().units.find((x) => x.serial === u.serial)!.locationId,
        ).toBe(to.id);
    });
  });

  it("says a serial already on the batch on its own row, before Log", async () => {
    const db = getDb();
    const unit = db.units.find((u) => u.status === "TERSEDIA")!;
    const dialog = await openStock("OUT");
    pickReason(dialog, "Internal use");
    fireEvent.change(serialBoxes(dialog)[0]!, {
      target: { value: unit.serial },
    });
    fireEvent.click(
      within(dialog).getAllByRole("button", { name: /Add line/ })[0]!,
    );
    await vi.waitFor(() => expect(serialBoxes(dialog)).toHaveLength(2));
    fireEvent.change(serialBoxes(dialog)[1]!, {
      target: { value: unit.serial },
    });
    expect(
      await within(dialog).findByText(
        `${unit.serial} is already on this batch.`,
      ),
    ).toBeInTheDocument();
  });
});
