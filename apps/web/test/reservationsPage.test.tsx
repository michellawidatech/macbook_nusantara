/**
 * Reservations, driven the way a counter drives it.
 *
 * This file exists because the 2026-08-27 revision moved every choice an
 * operator makes about a hold out of the table and into a dialog. What is
 * worth guarding is the three ways that dialog can dispose of a hold — take
 * everything, take some, take some and let the rest go — because each one
 * decides what happens to a machine somebody is expecting, and none of them
 * is reachable from a helper: the selection lives in component state.
 *
 * `useNavigate` is stubbed to record where checkout sent us. That makes the
 * checkout assertions about the URL rather than about a rendered till, which
 * is the right seam — Stock Out has its own tests, and what this page owes it
 * is the right serials.
 *
 * ## Where the seam is
 *
 * The store, again (2026-09-08). The page briefly read `/api/reservations`
 * while the MACHINES it holds stayed in the store, so a hold marked a Postgres
 * unit `DIRESERVASI` and the till sold the store's copy of the same machine
 * anyway. "Leaves the rest on hold" is therefore once more a statement about a
 * unit's status rather than about a request that was not sent — and that is
 * the stronger of the two promises, because the unit is what the customer is
 * waiting for.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationsPage } from "../src/routes/reservations/ReservationsPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

// Same budget and the same reason as inboundQcPage: this renders a whole page
// into jsdom and queries it by accessible name, so the cost tracks how busy
// the machine is rather than how much the test asserts.
vi.setConfig({ testTimeout: 60_000 });

/** The hold this file works on: two machines, both still waiting. */
const HOLD = "rsv-tst-1";
const CODE = "RV-2026/09-000771";
const SERIALS = ["SC02RS1111111", "SC02RS2222222"] as const;

/** The store, read through the one door it has. */
function snapshot(): MockDb {
  return getDb();
}

const unitOf = (serial: string) =>
  snapshot().units.find((u) => u.serial === serial);

const holdRow = () => snapshot().reservations.find((r) => r.id === HOLD);

/**
 * Two machines put aside for one customer, on top of the seeded shop.
 *
 * Written the way the page writes one — a reservation row AND a `DIRESERVASI`
 * on each machine — because a fixture that set only the header would be
 * testing against a hold that holds nothing, which is exactly the bug this
 * page came back to the store to fix.
 */
function makeHold(note = "") {
  mutate((d) => {
    const sku = d.skus[0]!;
    for (const serial of SERIALS) {
      d.units.push({
        serial,
        skuId: sku.id,
        status: "DIRESERVASI",
        locationId: "wh-1",
        buy: 9_000_000,
        description: "Mulus, Fullset dus",
        poId: "po-1",
        grade: "A",
      });
      d.events.push({
        id: `rs-ev-${serial}`,
        serial,
        seq: 1,
        type: "DIRESERVASI",
        at: "2026-09-05T03:00:00.000Z",
        fromStatus: "TERSEDIA",
        toStatus: "DIRESERVASI",
        locationId: "wh-1",
        refCode: CODE,
        staff: "Michella",
      });
    }
    d.reservations.push({
      id: HOLD,
      code: CODE,
      customerId: d.customers[0]!.id,
      when: "2026-09-21T08:00:00.000Z",
      note,
      sourceId: "rsv-src-wa",
      items: SERIALS.map((serial, i) => ({ id: `rs-it-${i}`, serial })),
      status: "ACTIVE",
    });
  });
}

/** Where `checkOut` sent us, or null if it never navigated. */
let navigatedTo: string | null = null;

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      navigatedTo = to;
    },
  };
});

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/reservations"]}>
        <Routes>
          <Route path="/reservations" element={<ReservationsPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });

/** Its still-held serials, read from the units rather than from the header. */
const heldSerials = (): string[] =>
  SERIALS.filter((s) => unitOf(s)?.status === "DIRESERVASI");

/** Open the units dialog on that hold, and hand back its element. */
async function openDialog() {
  await userEvent.click(
    screen.getByRole("button", { name: `Open the units on ${CODE}` }),
  );
  await settle();
  return screen.getByRole("dialog");
}

beforeEach(() => {
  navigatedTo = null;
  // The store is a module singleton, so this file removes exactly what it
  // adds — otherwise the second case inherits the first case's released
  // machines and "still on hold" passes for the wrong reason.
  mutate((d) => {
    const mine = new Set<string>(SERIALS);
    d.units = d.units.filter((u) => !mine.has(u.serial));
    d.events = d.events.filter((e) => !mine.has(e.serial));
    d.reservations = d.reservations.filter((r) => r.id !== HOLD);
  });
  makeHold();
});

describe("the row", () => {
  it("does not expand — the units are behind the action button", async () => {
    renderPage();
    await settle();

    // The old page put a caret on every row and rendered a second table
    // underneath it. Nothing on the row is expandable now, so antd renders no
    // expand control at all.
    expect(
      screen.queryByRole("button", { name: /Expand row|Collapse row/ }),
    ).toBeNull();
  });

  it("says what the hold's status IS, not 'Unknown'", async () => {
    // For three days this tag read "Tidak dikenal" — the page handed the
    // schema's spelling of the status to a map that only knew the store's.
    // Asserted here as well as in enumLabels.test.ts because this is the
    // screen somebody actually looks at.
    renderPage();
    await settle();

    expect(screen.getAllByText("On hold").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unknown")).toBeNull();
  });

  it("still lists the products and serials on the hold", async () => {
    renderPage();
    await settle();

    // What the row promised before the revision and still promises: read
    // across and the third product lines up with the third serial.
    for (const serial of heldSerials()) {
      expect(screen.getAllByText(serial).length).toBeGreaterThan(0);
    }
  });
});

describe("the units dialog", () => {
  it("lists every machine on the hold", async () => {
    renderPage();
    await settle();
    const dialog = await openDialog();

    for (const serial of heldSerials()) {
      expect(within(dialog).getAllByText(serial).length).toBeGreaterThan(0);
    }
  });

  it("takes the whole hold to the till with Buy all", async () => {
    renderPage();
    await settle();
    const held = heldSerials();
    const dialog = await openDialog();

    await userEvent.click(
      within(dialog).getByRole("button", { name: /Buy all/ }),
    );
    await settle();

    expect(navigatedTo).toContain(`reservation=${HOLD}`);
    for (const serial of held) expect(navigatedTo).toContain(serial);
    // Buy all never has a rest, so nothing is let go on the way: both machines
    // are still held, and the till is what will mark them sold.
    for (const serial of held) {
      expect(unitOf(serial)?.status, serial).toBe("DIRESERVASI");
    }
  });

  it("checks out only what was ticked, and leaves the rest on hold", async () => {
    renderPage();
    await settle();
    const [first, second] = heldSerials();
    const dialog = await openDialog();

    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: `Select ${first}` }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Check out 1/ }),
    );
    await settle();

    expect(navigatedTo).toContain(first!);
    expect(navigatedTo).not.toContain(second!);
    // Untouched: the switch was left alone, so the second machine is still
    // being held for this customer and nobody else can be sold it.
    expect(unitOf(second!)?.status).toBe("DIRESERVASI");
  });

  it("releases the rest when the switch is on", async () => {
    // The switch is the whole consent for this: there is no second confirm
    // between flipping it and the machine going back on the shelf, so what
    // it does has to be exactly what it says.
    renderPage();
    await settle();
    const [first, second] = heldSerials();
    const dialog = await openDialog();

    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: `Select ${first}` }),
    );
    await userEvent.click(
      within(dialog).getByRole("switch", {
        name: "Cancel the hold on the units not being taken",
      }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Check out 1/ }),
    );
    await settle();

    expect(navigatedTo).toContain(first!);
    // Exactly the rest, and nothing else: the second machine is sellable
    // again, and the one on its way to the till is still held until it sells.
    expect(unitOf(second!)?.status).toBe("TERSEDIA");
    expect(unitOf(first!)?.status).toBe("DIRESERVASI");
  });

  it("writes the release before it leaves the page", async () => {
    // Navigation is the last thing that happens. If it were not, a release
    // that failed would land on a page that has already gone, with the
    // customer's other machines silently still held.
    renderPage();
    await settle();
    const [first, second] = heldSerials();
    const dialog = await openDialog();

    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: `Select ${first}` }),
    );
    await userEvent.click(
      within(dialog).getByRole("switch", {
        name: "Cancel the hold on the units not being taken",
      }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Check out 1/ }),
    );
    await settle();

    expect(navigatedTo).toContain(first!);
    // The ledger says so too, and says which hold let it go — the timeline is
    // what somebody reads a week later asking why this machine came back.
    const released = snapshot().events.filter(
      (e) => e.serial === second && e.type === "RESERVASI_BATAL",
    );
    expect(released).toHaveLength(1);
    expect(released[0]?.refCode).toBe(CODE);
  });

  it("offers no switch until there is a rest for it to govern", async () => {
    renderPage();
    await settle();
    const held = heldSerials();
    const dialog = await openDialog();

    // Nothing ticked: there is no "taking some" to qualify.
    expect(within(dialog).queryByRole("switch")).toBeNull();

    for (const serial of held) {
      await userEvent.click(
        within(dialog).getByRole("checkbox", { name: `Select ${serial}` }),
      );
    }
    await settle();

    // Everything ticked: the switch would govern an empty set.
    expect(within(dialog).queryByRole("switch")).toBeNull();
  });

  it("shows the hold's own note, not one per machine", async () => {
    const note = "Collecting Saturday, wants the charger checked";
    mutate((d) => {
      const r = d.reservations.find((x) => x.id === HOLD);
      if (r) r.note = note;
    });
    renderPage();
    await settle();
    const dialog = await openDialog();

    // Once, above the table — not repeated against each machine.
    expect(within(dialog).getAllByText(note)).toHaveLength(1);
  });
});

describe("cancelling a whole hold", () => {
  /**
   * The reason this page belongs with the units: a hold that does not move
   * the machine is a hold the till will sell out from under the customer.
   */
  it("puts every machine back on the shelf and closes the hold", async () => {
    renderPage();
    await settle();
    const held = heldSerials();
    const dialog = await openDialog();

    await userEvent.click(
      within(dialog).getByRole("button", { name: /Cancel the hold/ }),
    );
    await settle();
    // The confirm is the consent — releasing every machine on a hold is the
    // one action here nobody should be able to take by mis-clicking.
    await userEvent.click(screen.getByRole("button", { name: /^Release$/ }));
    await settle();

    for (const serial of held) {
      expect(unitOf(serial)?.status, serial).toBe("TERSEDIA");
    }
    // The header is a PROJECTION of its machines, written in the same mutation
    // — never a column somebody remembered to set.
    expect(holdRow()?.status).toBe("CANCELLED");
  });
});
