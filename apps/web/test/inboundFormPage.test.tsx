/**
 * The order form's second step (owner ask 2026-09-20).
 *
 * > *"If the purchase has arrived, user will input: unit, qty, price. It will
 * > not automatically expand the unit below it. … When the user clicks tab,
 * > then it will display a modal popup for the user to fill: Serial, grade,
 * > battery, sell price."*
 *
 * The step itself is drawn by `PurchaseLinesTable`, which the order page
 * draws too, so `test/inboundQcPage.test.tsx` guards its behaviour. What is
 * only here is what happens at Save: the serials typed into the popup become
 * real units in QC, with their `DITERIMA`, in one mutation. Nothing else on
 * the form writes a unit, so nothing else would have caught it.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundFormPage } from "../src/routes/inbound/InboundFormPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { INBOUND_DRAFT_KEY } from "../src/lib/inboundDraft.js";
import type { MockDb } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 60_000 });

const SKU = "m-pro13-2016-v1";
const SERIAL = "SC02FF777FFFX";

const snapshot = (): MockDb => getDb();

function renderForm() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <InboundFormPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** Pick an option of an antd Select by the title its list prints. */
async function chooseOption(control: HTMLElement, title: string) {
  fireEvent.mouseDown(control);
  fireEvent.change(control, { target: { value: title } });
  const option = await vi.waitFor(() => {
    // The list opened last. rc-select portals its dropdown and leaves every
    // one it has opened mounted, so a bare document query finds the FIRST
    // line's list — and clicking an option nobody can see leaves the line
    // the caller meant with no product at all.
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      ),
    );
    const found = open[open.length - 1]?.querySelector<HTMLElement>(
      `.ant-select-item-option[title="${CSS.escape(title)}"]`,
    );
    if (!found) throw new Error(`no option “${title}” open`);
    return found;
  });
  fireEvent.click(option);
}

/** Step 1's three required answers, then on to the products. */
async function fillOrderStep() {
  await userEvent.type(screen.getByLabelText("Supplier"), "CV Apel Segar");
  await userEvent.type(screen.getByPlaceholderText(/e.g. INV/), "AS-999");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** A product and how many, on a fresh line under the table. */
async function addLine(qty: number) {
  const code = snapshot().skus.find((s) => s.id === SKU)!.code;
  await userEvent.click(screen.getByRole("button", { name: /Add a product/ }));
  const pickers = screen.getAllByRole("combobox", { name: "Product" });
  await chooseOption(pickers[pickers.length - 1]!, code);
  const boxes = screen.getAllByLabelText("Qty");
  const box = boxes[boxes.length - 1]!;
  await userEvent.clear(box);
  // Enter commits the count; the box is written when it is left, not per
  // keystroke.
  await userEvent.type(box, `${qty}{Enter}`);
}

beforeEach(() => {
  window.localStorage.removeItem(INBOUND_DRAFT_KEY);
  mutate((d) => {
    d.units = d.units.filter((u) => u.serial !== SERIAL);
    d.events = d.events.filter((e) => e.serial !== SERIAL);
  });
});

describe("the order form's products", () => {
  it("adds one line of a quantity, never a row per unit", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(3);

    expect(screen.getAllByLabelText("Qty")).toHaveLength(1);
    expect(screen.getByLabelText("Qty")).toHaveValue("3");
    // One price and one discount for the line, and a popup for the units.
    expect(screen.getAllByLabelText(/^Unit price of /)).toHaveLength(1);
    expect(screen.getAllByLabelText(/^Discount on /)).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    ).toHaveTextContent("See all units (0/3)");
  });

  it("puts the caret in the new line's picker", async () => {
    // Adding a line lands where the typing continues — product, then qty,
    // price, discount, ⇥ for the units.
    renderForm();
    await fillOrderStep();
    await userEvent.click(
      screen.getByRole("button", { name: /Add a product/ }),
    );
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "Product" }),
      ),
    );
  });

  it("shows the line's total and its COGS, expenses and discount included", async () => {
    renderForm();
    // Rp300.000 of shipping on step 1, spread over the line's pieces.
    await userEvent.type(screen.getByLabelText("Supplier"), "CV Apel Segar");
    await userEvent.type(screen.getByPlaceholderText(/e.g. INV/), "AS-999");
    await userEvent.click(screen.getByLabelText("Shipping fee"));
    await userEvent.paste("300000");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await addLine(2);

    await userEvent.click(screen.getAllByLabelText(/^Unit price of /)[0]!);
    await userEvent.paste("4000000");
    await userEvent.tab();
    await userEvent.click(screen.getAllByLabelText(/^Discount on /)[0]!);
    await userEvent.paste("500000");
    await userEvent.tab();

    // 2 × 4.000.000 − 500.000 = 7.500.000 owed, plus the whole shipping —
    // the same figure the footer totals, so both are on the page.
    expect(screen.getAllByText("Rp 7.500.000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rp 7.800.000").length).toBeGreaterThan(0);
  });

  it("opens the units on Tab out of the discount box", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(1);

    await userEvent.click(screen.getAllByLabelText(/^Discount on /)[0]!);
    await userEvent.tab();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Serial")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Grade")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Sell price")).toBeInTheDocument();
  });

  it("makes a unit in QC of every serial the popup was given", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(1);

    await userEvent.click(screen.getAllByLabelText(/^Unit price of /)[0]!);
    await userEvent.paste("4000000");
    await userEvent.tab();

    await userEvent.click(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("Serial"));
    await userEvent.paste(SERIAL);
    await userEvent.tab();
    // A serial is recorded once its unit has a grade (2026-09-21).
    await chooseOption(within(dialog).getByLabelText("Grade"), "A");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: /Save order/ }));

    const db = snapshot();
    const unit = db.units.find((u) => u.serial === SERIAL);
    expect(unit).toMatchObject({ status: "QC", skuId: SKU, buy: 4_000_000 });
    // The one rule: the row and the event that explains it, together.
    expect(db.events.filter((e) => e.serial === SERIAL)).toHaveLength(1);
    // A unit in hand is the proof the goods came.
    expect(db.pos.find((p) => p.id === unit!.poId)!.status).toBe("RECEIVED");
  });

  it("keeps two lines of one product apart, prices and serials both", async () => {
    // The trap: filtering the saved invoice by PRODUCT runs the two lines
    // together, so the second line's serials take the first line's price.
    renderForm();
    await fillOrderStep();
    await addLine(1);
    await userEvent.click(screen.getAllByLabelText(/^Unit price of /)[0]!);
    await userEvent.paste("4000000");
    await userEvent.tab();

    await addLine(1);
    await userEvent.click(screen.getAllByLabelText(/^Unit price of /)[1]!);
    await userEvent.paste("5000000");
    await userEvent.tab();

    // The second line's unit, and only it.
    await userEvent.click(
      screen.getAllByRole("button", { name: /Serials and QC for/ })[1]!,
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("Serial"));
    await userEvent.paste(SERIAL);
    await userEvent.tab();
    await chooseOption(within(dialog).getByLabelText("Grade"), "A");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: /Save order/ }));

    expect(snapshot().units.find((u) => u.serial === SERIAL)!.buy).toBe(
      5_000_000,
    );
  });

  it("writes no unit at all when the order is only a draft", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(1);

    await userEvent.click(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("Serial"));
    await userEvent.paste(SERIAL);
    await userEvent.tab();
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    // A draft is paperwork nobody has acted on; a unit is a machine on a
    // shelf. The serial is kept on the line, ready for the order's page.
    expect(snapshot().units.some((u) => u.serial === SERIAL)).toBe(false);
    const po = snapshot().pos.find((p) => p.status === "DRAFT")!;
    expect(po.items[0]!.serial).toBe(SERIAL);
  });

  it("refuses a new unit's serial that is not one, and keeps what was typed", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(1);

    await userEvent.click(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await chooseOption(within(dialog).getByLabelText("Grade"), "New");
    const box = within(dialog).getByLabelText("Serial");
    await userEvent.click(box);
    // Only a NEW unit's serial is judged (owner rules 2026-09-21).
    await userEvent.paste("NO-PE");
    await userEvent.tab();

    // Outlined in red, and the text survives being looked at — a typo has to
    // be fixable by editing (owner report 2026-09-01).
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveValue("NO-PE");
  });

  it("files a new unit's serial without its barcode's S", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(1);
    await userEvent.click(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await chooseOption(within(dialog).getByLabelText("Grade"), "New");
    const box = within(dialog).getByLabelText("Serial");
    await userEvent.click(box);
    await userEvent.paste(SERIAL);
    await userEvent.tab();
    expect(box).toHaveValue(SERIAL.slice(1));
  });

  it("holds a serial until its unit has a grade, and will not place the order around it", async () => {
    renderForm();
    await fillOrderStep();
    await addLine(1);
    await userEvent.click(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    );
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByLabelText("Serial");
    await userEvent.click(box);
    await userEvent.paste(SERIAL);
    await userEvent.tab();

    // Amber, not red: waiting, not wrong.
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(
      within(dialog).getByText("Pick the grade to record it"),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: /Save order/ }));
    // Refused rather than dropped: a serial left behind at Save is a serial
    // nobody types twice.
    expect(snapshot().units.some((u) => u.serial === SERIAL)).toBe(false);
    expect(
      await screen.findByText(/serial\(s\) cannot be recorded yet/),
    ).toBeInTheDocument();
  });
});
