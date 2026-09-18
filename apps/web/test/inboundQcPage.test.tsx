/**
 * Serials & QC, driven the two ways the shop actually drives it: a barcode
 * scanner, and somebody typing.
 *
 * The typing case is here because it was broken in a way unit tests could not
 * see. The table was keyed on the serial and wrote every keystroke to the
 * store, so each character re-keyed the row, React remounted the input, and the
 * caret went with it — you clicked, got one character in, and clicked again.
 * Only a rendered test catches that, so this is the one that guards it.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundDetailPage } from "../src/routes/inbound/InboundDetailPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";
import { __resetScanner, __setScannerClock } from "../src/lib/scanner.js";

/**
 * Why this file buys itself far more time than the 5s default.
 *
 * Every test here renders the WHOLE Inbound detail page — header, purchase
 * card, product lines and the QC grid — into jsdom and then drives it with
 * real keyboard and pointer events. Testing Library's `getByRole` recomputes
 * an accessible name for every button in that tree on each query, so the cost
 * is a multiple of the page rather than of the assertion.
 *
 * That makes these tests unusually sensitive to how busy the machine is. On a
 * quiet laptop a single render is about two seconds; measured again on the
 * same commit with another project's `tsc` running, the same render took
 * nearly seven, and the whole test went from comfortably inside 30s to over
 * 80. Nothing about the page had changed between the two measurements. A five
 * second budget leaves no room for that, and a test that fails because
 * something else on the machine was compiling is a test people learn to
 * re-run rather than read.
 *
 * Raised rather than trimmed on purpose: what these tests guard is the caret
 * behaviour of the serial field, which only a rendered test can see. Rendering
 * less of the page to make them quicker would give up the one thing this file
 * is for.
 */
vi.setConfig({ testTimeout: 60_000 });

const ORDER = "po-5";
const SKU = "m-pro13-2016-v1";

/**
 * A barcode the shop's scanner would really produce, and what intake stores
 * (owner correction 2026-09-01).
 *
 * They are now the SAME string, and that is the correction: `Unit.serial` is
 * Apple's own barcode and nothing is prefixed at intake. The store barcode —
 * `AS` in front, for CV Apel Segar, who supplies `po-5` — is derived for the
 * sticker and shown under the serial field.
 *
 * The two names are kept rather than collapsed into one, because a test that
 * says which of the two it means still reads better than one that does not,
 * and because the day the shop stores something other than Apple's barcode
 * again these are where it would show.
 */
const BARCODE = "SC02AA111AAAX";
const SERIAL = "SC02AA111AAAX";
const STORE_BARCODE = "ASSC02AA111AAAX";
const BARCODE_2 = "SC02BB222BBBX";
const SERIAL_2 = "SC02BB222BBBX";

/**
 * The store, read through the one door it has.
 *
 * `mutate` hands out the draft, and returning it unchanged costs a clone and a
 * no-op re-render — cheaper than a test-only export that production code would
 * have to keep honest.
 */
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
 * A serial arriving at a HAND's speed, into whatever has focus.
 *
 * The gap between characters is the only thing telling a scan from typing, and
 * the scanner's clock is injected here — so a `userEvent.keyboard` burst with
 * the clock standing still reads as a scanner however slowly the test meant
 * it. Advancing well past `burstGapMs` per character is what makes the typed
 * route actually the typed route.
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
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/inbound/${ORDER}`]}>
        <Routes>
          <Route path="/inbound/:poId" element={<InboundDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

const serials = () =>
  screen
    .getAllByLabelText("Serial")
    .map((el) => (el as HTMLInputElement).value);

/**
 * The other two boxes on a row, by row.
 *
 * Plural since 2026-08-27: Description and Battery used to exist only on rows
 * that had become units, so a `getByLabelText` was unambiguous. Every column
 * is typable on every row now — the bench grades a machine in whatever order
 * the machine offers itself — so these are indexed like the serials are.
 *
 * Description reads the CHOSEN TAGS rather than the box's value. It is a
 * `Select mode="tags"` since 2026-08-27 — a description is a list of phrases,
 * not a sentence — and the labelled element is the search input inside it,
 * which is empty whenever nobody is mid-word.
 */
const descriptions = (): string[][] =>
  screen
    .getAllByLabelText("Description")
    .map((el) =>
      Array.from(
        el
          .closest(".ant-select")
          ?.querySelectorAll(".ant-select-selection-item-content") ?? [],
      ).map((n) => n.textContent ?? ""),
    );

/**
 * Put a phrase on a row's description.
 *
 * `paste` rather than `type`: antd re-filters the option list on every
 * keystroke, so typing a phrase character by character into a page holding
 * three of these costs tens of seconds — the whole reason the "accepting a
 * machine" test used to run for fifteen.
 */
async function describeRow(index: number, phrase: string) {
  const box = screen.getAllByLabelText("Description")[index]!;
  await userEvent.click(box);
  await userEvent.paste(phrase);
  // Enter is what a person presses; leaving the field is what commits it in
  // jsdom, where rc-select does not treat its dropdown as open. Both are real
  // — the bench types a phrase and reaches for the next box — so the test does
  // both rather than picking whichever one the environment happens to honour.
  await userEvent.keyboard("{Enter}");
  await userEvent.tab();
}

/**
 * The battery boxes of the grid.
 *
 * `po-5` carries a 2016 MacBook Pro, so since the era split of 2026-09-08 its
 * rows ask for a CYCLE COUNT and a capacity rather than a percentage — which
 * is the feature, not an accident of the fixture. The percentage box is
 * exercised on its own further down, against an order whose product is new
 * enough to report one.
 */
const batteries = () => screen.getAllByLabelText("Cycle count");

/**
 * The confirm button of the dialog currently open, by its label.
 *
 * Scoped to the dialog rather than to the document: `getByRole("button", …)`
 * computes an accessible name for every button on the page, and this one draws
 * a card and a table per product with four buttons on every row.
 */
async function okButton(label: string) {
  // The LAST dialog, not the only one: antd leaves a closed modal in the DOM,
  // so a test that confirms twice has two to choose from and the live one is
  // the one mounted most recently.
  await screen.findAllByRole("dialog");
  const dialogs = screen.getAllByRole("dialog");
  return within(dialogs[dialogs.length - 1]!).getByRole("button", {
    name: label,
  });
}

beforeEach(() => {
  __resetScanner();
  now = 0;
  __setScannerClock(() => now);
  // An arrived order expecting three of one product, and nothing identified.
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
    d.units = d.units.filter((u) => u.poId !== ORDER);
    // …and this file's own serials wherever else a test may have put them.
    // The line above only clears THIS order's machines, and the collision test
    // below plants one on another order deliberately; left behind, it would
    // make every later scan of the same barcode a duplicate.
    const mine = new Set([SERIAL, SERIAL_2]);
    d.units = d.units.filter((u) => !mine.has(u.serial));
    // The store is a module singleton, so a serial one test recorded would
    // still have its ledger when the next one reused the same string — and an
    // assertion about "one arrival event" would count two.
    const live = new Set(d.units.map((u) => u.serial));
    d.events = d.events.filter((e) => live.has(e.serial));
    // Same for a service visit. The QC service tests below all send the same
    // barcode, so without this the second one asserts against the first one's
    // visit and reads its own charges as missing.
    d.services = d.services.filter((r) => live.has(r.serial));
  });
});

describe("typing a serial", () => {
  it("expects one row per machine, and none of them is a unit yet", () => {
    renderOrder();
    expect(serials()).toEqual(["", "", ""]);
    // Every row is gradeable from the moment it exists (owner revision
    // 2026-08-27). It is still not a unit — the serial is what makes one —
    // but the person holding the machine can write down what they can see
    // before they turn it over to read the sticker.
    expect(descriptions()).toEqual([[], [], []]);
    expect(batteries()).toHaveLength(3);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("takes a whole serial in one go, without losing the caret", async () => {
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]!;
    await userEvent.click(box);
    await userEvent.keyboard("SC02XY1234567");

    // The regression: before 2026-08-26 this held "C" and focus was gone.
    expect(box).toHaveValue("SC02XY1234567");
    expect(box).toHaveFocus();
  });

  it("writes the unit and its arrival only once the field is left", async () => {
    renderOrder();
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard("SC02XY1234567");

    // Still only text on screen. A half-typed serial is not a machine.
    expect(snapshot().units.some((u) => u.serial === "SC02XY1234567")).toBe(
      false,
    );

    await userEvent.tab();

    const db = snapshot();
    expect(db.units.find((u) => u.serial === "SC02XY1234567")).toMatchObject({
      status: "QC",
      poId: ORDER,
      skuId: SKU,
      // The line's cost follows the machine it was paid for.
      buy: 4_100_000,
    });
    // The one rule: the row and the event that explains it, together.
    expect(db.events.filter((e) => e.serial === "SC02XY1234567")).toHaveLength(
      1,
    );
    // One row fewer waiting, and the same three rows on screen: the slot did
    // not disappear, it became the machine.
    expect(serials()).toEqual(["SC02XY1234567", "", ""]);
  });

  it("refuses a serial another unit already carries", async () => {
    const taken = snapshot().units.find((u) => u.poId !== ORDER)!.serial;
    renderOrder();
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard(taken);
    await userEvent.tab();

    // Nothing recorded, and the box goes back to empty: a slot has no identity
    // to hold text against, so leaving it there would only mean losing it the
    // moment another row filled.
    expect(snapshot().units.filter((u) => u.serial === taken)).toHaveLength(1);
    expect(serials()).toEqual(["", "", ""]);
    // Nothing was created against this order by the refusal.
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("moves the ledger with a corrected serial", async () => {
    renderOrder();
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard("SC02XY1234500");
    await userEvent.tab();

    const box = screen.getAllByLabelText("Serial")[0]!;
    await userEvent.tripleClick(box);
    await userEvent.keyboard("SC02XY1234567");
    await userEvent.tab();

    const db = snapshot();
    // Leaving the events on the old serial would orphan the machine's whole
    // timeline while it sat there looking correct.
    expect(db.events.filter((e) => e.serial === "SC02XY1234500")).toHaveLength(
      0,
    );
    expect(db.events.filter((e) => e.serial === "SC02XY1234567")).toHaveLength(
      1,
    );
  });
});

describe("scanning a serial", () => {
  it("drops each scan into the next row still waiting", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();
    scan(BARCODE_2);
    await settle();

    // Stored with the supplier's origin code on the front, which is the
    // owner's whole point: the serial says which pallet the machine came off.
    expect(serials()).toEqual([SERIAL, SERIAL_2, ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(2);
  });

  it("does not book the same machine twice", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();
    scan(BARCODE);
    await settle();

    expect(serials()).toEqual([SERIAL, "", ""]);
  });

  it("refuses a scan the shop already knows from somewhere else", async () => {
    // A machine on another order already carrying the serial this scan would
    // build. The duplicate check runs on the STORED form, because that is
    // what a serial is once it is in the database.
    //
    // Added rather than renamed, so the seed's own rows stay as they were and
    // `beforeEach` can take this one back out again by its serial.
    act(() => {
      mutate((d) => {
        const other = d.units.find((u) => u.poId !== ORDER)!;
        d.units.push({ ...other, serial: SERIAL });
      });
    });
    renderOrder();
    scan(BARCODE);
    await settle();

    // Two units cannot share a serial, and silently filing this one against
    // the wrong order is the mistake the check exists to stop.
    expect(serials()).toEqual(["", "", ""]);
    expect(snapshot().units.filter((u) => u.serial === SERIAL)).toHaveLength(1);
  });
});

/**
 * The barcode rules (owner ask 2026-08-28).
 *
 * `test/serialScan.test.ts` is where the five rules themselves are checked.
 * What these guard is that the PAGE puts a scan through them at all, and that
 * a refusal leaves the grid untouched rather than filing a misread as a
 * machine.
 */
describe("what the scanner will not accept", () => {
  const nothingRecorded = () => {
    expect(serials()).toEqual(["", "", ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  };

  it("refuses a read that is too short", async () => {
    renderOrder();
    // Ten characters after the marker comes off — a scanner that came away
    // from the barcode early. Every other rule would pass it, which is
    // exactly why the length is checked first and refused by its own name.
    scan("SC02AA111A");
    await settle();
    nothingRecorded();
  });

  it("refuses a read carrying an I or an O", async () => {
    renderOrder();
    // Apple prints neither, precisely so nobody confuses them with 1 and 0,
    // so their presence is proof of a misread rather than a preference.
    scan("SC02AA1O1AAAX");
    await settle();
    nothingRecorded();
  });

  it("strips the barcode's S marker before storing the serial", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();
    // Thirteen characters in, thirteen stored. Nothing is prefixed — the
    // store barcode is derived for the sticker, not written into the serial.
    expect(serials()).toEqual([SERIAL, "", ""]);
  });

  it("refuses a read with no S at all", async () => {
    renderOrder();
    // The owner's rule, restated absolutely on 2026-09-01: *"begins with S; if
    // not begin with S don't accept"*. Twelve perfectly well-formed
    // characters, and still refused — that is what the regulatory barcode
    // beside the serial looks like.
    scan("C02AA111AAAX");
    await settle();
    nothingRecorded();
  });

  it("takes the shortest serial Apple prints — S and ten", async () => {
    renderOrder();
    // The owner's own example, which the old twelve-character floor refused.
    scan("SDQXFPXWCK7");
    await settle();
    expect(serials()).toEqual(["SDQXFPXWCK7", "", ""]);
  });

  /**
   * Both barcodes at the bench (owner ask 2026-09-01).
   *
   * A machine carries Apple's and, once QC has printed one, the shop's. Either
   * is a legitimate aim, and the desk has to take both while still refusing
   * the regulatory barcode sitting next to them — which is the whole reason
   * the marker rule exists.
   */
  it("takes the shop's own sticker as well as Apple's barcode", async () => {
    renderOrder();
    // Fifteen characters — `AS` in front of the whole original barcode. It
    // resolves back to Apple's, which is what the row stores.
    scan(STORE_BARCODE);
    await settle();
    expect(serials()).toEqual([SERIAL, "", ""]);
  });

  it("does not store the store barcode itself", async () => {
    renderOrder();
    scan(STORE_BARCODE);
    await settle();
    // The failure this guards: filing the sticker's own string as the serial,
    // so the machine is recorded under a number Apple never printed and a
    // scan of the underside finds nothing.
    expect(snapshot().units.some((u) => u.serial.startsWith("AS"))).toBe(false);
  });

  it("shows the store QR under the serial, derived not stored", async () => {
    // The owner's correction of 2026-09-01: *"don't auto append the original
    // with store initial. Instead, still show whatever the S-10/12 digit in
    // the serial field, then below it show the store serial number."*
    renderOrder();
    scan(BARCODE);
    await settle();

    // The field holds Apple's barcode…
    expect(serials()).toEqual([SERIAL, "", ""]);
    // …and the store form is under it, `AS` for CV Apel Segar who supplies
    // this order. Nothing in the database holds this string.
    expect(await screen.findByText(STORE_BARCODE)).toBeInTheDocument();
    expect(snapshot().units.some((u) => u.serial === STORE_BARCODE)).toBe(
      false,
    );
  });

  it("still refuses two capitals nobody issued as an origin code", async () => {
    renderOrder();
    // `XX` is not a supplier code this shop has given out, so these fourteen
    // characters carry no marker at all — exactly what a regulatory barcode
    // looks like.
    scan("XXSC02AA111AAAX");
    await settle();
    nothingRecorded();
  });
});

describe("recording a battery", () => {
  /** The cycle box on the first row — the one the scan below turns into a unit. */
  const battery = () => batteries()[0] as HTMLInputElement;

  const stored = () => snapshot().units.find((u) => u.serial === SERIAL)!;
  const cycles = () => stored().cycleCount;

  it("never files a reading nobody could have taken", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    await userEvent.click(battery());
    await userEvent.keyboard("50000");

    // Said while the number is still in the box.
    expect(battery()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("0–5000 only")).toBeTruthy();
    expect(cycles()).toBeUndefined();

    await userEvent.tab();

    // Refused, not clamped: antd's `max` would have stored 5000 here, which is
    // a claim about a battery nobody counted. And not stored as 5 either — the
    // digits on the way to a typo are not readings.
    expect(cycles()).toBeUndefined();
    expect(battery().value).toBe("");
    expect(screen.queryByText("0–5000 only")).toBeNull();
  });

  it("takes a real reading, 0 included, once the box is left", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    await userEvent.click(battery());
    await userEvent.keyboard("312");
    // Typing alone writes nothing: 3 and 31 are counts of a different machine.
    expect(cycles()).toBeUndefined();

    await userEvent.tab();
    expect(cycles()).toBe(312);
    expect(battery()).not.toHaveAttribute("aria-invalid");

    // Zero is a REAL count — a battery replaced last week — and must survive
    // every falsiness check between the box and the store.
    await userEvent.tripleClick(battery());
    await userEvent.keyboard("0");
    await userEvent.tab();
    expect(cycles()).toBe(0);
  });

  it("clears the refusal as soon as the number comes back in range", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    await userEvent.click(battery());
    await userEvent.keyboard("31200");
    expect(screen.getByText("0–5000 only")).toBeTruthy();

    // The slipped digit, deleted. The cell has to recover while the caret is
    // still in it, not only when it is left.
    await userEvent.keyboard("{Backspace}");
    expect(screen.queryByText("0–5000 only")).toBeNull();

    await userEvent.tab();
    expect(cycles()).toBe(3120);
  });

  it("empties a reading that turns out to be wrong", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    await userEvent.click(battery());
    await userEvent.keyboard("312");
    await userEvent.tab();
    expect(cycles()).toBe(312);

    await userEvent.tripleClick(battery());
    await userEvent.keyboard("{Backspace}");
    await userEvent.tab();

    // Blank is a state of the field, not a zero: nobody has counted it.
    expect(cycles()).toBeUndefined();
  });

  it("records the capacity beside the count, and never a percentage", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    await userEvent.click(battery());
    await userEvent.keyboard("312");
    await userEvent.tab();
    const capacity = screen.getAllByLabelText(
      "Full charge capacity",
    )[0] as HTMLInputElement;
    await userEvent.click(capacity);
    await userEvent.keyboard("4800");
    await userEvent.tab();

    expect(stored()).toMatchObject({ cycleCount: 312, fcc: 4800 });
    // A 2016 body reports no health figure, so the grid never offers a box
    // that could file one.
    expect(stored().batteryHealth).toBeUndefined();
    expect(screen.queryAllByLabelText("Battery health")).toHaveLength(0);
  });
});

describe("accepting a machine", () => {
  // The heaviest of the lot: it renders the page, scans, types a sentence
  // character by character and clicks. See the file-level timeout above.
  it("needs a description before it will let a machine onto the shelf", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    // By its own `aria-label`, which names the machine. A `getByRole` with a
    // name recomputes an accessible name for every button on the page, and
    // this page now draws a card and a table per product.
    const accept = () => screen.getByLabelText(`Accept ${SERIAL}`);
    expect(accept()).toBeDisabled();

    // The gate was a price AND a description until 2026-08-27, when the price
    // moved to the variant and stopped being something QC could be missing.
    // The description is the whole gate now: a second-hand machine that reaches
    // the shelf with nobody's note on its condition is one nobody can list, or
    // answer a question about later (owner, 2026-08-26).
    // Two phrases, not a sentence: the comma is the separator in the column,
    // so it is the separator in the box.
    await describeRow(0, "Mulus, Fullset dus");
    expect(descriptions()[0]).toEqual(["Mulus", "Fullset dus"]);
    expect(accept()).toBeEnabled();

    await userEvent.click(accept());
    const unit = snapshot().units.find((u) => u.serial === SERIAL)!;
    expect(unit.status).toBe("TERSEDIA");
    // Stored as one string, which is what the column is — the list is how the
    // screen shows it, not a second shape in the database.
    expect(unit.description).toBe("Mulus, Fullset dus");
  });
});

describe("grading before the serial", () => {
  /**
   * The owner's revision of 2026-08-27, and the one that changed the shape of
   * the screen: the serial is on a sticker on the underside, and the person
   * grading reads the battery off the screen and the marks off the lid while
   * the machine is still open in front of them. Insisting on the sticker first
   * meant putting the machine down and picking it up again, per machine.
   */
  it("carries what was typed into a waiting row onto the machine", async () => {
    renderOrder();

    // A row with no serial takes both, and neither is a unit yet.
    await describeRow(0, "Mulus");
    await userEvent.click(batteries()[0]!);
    await userEvent.keyboard("312");
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);

    // The serial arrives last, and the grading goes in with it — one push,
    // so no moment exists in which the machine is on file and what somebody
    // observed about it is not.
    //
    // TYPED, so it is stored exactly as written: the barcode rules and the
    // supplier prefix are for scans (`lib/serialScan.ts` says why). Somebody
    // keying a machine in off a smudged sticker can see the machine. Twelve
    // characters, because that floor IS asked of the field — see "refuses a
    // typed serial under twelve characters".
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard("SC02AA111AAAX");
    await userEvent.tab();

    expect(
      snapshot().units.find((u) => u.serial === "SC02AA111AAAX"),
    ).toMatchObject({ description: "Mulus", cycleCount: 312 });
  });

  it("files a free-typed description in the suggestion list too", async () => {
    renderOrder();
    scan(BARCODE);
    await settle();

    await describeRow(0, "Retak");

    // `ensureQcDescription`: the phrase reaches the machine and the shop's
    // vocabulary in the same mutation, so nothing is ever described by a
    // phrase the list has not heard of.
    expect(snapshot().qcDescriptions.some((d) => d.label === "Retak")).toBe(
      true,
    );
  });

  it("leaves each row's grading on its own row when a later one goes in first", async () => {
    renderOrder();
    await describeRow(0, "Dent");

    // The third row gets its serial before the first. Slot keys are
    // positional, so without `reslotDrafts` the dent would land on whatever
    // row the renumbering moved into its place.
    await userEvent.click(screen.getAllByLabelText("Serial")[2]!);
    await userEvent.keyboard("SC02CC333CCCX");
    await userEvent.tab();

    // The machine that was identified is not the one the dent was about.
    expect(
      snapshot().units.find((u) => u.serial === "SC02CC333CCCX")!.description,
    ).toBe("");
    // And the dent is still on a row that is still waiting for its serial.
    expect(descriptions()).toEqual([[], ["Dent"], []]);
  });
});

describe("the length of a serial", () => {
  it("stops the field at fifteen characters — the store barcode's length", () => {
    renderOrder();
    // Not thirteen. The field takes EITHER barcode, and the shop's own sticker
    // is two characters longer than the serial inside it; truncating a pasted
    // one to thirteen would fail it on a length rule it never broke.
    expect(screen.getAllByLabelText("Serial")[0]!).toHaveAttribute(
      "maxlength",
      "15",
    );
  });

  it("still takes a typed serial with an I or an O in it", async () => {
    renderOrder();
    // A SCAN of this is refused: Apple prints neither letter, so a scanner
    // reading one is misreading a 1 or a 0. Typed, it is a person looking at
    // the machine — the one witness who could legitimately key either — so
    // the shape rule applies and this one does not. See `validateSerial`.
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard("SC02AA1O1AAAX");
    await userEvent.tab();

    expect(
      snapshot().units.find((u) => u.serial === "SC02AA1O1AAAX"),
    ).toBeDefined();
  });

  it("takes the shop's own sticker typed into the field", async () => {
    // The trap this closes: somebody re-keying a machine reads whichever label
    // faces them, and on a graded machine that is usually the store sticker.
    // Refusing it — "does not begin with S", about a string that plainly does,
    // two characters in — was the most confusing thing this field could say.
    renderOrder();
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard(STORE_BARCODE);
    await userEvent.tab();

    // Filed under Apple's serial, not under the sticker.
    expect(snapshot().units.some((u) => u.serial === SERIAL)).toBe(true);
    expect(snapshot().units.some((u) => u.serial === STORE_BARCODE)).toBe(
      false,
    );
  });

  it("keeps what was typed when the shape is wrong, rather than wiping it", async () => {
    // `commitSerial` fires on BLUR, so clearing the box on a shape fault meant
    // clicking away mid-serial erased thirteen characters. A typo is two
    // keystrokes from correct; it must survive being looked at.
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await userEvent.keyboard("SC02AA111");
    await userEvent.tab();

    expect(box).toHaveValue("SC02AA111");
    expect(snapshot().units.some((u) => u.serial === "SC02AA111")).toBe(false);
  });

  it("puts the S back on a serial read off the case", async () => {
    // Owner ask 2026-09-01, second revision: *"if the barcode is typed and is
    // 10–12 digit, auto-add S"*. The marker is printed under the bars, not on
    // the case, so the number somebody is copying does not carry one — and
    // this field used to refuse the number the machine actually shows.
    renderOrder();
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand("C02AA111AAAX");
    await userEvent.tab();

    expect(snapshot().units.some((u) => u.serial === SERIAL)).toBe(true);
    // Filed under the marked serial, not under the bare one.
    expect(snapshot().units.some((u) => u.serial === "C02AA111AAAX")).toBe(
      false,
    );
  });

  it("refuses that same string when a scanner sent it", async () => {
    // The distinction the whole rule turns on. A barcode carries its marker,
    // so a burst without one was aimed at the regulatory code or the part
    // number beside the serial's — the misread this desk exists to catch.
    renderOrder();
    scan("C02AA111AAAX");
    await settle();

    expect(serials()).toEqual(["", "", ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("still refuses a bare string too long to be a serial", async () => {
    // Fourteen characters is neither form: too long for a bare serial to be
    // marked, and it carries no marker to be judged on. Nothing rescues it.
    renderOrder();
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await typeByHand("C02AA111AAAXYZ");
    await userEvent.tab();

    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });

  it("types in capitals whatever the keyboard is doing", async () => {
    // Owner ask 2026-09-01. The serial is stored upper-cased either way, so
    // without this the box shows one string while another gets filed — a
    // mismatch nobody sees until they compare the sticker with the screen.
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("c02aa111aaax");

    expect(box).toHaveValue("C02AA111AAAX");
    await userEvent.tab();
    expect(snapshot().units.some((u) => u.serial === SERIAL)).toBe(true);
  });

  it("refuses a typed serial with too little behind the S", async () => {
    renderOrder();
    // Half a serial: a sticker read at arm's length and keyed in three
    // characters short. Unlike a pasted paragraph it looks perfectly
    // reasonable in the column, which is why the floor exists.
    await userEvent.click(screen.getAllByLabelText("Serial")[0]!);
    await userEvent.keyboard("SC02AA111");
    await userEvent.tab();

    expect(
      snapshot().units.find((u) => u.serial === "SC02AA111"),
    ).toBeUndefined();
  });

  it("outlines the box in red and says why, not just a toast", async () => {
    // The owner's report (2026-09-01): a toast is gone in four seconds and the
    // next thing the bench does is pick up the next machine, so the refusal
    // has to live on the box that holds the bad serial.
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await userEvent.keyboard("SC02AA111");
    await userEvent.tab();

    expect(box).toHaveAttribute("aria-invalid", "true");
    // antd paints the outline from this class on the wrapper, and asserting on
    // the class rather than on a colour survives a theme change.
    expect(box.closest(".ant-input-status-error")).not.toBeNull();
    expect(screen.getByText("S and then 10–12")).toBeInTheDocument();
  });

  it("says a bare string is the wrong length, not that it is missing an S", async () => {
    // The S is printed under the bars, not on the case. Since the app puts it
    // back for a typed serial, telling somebody copying the case to "check the
    // sticker for an S" sends them looking for a character that is not there.
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await typeByHand("C02AA111AAAXYZ");
    await userEvent.tab();

    expect(screen.getByText("10–12 characters")).toBeInTheDocument();
    expect(box.closest(".ant-input-status-error")).not.toBeNull();
  });

  it("takes the red back as soon as the serial is being fixed", async () => {
    // The accusation was about the text that WAS in the box. A field that
    // stayed red while somebody corrected it would be reporting a serial
    // nobody can see any more.
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;
    await userEvent.click(box);
    await userEvent.keyboard("SC02AA111");
    await userEvent.tab();
    expect(box).toHaveAttribute("aria-invalid", "true");

    await userEvent.click(box);
    await userEvent.keyboard("AAAX");

    expect(box).not.toHaveAttribute("aria-invalid");
    expect(box.closest(".ant-input-status-error")).toBeNull();
  });

  it("does not outline a row that is merely still waiting", async () => {
    // An empty row is a prompt, not a mistake — it keeps the amber it has
    // always had, and red has to mean something narrower than "not done".
    renderOrder();
    const box = screen.getAllByLabelText("Serial")[0]! as HTMLInputElement;

    expect(box).not.toHaveAttribute("aria-invalid");
    expect(box.closest(".ant-input-status-warning")).not.toBeNull();
  });

  it("refuses a scan that is really two scans", async () => {
    renderOrder();
    // Two barcodes into one field with no Enter between them. It has a length,
    // and a length is the only thing about it a field can check.
    scan(`${BARCODE}${BARCODE_2}`);
    await settle();

    expect(serials()).toEqual(["", "", ""]);
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });
});

describe("taking a QC decision back", () => {
  /** Scan one machine and describe it, without typing a sentence per test. */
  async function graded(barcode = BARCODE, serial = SERIAL) {
    renderOrder();
    scan(barcode);
    await settle();
    act(() => {
      mutate((d) => {
        d.units.find((u) => u.serial === serial)!.description = "Mulus";
      });
    });
    return serial;
  }

  it("puts an accepted machine back on the bench, keeping both events", async () => {
    const serial = await graded();
    await userEvent.click(screen.getByLabelText(`Accept ${serial}`));
    expect(snapshot().units.find((u) => u.serial === serial)!.status).toBe(
      "TERSEDIA",
    );

    await userEvent.click(screen.getByLabelText(`Reopen QC for ${serial}`));
    await userEvent.click(await okButton("Reopen QC"));

    const db = snapshot();
    expect(db.units.find((u) => u.serial === serial)!.status).toBe("QC");
    // Append-only: the acceptance that was wrong stays on the timeline, and
    // the correction sits after it. Nothing is rewritten.
    const types = db.events
      .filter((e) => e.serial === serial)
      .map((e) => e.type);
    expect(types).toEqual(["DITERIMA", "QC_SELESAI", "QC_DIBUKA"]);
  });

  it("withdraws the supplier claim when the rejection was the wrong machine", async () => {
    const serial = await graded();
    await userEvent.click(
      screen.getByLabelText(`Reject ${serial} back to the supplier`),
    );
    await userEvent.click(await okButton("Return to supplier"));
    const claim = snapshot().returns.find((r) => r.serial === serial)!;
    expect(claim.status).toBe("DONE");

    await userEvent.click(screen.getByLabelText(`Reopen QC for ${serial}`));
    await userEvent.click(await okButton("Reopen QC"));

    const db = snapshot();
    expect(db.units.find((u) => u.serial === serial)!.status).toBe("QC");
    // Leaving it standing would have the shop claiming money from a supplier
    // for a machine sitting on its own bench. Marked withdrawn, not deleted —
    // the claim really was raised.
    expect(db.returns.find((r) => r.id === claim.id)!.status).toBe("CANCELLED");
  });

  it("will not reopen a machine somebody else has acted on", async () => {
    const serial = await graded();
    await userEvent.click(screen.getByLabelText(`Accept ${serial}`));
    act(() => {
      mutate((d) => {
        d.units.find((u) => u.serial === serial)!.status = "TERJUAL";
      });
    });

    // It is out of the door. Correcting that is the sale's job, not QC's.
    expect(screen.getByLabelText(`Reopen QC for ${serial}`)).toBeDisabled();
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
    renderOrder();
    scan(BARCODE);
    await settle();
    close();

    // Every box on the page stops together, or "closed" means nothing.
    for (const el of screen.getAllByLabelText("Serial")) {
      expect(el).toBeDisabled();
    }
    for (const el of screen.getAllByLabelText("Description")) {
      expect(el).toBeDisabled();
    }
    expect(
      screen.getByRole("button", { name: /Record payment/ }),
    ).toBeDisabled();
    // And no row offers a decision while it is closed.
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();

    // The way back is one click, on purpose: a close that is expensive to undo
    // is a close staff work around by raising a second order.
    // A regex, like the Accept button above: antd puts an `aria-label`-ed
    // unlock icon inside, and that label is part of the computed name.
    await userEvent.click(screen.getByRole("button", { name: /Reopen/ }));
    expect(
      snapshot().pos.find((p) => p.id === ORDER)!.closedAt,
    ).toBeUndefined();
    expect(screen.getAllByLabelText("Serial")[0]!).toBeEnabled();
  });

  it("refuses a scan rather than silently swallowing it", async () => {
    renderOrder();
    close();
    scan(BARCODE);
    await settle();

    // The scanner listens at the document, so no `disabled` prop reaches it.
    expect(snapshot().units.filter((u) => u.poId === ORDER)).toHaveLength(0);
  });
});

describe("what a payment settles", () => {
  it("says which part of the invoice each transfer was aimed at", () => {
    act(() => {
      mutate((d) => {
        const po = d.pos.find((p) => p.id === ORDER)!;
        po.shippingFee = 250_000;
        po.payments = [
          {
            id: "pp-t1",
            method: "TUNAI",
            amount: 250_000,
            at: "x",
            appliedTo: "SHIPPING",
          },
          // No `appliedTo` — a row from before the buckets existed. It reads
          // as the goods rather than as a fourth, unlabelled column.
          { id: "pp-t2", method: "TUNAI", amount: 1_000_000, at: "x" },
        ];
      });
    });
    renderOrder();

    // The forwarder's money and the supplier's, told apart on the card that
    // exists to answer "has the ongkir been settled?". One row says Shipping
    // and the other says Products — the reading `paymentFor` gives a payment
    // recorded before the buckets existed.
    const cells = screen.getAllByRole("cell").map((el) => el.textContent);
    expect(cells).toContain("Shipping");
    expect(cells).toContain("Products");
  });
});

/**
 * Sending a machine for a repair — owner revision 2026-09-09.
 *
 * Three facts worth a rendered test, because none of them is visible from
 * `lib/service.ts` alone: the dialog asks rather than confirms, the machine
 * does not arrive by being sent, and the charges it asks for land on the visit
 * it opens. The last one is what makes the margin honest, and it used to be a
 * column in the grid that could be filled in and then never read.
 */
describe("sending a machine to service", () => {
  async function graded(barcode = BARCODE, serial = SERIAL) {
    renderOrder();
    scan(barcode);
    await settle();
    act(() => {
      mutate((d) => {
        d.units.find((u) => u.serial === serial)!.description = "Mulus";
      });
    });
    return serial;
  }

  it("opens a visit that has not arrived, and leaves the machine where it is", async () => {
    const serial = await graded();
    const before = snapshot().units.find(
      (u) => u.serial === serial,
    )!.locationId;

    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    await userEvent.click(await okButton("Send to service"));

    const db = snapshot();
    const unit = db.units.find((u) => u.serial === serial)!;
    // Out of sellable stock the moment it is promised to a repairer...
    expect(unit.status).toBe("SERVIS");
    // ...but still on the shelf it was graded on, because nobody at the bench
    // has signed for it. Warehouse 4 claiming to hold a machine that is in a
    // van is the thing this replaced.
    expect(unit.locationId).toBe(before);
    const visit = db.services.find((r) => r.serial === serial)!;
    expect(visit.arrivedAt).toBeUndefined();
    expect(visit.raisedBy).toBe("QC");
  });

  it("puts the courier and the quote on the visit it opens", async () => {
    const serial = await graded();
    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    await screen.findAllByRole("dialog");

    const dialog = screen.getAllByRole("dialog").at(-1)!;
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
    // Two charges from two parties, not one number covering both — which is
    // the whole reason a visit carries a list.
    expect(visit.fees.map((f) => [f.kind, f.amount]).sort()).toEqual([
      ["LABOUR", 800_000],
      ["SHIPPING", 150_000],
    ]);
  });

  it("takes the machine off the bench's list when the decision is reopened", async () => {
    const serial = await graded();
    await userEvent.click(screen.getByLabelText(`Send ${serial} to service`));
    await userEvent.click(await okButton("Send to service"));

    await userEvent.click(screen.getByLabelText(`Reopen QC for ${serial}`));
    await userEvent.click(await okButton("Reopen QC"));

    const db = snapshot();
    expect(db.units.find((u) => u.serial === serial)!.status).toBe("QC");
    // The visit is closed rather than removed — a courier charge already
    // incurred is still a cost — but the bench stops waiting for it.
    expect(
      db.services.find((r) => r.serial === serial)!.closedAt,
    ).toBeDefined();
  });
});
