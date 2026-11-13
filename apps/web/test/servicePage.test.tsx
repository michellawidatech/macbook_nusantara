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
import { pressPageAction } from "./pageActions.js";

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
      // The unit rows sit inside their batch's row since 2026-11-10; the
      // unit's own row is the one holding no table of its own.
      tr.querySelector(".ant-table") === null &&
      (tr.textContent ?? "").includes(serial),
  );
  expect(row, serial).toBeDefined();
  return row!;
}

/**
 * Open the popup of the batch holding a serial (2026-11-11) — through the
 * row's Details since 2026-11-13, when a click on the row itself went
 * straight to Back in stock.
 */
async function openBatch(serial: string): Promise<HTMLElement> {
  const row = await waitFor(() => {
    const tr = document.querySelector<HTMLElement>(
      `tr[data-serials~="${serial}"]`,
    );
    expect(tr, serial).not.toBeNull();
    return tr!;
  });
  fireEvent.click(
    within(row).queryByRole("button", { name: /^Details of the batch/ }) ?? row,
  );
  return topModal();
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
    await openBatch(serial);
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
        // Filed as Back in stock files a repair (2026-11-13): the dialog
        // asks only the amount and how it was paid.
        note: `${serial} · Repair`,
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
    await openBatch(serial);
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
    await openBatch(serial);
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
    await openBatch(serial);
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
    await openBatch(serial);
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
    // Straight from the bench's row, without opening the batch (2026-11-13).
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
    // Nothing goes back until its repair cost is typed — 0 for a free one.
    const ok = within(dialog).getByRole("button", { name: "Back in stock" });
    expect(ok).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Repair cost"), "0");
    await userEvent.click(ok);
    await settle();
    expect(getDb().services.find((r) => r.serial === serial)!.fees).toEqual([]);
    const unit = getDb().units.find((u) => u.serial === serial)!;
    // Back to QC for a re-check, not onto the shelf (2026-11-04).
    expect(unit).toMatchObject({ status: "QC", locationId: bench.id });
  });
});

describe("Add to service (2026-11-10)", () => {
  it("picks units from the list, sends them as one batch, and groups them on the bench", async () => {
    renderPage();
    await settle();
    const db = getDb();
    const free = db.units.filter(
      (u) =>
        u.status === "TERSEDIA" &&
        skuTracksSerial(db, u.skuId) &&
        !db.services.some((r) => r.serial === u.serial),
    );
    // Two from ONE warehouse, so they are one batch.
    const home = free.find((u) =>
      free.some((v) => v !== u && v.locationId === u.locationId),
    )!.locationId;
    const picks = free.filter((u) => u.locationId === home).slice(0, 2);
    pressPageAction("Add to service");
    const send = await topModal();
    await userEvent.click(
      within(send).getByRole("button", { name: /Choose from list/ }),
    );
    const picker = await topModal();
    for (const u of picks) {
      const search = within(picker).getByLabelText(
        "Search serial, product or invoice",
      );
      await userEvent.clear(search);
      await userEvent.type(search, u.serial);
      await userEvent.click(within(picker).getByText(u.serial));
    }
    await userEvent.click(
      within(picker).getByRole("button", { name: "Add 2 unit(s)" }),
    );
    await waitFor(() => {
      for (const u of picks)
        expect(within(send).getByText(u.serial)).toBeInTheDocument();
    });
    await userEvent.click(
      within(send).getByRole("button", { name: "Send to service" }),
    );
    await settle();
    const visits = picks.map((u) => visitOf(u.serial)!);
    expect(visits.every(Boolean)).toBe(true);
    expect(visits[0]!.openedAt).toBe(visits[1]!.openedAt);
    // One batch row, and its popup lists both units.
    const popup = await openBatch(picks[0]!.serial);
    for (const u of picks)
      expect(within(popup).getByText(u.serial)).toBeInTheDocument();
  });

  it("names the batch when it is sent, shows it on the bench, and renames every visit from the popup", async () => {
    const db = getDb();
    const u = db.units.find(
      (x) =>
        x.status === "TERSEDIA" &&
        skuTracksSerial(db, x.skuId) &&
        !db.services.some((r) => r.serial === x.serial),
    )!;
    renderPage();
    await settle();
    pressPageAction("Add to service");
    const send = await topModal();
    await userEvent.type(
      within(send).getByLabelText("Batch name"),
      "Screens to Budi",
    );
    await userEvent.type(
      within(send).getByLabelText("Add a unit"),
      `${u.serial}{Enter}`,
    );
    await userEvent.click(
      within(send).getByRole("button", { name: "Send to service" }),
    );
    await settle();
    expect(visitOf(u.serial)!.title).toBe("Screens to Budi");
    expect(screen.getByText("Screens to Budi")).toBeInTheDocument();

    const popup = await openBatch(u.serial);
    const title = within(popup).getByLabelText("Batch name");
    await userEvent.clear(title);
    await userEvent.type(title, "Keyboards{Enter}");
    await settle();
    expect(visitOf(u.serial)!.title).toBe("Keyboards");
  });
});

describe("Back in stock from a batch (2026-11-11)", () => {
  it("asks each unit's repair cost, fills down, and brings back only the costed rows", async () => {
    const db = getDb();
    const free = db.units.filter(
      (u) =>
        u.status === "TERSEDIA" &&
        skuTracksSerial(db, u.skuId) &&
        !db.services.some((r) => r.serial === u.serial),
    );
    const home = free.find(
      (u) => free.filter((v) => v.locationId === u.locationId).length >= 3,
    )!.locationId;
    const picks = free.filter((u) => u.locationId === home).slice(0, 3);
    const at = new Date().toISOString();
    mutate((d) => {
      for (const p of picks) {
        const plan = planSendToService({
          unit: { serial: p.serial, locationId: p.locationId },
          dest: p.locationId,
          raisedBy: "ADJUSTMENT",
          at,
          staff: currentStaffName(),
          title: "Repair run",
          words: { shipLabel: "c", quoteLabel: "q", eventNote: "Sent" },
          nextId,
        });
        appendEvent(d, p.serial, plan.event);
        d.services.push(plan.visit);
      }
    });
    renderPage();
    await settle();
    const popup = await openBatch(picks[0]!.serial);
    // The popup's one green button; a unit's row carries no Back in stock.
    expect(
      within(popup).queryByLabelText(`Put ${picks[0]!.serial} back in stock`),
    ).toBeNull();
    await userEvent.click(
      within(popup).getByText("Back in stock (3)").closest("button")!,
    );
    const back = await topModal();
    // The batch's units and nothing to edit about the list: no add box, no
    // per-unit description (2026-11-13).
    expect(within(back).queryByLabelText("Add a unit")).toBeNull();
    expect(
      within(back).queryByLabelText(`Description of ${picks[0]!.serial}`),
    ).toBeNull();
    const ok = within(back).getByText("Back in stock (0)").closest("button")!;
    expect(ok).toBeDisabled();
    // Only the second and third get a cost: the second typed, then filled down.
    await userEvent.type(
      within(back).getByLabelText(`Repair cost of ${picks[1]!.serial}`),
      "150000",
    );
    expect(ok).toHaveTextContent("Back in stock (1)");
    await userEvent.click(
      within(back).getAllByRole("button", { name: "Fill down" })[0]!,
    );
    expect(ok).toHaveTextContent("Back in stock (2)");
    await userEvent.click(ok);
    await settle();

    const after = getDb();
    const status = (s: string) =>
      after.units.find((u) => u.serial === s)!.status;
    expect(status(picks[0]!.serial)).toBe("SERVIS");
    expect(status(picks[1]!.serial)).toBe("QC");
    expect(status(picks[2]!.serial)).toBe("QC");
    for (const p of picks.slice(1)) {
      const visit = after.services.find((r) => r.serial === p.serial)!;
      expect(visit.closedAt).toBeDefined();
      expect(visit.fees).toEqual([
        expect.objectContaining({ kind: "LABOUR", amount: 150_000 }),
      ]);
    }
  });
});

describe("one button per job (2026-11-13)", () => {
  it("asks a charge only its amount and how it was paid", async () => {
    const { serial } = sendOne();
    renderPage();
    await settle();
    await openBatch(serial);
    await userEvent.click(screen.getByLabelText(`Add a charge to ${serial}`));
    const dialog = await topModal();
    expect(within(dialog).getByLabelText("Amount")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radiogroup", { name: "Paid with" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("What for")).toBeNull();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
  });

  it("brings a whole batch back from its row on the bench", async () => {
    const db = getDb();
    const free = db.units.filter(
      (u) =>
        u.status === "TERSEDIA" &&
        skuTracksSerial(db, u.skuId) &&
        !db.services.some((r) => r.serial === u.serial),
    );
    const home = free.find(
      (u) => free.filter((v) => v.locationId === u.locationId).length >= 2,
    )!.locationId;
    const picks = free.filter((u) => u.locationId === home).slice(0, 2);
    const at = new Date().toISOString();
    mutate((d) => {
      for (const p of picks) {
        const plan = planSendToService({
          unit: { serial: p.serial, locationId: p.locationId },
          dest: p.locationId,
          raisedBy: "ADJUSTMENT",
          at,
          staff: currentStaffName(),
          words: { shipLabel: "c", quoteLabel: "q", eventNote: "Sent" },
          nextId,
        });
        appendEvent(d, p.serial, plan.event);
        d.services.push(plan.visit);
      }
    });
    renderPage();
    await settle();
    const row = await waitFor(() => {
      const tr = document.querySelector<HTMLElement>(
        `tr[data-serials~="${picks[0]!.serial}"]`,
      );
      expect(tr).not.toBeNull();
      return tr!;
    });
    // The store is shared across this file, so the batch may hold an
    // earlier test's unit too: count what the row says it holds.
    const n = row.getAttribute("data-serials")!.split(" ").length;
    // The unnamed batch reads as its units, not "None".
    expect(row).toHaveTextContent(`+${n - 1} more`);
    // Every Back in stock on the bench is one width, whatever its count.
    expect(
      within(row).getByText(`Back in stock (${n})`).closest("button")!.style
        .width,
    ).toBe("168px");
    await userEvent.click(
      within(row).getByText(`Back in stock (${n})`).closest("button")!,
    );
    const back = await topModal();
    expect(back).toHaveTextContent("Bring units back from service");
    for (const p of picks)
      expect(
        within(back).getByLabelText(`Repair cost of ${p.serial}`),
      ).toBeInTheDocument();
  });
});

describe("a batch row opens typing (2026-11-13)", () => {
  it("opens Back in stock with the caret in the first unit's cost", async () => {
    const { serial } = sendOne();
    renderPage();
    await settle();
    const row = await waitFor(() => {
      const tr = document.querySelector<HTMLElement>(
        `tr[data-serials~="${serial}"]`,
      );
      expect(tr).not.toBeNull();
      return tr!;
    });
    fireEvent.click(row);
    const back = await topModal();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(back).getAllByPlaceholderText("0 if free")[0],
      );
    });
  });
});

describe("Add back in stock (2026-11-13)", () => {
  /** Send units from one warehouse to service in one press, as the dialog does. */
  function sendMany(n: number): string[] {
    const db = getDb();
    const free = db.units.filter(
      (u) =>
        u.status === "TERSEDIA" &&
        skuTracksSerial(db, u.skuId) &&
        !db.services.some((r) => r.serial === u.serial),
    );
    const home = free.find(
      (u) => free.filter((v) => v.locationId === u.locationId).length >= n,
    )!.locationId;
    const picks = free.filter((u) => u.locationId === home).slice(0, n);
    const at = new Date().toISOString();
    mutate((d) => {
      for (const p of picks) {
        const plan = planSendToService({
          unit: { serial: p.serial, locationId: p.locationId },
          dest: p.locationId,
          raisedBy: "ADJUSTMENT",
          at,
          staff: currentStaffName(),
          words: { shipLabel: "c", quoteLabel: "q", eventNote: "Sent" },
          nextId,
        });
        appendEvent(d, p.serial, plan.event);
        d.services.push(plan.visit);
      }
    });
    return picks.map((p) => p.serial);
  }

  it("shows the bench as batch name, total units, warehouse, cost and actions", async () => {
    sendOne();
    renderPage();
    await settle();
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-table-thead th"),
    ).map((th) => (th.textContent ?? "").trim());
    expect(headers.filter(Boolean)).toEqual([
      "Batch name",
      "Total units",
      "Warehouse",
      "Cost",
    ]);
  });

  it("checks each scanned serial, refuses the ones not at service on their row, and brings the rest back with their fees", async () => {
    const [first, second] = sendMany(2);
    const db = getDb();
    const shelf = db.units.find(
      (u) =>
        u.status === "TERSEDIA" &&
        skuTracksSerial(db, u.skuId) &&
        !db.services.some((r) => r.serial === u.serial),
    )!.serial;
    renderPage();
    await settle();
    pressPageAction("Add back in stock");
    const dialog = await topModal();
    expect(dialog).toHaveTextContent("Add back in stock");
    const box = within(dialog).getByLabelText("Add a unit");
    await waitFor(() => expect(document.activeElement).toBe(box));
    for (const serial of [first!, second!, shelf, "ZZNOSUCHSERIAL"])
      await userEvent.type(box, `${serial}{Enter}`);

    // The two that cannot come back say why, each on its own row.
    expect(dialog.querySelector(`[data-refused="${shelf}"]`)).toHaveTextContent(
      "Not at service — it is in stock.",
    );
    expect(
      dialog.querySelector('[data-refused="ZZNOSUCHSERIAL"]'),
    ).toHaveTextContent("No unit has this serial.");
    expect(
      within(dialog).queryByLabelText(`Repair cost of ${shelf}`),
    ).toBeNull();

    // A fee on one; the other goes back with none.
    await userEvent.type(
      within(dialog).getByLabelText(`Repair cost of ${first}`),
      "125000",
    );
    const ok = within(dialog).getByText("Back in stock (2)").closest("button")!;
    expect(ok).toBeEnabled();
    await userEvent.click(ok);
    await settle();

    const after = getDb();
    const unit = (s: string) => after.units.find((u) => u.serial === s)!;
    expect(unit(first!).status).toBe("QC");
    expect(unit(second!).status).toBe("QC");
    expect(unit(shelf).status).toBe("TERSEDIA");
    const visit = (s: string) =>
      after.services
        .filter((r) => r.serial === s)
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0]!;
    expect(visit(first!).closedAt).toBeDefined();
    expect(visit(first!).fees).toEqual([
      expect.objectContaining({ kind: "LABOUR", amount: 125_000 }),
    ]);
    expect(visit(second!).closedAt).toBeDefined();
    expect(visit(second!).fees).toEqual([]);
  });
});
