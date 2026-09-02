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
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockOutPage } from "../src/routes/stock/StockOutPage.js";
import { mutate } from "../src/mock/store.js";
import { bargainOn, upsellOn } from "../src/lib/pos.js";
import type { MockDb } from "../src/mock/seed.js";

// Same reasoning as inboundQcPage.test.tsx: every test renders the whole page
// and drives it with real events, so the cost is a multiple of the page rather
// than of the assertion, and it moves with how busy the machine is.
vi.setConfig({ testTimeout: 60_000 });

const SKU = "sku-till";

function snapshot(): MockDb {
  let seen!: MockDb;
  act(() => {
    mutate((d) => {
      seen = d;
    });
  });
  return seen;
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

beforeEach(() => {
  // One variant with two machines of different grades, and nothing else on the
  // shelf, so the catalogue is one row and the chooser has a real choice.
  mutate((d) => {
    // Both sellable statuses go, so the catalogue holds only the variant this
    // file makes — otherwise "1 left" matches a seeded row as well as ours.
    d.units = d.units.filter(
      (u) => u.status !== "TERSEDIA" && u.status !== "DIRESERVASI",
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

/** Put the shop's only variant in the basket, via the chooser. */
async function pickFirstMachine(serial = "TILLAAA00001") {
  await openCatalogue();
  await userEvent.click(
    screen.getByRole("button", { name: /Choose a Till Test Air/ }),
  );
  // By the button's own `aria-label`, which names the machine — walking the
  // DOM for the row would be a test that breaks on a layout change rather
  // than on a behaviour one.
  await userEvent.click(await screen.findByLabelText(`Pick ${serial}`));
}

describe("picking a machine", () => {
  it("lists variants with a count, not one row per serial", async () => {
    renderTill();
    await openCatalogue();
    // Two machines, one row. The rebuild's whole premise: a customer points at
    // a model, and forty rows of C02XY… is not an answer to that.
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
    renderTill();
    await openCatalogue();
    await userEvent.click(
      screen.getByRole("button", { name: /Choose a Till Test Air/ }),
    );

    // The owner's answer of 2026-08-27. Both machines are offered, and the
    // grade is why you would choose between them.
    const d = await dialog();
    expect(d.getByText("TILLAAA00001")).toBeTruthy();
    expect(d.getByText("TILLBBB00002")).toBeTruthy();
    expect(d.getByLabelText("Pick TILLAAA00001")).toBeTruthy();
    expect(d.getByLabelText("Pick TILLBBB00002")).toBeTruthy();
  });

  it("counts the picked machine off the row without hiding it", async () => {
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
  await userEvent.click(
    screen.getByRole("button", { name: /^Pay & finish$/ }),
  );
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
    await userEvent.click(screen.getByRole("button", { name: "QRIS" }));
    await payAndFinish();
    expect(snapshot().orders[0]!.payMethod).toBe("QRIS");

    // The same answer all afternoon. A till that forgets between sales asks
    // the same question ten times.
    await pickFirstMachine("TILLBBB00002");
    await payAndFinish();
    const orders = snapshot().orders;
    expect(orders).toHaveLength(2);
    expect(orders[0]!.payMethod).toBe("QRIS");
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

describe("taking a machine in part-exchange", () => {
  /** The serial a traded machine comes in under. `S` + ten, like every other. */
  const TRADED = "STRADEIN0001";

  it("credits the bill and books the machine into QC", async () => {
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), TRADED);
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

  it("will not take a trade-in whose serial is not a real barcode", async () => {
    // The same shape rule intake enforces, for the same reason: this dialog
    // MINTS a unit, and a machine filed under a malformed serial is one no
    // later scan of it will find. Owner ask 2026-09-01.
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
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
    expect(await d.findByText(/is not a serial/)).toBeInTheDocument();
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

  it("puts the S back on a serial read off the customer's machine", async () => {
    // Owner ask 2026-09-01: the marker is printed under the bars, not on the
    // case. A machine traded in arrives with no paperwork and no sticker, so
    // its serial is always read off the case — this is the desk where being
    // asked for a character that is not in front of you bites hardest.
    renderTill();
    await pickFirstMachine();

    await goToPayment();
    await userEvent.click(screen.getByRole("button", { name: /Trade-in/ }));
    const d = await dialog();
    await userEvent.type(d.getByLabelText(/Description/), "Air 2017");
    await userEvent.type(d.getByLabelText(/Serial/), "c02dqxfpxwck");
    await userEvent.click(d.getByLabelText(/Price/));
    await userEvent.paste("2000000");
    await userEvent.click(d.getByText("New"));
    await userEvent.click(d.getByRole("button", { name: "Add it" }));

    // The machine is minted with the sale, exactly as the test above shows.
    await payAndFinish();

    // Filed with its marker, and upper-cased on the way.
    expect(snapshot().units.some((u) => u.serial === "SC02DQXFPXWCK")).toBe(
      true,
    );
    expect(snapshot().units.some((u) => u.serial === "C02DQXFPXWCK")).toBe(
      false,
    );
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
    renderTill();
    await openCatalogue();
    await userEvent.click(
      screen.getByRole("button", { name: /Choose a Till Test Air/ }),
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
      screen.getByRole("button", { name: /Choose a Till Test Air/ }),
    ).toBeInTheDocument();
  });

  it("puts it in a column on a desktop, with no Add product button", () => {
    useDesktopViewport();
    renderTill();
    expect(
      screen.getByRole("button", { name: /Choose a Till Test Air/ }),
    ).toBeVisible();
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
