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
  {
    search = true,
    // The exchange dropdown's labels are "SERIAL — product name", so a test
    // that knows the serial cannot name the whole title (2026-09-25).
    startsWith = false,
  }: { search?: boolean; startsWith?: boolean } = {},
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

/** What comes back — the ONE table the form keeps (owner ask 2026-09-25). */
const backTable = () =>
  screen.getByRole("group", { name: "Units coming back" });

/** What goes out instead. */
const outTable = () => screen.getByRole("group", { name: "Units going out" });

/**
 * The 2026-09-25 flow: a serial (or a transaction number) in the one box,
 * Enter, then *Select n units* on the picker that opens with everything
 * ticked. The unit is in the return table afterwards.
 */
async function scanBack(serial: string) {
  await userEvent.type(
    screen.getByLabelText("Transaction number"),
    `${serial}{Enter}`,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /^Select \d+ units?$/ }),
  );
  expect(within(backTable()).getByText(serial)).toBeInTheDocument();
}

/** Open the exchange half — hidden behind *Exchange unit* since 2026-09-25. */
async function openExchange() {
  // An icon Button's accessible name carries the icon too, so this is a
  // regex rather than the exact string.
  const button = screen.queryByRole("button", { name: /Exchange unit/ });
  if (button) await userEvent.click(button);
}

/** Put something on the exchange, by serial or by product name. */
async function exchangeFor(label: string) {
  await openExchange();
  await chooseOption(searchBox(), label, { startsWith: true });
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

describe("the additional charge (owner, 2026-09-26)", () => {
  /**
   * *"The additional price is per exchange unit, and if no exchange, we can
   * add 1 additional fee per return (not per product)."*
   */
  const feeBox = () =>
    screen.getByRole("spinbutton", { name: "Additional fee" });

  it("takes ONE fee for the whole return off what is handed back", async () => {
    sellOne([paid("p-ret-fee-1", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    // Not a box per row any more: the return table asks for nothing.
    expect(within(backTable()).queryAllByRole("spinbutton")).toHaveLength(0);

    await userEvent.type(feeBox(), "250000");
    expect(screen.getByText("Hand back Rp 4.750.000")).toBeInTheDocument();
    await record();

    const o = order();
    // The credit is what the unit sold for, less the one charge — and the
    // Rp250.000 is simply money the shop kept: nothing moved, so nothing is
    // recorded for it beyond the smaller credit.
    expect(o.adjustments).toMatchObject([{ type: "RETUR", amount: 4_750_000 }]);
    expect(o.refunds).toMatchObject([{ method: "TUNAI", amount: 4_750_000 }]);
    expect(orderBalance(o)).toMatchObject({ total: 250_000, customerOwes: 0 });
    // Handed back, so the Refund expense says the same figure.
    expect(getDb().expenses[0]).toMatchObject({
      kind: "REFUND",
      amount: 4_750_000,
    });
  });

  it("charges it per exchange unit instead, and leaves the price read-only", async () => {
    sellOne([paid("p-ret-fee-2", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await exchangeFor(SPARE);
    // The one-per-return box goes the moment something is going out: two
    // boxes both meaning "and this much on top" is a sale charged twice.
    expect(
      screen.queryByRole("spinbutton", { name: "Additional fee" }),
    ).toBeNull();
    // Rp6jt out for Rp5jt back, before anything extra.
    expect(
      screen.getByText("Customer pays Rp 1.000.000 for the exchange"),
    ).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole("spinbutton", { name: `Additional price on ${SPARE}` }),
      "500000",
    );
    expect(
      screen.getByText("Customer pays Rp 1.500.000 for the exchange"),
    ).toBeInTheDocument();
    await record();

    const o = order();
    // The replacement is recorded at the shop's asking price — the charge is
    // not folded into it, so the sale invents no upsell out of a swap fee.
    expect(o.prices[SPARE]).toBe(6_000_000);
    expect(o.adjustments).toMatchObject([{ type: "RETUR", amount: 4_500_000 }]);
    expect(o.payments!.map((p) => [p.state, p.amount])).toEqual([
      ["SETTLED", 5_000_000],
      ["SETTLED", 1_500_000],
    ]);
    expect(orderBalance(o)).toMatchObject({
      total: 6_500_000,
      customerOwes: 0,
    });
    expect(getDb().incomes[0]).toMatchObject({
      reason: "REFUND",
      amount: 1_500_000,
    });
  });
});

describe("exchanging (owner, 2026-09-21)", () => {
  it("records no money back when the replacement is cheaper", async () => {
    sellOne([paid("p-ret-3", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await exchangeFor(CHEAP);
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
    await exchangeFor(SPARE);
    await exchangeFor(SPARE2);
    expect(within(outTable()).getByText("Rp 3.000.000")).toBeInTheDocument();
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

  it("holds ONE transaction: a second number replaces the first", async () => {
    sellOne([paid("p-ret-5a", 5_000_000)]);
    sell({
      id: ORDER2,
      code: CODE2,
      ts: "2026-09-12T03:00:00.000Z",
      serial: SOLD2,
      price: 3_000_000,
      payments: [paid("p-ret-5b", 3_000_000, { method: "TRANSFER" })],
    });
    renderPanel();
    await scanBack(SOLD);
    // Owner ask 2026-09-25: "only 1 transaction at a time". The second sale
    // is a correction, not a second block — and the first sale's units go
    // with it rather than being left ticked on a sale nobody can see.
    await scanBack(SOLD2);
    expect(within(backTable()).queryByText(SOLD)).toBeNull();
    await pickReason();
    await record();

    expect(order(ORDER).adjustments ?? []).toEqual([]);
    expect(order(ORDER2).adjustments).toMatchObject([
      { type: "RETUR", amount: 3_000_000 },
    ]);
    expect(unit(SOLD).status).toBe("TERJUAL");
    expect(unit(SOLD2).status).toBe("TERSEDIA");
  });

  it("finds the sale by its transaction number, and opens on every unit", async () => {
    sellOne([paid("p-ret-5c", 5_000_000)]);
    renderPanel();
    await userEvent.type(
      screen.getByLabelText("Transaction number"),
      `${CODE}{Enter}`,
    );
    // The picker: the sale's units, named and priced, everything ticked.
    const dialog = (await screen.findByText(`Units on ${CODE}`)).closest(
      "[role='dialog']",
    ) as HTMLElement;
    expect(within(dialog).getByText(SOLD)).toBeInTheDocument();
    expect(within(dialog).getByText("Rp 5.000.000")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Select 1 units/ }),
    );
    expect(within(backTable()).getByText(SOLD)).toBeInTheDocument();
  });

  it("leaves out a unit unticked in the picker", async () => {
    sellOne([paid("p-ret-5d", 5_000_000)]);
    renderPanel();
    await userEvent.type(
      screen.getByLabelText("Transaction number"),
      `${CODE}{Enter}`,
    );
    const dialog = (await screen.findByText(`Units on ${CODE}`)).closest(
      "[role='dialog']",
    ) as HTMLElement;
    // Untick the one unit: the button counts down, and refuses an empty pick.
    await userEvent.click(
      within(dialog).getAllByRole("checkbox").slice(-1)[0]!,
    );
    expect(
      within(dialog).getByRole("button", { name: /Select 0 units/ }),
    ).toBeDisabled();
  });

  it("keeps the exchange shut until it is asked for, then picks by serial", async () => {
    sellOne([paid("p-ret-6", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    // Owner ask 2026-09-25: a dropdown, not the whole shelf on the page.
    expect(screen.queryByLabelText(`Additional price on ${SPARE}`)).toBeNull();
    await exchangeFor(SPARE);
    // The price is READ-ONLY here since 2026-09-26 (owner ask): text, not a
    // box. What this window may type is the additional price beside it.
    expect(within(outTable()).getByText("Rp 6.000.000")).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Additional price on ${SPARE}`),
    ).toBeInTheDocument();
    // One row, one unit: the shelf list drops what has been picked, so
    // there is nothing to pick twice.
    expect(screen.getAllByLabelText(/^Additional price on /)).toHaveLength(1);
  });

  it("says so when a picked replacement is sold elsewhere, and leaves it out", async () => {
    sellOne([paid("p-ret-8", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await exchangeFor(SPARE);
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
    expect(screen.queryByLabelText(`Additional price on ${SPARE}`)).toBeNull();
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
    await exchangeFor(name);
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

  /*
   * Where it comes back to is asked, not assumed (owner ask 2026-10-21: "we
   * should be able to choose the warehouse instead of automatically sending
   * it to warehouse 4"). It starts on this desk's warehouse.
   */
  /*
   * A fresh database has no reasons at all (go-live 2026-09-29 imported none),
   * and a pick-only box with nothing in it refused every return. A reason
   * typed here joins Settings' list, as an adjustment's always has.
   */
  it("takes a reason nobody has listed yet, and adds it to the list", async () => {
    sellOne([paid("p-ret-newreason", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await userEvent.type(
      within(returnForm()).getByLabelText("Reason"),
      "Layar bergaris",
    );
    await record();

    expect(unit(SOLD).status).toBe("TERSEDIA");
    expect(
      getDb().reasons.filter(
        (r) => r.activity === "RETURN_CUSTOMER" && r.label === "Layar bergaris",
      ),
    ).toHaveLength(1);
    expect(returnOf(SOLD).reason).toBe("Layar bergaris");
  });

  it("puts the unit back in the warehouse the form names", async () => {
    sellOne([paid("p-ret-wh", 5_000_000)]);
    renderPanel();
    await scanBack(SOLD);
    await pickReason();
    await chooseOption(
      within(returnForm()).getByLabelText("Back to warehouse"),
      "02 · Gudang Serpong",
      { search: false },
    );
    await record();

    expect(unit(SOLD).locationId).toBe("wh-2");
    const back = getDb().events.filter(
      (e) => e.serial === SOLD && e.type === "RETUR_PELANGGAN",
    );
    // The serial is reused by every test here; the newest return is this one.
    expect(back.at(-1)).toMatchObject({ locationId: "wh-2" });
  });

  /*
   * The SERVIS-kind warehouse is a warehouse like any other (2026-10-26): in
   * the shop's database it is 04, *Gudang Masuk Belum QC*. A desk whose own
   * warehouse it is returns there by default, as any desk does.
   */
  it("starts on this desk's warehouse, whatever its kind", async () => {
    mutate((d) => {
      d.myWarehouseId = "wh-4";
    });
    try {
      sellOne([paid("p-ret-wh4", 5_000_000)]);
      renderPanel();
      await scanBack(SOLD);
      await pickReason();
      await record();
      expect(unit(SOLD).status).toBe("TERSEDIA");
      expect(unit(SOLD).locationId).toBe("wh-4");
    } finally {
      mutate((d) => {
        d.myWarehouseId = "wh-1";
      });
    }
  });
});
