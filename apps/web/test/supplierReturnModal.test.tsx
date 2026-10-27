/**
 * Return to supplier, with its money (owner 2026-10-26, spec §3): one dialog,
 * rule C under the credit box, the refund received or awaited, the return's
 * row on the history with *Mark received*, and the undo that takes the credit
 * off the invoice and keeps a refund already received.
 */
import { App as AntdApp } from "antd";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SupplierReturnModal } from "../src/components/SupplierReturnModal.js";
import { SupplierReturnPanel } from "../src/routes/returns/SupplierReturnPage.js";
import { ReturnHistoryTable } from "../src/routes/returns/ReturnHistoryTable.js";
import { ServicePage } from "../src/routes/stock/ServicePage.js";
import { IncomeExpensePage } from "../src/routes/finance/CashflowPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { poTotals } from "../src/lib/inbound.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";
import { fmtRp } from "../src/lib/format.js";
import type { Unit } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 90_000 });

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

/** The modal on top: the last one open. */
async function topModal(): Promise<HTMLElement> {
  return waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-modal-wrap"),
    ).filter((w) => w.style.display !== "none");
    expect(open.length).toBeGreaterThan(0);
    return open.at(-1)!.querySelector<HTMLElement>(".ant-modal")!;
  });
}

/** Pick an antd Select option by its visible label (portalled list). */
async function chooseOption(control: HTMLElement, option: string) {
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
    ).find((el) => el.getAttribute("title") === option);
    if (!found) throw new Error(`no option “${option}” open`);
    return found;
  });
  fireEvent.click(item);
}

/**
 * A tracked unit on the shelf whose invoice has more than one unit — the
 * fixture's first such, with its invoice's money set to `paid` before the
 * dialog opens.
 */
function aUnit(paid: "NONE" | "ALL"): Unit {
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
  expect(unit).toBeDefined();
  mutate((d) => {
    const po = d.pos.find((p) => p.id === unit.poId)!;
    po.payments = [];
    if (paid === "ALL") {
      po.payments.push({
        id: `zz-paid-${unit.serial}`,
        method: "TRANSFER",
        amount: poTotals(po).total,
        at: new Date().toISOString(),
      });
    }
  });
  return getDb().units.find((u) => u.serial === unit.serial)!;
}

function renderDialog(serial: string, onClose = () => {}) {
  return render(
    <AntdApp>
      <MemoryRouter>
        <SupplierReturnModal serial={serial} onClose={onClose} />
      </MemoryRouter>
    </AntdApp>,
  );
}

function renderReturns() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <SupplierReturnPanel addOpen={false} onCloseAdd={() => {}} />
        <ReturnHistoryTable />
      </MemoryRouter>
    </AntdApp>,
  );
}

const record = async (dialog: HTMLElement) =>
  userEvent.click(
    within(dialog).getByRole("button", { name: "Record supplier return" }),
  );

const returnOf = (serial: string) =>
  getDb().returns.find(
    (r) => r.serial === serial && r.kind === "SUPPLIER" && r.status === "DONE",
  )!;

describe("the Return-to-supplier dialog", () => {
  it("takes the credit off an unpaid invoice and asks nothing about a refund", async () => {
    const unit = aUnit("NONE");
    renderDialog(unit.serial);
    const dialog = await topModal();
    await settle();
    const po = getDb().pos.find((p) => p.id === unit.poId)!;
    // The live line: rule C, before anything is written.
    expect(
      within(dialog).getByText(
        `${fmtRp(unit.buy)} comes off invoice ${po.code} (still unpaid ${fmtRp(poTotals(po).goods.owed)})`,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("Received into")).toBeNull();
    // The reason is the one question the door did not answer.
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Dead pixel" },
    });
    await record(dialog);

    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    const rec = returnOf(unit.serial);
    expect(rec).toMatchObject({
      kind: "SUPPLIER",
      status: "DONE",
      expectedCredit: unit.buy,
      supplierId: po.supplierId,
    });
    expect(getDb().units.find((u) => u.serial === unit.serial)!.status).toBe(
      "RETUR_SUPPLIER",
    );
    const credit = getDb()
      .pos.find((p) => p.id === po.id)!
      .payments.find((p) => p.returnId === rec.id)!;
    expect(credit).toMatchObject({
      method: "RETUR_SUPPLIER",
      amount: unit.buy,
      inBalance: false,
      appliedTo: "ORDER",
    });
    expect(getDb().incomes.some((i) => i.returnId === rec.id)).toBe(false);
  });

  it("on a paid invoice is a refund, received into the pot it is said to be", async () => {
    const unit = aUnit("ALL");
    renderDialog(unit.serial);
    const dialog = await topModal();
    await settle();
    expect(
      within(dialog).getByText(
        `${fmtRp(unit.buy)} is a refund from the supplier`,
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Dead pixel" },
    });
    // Where it went is asked, never assumed.
    await record(dialog);
    expect(
      await within(dialog).findByText(
        "Say where the refund went, or that it has not come yet.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByText("Cash"));
    await record(dialog);

    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    const rec = returnOf(unit.serial);
    expect(rec.refundReceived).toBe(unit.buy);
    expect(getDb().incomes.find((i) => i.returnId === rec.id)).toMatchObject({
      reason: "REFUND",
      method: "TUNAI",
      amount: unit.buy,
    });
    expect(
      getDb()
        .pos.flatMap((p) => p.payments)
        .some((p) => p.returnId === rec.id),
    ).toBe(false);
  });

  it("adds the service charges to the credit, and closes the visit", async () => {
    const unit = aUnit("ALL");
    const at = new Date(Date.now() - 86_400_000).toISOString();
    mutate((d) => {
      const u = d.units.find((x) => x.serial === unit.serial)!;
      u.status = "SERVIS";
      d.services.push({
        id: "zz-visit",
        serial: unit.serial,
        fromLocationId: u.locationId,
        openedAt: at,
        arrivedAt: at,
        fees: [
          {
            id: "zz-fee",
            kind: "LABOUR",
            amount: 400_000,
            at,
            staff: "Michella",
          },
        ],
        raisedBy: "ADJUSTMENT",
        staff: "Michella",
      });
    });
    renderDialog(unit.serial);
    const dialog = await topModal();
    await settle();
    expect(
      within(dialog).getByText(
        `Service charges on this unit: ${fmtRp(400_000)}`,
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Add service charges/ }),
    );
    expect(
      within(dialog).getByText(
        `${fmtRp(unit.buy + 400_000)} is a refund from the supplier`,
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Cannot be repaired" },
    });
    await userEvent.click(within(dialog).getByText("Not paid by supplier yet"));
    await record(dialog);

    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    const rec = returnOf(unit.serial);
    expect(rec.expectedCredit).toBe(unit.buy + 400_000);
    expect(getDb().incomes.some((i) => i.returnId === rec.id)).toBe(false);
    const visit = getDb().services.find((r) => r.id === "zz-visit")!;
    expect(visit.closedAt).toBeDefined();
    // Not back in any warehouse of the shop's.
    expect(visit.toLocationId).toBeUndefined();
  });

  it("will not send a held unit", async () => {
    const unit = aUnit("NONE");
    mutate((d) => {
      d.units.find((u) => u.serial === unit.serial)!.status = "DIRESERVASI";
    });
    renderDialog(unit.serial);
    const dialog = await topModal();
    expect(
      within(dialog).getByText(
        "Reserved for a customer — release the hold first.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Record supplier return" }),
    ).toBeDisabled();
  });
});

describe("the Returns page's To supplier", () => {
  it("asks the same questions, from a unit picked in the list", async () => {
    const unit = aUnit("NONE");
    const sku = getDb().skus.find((k) => k.id === unit.skuId)!;
    render(
      <AntdApp>
        <MemoryRouter>
          <SupplierReturnPanel addOpen onCloseAdd={() => {}} />
        </MemoryRouter>
      </AntdApp>,
    );
    const dialog = await topModal();
    await chooseOption(
      within(dialog).getByRole("combobox", { name: "Unit in inventory" }),
      `${unit.serial} — ${sku.name} ${sku.variantLabel}`,
    );
    await settle();
    expect(within(dialog).getByText(/comes off invoice/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Wrong spec" },
    });
    await record(dialog);
    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    expect(
      getDb()
        .pos.flatMap((p) => p.payments)
        .some((p) => p.returnId === returnOf(unit.serial).id),
    ).toBe(true);
  });
});

describe("a supplier return on the history", () => {
  it("shows what is awaited, and Mark received records it", async () => {
    const unit = aUnit("ALL");
    renderDialog(unit.serial);
    let dialog = await topModal();
    await settle();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Dead pixel" },
    });
    await userEvent.click(within(dialog).getByText("Not paid by supplier yet"));
    await record(dialog);
    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    const rec = returnOf(unit.serial);
    cleanup();

    renderReturns();
    expect(
      await screen.findByText(`Awaiting refund ${fmtRp(unit.buy)}`),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: `Mark the refund of ${rec.code} received`,
      }),
    );
    dialog = await topModal();
    await userEvent.click(within(dialog).getByText("Other bank"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mark received" }),
    );
    await waitFor(() =>
      expect(getDb().incomes.find((i) => i.returnId === rec.id)).toMatchObject({
        reason: "REFUND",
        method: "TRANSFER_LUAR",
        amount: unit.buy,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(`Awaiting refund ${fmtRp(unit.buy)}`),
      ).toBeNull(),
    );
    expect(
      screen.getByText(`Received: ${fmtRp(unit.buy)}`),
    ).toBeInTheDocument();
  });

  it("taking it back removes the credit and keeps a refund received", async () => {
    // Half the invoice paid: the credit splits into both halves.
    const unit = aUnit("NONE");
    const po = getDb().pos.find((p) => p.id === unit.poId)!;
    const owed = poTotals(po).goods.owed;
    mutate((d) => {
      d.pos
        .find((p) => p.id === po.id)!
        .payments.push({
          id: `zz-part-${unit.serial}`,
          method: "TRANSFER",
          amount: owed - 1_000_000,
          at: new Date().toISOString(),
        });
    });
    renderDialog(unit.serial);
    const dialog = await topModal();
    await settle();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Dead pixel" },
    });
    await userEvent.click(within(dialog).getByText("Bank"));
    await record(dialog);
    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    const rec = returnOf(unit.serial);
    const creditOf = () =>
      getDb()
        .pos.flatMap((p) => p.payments)
        .filter((p) => p.returnId === rec.id);
    expect(creditOf().map((p) => p.amount)).toEqual([1_000_000]);
    expect(getDb().incomes.find((i) => i.returnId === rec.id)!.amount).toBe(
      unit.buy - 1_000_000,
    );
    cleanup();

    renderReturns();
    await userEvent.click(
      await screen.findByRole("button", {
        name: `Take return ${rec.code} back`,
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Take it back" }),
    );
    await waitFor(() =>
      expect(getDb().returns.find((r) => r.id === rec.id)!.status).toBe(
        "CANCELLED",
      ),
    );
    expect(creditOf()).toEqual([]);
    // The money really arrived: it stays, and the row says so.
    expect(getDb().incomes.some((i) => i.returnId === rec.id)).toBe(true);
    expect(getDb().units.find((u) => u.serial === unit.serial)!.status).toBe(
      "TERSEDIA",
    );
    expect(
      await screen.findByText(`Refund kept: ${fmtRp(unit.buy - 1_000_000)}`),
    ).toBeInTheDocument();
  });
});

describe("a supplier return's money elsewhere", () => {
  it("Income & Expense lists the refund with its SP code and never the credit", async () => {
    const unit = aUnit("NONE");
    const po = getDb().pos.find((p) => p.id === unit.poId)!;
    mutate((d) => {
      d.pos
        .find((p) => p.id === po.id)!
        .payments.push({
          id: `zz-part2-${unit.serial}`,
          method: "TRANSFER",
          amount: poTotals(po).goods.owed - 500_000,
          at: new Date().toISOString(),
        });
    });
    renderDialog(unit.serial);
    const dialog = await topModal();
    await settle();
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Dead pixel" },
    });
    await userEvent.click(within(dialog).getByText("Bank"));
    await record(dialog);
    await waitFor(() => expect(returnOf(unit.serial)).toBeDefined());
    const rec = returnOf(unit.serial);
    cleanup();

    render(
      <AntdApp>
        <MemoryRouter>
          <IncomeExpensePage />
        </MemoryRouter>
      </AntdApp>,
    );
    expect(
      await screen.findByText(
        `Supplier refund — ${getDb().suppliers.find((s) => s.id === po.supplierId)!.name} · ${rec.code}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Supplier return credit")).toBeNull();
  });
});

describe("the service bench's finished visits", () => {
  it("lists a closed visit on request, with Delete and nothing else", async () => {
    const unit = aUnit("NONE");
    const opened = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const closed = new Date(Date.now() - 86_400_000).toISOString();
    mutate((d) => {
      d.services.push({
        id: "zz-closed-visit",
        serial: unit.serial,
        fromLocationId: unit.locationId,
        openedAt: opened,
        arrivedAt: opened,
        closedAt: closed,
        toLocationId: unit.locationId,
        fees: [],
        raisedBy: "ADJUSTMENT",
        staff: "Michella",
      });
    });
    render(
      <AntdApp>
        <MemoryRouter>
          <ServicePage />
        </MemoryRouter>
      </AntdApp>,
    );
    expect(
      screen.queryByLabelText(`Delete the service visit of ${unit.serial}`),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("switch", { name: "Show finished" }),
    );
    const del = await screen.findByLabelText(
      `Delete the service visit of ${unit.serial}`,
    );
    const row = del.closest("tr") as HTMLElement;
    expect(
      within(row).queryByLabelText(`Add a charge to ${unit.serial}`),
    ).toBeNull();
    expect(
      within(row).queryByLabelText(`Put ${unit.serial} back in stock`),
    ).toBeNull();
  });
});
