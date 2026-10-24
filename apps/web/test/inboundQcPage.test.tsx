/**
 * `/inbound/:id`, driven the ways the shop drives it: a barcode scanner,
 * somebody typing, and QC typed into each unit's row.
 *
 * The page is a table of INVOICE LINES since 2026-09-20 — product, qty, one
 * price, a discount — and the units behind a line are in the popup its *Units*
 * button opens. `renderUnits()` is that: render the page and open the first
 * line, which is where every serial box and QC answer in this file lives.
 *
 * The typing case is here because it was broken in a way unit tests could not
 * see. The table was keyed on the serial and wrote every keystroke to the
 * store, so each character re-keyed the row, React remounted the input, and the
 * caret went with it — you clicked, got one character in, and clicked again.
 * Only a rendered test catches that, so this is the one that guards it.
 */
import { App as AntdApp } from "antd";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundDetailPage } from "../src/routes/inbound/InboundDetailPage.js";
import { pressPageAction } from "./pageActions.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";
import { __resetScanner, __setScannerClock } from "../src/lib/scanner.js";

/**
 * Why this file buys itself far more time than the 5s default.
 *
 * Every test here renders the WHOLE Inbound detail page into jsdom and then
 * drives it with real keyboard and pointer events. Testing Library's
 * `getByRole` recomputes an accessible name for every button in that tree on
 * each query, so the cost is a multiple of the page rather than of the
 * assertion — and on a busy machine the same render has been measured at
 * three times its quiet speed. Raised rather than trimmed on purpose: what
 * these tests guard is the caret behaviour of the serial field, which only a
 * rendered test can see.
 */
vi.setConfig({ testTimeout: 60_000 });

const ORDER = "po-5";
const SKU = "m-pro13-2016-v1";

/**
 * A barcode the shop's scanner would really produce, and what intake files
 * from it (owner rules 2026-09-21): a SECOND-HAND unit's serial is the scan as
 * read; a NEW unit's is the scan without its S. Nothing puts a supplier code
 * on either, and a row with no grade holds the scan until it has one.
 */
const BARCODE = "SC02AA111AAAX";
const SERIAL = "SC02AA111AAAX";
const SEALED = "C02AA111AAAX";
const BARCODE_2 = "SC02BB222BBBX";
const SERIAL_2 = "SC02BB222BBBX";

/** The store, read through the one door it has. */
function snapshot(): MockDb {
  return getDb();
}

let now = 0;

/** One keystroke, as the OS delivers it. */
function press(key: string, el: Element = document.body) {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

/** A serial arriving at scanner speed, then the Enter the scanner sends. */
function scan(serial: string) {
  now += 10_000; // a clear break from whatever ran before
  for (const ch of serial) {
    now += 5;
    press(ch);
  }
  press("Enter");
}

/**
 * A serial arriving at a HAND's speed, into whatever has focus. The gap
 * between characters is the only thing telling a scan from typing, and the
 * scanner's clock is injected here.
 */
async function typeByHand(text: string) {
  for (const ch of text) {
    now += 200;
    await userEvent.keyboard(ch);
  }
}

/** Let the scanner's promise queue, `rendered()` and React all catch up. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });

function renderOrder() {
  const rendered = render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/inbound/${ORDER}`]}>
        <Routes>
          <Route path="/inbound/:poId" element={<InboundDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
  /*
   * Into edit mode. The page opens read-only since 2026-09-24 — *"when
   * viewing an inbound it should be display only first"* — and every test in
   * this file is about the bench WORKING the invoice: the scanner is off
   * until somebody presses this, which is the point of it.
   */
  pressPageAction(/Edit invoice/);
  return rendered;
}

/**
 * Open a line's units — the popup where the serials and the QC answers are.
 * Rendered in a portal, so everything under it is queried off `screen`.
 */
async function openUnits(line = 0) {
  const buttons = screen.getAllByRole("button", {
    name: /Serials and QC for/,
  });
  await userEvent.click(buttons[line]!);
  await screen.findByRole("dialog");
}

/** The page, with the first line's units open. */
async function renderUnits() {
  const r = renderOrder();
  await openUnits();
  return r;
}

const serials = () =>
  screen
    .getAllByLabelText("Serial")
    .map((el) => (el as HTMLInputElement).value);

/** The dialog mounted most recently — antd leaves closed ones in the DOM. */
/** Pick a warehouse in a Select by its id (the label carries its number). */
async function pickWarehouse(control: HTMLElement, id: string, here = false) {
  const w = snapshot().warehouses.find((x) => x.id === id)!;
  const label = w.code ? `${w.code} · ${w.name}` : w.name;
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
    ).find((el) =>
      (el.getAttribute("title") ?? "").startsWith(here ? `${label} (` : label),
    );
    if (!found) throw new Error(`no option “${label}” open`);
    return found;
  });
  fireEvent.click(item);
}

async function lastDialog(): Promise<HTMLElement> {
  const dialogs = await screen.findAllByRole("dialog");
  return dialogs[dialogs.length - 1]!;
}

/** The confirm button of the dialog currently open, by its label. */
async function okButton(label: string) {
  return within(await lastDialog()).getByRole("button", { name: label });
}

/**
 * Pick an option of an antd Select by its visible label. rc-select opens on
 * mouse-down, and its options are portalled out of the table, so the option
 * is looked for in the dropdown opened last rather than under the control.
 */
async function chooseIn(control: HTMLElement, option: string) {
  fireEvent.mouseDown(control);
  const item = await vi.waitFor(() => {
    // The list opened last: a list closed a moment ago can still be on its
    // way out, and two checklist questions offer the same "Like new".
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

/** A row's own box, by its label — row 0 is the first unit on the order. */
const inRow = (label: string, row = 0) =>
  screen.getAllByLabelText(label)[row] as HTMLElement;

/**
 * Put a phrase on a row's description. `paste` rather than `type`: antd
 * re-filters the option list on every keystroke.
 */
async function describe_(row: number, phrase: string) {
  const box = inRow("Description", row);
  await userEvent.click(box);
  await userEvent.paste(phrase);
  // Enter is what a person presses; leaving the field is what commits it in
  // jsdom, where rc-select does not treat its dropdown as open. Both are real.
  await userEvent.keyboard("{Enter}");
  await userEvent.tab();
}

type Grade = "New" | "A" | "B" | "C";

/**
 * Pick a row's grade — its condition, and so the rule its serial is held to.
 * Focus is handed back to the page, so the scanner can be pointed at it.
 */
async function grade(g: Grade, row = 0) {
  await chooseIn(inRow("Grade", row), g);
  act(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle();
}

/**
 * Scan a unit onto the next row still waiting and grade that row — the two
 * answers that between them record a unit (2026-09-21).
 */
async function scanGraded(barcode = BARCODE, g: Grade = "A", row = 0) {
  scan(barcode);
  await settle();
  await grade(g, row);
}

/** Scan one second-hand unit and describe it in the store, without the dialog. */
async function described(barcode = BARCODE, serial = SERIAL) {
  await renderUnits();
  await scanGraded(barcode, "A");
  act(() => {
    mutate((d) => {
      d.units.find((u) => u.serial === serial)!.description = "Mulus";
    });
  });
  return serial;
}

/** The Units card — the invoice's lines, as opposed to the popup behind one. */
const unitsCard = () =>
  screen.getByText("Units").closest(".ant-card") as HTMLElement;

/** Put a product on the invoice through the add bar under the lines. */
async function addProduct(code: string, qty = 1) {
  const picker = screen.getByRole("combobox", {
    name: "Product to add to the units",
  });
  fireEvent.mouseDown(picker);
  fireEvent.change(picker, { target: { value: code } });
  const option = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>(
      `.ant-select-item-option[title="${CSS.escape(code)}"]`,
    );
    if (!found) throw new Error("option not open");
    return found;
  });
  fireEvent.click(option);
  const box = screen.getByLabelText("How many units to add");
  await userEvent.clear(box);
  await userEvent.type(box, String(qty));
  await userEvent.click(
    screen.getByRole("button", { name: new RegExp(`Add ${qty} unit`) }),
  );
  await settle();
}

/** The popup, which is where a unit's own boxes and decisions are. */
const unitsDialog = () => screen.getByRole("dialog");

beforeEach(() => {
  __resetScanner();
  now = 0;
  __setScannerClock(() => now);
  // An arrived order expecting three of one product, nothing identified, and
  // no money on it yet.
  mutate((d) => {
    const po = d.pos.find((p) => p.id === ORDER)!;
    po.status = "RECEIVED";
    // The store is a module singleton and the closed-invoice tests below file
    // this order away. Left closed, every later test would drive a read-only
    // page and fail on something that looks like a missing control.
    delete po.closedAt;
    po.items = [
      { id: "poi-t1", skuId: SKU, serial: null, qty: 3, unitCost: 4_100_000 },
    ];
    po.fees = [];
    po.payments = [];
    d.units = d.units.filter((u) => u.poId !== ORDER);
    // …and this file's own serials wherever else a test may have put them.
    const mine = new Set([SERIAL, SERIAL_2, SEALED]);
    d.units = d.units.filter((u) => !mine.has(u.serial));
    // A serial one test recorded would still have its ledger when the next
    // one reused the same string.
    const live = new Set(d.units.map((u) => u.serial));
    d.events = d.events.filter((e) => live.has(e.serial));
    d.services = d.services.filter((r) => live.has(r.serial));
    d.returns = d.returns.filter((r) => !r.serial || live.has(r.serial));
  });
});

describe("typing a serial", () => {
  it("expects one row per unit, and none of them is a unit yet", async () => {
    await renderUnits();
    expect(serials()).toEqual(["", "", ""]);
    // Accepting is a decision about a particular unit, so it waits for the
    // serial — the QC answers themselves do not (see "QC on the row").
    for (const button of within(unitsDialog()).getAllByRole("button", {
      name: /^Accept unit/,
    })) {
      expect(button).toBeDisabled();
    }
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("takes a whole serial in one go, without losing the caret", async () => {
    await renderUnits();
    const box = screen.getAllByLabelText("Serial")[0]!;
    await userEvent.click(box);
    await userEvent.keyboard("SC02XY1234567");

    // The regression: before 2026-08-26 this held "C" and focus was gone.
    expect(box).toHaveValue("SC02XY1234567");
    expect(box).toHaveFocus();
  });

  it("writes the unit and its arrival once the field is left, on a graded row", async () => {
    await renderUnits();
    await grade("A");
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand("SC02XY1234567");

    // Still only text on screen. A half-typed serial is not a unit.
    expect(snapshot().units.some((u) => u.serial === "SC02XY1234567")).toBe(
      false,
    );

    await userEvent.tab();

    const db = snapshot();
    expect(db.units.find((u) => u.serial === "SC02XY1234567")).toMatchObject({
      status: "QC",
      poId: ORDER,
      skuId: SKU,
      grade: "A",
      // The line's cost follows the unit it was paid for.
      buy: 4_100_000,
    });
    // The one rule: the row and the events that explain it, together — its
    // arrival, and the grade it was given before its serial.
    expect(
      db.events.filter((e) => e.serial === "SC02XY1234567").map((e) => e.type),
    ).toEqual(["DITERIMA", "DICATAT"]);
    // The same three rows on screen: the slot became the unit.
    expect(serials()).toEqual(["SC02XY1234567", "", ""]);
    // And its decisions are live — Service needs nothing but the unit.
    expect(
      screen.getByLabelText("Send SC02XY1234567 to service"),
    ).toBeEnabled();
  });

  it("holds a serial typed before the grade, and records it when the grade is picked", async () => {
    // Owner answer 2026-09-21: the serial waits. New and second-hand are held
    // to different rules, and the bench can reach the serial box first.
    await renderUnits();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("C02XY1234567");
    await userEvent.tab();

    expect(box).toHaveValue("C02XY1234567");
    expect(box.closest(".ant-input-status-warning")).not.toBeNull();
    expect(screen.getByText("Pick the grade to record it")).toBeInTheDocument();
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);

    await grade("New");
    expect(snapshot().units.find((u) => u.poId === ORDER)).toMatchObject({
      serial: "C02XY1234567",
      grade: "NEW",
    });
  });

  it("refuses a serial another unit already carries", async () => {
    const taken = snapshot().units.find((u) => u.poId !== ORDER)!.serial;
    await renderUnits();
    await grade("A");
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand(taken);
    await userEvent.tab();

    expect(snapshot().units.filter((u) => u.serial === taken)).toHaveLength(1);
    expect(serials()).toEqual(["", "", ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("moves the ledger with a corrected serial", async () => {
    await renderUnits();
    await grade("A");
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand("SC02XY1234500");
    await userEvent.tab();

    const box = screen.getAllByLabelText("Serial")[0]!;
    await userEvent.tripleClick(box);
    await typeByHand("SC02XY1234567");
    await userEvent.tab();

    const db = snapshot();
    expect(db.events.filter((e) => e.serial === "SC02XY1234500")).toHaveLength(
      0,
    );
    expect(db.events.filter((e) => e.serial === "SC02XY1234567")).toHaveLength(
      2,
    );
  });
});

describe("scanning a serial", () => {
  it("holds each scan in the next row still waiting, until the row has a grade", async () => {
    await renderUnits();
    scan(BARCODE);
    await settle();
    scan(BARCODE_2);
    await settle();

    // In their boxes, as read, and not units yet.
    expect(serials()).toEqual([BARCODE, BARCODE_2, ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);

    await grade("A", 0);
    await grade("New", 1);
    // Second-hand: as read. New: its barcode's S dropped.
    expect(serials()).toEqual([SERIAL, "C02BB222BBBX", ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(2);
  });

  it("records a scan at once on a row already graded", async () => {
    await renderUnits();
    await grade("A");
    scan(BARCODE);
    await settle();
    expect(snapshot().units.find((u) => u.serial === SERIAL)).toBeDefined();
  });

  it("does not book the same unit twice", async () => {
    await renderUnits();
    scan(BARCODE);
    await settle();
    scan(BARCODE);
    await settle();

    expect(serials()).toEqual([SERIAL, "", ""]);
  });

  it("refuses a scan the shop already knows from somewhere else", async () => {
    act(() => {
      mutate((d) => {
        const other = d.units.find((u) => u.poId !== ORDER)!;
        d.units.push({ ...other, serial: SERIAL });
      });
    });
    await renderUnits();
    scan(BARCODE);
    await settle();

    expect(serials()).toEqual(["", "", ""]);
    expect(snapshot().units.filter((u) => u.serial === SERIAL)).toHaveLength(1);
  });
});

/**
 * The barcode rules (owner rules 2026-09-21). `test/serialInput.test.ts`
 * checks the rules themselves; these guard that the PAGE puts a scan through
 * the rule its row's grade decides, and that a refusal records nothing.
 */
describe("what the scanner will not accept", () => {
  const nothingRecorded = () => {
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  };

  it("takes a second-hand unit's scan as read, however short", async () => {
    await renderUnits();
    await grade("A");
    scan("SC02AA111A");
    await settle();
    expect(snapshot().units.find((u) => u.poId === ORDER)?.serial).toBe(
      "SC02AA111A",
    );
  });

  it("takes a second-hand unit's scan with no S, and maps no letter", async () => {
    await renderUnits();
    await grade("B");
    scan("C02AA1O1AAAX");
    await settle();
    expect(snapshot().units.find((u) => u.poId === ORDER)?.serial).toBe(
      "C02AA1O1AAAX",
    );
  });

  it("drops a new unit's S and reads an I as 1 and an O as 0", async () => {
    await renderUnits();
    await grade("New");
    scan("SC02AA1O1AAAX");
    await settle();
    expect(snapshot().units.find((u) => u.poId === ORDER)?.serial).toBe(
      "C02AA101AAAX",
    );
  });

  it("puts no supplier code on a new unit's serial", async () => {
    await renderUnits();
    await grade("New");
    scan(BARCODE);
    await settle();
    expect(serials()).toEqual([SEALED, "", ""]);
    expect(screen.queryByText(/Store QR/)).toBeNull();
  });

  it("refuses a new unit's read with no S, and outlines the box", async () => {
    await renderUnits();
    await grade("New");
    // The regulatory barcode beside the serial looks exactly like this.
    scan("C02AA111AAAX");
    await settle();
    nothingRecorded();
    const box = screen.getAllByLabelText("Serial")[0]!;
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Must start with S")).toBeInTheDocument();
  });

  it("takes the shortest serial Apple prints on a new unit — S and ten", async () => {
    await renderUnits();
    await grade("New");
    scan("SDQXFPXWCK7");
    await settle();
    expect(serials()).toEqual(["DQXFPXWCK7", "", ""]);
  });

  it("refuses two capitals in front of a new unit's barcode", async () => {
    await renderUnits();
    await grade("New");
    scan("XXSC02AA111AAAX");
    await settle();
    nothingRecorded();
  });

  it("refuses a new unit's scan that is really two scans", async () => {
    await renderUnits();
    await grade("New");
    scan(`${BARCODE}${BARCODE_2}`);
    await settle();
    nothingRecorded();
  });

  it("judges a held scan by the grade picked after it", async () => {
    await renderUnits();
    scan("C02AA111AAAX");
    await settle();
    // Held, not refused: nothing has said yet which rule it is under.
    expect(serials()).toEqual(["C02AA111AAAX", "", ""]);
    expect(screen.getAllByLabelText("Serial")[0]!).not.toHaveAttribute(
      "aria-invalid",
    );

    await grade("New");
    // A new unit's scan must carry its S: refused now, and said at the box.
    nothingRecorded();
    expect(screen.getAllByLabelText("Serial")[0]!).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});

describe("the length of a serial", () => {
  it("takes any serial a rule in this app can accept, without truncating", async () => {
    /*
     * A second-hand serial is taken as read and held to no length at all
     * (2026-09-21), so the box is generous — `SERIAL_FIELD_MAX_LENGTH`. A box
     * that stopped short would silently swallow a character, which is the one
     * outcome nothing on screen would report.
     */
    await renderUnits();
    expect(screen.getAllByLabelText("Serial")[0]!).toHaveAttribute(
      "maxlength",
      "23",
    );
  });

  it("takes a typed second-hand serial with an I or an O in it, as read", async () => {
    await renderUnits();
    await grade("A");
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    // `typeByHand`: at a hand's speed, so the page reads it as typed.
    await typeByHand("SC02AA1O1AAAX");
    await userEvent.tab();
    expect(
      snapshot().units.find((u) => u.serial === "SC02AA1O1AAAX"),
    ).toBeDefined();
  });

  it("reads a typed I and O as 1 and 0 on a new unit (owner answer)", async () => {
    await renderUnits();
    await grade("New");
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand("C02AA1O1AAAX");
    await userEvent.tab();
    expect(
      snapshot().units.find((u) => u.serial === "C02AA101AAAX"),
    ).toBeDefined();
  });

  it("keeps what was typed when a new unit's serial is wrong, rather than wiping it", async () => {
    // `commitSerial` fires on BLUR, so clearing the box meant clicking away
    // mid-serial erased what had been typed.
    await renderUnits();
    await grade("New");
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("C02-AA111AAAX");
    await userEvent.tab();
    expect(box).toHaveValue("C02-AA111AAAX");
    expect(snapshot().units.some((u) => u.serial.includes("-"))).toBe(false);
  });

  it("records a typed serial of an odd length on a second-hand unit", async () => {
    await renderUnits();
    await grade("A");
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("SC02AA111");
    await userEvent.tab();
    expect(snapshot().units.some((u) => u.serial === "SC02AA111")).toBe(true);
  });

  it("files a new unit's number off the case as it is — no S added", async () => {
    await renderUnits();
    await grade("New");
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand(SEALED);
    await userEvent.tab();
    expect(snapshot().units.some((u) => u.serial === SEALED)).toBe(true);
    expect(snapshot().units.some((u) => u.serial === SERIAL)).toBe(false);
  });

  it("refuses that same string on a new unit when a scanner sent it", async () => {
    await renderUnits();
    await grade("New");
    scan(SEALED);
    await settle();
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("types in capitals whatever the keyboard is doing", async () => {
    await renderUnits();
    await grade("A");
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("c02aa111aaax");
    expect(box).toHaveValue("C02AA111AAAX");
    await userEvent.tab();
    expect(snapshot().units.some((u) => u.serial === SEALED)).toBe(true);
  });

  it("outlines the box in red and says why, not just a toast", async () => {
    await renderUnits();
    await grade("New");
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("C02-AA111AAAX");
    await userEvent.tab();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box.closest(".ant-input-status-error")).not.toBeNull();
    expect(screen.getByText("Capitals and digits only")).toBeInTheDocument();
  });

  it("takes the red back as soon as the serial is being fixed", async () => {
    await renderUnits();
    await grade("New");
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("C02-AA111AAAX");
    await userEvent.tab();
    expect(box).toHaveAttribute("aria-invalid", "true");

    await userEvent.click(box);
    await typeByHand("X");
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(box.closest(".ant-input-status-error")).toBeNull();
  });

  it("does not outline a row that is merely still waiting", async () => {
    await renderUnits();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    expect(box).not.toHaveAttribute("aria-invalid");
    expect(box.closest(".ant-input-status-warning")).not.toBeNull();
  });
});

/**
 * QC on the row (owner brief 2026-09-19): battery, description and grade are
 * columns of the unit's row, answerable in any order — before the serial too —
 * and Accept, Service and Return are the row's decisions.
 */
describe("QC on the row", () => {
  const stored = () => snapshot().units.find((u) => u.serial === SERIAL)!;

  it("asks for capacity and cycles on a 2016 unit, and never a percentage", async () => {
    // `po-5` carries a 2016 Intel MacBook Pro, which reports cycles and a
    // capacity rather than a health figure.
    await renderUnits();
    await scanGraded();

    await userEvent.click(inRow("Full charge capacity"));
    await userEvent.keyboard("4800");
    await userEvent.click(inRow("Cycle count"));
    await userEvent.keyboard("312");
    await userEvent.tab();

    expect(stored()).toMatchObject({ cycleCount: 312, fcc: 4800 });
    expect(stored().batteryHealth).toBeUndefined();
    expect(
      screen.queryAllByRole("spinbutton", { name: "Battery health" }),
    ).toHaveLength(0);
  });

  it("never files a battery reading nobody could have taken", async () => {
    await renderUnits();
    await scanGraded();
    const cc = inRow("Cycle count") as HTMLInputElement;

    await userEvent.click(cc);
    await userEvent.keyboard("50000");
    // Said while the number is still in the box.
    expect(cc).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("0–5000 only").length).toBeGreaterThan(0);

    await userEvent.tab();
    // Refused, not clamped to 5000 and not stored as 5.
    expect(stored().cycleCount).toBeUndefined();
  });

  it("takes a zero cycle count, which is a real reading", async () => {
    await renderUnits();
    await scanGraded();

    await userEvent.click(inRow("Cycle count"));
    await userEvent.keyboard("0");
    await userEvent.tab();
    expect(stored().cycleCount).toBe(0);
  });

  it("lets the model decide the reading — there is no switch", async () => {
    await renderUnits();
    scan(BARCODE);
    await settle();

    // Owner 2026-09-19: "the system is the one that must determine".
    expect(
      screen.queryByLabelText("How this battery is recorded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryAllByRole("spinbutton", { name: "Battery health" }),
    ).toHaveLength(0);
  });

  it("needs a description before a second-hand unit can be accepted", async () => {
    await renderUnits();
    await scanGraded();

    // Refused: nobody has written down what condition it is in.
    expect(screen.getByLabelText(`Accept ${SERIAL}`)).toBeDisabled();

    // Two phrases, not a sentence: the comma is the separator in the column.
    await describe_(0, "Mulus, Fullset dus");
    expect(stored().description).toBe("Mulus, Fullset dus");

    await userEvent.click(screen.getByLabelText(`Accept ${SERIAL}`));
    expect(stored().status).toBe("TERSEDIA");
    // QC passed is what Accept always wrote.
    expect(
      snapshot()
        .events.filter((e) => e.serial === SERIAL)
        .map((e) => e.type),
    ).toEqual(["DITERIMA", "DICATAT", "QC_SELESAI"]);
  });

  it("lets a sealed unit through without a description", async () => {
    await renderUnits();
    scan(BARCODE);
    await settle();

    await chooseIn(inRow("Grade"), "New");
    // Filed as a new unit's serial: its barcode's S dropped (2026-09-21).
    const sealed = () => snapshot().units.find((u) => u.serial === SEALED)!;
    expect(sealed().grade).toBe("NEW");

    await userEvent.click(screen.getByLabelText(`Accept ${SEALED}`));
    expect(sealed().status).toBe("TERSEDIA");
    expect(
      snapshot().events.some(
        (e) => e.serial === SEALED && e.note === "Marked new — sealed stock",
      ),
    ).toBe(true);
  });

  it("takes a picked grade, and files each pick on the timeline", async () => {
    await renderUnits();
    scan(BARCODE);
    await settle();

    await chooseIn(inRow("Grade"), "B");
    expect(stored().grade).toBe("B");
    await chooseIn(inRow("Grade"), "A");
    expect(stored().grade).toBe("A");

    const graded = snapshot().events.filter(
      (e) => e.serial === SERIAL && e.note?.startsWith("Graded"),
    );
    expect(graded.map((e) => e.note)).toEqual(["Graded B", "Graded A"]);
  });

  it("moves on from an empty description to the sell price on Enter", async () => {
    await renderUnits();
    await scanGraded();

    await userEvent.click(inRow("Description"));
    await userEvent.keyboard("{Enter}");
    await settle();
    // The popup asks serial, grade, battery, description, sell price — so an
    // empty description hands on to the price, not back to the grade.
    expect(inRow("Sell price")).toHaveFocus();
    expect(stored().description).toBe("");
  });

  it("files a free-typed description in the suggestion list too", async () => {
    await renderUnits();
    await scanGraded();
    await describe_(0, "Retak");
    expect(snapshot().qcDescriptions.some((d) => d.label === "Retak")).toBe(
      true,
    );
  });

  it("takes QC before the serial, and carries it onto the unit", async () => {
    // Owner brief 2026-09-19: "I don't need to input serial first, I could
    // input in whatever order I want."
    await renderUnits();
    await describe_(0, "Mulus");
    await chooseIn(inRow("Grade"), "B");
    await userEvent.click(inRow("Cycle count"));
    await userEvent.keyboard("312");
    await userEvent.tab();
    // Nothing is a unit yet — the answers are held against the row.
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);

    // The scanner types into whatever has focus; point it at the page.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    scan(BARCODE);
    await settle();

    expect(stored()).toMatchObject({
      description: "Mulus",
      grade: "B",
      cycleCount: 312,
    });
    expect(
      snapshot().events.some(
        (e) => e.serial === SERIAL && e.note === "Graded B",
      ),
    ).toBe(true);
  });

  it("returns a unit to the supplier from its row", async () => {
    await described();
    await userEvent.click(
      screen.getByLabelText(`Return ${SERIAL} to the supplier`),
    );
    await userEvent.click(await okButton("Return to supplier"));
    expect(stored().status).toBe("RETUR_SUPPLIER");
  });
});

describe("taking a QC decision back", () => {
  it("puts an accepted unit back on the bench, keeping both events", async () => {
    const serial = await described();
    await userEvent.click(screen.getByLabelText(`Accept ${serial}`));
    expect(snapshot().units.find((u) => u.serial === serial)!.status).toBe(
      "TERSEDIA",
    );

    await userEvent.click(screen.getByLabelText(`More for ${serial}`));
    await userEvent.click(await screen.findByText("Reopen QC"));
    await userEvent.click(await okButton("Reopen QC"));

    const db = snapshot();
    expect(db.units.find((u) => u.serial === serial)!.status).toBe("QC");
    // Append-only: the acceptance that was wrong stays on the timeline.
    expect(
      db.events.filter((e) => e.serial === serial).map((e) => e.type),
    ).toEqual(["DITERIMA", "DICATAT", "QC_SELESAI", "QC_DIBUKA"]);
  });

  it("withdraws the supplier claim when the return was the wrong unit", async () => {
    const serial = await described();
    await userEvent.click(
      screen.getByLabelText(`Return ${serial} to the supplier`),
    );
    await userEvent.click(await okButton("Return to supplier"));
    const claim = snapshot().returns.find((r) => r.serial === serial)!;
    expect(claim.status).toBe("DONE");

    await userEvent.click(screen.getByLabelText(`More for ${serial}`));
    await userEvent.click(await screen.findByText("Reopen QC"));
    await userEvent.click(await okButton("Reopen QC"));

    const db = snapshot();
    expect(db.units.find((u) => u.serial === serial)!.status).toBe("QC");
    // Marked withdrawn, not deleted — the claim really was raised.
    expect(db.returns.find((r) => r.id === claim.id)!.status).toBe("CANCELLED");
  });

  it("will not reopen a unit somebody else has acted on", async () => {
    const serial = await described();
    act(() => {
      mutate((d) => {
        d.units.find((u) => u.serial === serial)!.status = "TERJUAL";
      });
    });
    // It is out of the door. Correcting that is the sale's job, not QC's —
    // so the row offers nothing to take back.
    expect(screen.queryByLabelText(`More for ${serial}`)).toBeNull();
  });
});

/**
 * The invoice's lines (owner ask 2026-09-20): a product, a quantity, ONE
 * price and a discount. The collapsed *Inbound* section and the one-row-per
 * -unit list it doubled are both gone — this is the one table, and it is the
 * same component the order form's second step draws.
 */
describe("the invoice's lines", () => {
  /** The line's own boxes, which are on the page rather than in the popup. */
  const lineQty = () => screen.getAllByLabelText("Qty")[0]!;

  it("shows one line for three units of one product at one price", () => {
    renderOrder();
    expect(screen.getAllByLabelText("Qty")).toHaveLength(1);
    expect(lineQty()).toHaveValue("3");
    expect(
      screen.getByRole("button", { name: /Serials and QC for/ }),
    ).toHaveTextContent("See all units (0/3)");
    // One price box for the line, never one per unit.
    expect(screen.getAllByLabelText(/^Unit price of /)).toHaveLength(1);
  });

  it("adds a unit to the line when its quantity goes up, at the line's price", async () => {
    renderOrder();
    await userEvent.tripleClick(lineQty());
    await userEvent.keyboard("4");
    await userEvent.tab();
    await settle();

    // Still ONE line on screen…
    expect(screen.getAllByLabelText("Qty")).toHaveLength(1);
    expect(lineQty()).toHaveValue("4");
    // …and four pieces under it, all at the line's price: a line is one
    // price (owner ask 2026-09-20), so nothing is added unpriced.
    const items = snapshot().pos.find((p) => p.id === ORDER)!.items;
    expect(items.map((i) => [i.qty, i.unitCost])).toEqual([
      [1, 4_100_000],
      [1, 4_100_000],
      [1, 4_100_000],
      [1, 4_100_000],
    ]);
    await openUnits();
    expect(serials()).toEqual(["", "", "", ""]);
  });

  it("writes one price to every unit of the line", async () => {
    renderOrder();
    const price = screen.getAllByLabelText(/^Unit price of /)[0]!;
    await userEvent.tripleClick(price);
    await userEvent.keyboard("3900000");
    await userEvent.tab();
    await settle();

    const items = snapshot().pos.find((p) => p.id === ORDER)!.items;
    expect(items.map((i) => i.unitCost)).toEqual([
      3_900_000, 3_900_000, 3_900_000,
    ]);
  });

  it("takes a discount off the line and spreads it over its units", async () => {
    renderOrder();
    const discount = screen.getAllByLabelText(/^Discount on /)[0]!;
    await userEvent.tripleClick(discount);
    await userEvent.keyboard("500000");
    await userEvent.tab();
    await settle();

    const items = snapshot().pos.find((p) => p.id === ORDER)!.items;
    // Whole rupiah that add back up to what was negotiated.
    expect(items.reduce((n, i) => n + (i.discount ?? 0), 0)).toBe(500_000);
    // …and the line total says so: 3 × 4.100.000 − 500.000.
    expect(screen.getAllByText("Rp 11.800.000").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("gives a unit scanned onto a discounted line what it really cost", async () => {
    renderOrder();
    const discount = screen.getAllByLabelText(/^Discount on /)[0]!;
    await userEvent.tripleClick(discount);
    await userEvent.keyboard("300000");
    await userEvent.tab();
    await settle();

    // The scanner types into whatever has focus; point it at the page.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    scan(BARCODE);
    await settle();
    // Held in its row until the row has a grade (2026-09-21).
    await openUnits();
    await grade("A");
    expect(snapshot().units.find((u) => u.serial === SERIAL)!.buy).toBe(
      4_000_000,
    );
  });

  it("splits one product at two prices into two lines", async () => {
    // The owner's own answer: *"if 2 same unit have different price, they
    // would manually input 2 times."*
    renderOrder();
    const other = getDb().skus.find((s) => s.id !== SKU)!;
    await addProduct(other.code, 2);

    const rows = screen.getAllByLabelText("Qty");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveValue("2");
    const items = snapshot().pos.find((p) => p.id === ORDER)!.items;
    expect(items.filter((i) => i.skuId === other.id)).toHaveLength(2);
    // The caret on the new line's price — the next thing anybody types.
    expect(document.activeElement?.id).toMatch(/^po-line-cost-/);
  });

  it("grows the line, at its own price, when the popup adds a unit", async () => {
    // The quantity follows the serials (owner ask 2026-09-20) — and the unit
    // it adds is one of THESE, not a second line at no price.
    await renderUnits();
    await userEvent.click(
      within(unitsDialog()).getByRole("button", { name: /Add another unit/ }),
    );
    await settle();

    expect(screen.getAllByLabelText("Qty")).toHaveLength(1);
    expect(screen.getByLabelText("Qty")).toHaveValue("4");
    const items = snapshot().pos.find((p) => p.id === ORDER)!.items;
    expect(items.map((i) => i.unitCost)).toEqual([
      4_100_000, 4_100_000, 4_100_000, 4_100_000,
    ]);
    // …and the popup is showing it.
    expect(serials()).toEqual(["", "", "", ""]);
  });

  it("will not take a scanned unit off the invoice", async () => {
    await renderUnits();
    await grade("A", 0);
    await grade("A", 1);
    scan(BARCODE);
    await settle();
    scan(BARCODE_2);
    await settle();
    await userEvent.click(
      within(unitsDialog()).getByRole("button", { name: "Done" }),
    );

    await userEvent.tripleClick(lineQty());
    await userEvent.keyboard("1");
    await userEvent.tab();
    await settle();

    // Only the waiting unit could go; two have serials.
    await openUnits();
    expect(serials()).toEqual([SERIAL, SERIAL_2, ""]);
  });
});

describe("expenses", () => {
  const order = () => snapshot().pos.find((p) => p.id === ORDER)!;

  async function addExpense(amount: string, opts: { paid?: boolean } = {}) {
    await userEvent.click(screen.getByRole("button", { name: /Add expense/ }));
    const dialog = await lastDialog();
    await userEvent.type(within(dialog).getByLabelText("Amount"), amount);
    if (opts.paid) {
      await userEvent.click(
        within(dialog).getByRole("switch", { name: "Paid" }),
      );
    }
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Add expense/ }),
    );
  }

  it("owes an expense and spreads it over the machines' COGS", async () => {
    await renderUnits();
    await addExpense("150000");

    expect(order().fees).toMatchObject([
      { kind: "SHIPPING", amount: 150_000, inCogs: true },
    ]);
    // Nothing paid: it is owed, which is what an expense is.
    expect(order().payments).toHaveLength(0);
    // Rp150.000 over three units is Rp50.000 on each one's cost, and the
    // line's COGS column says what the three of them cost all in.
    expect(
      within(unitsCard()).getAllByText("Rp 12.450.000").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("records the payment when it is marked paid, tied to the expense", async () => {
    await renderUnits();
    await addExpense("150000", { paid: true });

    const [fee] = order().fees;
    expect(order().payments).toMatchObject([
      { amount: 150_000, feeId: fee!.id, appliedTo: "SHIPPING" },
    ]);
  });

  it("takes the expense off every machine's cost when it leaves COGS", async () => {
    await renderUnits();
    await addExpense("150000");
    await userEvent.click(screen.getByLabelText(/^Edit Shipping/));
    const dialog = await lastDialog();
    await userEvent.click(
      within(dialog).getByRole("switch", { name: "Split into COGS per unit" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Save changes/ }),
    );

    expect(order().fees[0]!.inCogs).toBe(false);
    expect(
      within(unitsCard()).getAllByText("Rp 12.300.000").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("says which expense each payment settled", async () => {
    act(() => {
      mutate((d) => {
        const po = d.pos.find((p) => p.id === ORDER)!;
        po.fees = [
          {
            id: "f-ship",
            kind: "SHIPPING",
            label: "",
            amount: 250_000,
            inCogs: true,
          },
        ];
        po.payments = [
          {
            id: "pp-t1",
            method: "TUNAI",
            amount: 250_000,
            at: "x",
            appliedTo: "SHIPPING",
            feeId: "f-ship",
          },
          // No `appliedTo` — a row from before the buckets existed. It reads
          // as the goods.
          { id: "pp-t2", method: "TUNAI", amount: 1_000_000, at: "x" },
        ];
      });
    });
    await renderUnits();
    const cells = screen.getAllByRole("cell").map((el) => el.textContent);
    expect(cells).toContain("Shipping");
    expect(cells).toContain("Products");
  });
});

describe("a closed invoice", () => {
  const close = () =>
    act(() => {
      mutate((d) => {
        d.pos.find((p) => p.id === ORDER)!.closedAt =
          "2026-08-27T04:00:00.000Z";
      });
    });

  it("takes no input at all, and says how to get it back", async () => {
    await renderUnits();
    scan(BARCODE);
    await settle();
    close();

    for (const el of screen.getAllByLabelText("Serial")) {
      expect(el).toBeDisabled();
    }
    expect(
      screen.getByRole("button", { name: /Record payment/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Add expense/ })).toBeDisabled();
    // And no row offers a decision while it is closed.
    expect(screen.queryByLabelText(`Send ${SERIAL} to service`)).toBeNull();
    expect(
      screen.queryByLabelText(`Return ${SERIAL} to the supplier`),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Reopen/ }));
    expect(
      snapshot().pos.find((p) => p.id === ORDER)!.closedAt,
    ).toBeUndefined();
    expect(screen.getAllByLabelText("Serial")[0]!).toBeEnabled();
  });

  it("refuses a scan rather than silently swallowing it", async () => {
    await renderUnits();
    close();
    scan(BARCODE);
    await settle();
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });
});

/**
 * Sending a unit for a repair. The dialog asks rather than confirms, and the
 * charges it asks for land on the visit it opens.
 *
 * ⚠️ There is no arrival to wait for since 2026-09-25 (owner: *"no need to
 * mark as 'received' first"*), so the visit opens already arrived and a unit
 * that travels is filed at the bench in the SAME transaction. The 2026-09-09
 * confirmation used to be the only thing that wrote `Unit.locationId`;
 * without one, nothing else would, and warehouse 4 would hold nothing —
 * which is the bug `Location.kind` was introduced to fix on 2026-09-08.
 */
describe("sending a machine to service", () => {
  it("opens an arrived visit and files the unit at the bench", async () => {
    // *Send it to the bench* is on by default: the bench is a different
    // building, and a unit graded in warehouse 1 has to get there.
    const serial = await described();
    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    await userEvent.click(await okButton("Send to service"));

    const db = snapshot();
    const unit = db.units.find((u) => u.serial === serial)!;
    const bench = db.warehouses.find((w) => w.kind === "SERVIS")!;
    expect(unit.status).toBe("SERVIS");
    expect(unit.locationId).toBe(bench.id);
    const visit = db.services.find((r) => r.serial === serial)!;
    expect(visit.arrivedAt).toBeTruthy();
    expect(visit.raisedBy).toBe("QC");
    // Where it set out from is on the visit, which is what sends it back.
    expect(visit.fromLocationId).not.toBe(bench.id);
  });

  it("leaves a unit nobody is shipping where it is", async () => {
    // The repairer-collects case, or a unit already at the bench: it stops
    // being sellable, and it has not travelled, so it has not moved.
    const serial = await described();
    const before = snapshot().units.find(
      (u) => u.serial === serial,
    )!.locationId;
    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    const dialog = await lastDialog();
    await pickWarehouse(within(dialog).getByLabelText("Send to"), before, true);
    await userEvent.click(await okButton("Send to service"));

    const db = snapshot();
    const unit = db.units.find((u) => u.serial === serial)!;
    expect(unit.status).toBe("SERVIS");
    expect(unit.locationId).toBe(before);
    expect(
      db.services.find((r) => r.serial === serial)!.arrivedAt,
    ).toBeTruthy();
  });

  // Owner ask 2026-10-22: *"make sure we can choose where we send the
  // product"* — the bench is the default, not the only answer.
  it("sends it to whichever warehouse the dialog names", async () => {
    const serial = await described();
    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    const dialog = await lastDialog();
    const other = snapshot().warehouses.find(
      (w) =>
        w.active &&
        w.kind !== "SERVIS" &&
        w.id !== snapshot().units.find((u) => u.serial === serial)!.locationId,
    )!;
    await pickWarehouse(within(dialog).getByLabelText("Send to"), other.id);
    await userEvent.click(await okButton("Send to service"));

    const db = snapshot();
    const unit = db.units.find((u) => u.serial === serial)!;
    expect(unit.status).toBe("SERVIS");
    expect(unit.locationId).toBe(other.id);
    const visit = db.services.find((r) => r.serial === serial)!;
    expect(visit.closedAt).toBeUndefined();
    expect(visit.fromLocationId).not.toBe(other.id);
  });

  it("puts the courier and the quote on the visit it opens", async () => {
    const serial = await described();
    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    const dialog = await lastDialog();
    await userEvent.type(
      within(dialog).getByLabelText(/Cost of getting it there/),
      "150000",
    );
    await userEvent.type(
      within(dialog).getByLabelText(/Service fee/),
      "800000",
    );
    await userEvent.click(await okButton("Send to service"));

    const visit = snapshot().services.find((r) => r.serial === serial)!;
    expect(visit.fees.map((f) => [f.kind, f.amount]).sort()).toEqual([
      ["LABOUR", 800_000],
      ["SHIPPING", 150_000],
    ]);
  });
});

/**
 * A counted product is priced before it is shelved (owner ask 2026-09-24:
 * *"the accessories at the moment do not have a field to input the price …
 * set the price before accepting the unit into the inventory"*). The line
 * carries a Sell price box — the variant's asking price, the one price an
 * accessory has — and Confirm arrived waits for it.
 */
describe("a counted product's sell price", () => {
  it("is asked for on the line, and Confirm arrived waits for it", async () => {
    const db = snapshot();
    const sku = db.skus.find((s) => !skuTracksSerial(db, s.id))!;
    mutate((d) => {
      d.skus.find((s) => s.id === sku.id)!.price = 0;
      d.stockMoves = d.stockMoves.filter((m) => m.poId !== ORDER);
    });
    renderOrder();
    await addProduct(sku.code, 2);

    const confirm = () =>
      screen.getByRole("button", { name: /^Confirm 2 .* arrived$/ });
    expect(confirm()).toBeDisabled();

    const box = screen.getByLabelText(/^Sell price of /);
    await userEvent.clear(box);
    await userEvent.type(box, "150000");
    fireEvent.blur(box);
    await settle();
    expect(snapshot().skus.find((s) => s.id === sku.id)!.price).toBe(150_000);
    expect(confirm()).toBeEnabled();

    await userEvent.click(confirm());
    await settle();
    const moves = snapshot().stockMoves.filter(
      (m) => m.poId === ORDER && m.skuId === sku.id,
    );
    expect(moves.map((m) => m.qty)).toEqual([2]);
  });
});

/**
 * The sell price box holds THIS unit's price; what the variant asks is the
 * grey hint behind it (owner report 2026-10-08: *"why the price cannot be
 * removed"*). The go-live import priced every variant at Rp 0, and filled in
 * as a value that zero sat in every box and came straight back when emptied.
 */
describe("a unit's sell price", () => {
  const stored = () => snapshot().units.find((u) => u.serial === SERIAL)!;

  /** Run with the order's product asking `price`, and put it back after. */
  async function asking<T>(price: number, run: () => Promise<T>) {
    const was = snapshot().skus.find((s) => s.id === SKU)!.price;
    mutate((d) => {
      d.skus.find((s) => s.id === SKU)!.price = price;
    });
    try {
      return await run();
    } finally {
      mutate((d) => {
        d.skus.find((s) => s.id === SKU)!.price = was;
      });
    }
  }

  it("leaves a Rp 0 variant's box empty, and files no price on the unit", () =>
    asking(0, async () => {
      await renderUnits();
      const box = inRow("Sell price") as HTMLInputElement;
      expect(box.value).toBe("");
      expect(box.placeholder).toBe("");

      await scanGraded();
      expect(stored().price).toBeUndefined();
      expect((inRow("Sell price") as HTMLInputElement).value).toBe("");
    }));

  it("can be emptied, and the unit then quotes its variant", () =>
    asking(9_500_000, async () => {
      await renderUnits();
      expect((inRow("Sell price") as HTMLInputElement).placeholder).toMatch(
        /9\.500\.000$/,
      );
      await scanGraded();
      expect(stored().price).toBe(9_500_000);

      const box = inRow("Sell price");
      await userEvent.clear(box);
      await userEvent.type(box, "8750000");
      await userEvent.tab();
      await settle();
      expect(stored().price).toBe(8_750_000);

      await userEvent.clear(inRow("Sell price"));
      await userEvent.tab();
      await settle();
      expect(stored().price).toBeUndefined();
      expect((inRow("Sell price") as HTMLInputElement).value).toBe("");
    }));
});
