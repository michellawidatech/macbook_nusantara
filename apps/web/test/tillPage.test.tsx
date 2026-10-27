/**
 * The till, driven the way the counter drives it.
 *
 * What this guards is the flow rather than the arithmetic — `pos.test.ts` has
 * the sums. The claim being tested is the owner's whole reason for the
 * 2026-08-27 rebuild: *the design should accommodate rapid and lots of new
 * transactions*. A walk-in paying cash must be recordable without the details
 * section ever opening, picking between machines must go through the serial
 * chooser — and a variant down to its LAST machine must skip the chooser,
 * because a dialog offering one option is a tap paid for nothing (both owner
 * answers, 2026-08-27).
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
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockOutPage } from "../src/routes/stock/StockOutPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { __resetScanner, __setScannerClock } from "../src/lib/scanner.js";
import { bargainOn, upsellOn } from "../src/lib/pos.js";
import type { MockDb } from "../src/mock/seed.js";

// Same reasoning as inboundQcPage.test.tsx: every test renders the whole page
// and drives it with real events, so the cost is a multiple of the page rather
// than of the assertion, and it moves with how busy the machine is. Three
// minutes, not one: the split-payment test alone took 45 s on an M2 with a
// worker to itself (2026-09-18), and CI's 2-vCPU runner — one vitest worker,
// slower cores — is the machine this budget has to hold on.
vi.setConfig({ testTimeout: 180_000 });

const SKU = "sku-till";

function snapshot(): MockDb {
  return getDb();
}

function renderTill() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/stock/out"]}>
        <Routes>
          <Route path="/stock/out" element={<StockOutPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

/** The dialog currently open — antd leaves closed ones in the DOM. */
async function dialog() {
  await screen.findAllByRole("dialog");
  const all = screen.getAllByRole("dialog");
  return within(all[all.length - 1]!);
}

/**
 * Pick an option of an antd Select by its visible label. rc-select opens on
 * mouse-down, and its options are portalled out of the dialog, so the option
 * is looked for in the dropdown opened last rather than under the control.
 */
async function chooseOption(control: HTMLElement, option: string) {
  fireEvent.mouseDown(control);
  // Typed first, because a long list is virtual and draws only its first
  // screenful — the demo catalogue's last variant is not in the DOM until the
  // search narrows the list to it.
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

/**
 * The variant this file stocks, as the trade-in's product list names it: by
 * its shop code, the way Inbound picks a product (owner ask 2026-10-08).
 */
const TILL_PRODUCT = "TILL-1";

beforeEach(() => {
  /*
   * Every keystroke in this file is a HAND, and the clock says so.
   *
   * The trade-in dialog asks `wasScannedText` since 2026-09-08 — a scan must
   * carry its `S` and a typed serial has one added — and the only evidence
   * either way is how fast the characters arrived. `userEvent` types faster
   * than any person, so without this the whole file's typing is a burst, and
   * whether it is depends on how loaded the machine is: these tests passed
   * alone and failed in the full suite.
   *
   * A clock that jumps a second per reading makes every gap far too long to be
   * a scanner, which is exactly what these tests mean. A test that wants the
   * scanned path says so by delivering a scan.
   */
  __resetScanner();
  let now = 0;
  __setScannerClock(() => (now += 1000));

  // One variant with two machines of different grades, and nothing else on the
  // shelf, so the catalogue is one row and the chooser has a real choice.
  mutate((d) => {
    // Both sellable statuses go, so the catalogue holds only the variant this
    // file makes — otherwise "1 left" matches a seeded row as well as ours.
    //
    // …and this file's OWN serials go with them, whatever state a previous
    // test left them in. A serial is the subject of this database: two units
    // carrying one is a store no screen is written against, and the first
    // symptom is that `units.find(byPersonSerial)` answers with the sold copy
    // — which carries no invoice, so its share of the ongkir is zero.
    const mine = new Set(["TILLAAA00001", "TILLBBB00002"]);
    d.units = d.units.filter(
      (u) =>
        !mine.has(u.serial) &&
        u.status !== "TERSEDIA" &&
        u.status !== "DIRESERVASI",
    );
    d.skus = d.skus.filter((s) => s.id !== SKU);
    d.skus.push({
      id: SKU,
      modelId: d.models[0]!.id,
      code: "TILL-1",
      name: "Till Test Air",
      variantLabel: "8GB / 256GB",
      price: 10_000_000,
    });
    for (const [serial, grade] of [
      ["TILLAAA00001", "A"],
      ["TILLBBB00002", "B"],
    ] as const) {
      d.units.push({
        serial,
        skuId: SKU,
        status: "TERSEDIA",
        locationId: d.myWarehouseId,
        buy: 8_000_000,
        description: `Graded ${grade}`,
        poId: null,
        grade,
      });
    }
    d.orders = [];
    // Counted products live on the stock ledger (2026-09-19); an empty one
    // keeps the catalogue to the one variant this file makes.
    d.stockMoves = [];
  });
});

/**
 * Force the desktop layout for one test.
 *
 * `test/setup.ts` stubs `matchMedia` to answer "no" to everything, which makes
 * `useLayoutMode` report `compact` — so every test in this file is on the
 * PHONE layout unless it says otherwise. That is the useful default here,
 * since the phone is the harder of the two shapes, but the two-column desktop
 * needs its own coverage. Answering "yes" up to `xl` puts `md` and `lg` in
 * range, which is what `compact` and `nav` read.
 */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== undefined && min !== null && Number(min[1]) <= 1200,
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

/**
 * Open the catalogue, wherever this viewport keeps it.
 *
 * On a phone it is a dialog behind *Add product* (owner ask 2026-09-01) and on
 * a desktop it is the left column. One helper rather than two test suites: the
 * catalogue itself is one component, and what is being checked below is what
 * it does, not where it is mounted.
 */
async function openCatalogue() {
  const add = screen.queryByRole("button", { name: /Add product/ });
  if (add) await userEvent.click(add);
}

/** The catalogue row of Till Test Air in one grade. */
function tillAirRow(grade: string): RegExp {
  return new RegExp(`Choose a Till Test Air.*grade ${grade}$`);
}

/** Make the B unit an A too, so the A row has a real choice. */
function bothGradeA() {
  act(() => {
    mutate((d) => {
      d.units.find((u) => u.serial === "TILLBBB00002")!.grade = "A";
    });
  });
}

/**
 * Put the shop's only variant in the basket, through the chooser when there
 * is one.
 *
 * A variant down to its LAST machine skips the chooser (owner revision
 * 2026-08-27) — a dialog offering one option is a tap paid for nothing — so
 * the second call in a test that has already sold one goes straight into the
 * basket, and there is nothing to pick. Asserting on the chooser here would
 * make every such test depend on how many machines the file happens to have
 * left rather than on what it is checking.
 */
async function pickFirstMachine(serial = "TILLAAA00001") {
  await openCatalogue();
  // A row is a variant in ONE grade (owner ask 2026-10-08), so the unit is
  // found on its own grade's row.
  const grade = snapshot().units.find((u) => u.serial === serial)?.grade;
  await userEvent.click(
    screen.getByRole("button", { name: tillAirRow(grade ?? "") }),
  );
  // By the button's own `aria-label`, which names the machine — walking the
  // DOM for the row would be a test that breaks on a layout change rather
  // than on a behaviour one.
  const pick = await screen
    .findByLabelText(`Pick ${serial}`, {}, { timeout: 250 })
    .catch(() => null);
  if (pick) await userEvent.click(pick);
}

describe("selling a counted product", () => {
  it("adds pieces by quantity and writes the sale to the stock ledger", async () => {
    const db = snapshot();
    const mouse = db.skus.find((s) => {
      const model = db.models.find((m) => m.id === s.modelId);
      return db.categories.some(
        (c) => c.name === model?.category && !c.tracksSerial,
      );
    })!;
    act(() => {
      mutate((d) => {
        d.stockMoves = [
          {
            id: "sm-till-1",
            skuId: mouse.id,
            locationId: d.myWarehouseId,
            qty: 3,
            cost: 400_000,
            type: "KOREKSI",
            at: "2026-09-01T10:00:00.000Z",
            staff: "Michella",
          },
        ];
      });
    });
    renderTill();
    await openCatalogue();
    const row = new RegExp(`Choose a ${mouse.name}`);
    // No chooser for a mouse: each tap is one more piece.
    await userEvent.click(screen.getByRole("button", { name: row }));
    await openCatalogue();
    await userEvent.click(screen.getByRole("button", { name: row }));
    await payAndFinish();

    const after = snapshot();
    const order = after.orders[0]!;
    expect(order.serials).toEqual([]);
    expect(order.lines).toMatchObject([
      { skuId: mouse.id, qty: 2, price: mouse.price },
    ]);
    const out = after.stockMoves.filter((m) => m.orderId === order.id);
    expect(out).toMatchObject([
      {
        type: "TERJUAL",
        qty: -2,
        cost: 400_000,
        orderLineId: order.lines![0]!.id,
      },
    ]);
    expect(order.total).toBe(mouse.price * 2);
  });
});

describe("picking a machine", () => {
  it("lists one row per variant and grade, with a count (owner ask 2026-10-08)", async () => {
    renderTill();
    await openCatalogue();
    // An A and a B are two rows — "per row is per unit with same grade and
    // same spec" — best grade first.
    const rows = screen.getAllByRole("button", {
      name: /Choose a Till Test Air/,
    });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Choose a Till Test Air 8GB / 256GB, grade A",
      "Choose a Till Test Air 8GB / 256GB, grade B",
    ]);
    expect(screen.getAllByText("1 left")).toHaveLength(2);
  });

  it("lists units of one grade on one row, not one row per serial", async () => {
    bothGradeA();
    renderTill();
    await openCatalogue();
    // The rebuild's whole premise: a customer points at a model, and forty
    // rows of C02XY… is not an answer to that.
    expect(
      screen.getAllByRole("button", { name: /Choose a Till Test Air/ }),
    ).toHaveLength(1);
    expect(screen.getByText("2 left")).toBeTruthy();
  });

  it("skips the chooser when only one machine is left", async () => {
    // Take the shop down to a single Till Test Air.
    act(() => {
      mutate((d) => {
        d.units = d.units.filter((u) => u.serial !== "TILLBBB00002");
      });
    });
    renderTill();
    await openCatalogue();
    await userEvent.click(
      screen.getByRole("button", { name: /Choose a Till Test Air/ }),
    );

    // No dialog: the one machine is already on the sale.
    expect(screen.queryByLabelText("Pick TILLAAA00001")).toBeNull();
    expect(screen.getByText("TILLAAA00001")).toBeTruthy();
    expect(screen.getByText("None left")).toBeTruthy();
  });

  it("asks which one when there is a choice, and says what tells them apart", async () => {
    bothGradeA();
    renderTill();
    await openCatalogue();
    await userEvent.click(
      screen.getByRole("button", { name: tillAirRow("A") }),
    );

    // The owner's answer of 2026-08-27. Both machines are offered, each with
    // the QC note that is why you would choose between them.
    const d = await dialog();
    expect(d.getByText("TILLAAA00001")).toBeTruthy();
    expect(d.getByText("TILLBBB00002")).toBeTruthy();
    expect(d.getByLabelText("Pick TILLAAA00001")).toBeTruthy();
    expect(d.getByLabelText("Pick TILLBBB00002")).toBeTruthy();
  });

  it("narrows the chooser by serial, and Enter takes the one left (owner ask 2026-10-08)", async () => {
    bothGradeA();
    renderTill();
    await openCatalogue();
    await userEvent.click(
      screen.getByRole("button", { name: tillAirRow("A") }),
    );
    const d = await dialog();
    const search = d.getByRole("searchbox", { name: "Search the serial" });
    // The caret is in it, so the serial can be typed straight away.
    await waitFor(() => expect(search).toHaveFocus());

    await userEvent.type(search, "bbb");
    expect(d.queryByLabelText("Pick TILLAAA00001")).toBeNull();
    expect(d.getByLabelText("Pick TILLBBB00002")).toBeTruthy();

    await userEvent.type(search, "{Enter}");
    // On the sale, and the box is empty for the next one.
    expect(search).toHaveValue("");
    expect(d.getByText("1 on this sale: TILLBBB00002")).toBeTruthy();
    expect(d.getByLabelText("Pick TILLAAA00001")).toBeTruthy();
    expect(d.queryByLabelText("Pick TILLBBB00002")).toBeNull();

    await userEvent.type(search, "zzz");
    expect(d.getByText("No unit here has a serial like that.")).toBeTruthy();
  });

  it("puts a unit in the basket the moment its serial is typed (owner ask 2026-09-21)", async () => {
    // "When we type in serial number, we should automatically add the unit
    // instead of showing the unit name and choosing it manually."
    renderTill();
    await openCatalogue();
    const search = screen.getByRole("searchbox", { name: "Search the stock" });
    await userEvent.type(search, "tillbbb00002");

    // No chooser, and the box is empty for the next one.
    expect(screen.queryByLabelText("Pick TILLBBB00002")).toBeNull();
    expect(search).toHaveValue("");
    expect(screen.getAllByText("TILLBBB00002").length).toBeGreaterThan(0);
    expect(screen.getByText("1 left")).toBeTruthy();
  });

  it("says why a typed serial cannot go on the sale, rather than adding it", async () => {
    act(() => {
      mutate((d) => {
        d.units.find((u) => u.serial === "TILLBBB00002")!.status = "TERJUAL";
      });
    });
    renderTill();
    await openCatalogue();
    const search = screen.getByRole("searchbox", { name: "Search the stock" });
    await userEvent.type(search, "TILLBBB00002");
    expect(search).toHaveValue("TILLBBB00002");
    expect(screen.getByText(/TILLBBB00002 cannot be sold/)).toBeInTheDocument();
  });

  it("counts the picked machine off the row without hiding it", async () => {
    bothGradeA();
    renderTill();
    await pickFirstMachine();

    // A row that vanishes as it is clicked moves the next one under the hand.
    expect(screen.getByText("1 left")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /Choose a Till Test Air/ }),
    ).toHaveLength(1);
  });
});

/**
 * Move to step two, where everything that is not the basket lives.
 *
 * It was a collapsible section under the till and is a second STEP since the
 * owner's revision of 2026-09-01: *Continue* swaps the catalogue for the
 * discount, the trade-in, the charges, the channel, the payment method and the
 * people, all open at once. A fast sale never presses it, which is the point.
 */
async function goToPayment() {
  await userEvent.click(screen.getByRole("button", { name: /Continue/ }));
}

/**
 * Finish the sale, the way the counter now does it.
 *
 * Three presses since the owner's revision of 2026-09-01, and each is its own
 * decision: *Continue* leaves the catalogue, *Pay & finish* asks, and the
 * dialog's own button writes. Step one no longer carries a finish button at
 * all — the channel and the payment method live on step two, and a sale that
 * skipped it was a sale that had never seen them.
 *
 * `Continue` is pressed only when it is on screen, so this works from either
 * step.
 */
async function payAndFinish() {
  const cont = screen.queryByRole("button", { name: /^Continue$/ });
  if (cont) await userEvent.click(cont);
  await userEvent.click(screen.getByRole("button", { name: /^Pay & finish$/ }));
  // The dialog holding the confirmation, not merely the last one mounted: the
  // catalogue's chooser stays in the DOM behind it on the phone layout, which
  // every test gets unless it asks for a desktop viewport.
  const dialogs = await screen.findAllByRole("dialog");
  const confirm = dialogs.find((d) =>
    within(d).queryByRole("button", { name: /Record it|Record at a loss/ }),
  )!;
  await userEvent.click(
    within(confirm).getByRole("button", { name: /Record it|Record at a loss/ }),
  );
}

describe("a walk-in paying cash", () => {
  it("is recorded without answering anything about the people", async () => {
    renderTill();
    await pickFirstMachine();

    // Nothing about the people is answered, and nothing is going to be — but
    // step two is now walked through rather than skipped, because that is
    // where the channel and the payment method are.
    await payAndFinish();

    const db = snapshot();
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0]!.serials).toEqual(["TILLAAA00001"]);
    expect(db.orders[0]!.customerId).toBeNull();
    // The salesperson stopped being required on 2026-08-27. An empty one is an
    // honest record of a sale nobody claimed; a blocking dialog on a queue got
    // whichever name was first in the list, which is worse because it looks
    // like data.
    expect(db.orders[0]!.salesmanId).toBeUndefined();
    expect(db.units.find((u) => u.serial === "TILLAAA00001")!.status).toBe(
      "TERJUAL",
    );
  });

  it("keeps the channel and payment method between sales", async () => {
    renderTill();
    await pickFirstMachine();
    await goToPayment();
    // The chips are toggles since 2026-09-19: Cash off, Transfer on.
    await userEvent.click(screen.getByRole("button", { name: "Pay by Cash" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Pay by Transfer" }),
    );
    await payAndFinish();
    expect(snapshot().orders[0]!.payMethod).toBe("TRANSFER");

    // The same answer all afternoon. A till that forgets between sales asks
    // the same question ten times.
    await pickFirstMachine("TILLBBB00002");
    await payAndFinish();
    const orders = snapshot().orders;
    expect(orders).toHaveLength(2);
    expect(orders[0]!.payMethod).toBe("TRANSFER");
  });

  it("will not leave the catalogue with an empty basket", () => {
    // Step one ends in Continue and nothing else since 2026-09-01, so this is
    // the button that guards an empty sale now.
    renderTill();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
  });
});

describe("charging for delivery", () => {
  it("carries the extra onto the order, named", async () => {
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    // A charge is a row now, added on demand — the owner's "additional fee
    // could be more than 1".
    await userEvent.click(screen.getByRole("button", { name: /Add a charge/ }));
    // A `tags`-mode Select: the category list is the shop's own, and a charge
    // nobody anticipated is still allowed through as typed text.
    await userEvent.click(screen.getByLabelText("What for"));
    await userEvent.paste("Ongkir JNE");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByLabelText("Extra charge amount"));
    await userEvent.paste("150000");
    await payAndFinish();

    const order = snapshot().orders[0]!;
    // An `extra` with no note is a figure on an invoice nobody can account for
    // a month later.
    expect(order.extra).toBe(150_000);
    expect(order.extraNote).toBe("Ongkir JNE");
    expect(order.total).toBe(10_150_000);
  });
});

describe("paying a bill in more than one way", () => {
  /*
   * The owner's own example (2026-09-08): part of the bill in cash at the
   * counter, the rest on a marketplace. One method and one flag could not
   * describe it — the cash is in the till today and the marketplace money is
   * not — and which half is which is the only question the finance screens
   * ever ask of a sale.
   */
  it("records one payment for a sale nobody splits", async () => {
    // The common case has to be untouched: the chips still describe the whole
    // bill and the split grid is never opened.
    renderTill();
    await pickFirstMachine();
    await payAndFinish();

    const order = snapshot().orders[0]!;
    expect(order.payments).toHaveLength(1);
    expect(order.payments![0]).toMatchObject({
      amount: order.total,
      state: "SETTLED",
    });
    expect(order.settled).toBe(true);
  });

  it("records a split across two methods, the last taking the rest", async () => {
    // Owner revision 2026-09-19: pick several chips; each is listed with its
    // split amount and what was actually paid.
    renderTill();
    await pickFirstMachine();
    await goToPayment();

    await userEvent.click(
      screen.getByRole("button", { name: "Pay by Transfer" }),
    );
    const cashSplit = screen.getByLabelText("Amount paid, Cash");
    await userEvent.tripleClick(cashSplit);
    await userEvent.paste("4000000");
    // Transfer is last, so it takes what Cash leaves — no subtraction. The box
    // is EMPTY and says so in its placeholder (owner revision 2026-09-21):
    // blank means "all of it", and only a shortfall is ever typed.
    const transferPaid = screen.getByLabelText("Actual paid, Transfer");
    expect(transferPaid).toHaveValue("");
    expect(transferPaid).toHaveAttribute("placeholder", "6.000.000");

    await payAndFinish();

    const order = snapshot().orders[0]!;
    expect(order.payments!.map((p) => [p.method, p.amount, p.state])).toEqual([
      ["TUNAI", 4_000_000, "SETTLED"],
      ["TRANSFER", 6_000_000, "SETTLED"],
    ]);
    // Every rupiah is the shop's, so the sale IS settled.
    expect(order.settled).toBe(true);
  });

  it("records what is still owed when less was paid (piutang) — against somebody", async () => {
    renderTill();
    await pickFirstMachine();
    await goToPayment();

    const paid = screen.getByLabelText("Actual paid, Cash");
    await userEvent.tripleClick(paid);
    await userEvent.paste("3000000");
    expect(screen.getByText(/Customer owes/)).toBeInTheDocument();

    // A debt needs somebody to collect it from (owner ask 2026-09-24):
    // refused on this page, on the customer's box, and nothing is written.
    await userEvent.click(
      screen.getByRole("button", { name: /^Pay & finish$/ }),
    );
    expect(
      await screen.findAllByText(/add the customer's name or phone number/),
    ).not.toHaveLength(0);
    expect(snapshot().orders).toHaveLength(0);

    // A phone number alone is enough — "either is fine".
    await userEvent.click(screen.getByRole("button", { name: /Add customer/ }));
    const d = await dialog();
    await userEvent.type(d.getByLabelText("Phone number"), "+62811000999");
    await userEvent.click(d.getByRole("button", { name: /^OK$/ }));
    expect(
      await screen.findByText(/\+62811000999 added\./),
    ).toBeInTheDocument();

    await payAndFinish();

    const db = snapshot();
    const order = db.orders[0]!;
    expect(order.payments!.map((p) => [p.state, p.amount])).toEqual([
      ["SETTLED", 3_000_000],
      ["DUE", 7_000_000],
    ]);
    expect(order.settled).toBe(false);
    const debtor = db.customers.find((c) => c.id === order.customerId);
    expect(debtor).toMatchObject({ name: "", phone: "+62811000999" });
  });

  it("will not record a marketplace part without its own order number", async () => {
    renderTill();
    await pickFirstMachine();
    await goToPayment();

    await userEvent.click(screen.getByRole("button", { name: "Pay by Cash" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Pay by Shopee" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^Pay & finish$/ }),
    );
    // Refused on this page, on the box that needs the answer.
    expect(
      await screen.findAllByText(/the marketplace's order number/),
    ).not.toHaveLength(0);
    expect(snapshot().orders).toHaveLength(0);

    // In the Shopee row itself, where a cash row has its Actual paid (owner
    // revision 2026-09-21).
    await userEvent.type(
      screen.getByLabelText("Reference number, Shopee"),
      "240919ABCDEF",
    );
    await payAndFinish();

    const order = snapshot().orders[0]!;
    expect(order.payments).toEqual([
      expect.objectContaining({
        method: "MARKETPLACE",
        channel: "SHOPEE",
        state: "PENDING",
        amount: order.total,
        ref: "240919ABCDEF",
      }),
    ]);
    // Paid, but Shopee holds it until the payout.
    expect(order.settled).toBe(false);
  });

  it("gives a Shopee part and a Tokopedia part a number each", async () => {
    // Owner revision 2026-09-21: "if the user choose 1 shopee 1 tokopedia,
    // then have 2 reference number". Two platforms, two orders, two payouts.
    renderTill();
    await pickFirstMachine();
    await goToPayment();

    await userEvent.click(screen.getByRole("button", { name: "Pay by Cash" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Pay by Shopee" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pay by Tokopedia" }),
    );
    const shopeeAmount = screen.getByLabelText("Amount paid, Shopee");
    await userEvent.tripleClick(shopeeAmount);
    await userEvent.paste("4000000");
    // A marketplace row has no Actual paid — it is paid in full at checkout.
    expect(screen.queryByLabelText("Actual paid, Shopee")).toBeNull();
    await userEvent.type(
      screen.getByLabelText("Reference number, Shopee"),
      "2609SHOPEE01",
    );
    await userEvent.type(
      screen.getByLabelText("Reference number, Tokopedia"),
      "INV/TKP/0001",
    );
    await payAndFinish();

    const order = snapshot().orders[0]!;
    expect(
      order.payments!.map((p) => [p.channel, p.amount, p.ref, p.state]),
    ).toEqual([
      ["SHOPEE", 4_000_000, "2609SHOPEE01", "PENDING"],
      ["TOKOPEDIA", 6_000_000, "INV/TKP/0001", "PENDING"],
    ]);
  });
});

describe("a sale kept on this device", () => {
  it("is still there after leaving the till and coming back", async () => {
    // The in-app tab strip used to keep the till mounted; it is gone (owner
    // ask 2026-09-21), and what was typed is kept on this device instead.
    const first = renderTill();
    await pickFirstMachine();
    await goToPayment();
    await userEvent.click(
      screen.getByRole("button", { name: "Pay by Shopee" }),
    );
    await userEvent.type(
      screen.getByLabelText("Reference number, Shopee"),
      "2609KEPT0001",
    );
    first.unmount();

    renderTill();
    // Back on the payment step, with the same basket and the same answers.
    expect(
      await screen.findByRole("button", { name: /Go back to products/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Reference number, Shopee")).toHaveValue(
      "2609KEPT0001",
    );
    // …and the unit is still in the basket.
    await userEvent.click(
      screen.getByRole("button", { name: /Go back to products/ }),
    );
    expect(screen.getByLabelText("Price for TILLAAA00001")).toBeInTheDocument();
  });

  it("takes a unit sold elsewhere off a kept basket, and says so", async () => {
    localStorage.setItem(
      "nusantara.draft.till.lines",
      JSON.stringify([{ serial: "TILLAAA00001" }, { serial: "TILLBBB00002" }]),
    );
    act(() => {
      mutate((d) => {
        const u = d.units.find((x) => x.serial === "TILLAAA00001")!;
        u.status = "TERJUAL";
      });
    });
    renderTill();
    expect(
      await screen.findByText(
        "TILLAAA00001 is no longer for sale and was taken off this sale.",
      ),
    ).toBeInTheDocument();
    const kept = JSON.parse(
      localStorage.getItem("nusantara.draft.till.lines") ?? "[]",
    ) as { serial?: string }[];
    expect(kept.map((l) => l.serial)).toEqual(["TILLBBB00002"]);
  });
});

describe("taking a machine in part-exchange", () => {
  /**
   * A traded unit's barcode, and what a NEW one is filed under: the barcode
   * without its S (owner rules 2026-09-21).
   */
  const TRADED_BARCODE = "SC02TRADE001";
  const TRADED = "C02TRADE001";

  it("credits the bill and books the machine into QC", async () => {
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
    await chooseOption(d.getByLabelText(/^Product/), TILL_PRODUCT);
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), TRADED_BARCODE);
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    // New, so no grading checklist is owed — `lib/condition.ts` is explicit
    // that there is nothing to inspect in a sealed box, and the dialog draws
    // no star on the grade for one.
    // antd's Segmented puts `pointer-events: none` on the radio itself and
    // takes the click on the label wrapping it.
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));

    await payAndFinish();

    const db = snapshot();
    const order = db.orders[0]!;
    expect(order.total).toBe(8_000_000);
    expect(order.tradeIns).toHaveLength(1);

    // The shop has BOUGHT the machine, so it enters exactly as a machine off a
    // purchase order does — at QC, with the price as its cost, and an arrival
    // on its timeline.
    const taken = db.units.find((u) => u.serial === TRADED)!;
    expect(taken.status).toBe("QC");
    expect(taken.buy).toBe(2_000_000);
    expect(
      db.events.filter((e) => e.serial === TRADED).map((e) => e.type),
    ).toEqual(["DITERIMA"]);
  });

  it("corrects a trade-in already on the sale, in place", async () => {
    // Owner ask 2026-10-02: a trade-in could only be deleted and typed again.
    // Its own serial: the test above already stocked TRADED.
    const barcode = "SC02TRADE009";
    const filed = "C02TRADE009";
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    let d = await dialog();
    await chooseOption(d.getByLabelText(/^Product/), TILL_PRODUCT);
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), barcode);
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Edit trade-in Air 2017" }),
    );
    d = await dialog();
    // It opens on what it said.
    expect(d.getByLabelText(/Description/)).toHaveValue("Air 2017");
    const desc = d.getByLabelText(/Description/);
    await userEvent.clear(desc);
    await userEvent.type(desc, "Air 2017, dent on lid");
    const price = d.getByLabelText(/Price/);
    await userEvent.clear(price);
    await userEvent.click(price);
    await userEvent.paste("1500000");
    await userEvent.click(d.getByRole("button", { name: "Save" }));

    await payAndFinish();

    const order = snapshot().orders[0]!;
    // Replaced, not added beside the old one.
    expect(order.tradeIns).toHaveLength(1);
    expect(order.tradeIns![0]!.label).toBe("Air 2017, dent on lid");
    expect(order.tradeIns![0]!.value).toBe(1_500_000);
    expect(order.total).toBe(8_500_000);
    expect(snapshot().units.find((u) => u.serial === filed)!.buy).toBe(
      1_500_000,
    );
  });

  it("will not take a trade-in whose serial is not a real barcode", async () => {
    // The same shape rule intake enforces, for the same reason: this dialog
    // MINTS a unit, and a machine filed under a malformed serial is one no
    // later scan of it will find. Owner ask 2026-09-01.
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
    await chooseOption(d.getByLabelText(/^Product/), TILL_PRODUCT);
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    // Fourteen characters: too long for the app to put a marker in front of
    // (10–12 is a bare serial), and carrying none of its own. Neither form,
    // so nothing rescues it.
    await userEvent.type(d.getByLabelText(/Serial/), "TRADEIN0000123");
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    // antd's Segmented puts `pointer-events: none` on the radio itself and
    // takes the click on the label wrapping it.
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));

    // Refused, and the dialog stays open with the reason on it.
    expect(
      await d.findByText(/is not a new unit's serial/),
    ).toBeInTheDocument();
    // On the FIELD, not in a banner at the top of a dialog that scrolls
    // (owner ask 2026-09-01). The reason names a serial; the outline says
    // which box is holding it.
    expect(
      d.getByLabelText(/Serial/).closest(".ant-form-item-has-error"),
    ).not.toBeNull();
    expect(snapshot().units.some((u) => u.serial === "TRADEIN0000123")).toBe(
      false,
    );
  });

  it("files a new unit's serial as read off its case — no S added", async () => {
    // Owner rules 2026-09-21: the S is the BARCODE's, never the serial's. A
    // unit traded in arrives with no paperwork, so its serial is read off the
    // case, and that is what it is filed under.
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
    await chooseOption(d.getByLabelText(/^Product/), TILL_PRODUCT);
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), "c02dqxfpxwck");
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));

    // The machine is minted with the sale, exactly as the test above shows.
    await payAndFinish();

    // Filed as it is on the case, upper-cased on the way.
    expect(snapshot().units.some((u) => u.serial === "C02DQXFPXWCK")).toBe(
      true,
    );
    expect(snapshot().units.some((u) => u.serial === "SC02DQXFPXWCK")).toBe(
      false,
    );
  });

  /*
   * Owner revision 2026-09-19: "Trade-Ins", one star, nothing drawn for a
   * sealed machine, no price cards — and no field waits for another.
   */
  it("is titled Trade-Ins and adds no star of its own", async () => {
    renderTill();
    await pickFirstMachine();
    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();

    expect(d.getByText("Trade-Ins")).toBeInTheDocument();
    // The star is the app-wide required mark's (theme/requiredMark.tsx — not
    // mounted here). The dialog used to write its own `*` into the label as
    // well, so in the app every required field read "Product * *".
    expect(document.querySelector('label[for="skuId"]')?.textContent).toBe(
      "Product",
    );
    expect(d.queryByText(/We list it at/)).toBeNull();
    expect(d.queryByText(/We have paid/)).toBeNull();
  });

  it("draws nothing to grade on a new machine", async () => {
    renderTill();
    await pickFirstMachine();
    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();

    expect(d.getByLabelText("Grade")).toBeInTheDocument();
    await userEvent.click(d.getByText("New"));
    expect(d.queryByLabelText("Grade")).toBeNull();
  });

  it("grades a unit before its product is found", async () => {
    // The category is its own box, and the product can be found afterwards.
    renderTill();
    await pickFirstMachine();
    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();

    const category = snapshot().models.find(
      (m) => m.id === snapshot().skus.find((s) => s.id === SKU)!.modelId,
    )!.category;
    await chooseOption(d.getByLabelText(/^Category/), category);
    await chooseOption(d.getByLabelText("Grade"), "B");

    // …and the product last, which keeps the category it agrees with.
    await chooseOption(d.getByLabelText(/^Product/), TILL_PRODUCT);
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), "STRADEIN0002");
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    await userEvent.click(d.getByRole("button", { name: "Add it" }));
    await payAndFinish();

    const taken = snapshot().units.find((u) => u.serial === "STRADEIN0002")!;
    expect(taken.skuId).toBe(SKU);
    expect(taken.grade).toBe("B");
  });

  it("takes an accessory in without a serial, as a quantity", async () => {
    // Owner brief 2026-09-19: "Accessories: do not have battery and serial".
    const db = snapshot();
    const sleeve = db.skus.find((s) => {
      const model = db.models.find((m) => m.id === s.modelId);
      return db.categories.some(
        (c) => c.name === model?.category && !c.tracksSerial,
      );
    })!;
    renderTill();
    await pickFirstMachine();
    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
    await chooseOption(d.getByLabelText(/^Product/), sleeve.code);
    // No box for a number nobody reads off an accessory.
    await vi.waitFor(() => expect(d.queryByLabelText(/Serial/)).toBeNull());
    await userEvent.type(d.getByLabelText(/Description/), "Sleeve bekas");
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("100000");
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));
    await payAndFinish();

    // A quantity on the stock ledger, at what was allowed for it — and no
    // unit minted to hold it (2026-09-19).
    const db2 = snapshot();
    expect(db2.units.some((u) => u.skuId === sleeve.id)).toBe(false);
    expect(db2.stockMoves.find((m) => m.skuId === sleeve.id)).toMatchObject({
      type: "TUKAR_TAMBAH",
      qty: 1,
      cost: 100_000,
    });
  });

  it("will not take a trade-in without its product", async () => {
    // A unit is filed under a variant, and the store refuses one with none —
    // which would have refused the whole sale with it.
    renderTill();
    await pickFirstMachine();
    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();

    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), "STRADEIN0003");
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));

    expect(await d.findByText(/Pick the product/)).toBeInTheDocument();
  });
});

/**
 * The 2026-09-01 owner revisions to the till.
 *
 * Four separate asks, and all four are about what a person at the counter can
 * see: keep the serial chooser open for a repeat purchase, keep the shop's
 * cost off the customer-facing panel, show a negotiated price as a
 * negotiation, and credit the salesperson for the ones that go the other way.
 */
describe("the price a machine actually goes out at", () => {
  it("keeps the subtotal at the list price and books the difference as a bargain", async () => {
    renderTill();
    await pickFirstMachine();

    // Rp 10.000.000 asked, Rp 9.250.000 agreed at the counter.
    const price = screen.getByLabelText("Price for TILLAAA00001");
    await userEvent.tripleClick(price);
    await userEvent.paste("9250000");
    await payAndFinish();

    const order = snapshot().orders[0]!;
    expect(order.prices["TILLAAA00001"]).toBe(9_250_000);
    // The snapshot is what makes the difference readable a month later, when
    // the variant may well have been repriced.
    expect(order.listPrices!["TILLAAA00001"]).toBe(10_000_000);
    expect(order.total).toBe(9_250_000);
    // Not a discount. A discount is the shop's own promotion, with a code and
    // a window; this is one cashier and one customer agreeing a number.
    expect(order.discount).toBe(0);
    expect(order.discountId).toBeUndefined();
  });

  it("credits a sale above the list price to the salesperson", async () => {
    renderTill();
    await pickFirstMachine();

    const price = screen.getByLabelText("Price for TILLAAA00001");
    await userEvent.tripleClick(price);
    await userEvent.paste("10800000");
    await goToPayment();
    await payAndFinish();

    const order = snapshot().orders[0]!;
    expect(upsellOn(order)).toBe(800_000);
    expect(bargainOn(order)).toBe(0);
  });

  it("keeps what the shop paid off the counter-facing panel", async () => {
    renderTill();
    await pickFirstMachine();

    // Rp 8.000.000 is `Unit.buy` — the fixture's cost. It used to be one
    // subtraction away from a live margin printed beside the price box.
    expect(screen.queryByText(/8.000.000/)).toBeNull();

    await userEvent.click(
      screen.getByLabelText("Price detail for TILLAAA00001"),
    );
    const d = await dialog();
    // The three the owner named, and the cost the margin is computed from.
    expect(d.getByText("Original price")).toBeTruthy();
    expect(d.getByText("Sell price")).toBeTruthy();
    expect(d.getByText("Margin")).toBeTruthy();
    expect(d.getByText("20.0%")).toBeTruthy();
  });
});

describe("buying two of the same variant", () => {
  it("leaves the chooser open until every machine is taken", async () => {
    bothGradeA();
    renderTill();
    await openCatalogue();
    await userEvent.click(
      screen.getByRole("button", { name: tillAirRow("A") }),
    );

    // First of two. The dialog stays: the owner's ask is that a customer
    // taking three of a kind does not reopen it three times.
    await userEvent.click(await screen.findByLabelText("Pick TILLAAA00001"));
    expect(screen.getByLabelText("Pick TILLBBB00002")).toBeTruthy();

    // Second and last. Nothing is left to choose, so it closes itself.
    await userEvent.click(screen.getByLabelText("Pick TILLBBB00002"));
    expect(screen.queryByLabelText("Pick TILLAAA00001")).toBeNull();

    await payAndFinish();
    expect(snapshot().orders[0]!.serials).toEqual([
      "TILLAAA00001",
      "TILLBBB00002",
    ]);
  });
});

/**
 * The two shapes the till takes (owner asks 2026-09-01).
 *
 * Worth its own block because `test/setup.ts` reports a phone to every test in
 * this file, so the desktop half would otherwise never render at all — and the
 * two differ in where the catalogue lives, which is the thing most likely to
 * break silently.
 */
describe("phone and desktop", () => {
  it("puts the catalogue behind a button on a phone", async () => {
    renderTill();
    // Not on the page: adding a product is its own task on a 375px screen,
    // and stacking forty rows above the basket meant scrolling past them to
    // reach the sale.
    expect(
      screen.queryByRole("button", { name: /Choose a Till Test Air/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Add product/ })).toBeVisible();
    // And reachable from it. `toBeInTheDocument` rather than `toBeVisible`:
    // the dialog does open, but antd's zoom motion parks `.ant-modal` on
    // `ant-zoom-appear-prepare` — `opacity: 0` — until a `transitionend` that
    // jsdom never fires, and `toBeVisible` walks the ancestors checking
    // opacity. `getByRole` still finds the row, because the accessibility tree
    // only drops `display: none`, so `findByRole` would not have helped: the
    // query was never what failed. The row being present IS the claim — that
    // Modal is `destroyOnHidden`, so the row is in the DOM only while the
    // dialog is open — and every other test in this file proves it is
    // clickable by clicking it through `pickFirstMachine`.
    await openCatalogue();
    expect(
      screen.getByRole("button", { name: tillAirRow("A") }),
    ).toBeInTheDocument();
  });

  it("puts it in a column on a desktop, with no Add product button", () => {
    useDesktopViewport();
    renderTill();
    expect(screen.getByRole("button", { name: tillAirRow("A") })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Add product/ })).toBeNull();
  });

  it("keeps the money reachable without a scroll on both", async () => {
    // The panel is anchored to the bottom of the column on a phone and sticky
    // beside the catalogue on a desktop. Either way the total and the button
    // are rendered — which is the promise; where they sit is CSS this test
    // cannot see.
    renderTill();
    await pickFirstMachine();
    expect(screen.getByRole("button", { name: /^Continue$/ })).toBeVisible();
  });
});

/**
 * What a machine cost, with its invoice's shipping and tax on it (owner ask
 * 2026-09-15: *"Shipping fee and tax fee should be divided across all units
 * evenly for the COGS and margin calculation"*).
 *
 * Both machines on this till come off one invoice of two rows — one per
 * machine, the shape Inbound & QC writes — that charged Rp300.000 of ongkir
 * and Rp100.000 of tax. Each has therefore cost the shop Rp8.200.000, not the
 * Rp8.000.000 its row says, and the margin and the below-cost warning both
 * have to know.
 */
describe("a machine's share of its invoice's shipping and tax", () => {
  beforeEach(() => {
    mutate((d) => {
      d.pos = d.pos.filter((p) => p.id !== "po-till");
      d.pos.push({
        id: "po-till",
        code: "PI-TILL",
        supplierId: d.suppliers[0]!.id,
        invoice: "INV-TILL",
        date: "2026-09-01",
        locationId: d.myWarehouseId,
        items: ["TILLAAA00001", "TILLBBB00002"].map((serial, i) => ({
          id: `po-till-${i + 1}`,
          skuId: SKU,
          serial,
          qty: 1,
          unitCost: 8_000_000,
        })),
        payments: [],
        fees: [
          {
            id: "f1",
            kind: "SHIPPING",
            label: "",
            amount: 300_000,
            inCogs: true,
          },
          { id: "f2", kind: "TAX", label: "", amount: 100_000, inCogs: true },
        ],
        discount: 0,
        status: "RECEIVED",
      });
      // Only the machines the outer `beforeEach` just shelved: earlier tests
      // leave sold copies of the same serials behind, and those are not on
      // this invoice.
      for (const u of d.units) {
        if (u.skuId === SKU && u.status === "TERSEDIA") u.poId = "po-till";
      }
    });
  });

  it("puts the share on its own line and takes the margin after it", async () => {
    renderTill();
    await pickFirstMachine();
    await userEvent.click(
      screen.getByLabelText("Price detail for TILLAAA00001"),
    );
    const d = await dialog();
    // Named PURCHASE shipping: a sale has a delivery charge of its own, and
    // this is not it.
    expect(d.getByText("Purchase shipping & tax")).toBeTruthy();
    expect(d.getByText("Rp 200.000")).toBeTruthy();
    expect(d.getByText("Rp 8.200.000")).toBeTruthy();
    // (10.000.000 − 8.200.000) ÷ 10.000.000, where the row's price alone
    // said 20%.
    expect(d.getByText("18.0%")).toBeTruthy();
  });

  it("calls a price under that cost a loss, though it is above the row's price", async () => {
    renderTill();
    await pickFirstMachine();
    // Above the Rp8.000.000 on the invoice row, below the Rp8.200.000 the
    // machine has actually cost.
    const price = screen.getByLabelText("Price for TILLAAA00001");
    await userEvent.tripleClick(price);
    await userEvent.paste("8100000");
    await userEvent.click(screen.getByRole("button", { name: /^Continue$/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /^Pay & finish$/ }),
    );
    expect(
      await screen.findByRole("button", { name: /Record at a loss/ }),
    ).toBeTruthy();
    // Scoped to the confirm dialog: the totals panel behind it says the same
    // sentence, which is the point of both — the panel warns while there is
    // still time to change the price, the dialog asks before it is recorded.
    const d = await dialog();
    expect(
      d.getByText("1 line(s) priced below what the shop paid."),
    ).toBeTruthy();
  });
});

describe("a visit the bot booked (2026-10-27)", () => {
  const VISIT = "rsv-till-visit";
  it("is offered among the reservations and loads only the customer", async () => {
    mutate((d) => {
      d.reservations = d.reservations.filter((r) => r.id !== VISIT);
      d.reservations.push({
        id: VISIT,
        code: "RV-2026/10-000991",
        customerId: d.customers[0]!.id,
        when: "2026-10-31T07:00:00.000Z",
        note: "",
        items: [],
        status: "ACTIVE",
      });
    });
    try {
      renderTill();
      const before = screen.getAllByRole("button", {
        name: /Reservations \(\d+\)/,
      })[0]!;
      await userEvent.click(before);
      const picker = await dialog();
      const row = (await picker.findByText("Visit")).closest(
        "tr",
      ) as HTMLElement;
      await userEvent.click(
        within(row).getByRole("button", { name: "Use this" }),
      );
      expect(
        await screen.findByText(/from the visit RV-2026\/10-000991/),
      ).toBeInTheDocument();
      // No unit came with it: nothing was held.
      expect(screen.queryByText(/Loaded \d+ unit/)).toBeNull();
    } finally {
      mutate((d) => {
        d.reservations = d.reservations.filter((r) => r.id !== VISIT);
      });
    }
  });
});

describe("holds and DPs at the till (2026-10-27)", () => {
  const RV = "rsv-till-dp";
  const RV_CODE = "RV-2026/10-000992";
  const clean = () =>
    mutate((d) => {
      d.reservations = d.reservations.filter((r) => r.id !== RV);
      d.events = d.events.filter((e) => e.refCode !== RV_CODE);
    });

  /** The confirmation dialog, by the button that records. */
  async function confirmDialog(name: RegExp) {
    const dialogs = await screen.findAllByRole("dialog");
    return within(
      dialogs.find((d) => within(d).queryByRole("button", { name }))!,
    );
  }

  it("takes the DP toward the bill, asks only for the rest, and puts the SAME payment on the sale", async () => {
    mutate((d) => {
      const u = d.units.find((x) => x.serial === "TILLAAA00001")!;
      u.status = "DIRESERVASI";
      d.events.push({
        id: "till-dp-ev",
        serial: u.serial,
        seq: 1,
        type: "DIRESERVASI",
        at: "2026-10-27T03:00:00.000Z",
        fromStatus: "TERSEDIA",
        toStatus: "DIRESERVASI",
        locationId: u.locationId,
        refCode: RV_CODE,
        staff: "Michella",
      });
      d.reservations = d.reservations.filter((r) => r.id !== RV);
      d.reservations.push({
        id: RV,
        code: RV_CODE,
        customerId: d.customers[0]!.id,
        when: "2026-10-30T07:00:00.000Z",
        note: "",
        items: [{ id: "rvi-till-dp", serial: u.serial }],
        status: "ACTIVE",
        heldUntil: "2099-11-03T03:00:00.000Z",
        dp: {
          id: "pay-till-dp",
          method: "TRANSFER",
          amount: 500_000,
          at: "2026-10-27T03:00:00.000Z",
        },
      });
    });
    try {
      renderTill();
      await userEvent.click(
        screen.getAllByRole("button", { name: /Reservations \(\d+\)/ })[0]!,
      );
      const picker = await dialog();
      const row = (await picker.findByText("Rp 500.000 paid")).closest(
        "tr",
      ) as HTMLElement;
      await userEvent.click(
        within(row).getByRole("button", { name: "Use this" }),
      );
      expect(
        await screen.findByText(`DP already paid (${RV_CODE})`),
      ).toBeInTheDocument();
      expect(screen.getByText("Rp 9.500.000")).toBeInTheDocument();

      await payAndFinish();
      const order = snapshot().orders[0]!;
      expect(order.total).toBe(10_000_000);
      expect(order.settled).toBe(true);
      // The DP first, as the reservation's own row; only the rest collected.
      expect(
        order.payments!.map((p) => [p.id, p.method, p.amount, p.reservationId]),
      ).toEqual([
        ["pay-till-dp", "TRANSFER", 500_000, RV],
        [expect.any(String), "TUNAI", 9_500_000, undefined],
      ]);
      const hold = snapshot().reservations.find((r) => r.id === RV)!;
      expect(hold.dp!.orderId).toBe(order.id);
      expect(hold.status).toBe("DONE");
    } finally {
      clean();
    }
  });

  it("asks before selling a unit reserved unpaid for somebody else, then takes it off their hold", async () => {
    mutate((d) => {
      d.reservations = d.reservations.filter((r) => r.id !== RV);
      d.reservations.push({
        id: RV,
        code: RV_CODE,
        customerId: d.customers[0]!.id,
        when: "2026-10-30T07:00:00.000Z",
        note: "",
        items: [{ id: "rvi-till-soft", serial: "TILLAAA00001" }],
        status: "ACTIVE",
      });
    });
    const name = (() => {
      const c = snapshot().customers[0]!;
      return c.name || c.phone;
    })();
    try {
      renderTill();
      await pickFirstMachine();
      // On sale all along, and tagged for whom it is reserved.
      expect(
        screen.getAllByText(`Reserved for ${name}, not paid`).length,
      ).toBeGreaterThan(0);
      await userEvent.click(screen.getByRole("button", { name: /^Continue$/ }));
      await userEvent.click(
        screen.getByRole("button", { name: /^Pay & finish$/ }),
      );
      const confirm = await confirmDialog(/Sell anyway/);
      expect(
        confirm.getByText(
          `TILLAAA00001 is held for ${name}, not paid. Sell anyway?`,
        ),
      ).toBeInTheDocument();
      await userEvent.click(
        confirm.getByRole("button", { name: /Sell anyway/ }),
      );

      expect(snapshot().orders).toHaveLength(1);
      const hold = snapshot().reservations.find((r) => r.id === RV)!;
      expect(hold.items).toEqual([]);
      expect(hold.status).toBe("CANCELLED");
      expect(hold.note).toMatch(
        /TILLAAA00001 was sold to another buyer on SI-/,
      );
    } finally {
      clean();
    }
  });
});
