/**
 * A stock take that finds a machine the shop has never booked in — the owner's
 * ask of 2026-08-31, driven end to end.
 *
 * The pure rules live in `test/opnameScope.test.ts`. What can only be checked
 * by rendering is the SEQUENCE, and the sequence is the whole feature:
 *
 * - a draft writes nothing, however much the counter fills in;
 * - posting creates the unit, in QC, with a genesis event and nothing else;
 * - a serial the shop already owns is never offered the button, because that
 *   machine exists and needs moving rather than making.
 *
 * Every one of those is a promise about a moment rather than about a value, so
 * a unit test of the store could hold while the page broke.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpnameSessionPage } from "../src/routes/opname/OpnameSessionPage.js";
import { mutate } from "../src/mock/store.js";
import { HELD_STATUSES } from "../src/lib/inventory.js";
import type { MockDb } from "../src/mock/seed.js";

// The same budget `inboundQcPage.test.tsx` takes, and for the same reason:
// these render a whole page into jsdom and drive it with real events, so the
// cost tracks how busy the machine is rather than what is being asserted.
vi.setConfig({ testTimeout: 60_000 });

const SESSION = "op-test";
/** Not a serial anything in the seed carries. Twelve characters, AS + ten. */
const FOUND = "ASZZ999888ZZ";
/** A real unit, parked in a warehouse this count does not cover. */
let elsewhereSerial = "";

function snapshot(): MockDb {
  let seen!: MockDb;
  act(() => {
    mutate((d) => {
      seen = d;
    });
  });
  return seen;
}

/** A draft count of one warehouse, with the found serial already scanned in. */
beforeEach(() => {
  mutate((d) => {
    d.opnames = d.opnames.filter((o) => o.id !== SESSION);
    d.units = d.units.filter((u) => u.serial !== FOUND);
    d.events = d.events.filter((e) => e.serial !== FOUND);
    // One real machine moved out of the counted warehouse, so the
    // "already ours" case is a fixture rather than a hope about the seed.
    const away = d.units.find(
      (u) => u.status === "TERSEDIA" && u.locationId === d.myWarehouseId,
    )!;
    away.locationId = "wh-2";
    elsewhereSerial = away.serial;
    d.opnames.unshift({
      id: SESSION,
      code: "SO-2026/08-000099",
      locationIds: [d.myWarehouseId],
      rackIds: [],
      categories: [],
      conditions: [],
      date: "2026-08-31",
      at: new Date().toISOString(),
      counted: [],
      missing: [],
      unknown: [],
      notes: {},
      surplus: {},
      status: "DRAFT",
    });
  });
});

function renderSession() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/stock/opname/${SESSION}`]}>
        <Routes>
          <Route
            path="/stock/opname/:opnameId"
            element={<OpnameSessionPage />}
          />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

/**
 * Shut whatever dialog is open, the way a person does.
 *
 * Not housekeeping — it is required. Antd's imperative `modal.confirm` renders
 * through its own root in `document.body` rather than into the container
 * Testing Library unmounts, so a confirmation left standing is still there for
 * the next test; and an open antd modal puts `aria-hidden` on its siblings, so
 * the next test renders a perfectly good page that every `getByRole` refuses
 * to see. Cancelling it closes it through React rather than tearing the node
 * out from under it, which is the difference between this and the version of
 * this helper that did not work.
 *
 * Cancel rather than Escape: antd's confirm dialog does not honour Escape
 * under jsdom, and a helper that silently leaves the dialog open would put the
 * failure two tests away from its cause.
 */
async function closeDialog() {
  const dialog = screen.getByRole("dialog");
  const cancel = within(dialog).queryByRole("button", { name: /Cancel/i });
  if (cancel) await userEvent.click(cancel);
  else await userEvent.keyboard("{Escape}");
  // Waits for the PAGE to come back, not for the dialog to vanish. jsdom
  // fires no transition events, so antd's closing modal sits in its leave
  // animation for ever and `queryByRole("dialog")` keeps finding it. What
  // actually matters is the thing that broke the next test — the `aria-hidden`
  // an open modal puts on its siblings — and that comes off as soon as it
  // closes. The footer's Save button is on every draft view, both phases, so
  // seeing it means the page is reachable again.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Save now/i })).toBeVisible(),
  );
}

/**
 * Count one serial through the scan box, then go to the review step.
 *
 * Two clicks since 2026-09-01: *Review & finish* now lands on the expected
 * list — the owner's "before Review & Finish, show all the product that is
 * supposed to be in that scope" — and the confirmation is one step further on.
 */
async function count(serial: string) {
  const box = screen.getByPlaceholderText(/Scan or type a serial/i);
  await userEvent.click(box);
  await userEvent.paste(serial);
  await userEvent.keyboard("{Enter}");
  await userEvent.click(
    screen.getByRole("button", { name: /Review & finish/i }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Continue to review/i }),
  );
}

describe("a machine the shop never booked in", () => {
  it("offers the button only for a serial the system has never seen", async () => {
    renderSession();
    await count(FOUND);

    // The unknown table carries it, and the button is there to be pressed.
    expect(
      screen.getByRole("button", { name: /Add to inventory/i }),
    ).toBeInTheDocument();
  });

  it("does not offer it for a unit that is simply in the wrong place", async () => {
    // A machine the shop already owns needs MOVING, not making. A second row
    // for it would be a duplicate of a laptop that exists.
    renderSession();
    await count(elsewhereSerial);

    expect(
      screen.queryByRole("button", { name: /Add to inventory/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Already ours/i)).toBeInTheDocument();
  });

  it("creates nothing while the count is still a draft", async () => {
    renderSession();
    await count(FOUND);
    await userEvent.click(
      screen.getByRole("button", { name: /Add to inventory/i }),
    );
    await screen.findByRole("dialog");

    // The dialog is open, the decision is half made, and the database has not
    // heard of this machine. That is the promise a draft makes.
    expect(snapshot().units.some((u) => u.serial === FOUND)).toBe(false);
    expect(snapshot().events.some((e) => e.serial === FOUND)).toBe(false);
    await closeDialog();
  });

  it("says where it will end up before anybody commits to it", async () => {
    renderSession();
    await count(FOUND);
    await userEvent.click(
      screen.getByRole("button", { name: /Add to inventory/i }),
    );
    const dialog = await screen.findByRole("dialog");

    // Posting is where a note becomes a machine in stock. Not a consequence
    // to discover afterwards in a toast that has already gone.
    expect(
      within(dialog).getByText(/enters QC, not the shelf/i),
    ).toBeInTheDocument();
    await closeDialog();
  });
});

/**
 * Posting, which is where the decision becomes a machine.
 *
 * The draft is seeded with the decision already made rather than made through
 * the dialog — reopening a saved draft is a real path, and rc-select under
 * jsdom is a poor way to spend sixty seconds proving something the dialog
 * tests above already cover. What is being checked here is what POST does.
 */
describe("posting a count that found one", () => {
  const SKU = "m-pro13-2016-v1";

  /**
   * A count of ONE EMPTY RACK, on which one unrecorded machine turned up.
   *
   * The scope is doing real work here rather than dressing the fixture. A
   * count of the whole warehouse expects two dozen machines, so posting it
   * would stop at "23 units still need a description" — the missing-note gate,
   * which is correct and has nothing to do with what these tests are about.
   * Narrowing to a rack nothing is filed on leaves the surplus as the only
   * finding, which is also exactly the shape of the real errand: somebody
   * checks a shelf and finds something that should not be there.
   */
  const EMPTY_RACK = "wh-1-rack-3";

  beforeEach(() => {
    mutate((d) => {
      for (const u of d.units) {
        if (u.rackId === EMPTY_RACK) u.rackId = "wh-1-rack-1";
      }
      const o = d.opnames.find((x) => x.id === SESSION)!;
      o.rackIds = [EMPTY_RACK];
      o.counted = [FOUND];
      o.unknown = [FOUND];
      o.surplus = {
        [FOUND]: {
          skuId: SKU,
          locationId: d.myWarehouseId,
          reason: "Bought over the counter, never entered",
          condition: "SECOND",
        },
      };
    });
  });

  /**
   * A draft opens on the counting screen, so the review is three clicks away —
   * the page deliberately withholds it until somebody says they are done
   * counting, and since 2026-09-01 there is an expected-list step in between.
   * See `OpnameSessionPage`'s docblock on what is not shown, and on `phase`.
   */
  async function review() {
    renderSession();
    await userEvent.click(
      screen.getByRole("button", { name: /Review & finish/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Continue to review/i }),
    );
  }

  async function post() {
    await review();
    await userEvent.click(screen.getByRole("button", { name: /Post count/i }));
    const confirm = await screen.findByRole("dialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: /Post count/i }),
    );
  }

  it("warns that the machine is about to exist, before the button is pressed", async () => {
    await review();
    await userEvent.click(screen.getByRole("button", { name: /Post count/i }));
    const confirm = await screen.findByRole("dialog");

    expect(
      within(confirm).getByText(/will be created in QC/i),
    ).toBeInTheDocument();
    await closeDialog();
  });

  it("reports nothing missing, because the rack it counted was empty", async () => {
    // Guards the fixture itself: if the scope ever stopped narrowing, these
    // tests would be posting a count of the whole warehouse and the surplus
    // assertions below would be measuring something else entirely.
    await review();
    expect(
      screen.getByText(/Nothing missing. Every expected unit was counted./i),
    ).toBeInTheDocument();
  });

  it("creates the unit in QC, not on the shelf", async () => {
    await post();

    const unit = snapshot().units.find((u) => u.serial === FOUND);
    expect(unit).toMatchObject({
      skuId: SKU,
      status: "QC",
      // No order behind it — that is what makes it a surplus rather than an
      // arrival, and what `OrphanQcCard` looks for.
      poId: null,
      // No cost: nobody bought it, and writing the asking price in as `buy`
      // would invent a margin out of nothing.
      buy: 0,
    });
    // Second-hand and ungraded is an honest state. An invented "A" would not
    // be — see `gradeForCondition`.
    expect(unit?.grade).toBeUndefined();
    expect(unit?.rackId).toBeUndefined();
  });

  it("gives it a genesis event rather than pretending it arrived on an order", async () => {
    await post();

    const events = snapshot().events.filter((e) => e.serial === FOUND);
    // Exactly one. The `DICATAT` the unknown list writes for everything else
    // must not also fire here, or the machine's first day would read twice.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "OPNAME_DITEMUKAN",
      // `-` is the mock's spelling of "this unit did not exist", the same one
      // an adjustment-in writes.
      fromStatus: "-",
      toStatus: "QC",
      seq: 1,
      refCode: "SO-2026/08-000099",
    });
    expect(events[0]?.note).toMatch(/Bought over the counter/);
  });

  it("files the reason on the managed list, so nothing points at a row that is not there", async () => {
    await post();

    expect(
      snapshot().reasons.some(
        (r) =>
          r.activity === "ADJUSTMENT" &&
          r.label === "Bought over the counter, never entered",
      ),
    ).toBe(true);
  });

  it("counts towards the product's stock the moment it exists", async () => {
    // The owner's words for what the button is for: *"item will be counted as
    // surplus & increase the inventory qty for that product"*. `HELD_STATUSES`
    // includes QC, so it does — before anybody grades it.
    const before = snapshot().units.filter(
      (u) => u.skuId === SKU && HELD_STATUSES.includes(u.status),
    ).length;
    await post();
    const after = snapshot().units.filter(
      (u) => u.skuId === SKU && HELD_STATUSES.includes(u.status),
    ).length;

    expect(after).toBe(before + 1);
  });
});
