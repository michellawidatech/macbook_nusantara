/**
 * The service bench, 2026-10-26: no "Bench" card, a charge paid or owed (a
 * paid one is a UNIT expense), a charge or a whole visit deleted with the
 * history rows it wrote, and *Back in stock* offering every warehouse with the
 * one the unit left as its default — the owner saw a raw `wh-04` in that box.
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicePage } from "../src/routes/stock/ServicePage.js";
import {
  appendEvent,
  currentStaffName,
  getDb,
  mutate,
  nextId,
} from "../src/mock/store.js";
import { planSendToService } from "../src/lib/serviceActions.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";

vi.setConfig({ testTimeout: 90_000 });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

/** Send a shelf unit to service at `dest` the way the dialog does, and return it. */
function sendOne(dest?: string) {
  const db = getDb();
  const unit = db.units.find(
    (u) =>
      u.status === "TERSEDIA" &&
      skuTracksSerial(db, u.skuId) &&
      !db.services.some((r) => r.serial === u.serial),
  )!;
  const before = { status: unit.status, locationId: unit.locationId };
  const events = db.events.filter((e) => e.serial === unit.serial).length;
  mutate((d) => {
    const u = d.units.find((x) => x.serial === unit.serial)!;
    const plan = planSendToService({
      unit: { serial: u.serial, locationId: u.locationId },
      dest: dest ?? u.locationId,
      raisedBy: "ADJUSTMENT",
      at: new Date().toISOString(),
      staff: currentStaffName(),
      words: {
        shipLabel: "Courier to service",
        quoteLabel: "Quoted when sent",
        eventNote: "Sent to service",
      },
      nextId,
    });
    appendEvent(d, u.serial, plan.event);
    d.services.push(plan.visit);
  });
  return { serial: unit.serial, before, events };
}

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/stock/service"]}>
        <ServicePage />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** The bench row for a serial. */
function rowOf(serial: string): HTMLElement {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".ant-table-tbody > tr.ant-table-row",
    ),
  ).find(
    (tr) =>
      tr.closest(".ant-table-expanded-row") === null &&
      (tr.textContent ?? "").includes(serial),
  );
  expect(row, serial).toBeDefined();
  return row!;
}

/** Open the row's charges. */
async function openCharges(serial: string): Promise<HTMLElement> {
  const row = rowOf(serial);
  const icon = row.querySelector<HTMLElement>(".ant-table-row-expand-icon");
  if (icon && !icon.classList.contains("ant-table-row-expand-icon-expanded"))
    fireEvent.click(icon);
  return waitFor(() => {
    const next = rowOf(serial).nextElementSibling as HTMLElement | null;
    expect(next?.classList.contains("ant-table-expanded-row")).toBe(true);
    return next!;
  });
}

async function topModal(): Promise<HTMLElement> {
  return waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-modal-wrap"),
    ).filter((w) => w.style.display !== "none");
    expect(open.length).toBeGreaterThan(0);
    return open.at(-1)!.querySelector<HTMLElement>(".ant-modal")!;
  });
}

/** Record a charge on a row through the Charge dialog. */
async function charge(serial: string, amount: string, paid?: string) {
  await userEvent.click(screen.getByLabelText(`Add a charge to ${serial}`));
  const dialog = await topModal();
  await userEvent.type(within(dialog).getByLabelText("Amount"), amount);
  if (paid) {
    await userEvent.click(
      within(
        within(dialog).getByRole("radiogroup", { name: "Paid with" }),
      ).getByText(paid),
    );
  }
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Record it" }),
  );
  await settle();
}

const visitOf = (serial: string) =>
  getDb().services.find((r) => r.serial === serial && !r.closedAt);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the service bench", () => {
  it("has no Bench card", async () => {
    sendOne();
    renderPage();
    await settle();
    expect(screen.queryByText("Bench")).toBeNull();
    expect(screen.getByText("Units away")).toBeInTheDocument();
  });

  it("pays a charge with Bank as a Unit expense, and leaves an owed one owed", async () => {
    const { serial } = sendOne();
    renderPage();
    await settle();
    await charge(serial, "800000", "Bank");
    await charge(serial, "50000");

    const [paid, owed] = visitOf(serial)!.fees;
    expect(paid).toMatchObject({ amount: 800_000, paid: true });
    expect(owed!.paid).toBeUndefined();
    const expenses = getDb().expenses.filter(
      (e) => e.serviceFeeId === paid!.id || e.serviceFeeId === owed!.id,
    );
    expect(expenses).toEqual([
      expect.objectContaining({
        kind: "UNIT",
        amount: 800_000,
        method: "TRANSFER",
        serviceFeeId: paid!.id,
        note: `${serial} · Labour`,
      }),
    ]);

    // The owed one says so, and Mark paid writes its expense.
    const lines = await openCharges(serial);
    expect(within(lines).getByText("Paid · Bank")).toBeInTheDocument();
    expect(within(lines).getByText("Not paid")).toBeInTheDocument();
    await userEvent.click(
      within(lines).getByLabelText(
        `Mark the Rp 50.000 charge on ${serial} paid`,
      ),
    );
    const dialog = await topModal();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mark paid" }),
    );
    await settle();
    expect(
      getDb().expenses.find((e) => e.serviceFeeId === owed!.id),
    ).toMatchObject({ kind: "UNIT", amount: 50_000, method: "TRANSFER" });
    expect(visitOf(serial)!.fees[1]!.paid).toBe(true);
  });

  it("moves a paid charge's expense with its amount, and takes it back on Not paid yet", async () => {
    const { serial } = sendOne();
    renderPage();
    await settle();
    await charge(serial, "800000", "Cash");
    const fee = visitOf(serial)!.fees[0]!;

    let lines = await openCharges(serial);
    await userEvent.click(
      within(lines).getByLabelText(`Change the Rp 800.000 charge on ${serial}`),
    );
    let dialog = await topModal();
    const amount = within(dialog).getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "650000");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save the change" }),
    );
    await settle();
    expect(
      getDb().expenses.find((e) => e.serviceFeeId === fee.id),
    ).toMatchObject({ amount: 650_000, method: "TUNAI" });

    lines = await openCharges(serial);
    await userEvent.click(
      within(lines).getByLabelText(`Change the Rp 650.000 charge on ${serial}`),
    );
    dialog = await topModal();
    await userEvent.click(
      within(
        within(dialog).getByRole("radiogroup", { name: "Paid with" }),
      ).getByText("Not paid yet"),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save the change" }),
    );
    await settle();
    expect(
      getDb().expenses.find((e) => e.serviceFeeId === fee.id),
    ).toBeUndefined();
    expect(visitOf(serial)!.fees[0]!.paid).toBeUndefined();
  });

  it("deletes a charge with its expense and its timeline line", async () => {
    const { serial } = sendOne();
    renderPage();
    await settle();
    await charge(serial, "300000", "Other bank");
    const fee = visitOf(serial)!.fees[0]!;
    const note = getDb().events.find(
      (e) => e.serial === serial && e.at === fee.at && e.type === "DICATAT",
    )!;
    expect(note).toBeDefined();

    const lines = await openCharges(serial);
    await userEvent.click(
      within(lines).getByLabelText(`Delete the Rp 300.000 charge on ${serial}`),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    await settle();

    expect(visitOf(serial)!.fees).toEqual([]);
    expect(getDb().expenses.some((e) => e.serviceFeeId === fee.id)).toBe(false);
    expect(getDb().events.some((e) => e.id === note.id)).toBe(false);
    // Still at service: deleting a charge is not taking the unit back.
    expect(getDb().units.find((u) => u.serial === serial)!.status).toBe(
      "SERVIS",
    );
  });

  it("deletes a whole visit behind the serial typed back, and the unit is as it was", async () => {
    const other = getDb().warehouses.find(
      (w) =>
        w.active &&
        w.id !== getDb().units.find((u) => u.status === "TERSEDIA")!.locationId,
    )!;
    const { serial, before, events } = sendOne(other.id);
    renderPage();
    await settle();
    await charge(serial, "200000", "Bank");
    const fee = visitOf(serial)!.fees[0]!;

    await userEvent.click(
      screen.getByLabelText(`Delete the service visit of ${serial}`),
    );
    const dialog = await topModal();
    const ok = within(dialog).getByRole("button", { name: "Delete the visit" });
    expect(ok).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText("Serial, to confirm"),
      serial.toLowerCase(),
    );
    expect(ok).toBeEnabled();
    await userEvent.click(ok);
    await settle();

    const db = getDb();
    expect(db.services.some((r) => r.serial === serial && !r.closedAt)).toBe(
      false,
    );
    expect(db.expenses.some((e) => e.serviceFeeId === fee.id)).toBe(false);
    const unit = db.units.find((u) => u.serial === serial)!;
    expect(unit.status).toBe(before.status);
    expect(unit.locationId).toBe(before.locationId);
    expect(db.events.filter((e) => e.serial === serial)).toHaveLength(events);
  });

  it("refuses to delete a visit the unit has moved on from", async () => {
    const { serial } = sendOne();
    // Something else happened to it at service — a note nobody wrote here.
    mutate((d) => {
      appendEvent(d, serial, { type: "DICATAT", note: "Price 9.000.000" });
    });
    renderPage();
    await settle();
    await userEvent.click(
      screen.getByLabelText(`Delete the service visit of ${serial}`),
    );
    const dialog = await topModal();
    await userEvent.type(
      within(dialog).getByLabelText("Serial, to confirm"),
      serial,
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete the visit" }),
    );
    await settle();
    expect(visitOf(serial)).toBeDefined();
    expect(
      await screen.findByText(/has moved on since this visit/),
    ).toBeInTheDocument();
  });

  it("offers every warehouse to come back to, the one it left by default — named, never its id", async () => {
    // Sent from the warehouse whose kind is SERVIS: the shop's 04 is one.
    const bench = getDb().warehouses.find((w) => w.kind === "SERVIS")!;
    const { serial } = sendOne();
    mutate((d) => {
      const i = d.services.findIndex((r) => r.serial === serial && !r.closedAt);
      d.services[i] = { ...d.services[i]!, fromLocationId: bench.id };
    });
    renderPage();
    await settle();
    await userEvent.click(screen.getByLabelText(`Put ${serial} back in stock`));
    const dialog = await topModal();
    const label = bench.code ? `${bench.code} · ${bench.name}` : bench.name;
    expect(within(dialog).getByText(label)).toBeInTheDocument();
    expect(within(dialog).queryByText(bench.id)).toBeNull();

    fireEvent.mouseDown(within(dialog).getByLabelText("Which warehouse"));
    const offered = await waitFor(() => {
      const titles = Array.from(
        document.querySelectorAll<HTMLElement>(".ant-select-item-option"),
      ).map((el) => el.getAttribute("title"));
      expect(titles.length).toBeGreaterThan(0);
      return titles;
    });
    expect(offered).toHaveLength(
      getDb().warehouses.filter((w) => w.active).length,
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Back in stock" }),
    );
    await settle();
    const unit = getDb().units.find((u) => u.serial === serial)!;
    expect(unit).toMatchObject({ status: "TERSEDIA", locationId: bench.id });
  });
});
