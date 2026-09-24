/**
 * Returns & exchange (owner brief 2026-09-19): "If the unit is paid, it will
 * be recorded as buying back from the customer. If the unit is unpaid, it will
 * be recorded as return."
 *
 * And the exchange, reshaped 2026-09-21: "the user can add multiple product in
 * exchange … If the unit they exchange for is cheaper than the one they
 * purchase, the money will not return" — one unit back for two out, and units
 * back from two sales, the replacements on one of them.
 */
import { App as AntdApp } from "antd";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerReturnPanel } from "../src/routes/returns/CustomerReturnPage.js";
import { ReturnHistoryTable } from "../src/routes/returns/ReturnHistoryTable.js";
import { getDb, mutate } from "../src/mock/store.js";
import { orderBalance } from "../src/lib/salePayments.js";
import type { SalePayment } from "../src/lib/salePayments.js";
import { onHand } from "../src/lib/stock.js";

vi.setConfig({ testTimeout: 90_000 });

const SOLD = "SRETTEST0001";
const SPARE = "SRETTEST0002";
const SPARE2 = "SRETTEST0003";
const CHEAP = "SRETTEST0004";
const SOLD2 = "SRETTEST0005";
const OURS = [SOLD, SPARE, SPARE2, CHEAP, SOLD2];
const ORDER = "o-return-test";
const ORDER2 = "o-return-test-2";
const CODE = "SI-2026/09-990001";
const CODE2 = "SI-2026/09-990002";
const MOUSE = "m-magic-mouse-v1";

function renderPanel() {
  // The history moved out of the panel and into one combined table on the
  // page (owner ask 2026-09-23), so the two are rendered together here — the
  // panel still owns the form, the table still shows what it wrote.
  return render(
    <AntdApp>
      <MemoryRouter>
        <CustomerReturnPanel
          addOpen
          onCloseAdd={() => {}}
          onOpenAdd={() => {}}
        />
        <ReturnHistoryTable />
      </MemoryRouter>
    </AntdApp>,
  );
}

/**
 * Pick an antd Select option by its visible label (portalled list). A Select
 * without search has a read-only box nobody can type into — and typing into
 * it anyway makes rc-select filter its options by VALUE, hiding them all.
 */
async function chooseOption(
  control: HTMLElement,
  option: string,
  { search = true }: { search?: boolean } = {},
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
    ).find((el) => el.getAttribute("title") === option);
    if (!found) throw new Error(`no option “${option}” open`);
    return found;
  });
  fireEvent.click(item);
}

/** A sale of one unit, paid as given. */
function sell(o: {
  id: string;
  code: string;
  ts: string;
  serial: string;
  price: number;
  payments: SalePayment[];
}) {
  mutate((d) => {
    d.orders.unshift({
      id: o.id,
      code: o.code,
      ts: o.ts,
      customerId: null,
      serials: [o.serial],
      prices: { [o.serial]: o.price },
      discount: 0,
      source: "OFFLINE",
      payMethod: "TUNAI",
      settled: o.payments.every((p) => p.state === "SETTLED"),
      payments: o.payments,
      total: o.price,
    });
  });
}

const paid = (id: string, amount: number, extra: Partial<SalePayment> = {}) =>
  ({
    id,
    method: "TUNAI",
    amount,
    state: "SETTLED",
    at: "2026-09-10T03:00:00.000Z",
    ...extra,
  }) as SalePayment;

/** SOLD out on one Rp5jt sale, paid as given. */
const sellOne = (payments: SalePayment[]) =>
  sell({
    id: ORDER,
    code: CODE,
    ts: "2026-09-10T03:00:00.000Z",
    serial: SOLD,
    price: 5_000_000,
    payments,
  });

const order = (id = ORDER) => getDb().orders.find((o) => o.id === id)!;
const returnOf = (serial: string) =>
  getDb().returns.find((r) => r.kind === "CUSTOMER" && r.serial === serial)!;
const unit = (serial: string) =>
  getDb().units.find((u) => u.serial === serial)!;

async function scanBack(serial: string) {
  await userEvent.type(
    screen.getByPlaceholderText("Scan or type the serial coming back"),
    `${serial}{Enter}`,
  );
  expect(screen.getByLabelText(`${serial} is coming back`)).toBeChecked();
}

/** The Record-a-return dialog: the combined history has a Reason column too. */
const returnForm = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".ant-modal")).find((m) =>
    m.textContent?.includes("Record return"),
  )!;

async function pickReason() {
  const reason = getDb().reasons.find(
    (r) => r.activity === "RETURN_CUSTOMER" && r.active,
  )!;
  await chooseOption(
    within(returnForm()).getByLabelText("Reason"),
    reason.label,
  );
}

const searchBox = () =>
  screen.getByLabelText("Find a replacement in the inventory");

async function record() {
  await userEvent.click(screen.getByRole("button", { name: "Record return" }));
}

/**
 * The history's row for a return, found by one of its SG codes — a row lists
 * every code of the return under the transaction it undid ("SG-1, SG-2").
 */
const historyRow = (code: string) =>
  screen
    .getAllByText(
      (_, el) => el?.textContent?.split(", ").includes(code) ?? false,
    )
    .map((el) => el.closest("tr"))
    .find((tr): tr is HTMLTableRowElement => tr !== null)!;

/**
 * The combined history's cells (owner ask 2026-09-23): type, the transaction
 * or inbound it is against, date, the party, the reason. Everything per unit
 * is in the popup the row opens.
 */
const cells = (row: HTMLTableRowElement) => {
  const [side, sale, date, party, reason] = Array.from(
    row.querySelectorAll("td"),
  );
  return {
    side: side!,
    sale: sale!,
    date: date!,
    party: party!,
    reason: reason!,
  };
};

/** The units behind a history row, in the popup a click on it opens. */
async function openRow(code: string): Promise<HTMLElement> {
  await userEvent.click(historyRow(code));
  // A return of two units has two codes in its title, so the match is on a
  // substring rather than the whole string.
  return (
    await screen.findByText(
      (_, el) =>
        el?.classList.contains("ant-modal-title") === true &&
        (el.textContent?.includes(code) ?? false),
    )
  ).closest(".ant-modal") as HTMLElement;
}

/**
 * The desktop layout — `test/setup.ts` answers "no" to every media query, so
 * a test is on the phone's cards unless it says otherwise, and the combined
 * history is read here as a table (owner ask 2026-09-23: the per-unit detail
 * moved into a popup, which took the `expandable` that used to keep this
 * table a table on a narrow screen).
 */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1600,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

beforeEach(() => {
  useDesktopViewport();
  mutate((d) => {
    const base = d.units.find(
      (u) => u.status === "TERSEDIA" && !OURS.includes(u.serial),
    )!;
    d.units = d.units.filter((u) => !OURS.includes(u.serial));
    d.returns = d.returns.filter((r) => !OURS.includes(r.serial));
    d.units.push(
      { ...base, serial: SOLD, status: "TERJUAL", price: 5_000_000 },
      { ...base, serial: SPARE, status: "TERSEDIA", price: 6_000_000 },
      { ...base, serial: SPARE2, status: "TERSEDIA", price: 3_000_000 },
      { ...base, serial: CHEAP, status: "TERSEDIA", price: 4_000_000 },
      { ...base, serial: SOLD2, status: "TERJUAL", price: 3_000_000 },
    );
    d.orders = d.orders.filter((o) => o.id !== ORDER && o.id !== ORDER2);
  });
});

describe("taking a unit back", () => {
  it("buys back a paid unit at full price, and hands the money back", async () => {
    sellOne([paid("p-ret-1", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    expect(screen.getByText("Hand back Rp 5.000.000")).toBeInTheDocument();
    // The section of the owner's screenshot is gone.
    expect(screen.queryByLabelText("Refund value")).not.toBeInTheDocument();
    await record();

    const o = order();
    expect(o.adjustments).toMatchObject([{ type: "RETUR", amount: 5_000_000 }]);
    expect(o.refunds).toMatchObject([{ method: "TUNAI", amount: 5_000_000 }]);
    // Nothing is owed and nothing is held: the sale is square.
    expect(orderBalance(o)).toMatchObject({ total: 0, customerOwes: 0 });
    expect(o.settled).toBe(true);
    const ret = returnOf(SOLD);
    // Received on the way in since 2026-09-23 (owner ask): there is no
    // separate step, so the unit is back on the shelf already.
    expect(ret.status).toBe("ARRIVED");
    expect(ret.code).toBe(o.adjustments![0]!.code);
    expect(getDb().units.find((u) => u.serial === SOLD)!.status).toBe(
      "TERSEDIA",
    );

    // The history: one row, from the customer, against the sale it undid.
    const row = cells(historyRow(ret.code));
    expect(within(row.side).getByText("From customer")).toBeInTheDocument();
    expect(within(row.sale).getByText(CODE)).toBeInTheDocument();
    // The unit itself is in the popup the row opens.
    expect(within(await openRow(ret.code)).getByText(SOLD)).toBeInTheDocument();
  });

  it("takes back an unpaid unit by cancelling the debt — no money moves", async () => {
    sellOne([
      paid("p-ret-2", 5_000_000, {
        method: "TRANSFER",
        state: "DUE",
        dueAt: "2026-10-01T00:00:00.000Z",
      }),
    ]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    expect(screen.queryByText(/Hand back/)).not.toBeInTheDocument();
    await record();

    const o = order();
    expect(o.refunds ?? []).toEqual([]);
    expect(o.payments).toEqual([]);
    expect(orderBalance(o).customerOwes).toBe(0);
  });
});

describe("exchanging (owner, 2026-09-21)", () => {
  it("records no money back when the replacement is cheaper", async () => {
    sellOne([paid("p-ret-3", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`Add ${CHEAP}`) }),
    );
    // Rp4jt out for Rp5jt back: nothing to hand back, nothing to take.
    expect(screen.queryByText(/Hand back/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Customer pays/)).not.toBeInTheDocument();
    await record();

    const o = order();
    expect(o.serials).toEqual([SOLD, CHEAP]);
    expect(o.prices[CHEAP]).toBe(4_000_000);
    expect(unit(CHEAP).status).toBe("TERJUAL");
    expect(o.refunds ?? []).toEqual([]);
    expect(o.payments!.map((p) => [p.id, p.state, p.amount])).toEqual([
      ["p-ret-3", "SETTLED", 5_000_000],
    ]);
    // Only what the replacement used comes off the bill: still Rp5jt, paid.
    expect(o.adjustments).toMatchObject([{ type: "RETUR", amount: 4_000_000 }]);
    expect(orderBalance(o)).toMatchObject({
      total: 5_000_000,
      customerOwes: 0,
      fullySettled: true,
    });
    expect(returnOf(SOLD)).toMatchObject({ exchangeSerial: CHEAP });
    expect(returnOf(SOLD).fee).toBeUndefined();
  });

  it("sends one unit back for two out, both on the same sale", async () => {
    sellOne([paid("p-ret-4", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`Add ${SPARE}`) }),
    );
    await userEvent.type(searchBox(), SPARE2);
    expect(screen.getByLabelText(`Price of ${SPARE2}`)).toBeInTheDocument();
    // Rp6jt + Rp3jt out, Rp5jt back.
    expect(
      screen.getByText("Customer pays Rp 4.000.000 for the exchange"),
    ).toBeInTheDocument();
    await record();

    const o = order();
    const ret = returnOf(SOLD);
    expect(o.serials).toEqual([SOLD, SPARE, SPARE2]);
    expect(o.total).toBe(14_000_000);
    expect(unit(SPARE).status).toBe("TERJUAL");
    expect(unit(SPARE2).status).toBe("TERJUAL");
    // Each replacement's ledger row names the RETURN, which is what ties it
    // to the return on the server.
    for (const serial of [SPARE, SPARE2]) {
      expect(
        getDb().events.filter(
          (e) =>
            e.serial === serial &&
            e.type === "TERJUAL" &&
            e.refCode === ret.code,
        ),
      ).toHaveLength(1);
    }
    expect(o.payments!.map((p) => [p.state, p.amount])).toEqual([
      ["SETTLED", 5_000_000],
      ["SETTLED", 4_000_000],
    ]);
    expect(orderBalance(o)).toMatchObject({
      customerOwes: 0,
      total: 9_000_000,
    });
    expect(ret).toMatchObject({ exchangeSerial: SPARE, fee: 4_000_000 });

    // The history's row opens a popup of what came back (owner ask
    // 2026-09-23). What went out in exchange is on the sale, and on each
    // replacement's own timeline.
    const popup = await openRow(ret.code);
    expect(within(popup).getByText(SOLD)).toBeInTheDocument();

    // A serial opens its history in a popup, not on another page.
    await userEvent.click(within(popup).getByText(SOLD));
    // By its title: the test setup's ids are all one id, so a dialog's
    // accessible name resolves to whichever dialog came first.
    const title = await screen.findByText(`History — ${SOLD}`);
    const dialog = title.closest<HTMLElement>("[role='dialog']")!;
    expect(within(dialog).getByText("Lifecycle")).toBeInTheDocument();
  });

  it("takes units back from two sales and puts the replacements on the chosen one", async () => {
    sellOne([paid("p-ret-5a", 5_000_000)]);
    sell({
      id: ORDER2,
      code: CODE2,
      ts: "2026-09-12T03:00:00.000Z",
      serial: SOLD2,
      price: 3_000_000,
      payments: [
        paid("p-ret-5b", 3_000_000, {
          method: "TRANSFER",
          at: "2026-09-12T03:00:00.000Z",
        }),
      ],
    });
    renderPanel();
    await scanBack(SOLD);
    await scanBack(SOLD2);
    // Both sales in the ONE table of what comes back.
    const back = screen.getByRole("group", { name: "Units coming back" });
    expect(within(back).getByText(CODE)).toBeInTheDocument();
    expect(within(back).getByText(CODE2)).toBeInTheDocument();
    await pickReason();
    await userEvent.type(searchBox(), SPARE);
    await userEvent.type(searchBox(), SPARE2);
    // The newer sale is the default; put them on the first one instead.
    await chooseOption(screen.getByLabelText("Put the replacements on"), CODE, {
      search: false,
    });
    // Rp9jt out, Rp5jt + Rp3jt back.
    expect(
      screen.getByText("Customer pays Rp 1.000.000 for the exchange"),
    ).toBeInTheDocument();
    await record();

    const a = order(ORDER);
    const b = order(ORDER2);
    expect(a.serials).toEqual([SOLD, SPARE, SPARE2]);
    expect(b.serials).toEqual([SOLD2]);
    // The second sale's Rp3jt moved over, as the transfer it was, on the day
    // it arrived; the customer pays the last Rp1jt now.
    expect(a.payments!.map((p) => [p.method, p.state, p.amount])).toEqual([
      ["TUNAI", "SETTLED", 5_000_000],
      ["TRANSFER", "SETTLED", 3_000_000],
      ["TUNAI", "SETTLED", 1_000_000],
    ]);
    expect(a.payments![1]).toMatchObject({ at: "2026-09-12T03:00:00.000Z" });
    expect(a.payments![1]!.note).toContain(CODE2);
    expect(b.payments ?? []).toEqual([]);
    expect(a.adjustments).toMatchObject([{ type: "RETUR", amount: 5_000_000 }]);
    expect(b.adjustments).toMatchObject([{ type: "RETUR", amount: 3_000_000 }]);
    expect(a.refunds ?? []).toEqual([]);
    expect(b.refunds ?? []).toEqual([]);
    expect(orderBalance(a)).toMatchObject({
      total: 9_000_000,
      customerOwes: 0,
      fullySettled: true,
    });
    expect(orderBalance(b)).toMatchObject({ total: 0, customerOwes: 0 });
    expect(a.settled).toBe(true);
    expect(b.settled).toBe(true);
    const retA = returnOf(SOLD);
    const retB = returnOf(SOLD2);
    expect(retA).toMatchObject({ exchangeSerial: SPARE, fee: 1_000_000 });
    expect(retB).toMatchObject({ exchangeSerial: SPARE });
    expect(retB.fee).toBeUndefined();
    // Every change to money is in the log.
    const log = getDb().paymentLog.filter((l) => l.reason?.includes(retA.code));
    expect(log.map((l) => l.action).sort()).toEqual([
      "ADDED",
      "ADDED",
      "REMOVED",
    ]);
    // One row for the whole exchange: both sales named on it, both units
    // back inside it.
    const tr = historyRow(retA.code);
    expect(historyRow(retB.code)).toBe(tr);
    const row = cells(tr);
    expect(row.sale.textContent).toContain(CODE);
    expect(row.sale.textContent).toContain(CODE2);
    const popup = await openRow(retA.code);
    expect(within(popup).getByText(SOLD)).toBeInTheDocument();
    expect(within(popup).getByText(SOLD2)).toBeInTheDocument();
  });

  it("adds a unit the moment its whole serial is typed into the search", async () => {
    sellOne([paid("p-ret-6", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    expect(
      screen.getByRole("button", { name: new RegExp(`Add ${SPARE}`) }),
    ).toBeInTheDocument();
    await userEvent.type(searchBox(), SPARE.toLowerCase());
    const price = screen.getByLabelText(`Price of ${SPARE}`);
    expect((price as HTMLInputElement).value).toBe("6.000.000");
    expect((searchBox() as HTMLInputElement).value).toBe("");
    // It left the list it was picked from: a unit cannot go out twice.
    expect(
      screen.queryByRole("button", { name: new RegExp(`Add ${SPARE}`) }),
    ).not.toBeInTheDocument();
  });

  it("says so when a picked replacement is sold elsewhere, and leaves it out", async () => {
    sellOne([paid("p-ret-8", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await userEvent.type(searchBox(), SPARE);
    expect(
      screen.getByText("Customer pays Rp 1.000.000 for the exchange"),
    ).toBeInTheDocument();
    // Another till sells it while this form is open.
    act(() => {
      mutate((d) => {
        d.units.find((u) => u.serial === SPARE)!.status = "TERJUAL";
      });
    });
    expect(
      screen.getByText(`No longer on the shelf, so left out: ${SPARE}`),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(`Price of ${SPARE}`)).toBeNull();
    // With nothing going out it is a plain return again.
    expect(screen.getByText("Hand back Rp 5.000.000")).toBeInTheDocument();
  });

  it("sends a counted product out by quantity, off the shelf", async () => {
    const heldBefore = onHand(getDb().stockMoves, MOUSE);
    expect(heldBefore).toBeGreaterThan(0);
    sellOne([paid("p-ret-7", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    const sku = getDb().skus.find((s) => s.id === MOUSE)!;
    const name = `${sku.name} ${sku.variantLabel}`;
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(`Add ${name}`) }),
    );
    expect(screen.getByLabelText(`How many ${name}`)).toBeInTheDocument();
    await record();

    const o = order();
    const ret = returnOf(SOLD);
    expect(o.lines).toMatchObject([
      { skuId: MOUSE, qty: 1, price: sku.price, listPrice: sku.price },
    ]);
    const line = o.lines![0]!;
    expect(
      getDb().stockMoves.filter((m) => m.orderLineId === line.id),
    ).toMatchObject([
      {
        type: "TERJUAL",
        qty: -1,
        refCode: ret.code,
        orderId: ORDER,
        skuId: MOUSE,
      },
    ]);
    expect(onHand(getDb().stockMoves, MOUSE)).toBe(heldBefore - 1);
    expect(orderBalance(o)).toMatchObject({
      total: 5_000_000,
      customerOwes: 0,
    });
    // The unit that came back is what the row's popup lists; the counted
    // product went OUT, which its stock move above already records.
    expect(within(await openRow(ret.code)).getByText(SOLD)).toBeInTheDocument();
  });
});
