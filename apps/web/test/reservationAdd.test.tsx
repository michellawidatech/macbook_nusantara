/**
 * Staff's *Add reservation* (owner ask 2026-11-13): name or phone, a date, a
 * PRODUCT with its stock, and the DP prefilled from Settings → DP.
 */
import { App as AntdApp } from "antd";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationsPage } from "../src/routes/reservations/ReservationsPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import {
  headerState,
  isVisit,
  reprojectHolds,
  softHolds,
} from "../src/lib/reservations.js";
import { dpStage, recordDpBlock } from "../src/lib/dp.js";
import { isLiveSku } from "../src/lib/skuCode.js";
import { pressPageAction } from "./pageActions.js";
import type { Reservation } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/reservations"]}>
        <ReservationsPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

async function dialog() {
  const all = await screen.findAllByRole("dialog");
  return all[all.length - 1]!;
}

/** Pick an antd Select option by its title. */
async function chooseOption(control: HTMLElement, option: string) {
  fireEvent.mouseDown(control);
  fireEvent.change(control, { target: { value: option } });
  const item = await waitFor(() => {
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
  return item;
}

/** A live tracked variant with at least one unit on the shelf, and its count. */
function aStockedVariant() {
  const db = getDb();
  const reserved = softHolds(db);
  const counts = new Map<string, number>();
  for (const u of db.units)
    if (u.status === "TERSEDIA" && !reserved.has(u.serial))
      counts.set(u.skuId, (counts.get(u.skuId) ?? 0) + 1);
  const sku = db.skus.find((s) => isLiveSku(s) && (counts.get(s.id) ?? 0) > 0)!;
  return {
    sku,
    label: `${sku.name} ${sku.variantLabel}`.trim(),
    count: counts.get(sku.id)!,
  };
}

const newest = (before: readonly string[]) =>
  getDb().reservations.find((r) => !before.includes(r.id));

let before: string[] = [];
beforeEach(() => {
  before = getDb().reservations.map((r) => r.id);
});

describe("Add reservation", () => {
  it("reserves a product for a phone number with the DP prefilled, recorded as Record DP records it", async () => {
    const { sku, label, count } = aStockedVariant();
    const statuses = getDb().units.map((u) => `${u.serial}:${u.status}`);
    renderPage();
    await settle();
    pressPageAction("Add reservation");
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText("Phone"), "+6281200001111");
    const option = await chooseOption(
      within(d).getByRole("combobox", { name: "Product" }),
      label,
    );
    // The picker says how many are on the shelf, and no serial.
    expect(option).toHaveTextContent(`${count} in stock`);
    await userEvent.click(within(d).getByRole("button", { name: "Reserve" }));
    await settle();

    const r = newest(before)!;
    expect(r).toBeDefined();
    expect(r.items).toEqual([{ id: expect.any(String), skuId: sku.id }]);
    expect(r.dp).toMatchObject({ amount: 500_000, method: "TRANSFER" });
    expect(r.heldUntil).toBeDefined();
    expect(r.status).toBe("ACTIVE");
    const customer = getDb().customers.find((c) => c.id === r.customerId)!;
    expect(customer.phone).toBe("+6281200001111");
    // A product holds no unit: nothing on the shelf moved.
    expect(getDb().units.map((u) => `${u.serial}:${u.status}`)).toEqual(
      statuses,
    );
    // The row reads as the product, any unit.
    await waitFor(() =>
      expect(screen.getAllByText("Any unit").length).toBeGreaterThan(0),
    );
    // Nothing is held, so it is sold by picking a unit at the till.
    expect(
      screen.getByRole("button", { name: `Sell ${r.code} at the till` }),
    ).toBeInTheDocument();
  });

  it("takes a name alone and a DP of 0 as a reservation without one", async () => {
    const { label } = aStockedVariant();
    renderPage();
    await settle();
    pressPageAction("Add reservation");
    const d = await dialog();
    await userEvent.type(within(d).getByLabelText("Name"), "Budi Santoso");
    const dp = within(d).getByLabelText("DP amount");
    await userEvent.clear(dp);
    await userEvent.type(dp, "0");
    await chooseOption(
      within(d).getByRole("combobox", { name: "Product" }),
      label,
    );
    await userEvent.click(within(d).getByRole("button", { name: "Reserve" }));
    await settle();
    const r = newest(before)!;
    expect(r.dp).toBeUndefined();
    expect(r.heldUntil).toBeUndefined();
    expect(getDb().customers.find((c) => c.id === r.customerId)).toMatchObject({
      name: "Budi Santoso",
      phone: "",
    });
  });

  it("refuses a reservation with neither a name nor a phone number", async () => {
    const { label } = aStockedVariant();
    renderPage();
    await settle();
    pressPageAction("Add reservation");
    const d = await dialog();
    await chooseOption(
      within(d).getByRole("combobox", { name: "Product" }),
      label,
    );
    await userEvent.click(within(d).getByRole("button", { name: "Reserve" }));
    await settle();
    expect(
      await within(d).findByText("Type a name or a phone number."),
    ).toBeInTheDocument();
    expect(newest(before)).toBeUndefined();
  });
});

describe("a reservation of products", () => {
  const rsv = (over: Partial<Reservation> = {}): Reservation => ({
    id: "rsv-prod-1",
    code: "RV-2026/11-000901",
    customerId: getDb().customers[0]!.id,
    when: "2026-11-20T07:00:00.000Z",
    note: "",
    items: [{ id: "rsvi-p1", skuId: getDb().skus[0]!.id }],
    status: "ACTIVE",
    ...over,
  });

  it("holds no unit, so it is a visit to every unit rule and no projection closes it", () => {
    const r = rsv();
    expect(isVisit(r)).toBe(true);
    expect(headerState(getDb(), r)).toBe("ACTIVE");
    mutate((d) => {
      d.reservations.push(rsv({ id: "rsv-prod-2" }));
      reprojectHolds(d);
    });
    expect(
      getDb().reservations.find((x) => x.id === "rsv-prod-2")!.status,
    ).toBe("ACTIVE");
    expect(recordDpBlock(getDb(), r)).toBeUndefined();
  });

  it("keeps its DP until heldUntil, then asks for the decision", () => {
    const dp = {
      id: "pay-p1",
      method: "TRANSFER",
      amount: 500_000,
      at: "2026-11-13T01:00:00.000Z",
    };
    const r = rsv({ dp, heldUntil: "2026-11-20T01:00:00.000Z" });
    expect(dpStage(getDb(), r, new Date("2026-11-15T00:00:00.000Z"))).toBe(
      "HOLDING",
    );
    expect(dpStage(getDb(), r, new Date("2026-11-21T00:00:00.000Z"))).toBe(
      "DECIDE",
    );
  });
});
