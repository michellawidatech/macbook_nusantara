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
 * ## Why this no longer touches the mock store
 *
 * The page reads `/api/reservations` now. The seam moved with it: the API
 * client module is stubbed, so these tests still assert what the OPERATOR
 * does — which checkbox, which switch, which button — and now also assert what
 * the page ASKS THE SERVER TO DO, which is the thing that was previously only
 * observable as a mutation of a shared object. "Leaves the rest on hold" used
 * to mean "that unit is still DIRESERVASI in the store"; it now means "the page
 * did not ask for it to be released", which is the same promise stated where
 * the page is actually responsible for it.
 */
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationsPage } from "../src/routes/reservations/ReservationsPage.js";
import type { Hold } from "../src/lib/reservationsApi.js";

// Same budget and the same reason as inboundQcPage: this renders a whole page
// into jsdom and queries it by accessible name, so the cost tracks how busy
// the machine is rather than how much the test asserts.
vi.setConfig({ testTimeout: 60_000 });

/** The hold this file works on: two machines, both still waiting. */
const HOLD = "rsv-2";
const CODE = "RV-2026/08-000002";

let hold: Hold;

function makeHold(note = ""): Hold {
  return {
    id: HOLD,
    code: CODE,
    customerId: "cust-1",
    customerName: "Budi Santoso",
    phone: "+628111000321",
    scheduledFor: "2026-08-21T08:00:00.000Z",
    note,
    status: "TERJADWAL",
    source: "STAF",
    reservationSourceId: "rsv-src-wa",
    channelName: "WhatsApp",
    createdAt: "2026-08-20T03:00:00.000Z",
    items: [
      {
        id: "it-1",
        serial: "NUS0001111",
        productName: "MacBook Air M2 256GB",
        variantLabel: "8/256",
        grade: "A",
        unitStatus: "DIRESERVASI",
        state: "HELD",
      },
      {
        id: "it-2",
        serial: "NUS0002222",
        productName: "MacBook Pro 14 M3",
        variantLabel: "16/512",
        grade: "B",
        unitStatus: "DIRESERVASI",
        state: "HELD",
      },
    ],
  };
}

// The spies OWN what they return, so a case can hand back a promise that has
// not settled yet and assert on what the page does while it is in flight.
type Spy = (...a: unknown[]) => Promise<{ reservation: Hold }>;
const createHold = vi.fn<Spy>(() => Promise.resolve({ reservation: hold }));
const releaseHold = vi.fn<Spy>(() => Promise.resolve({ reservation: hold }));
const cancelHold = vi.fn<Spy>(() => Promise.resolve({ reservation: hold }));

vi.mock("../src/lib/reservationsApi.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/reservationsApi.js")
  >("../src/lib/reservationsApi.js");
  return {
    ...actual,
    listHolds: () =>
      Promise.resolve({
        rows: [hold],
        page: 1,
        perPage: 200,
        total: 1,
        totalUnfiltered: 1,
      }),
    listHoldSources: () =>
      Promise.resolve({ sources: [{ id: "rsv-src-wa", name: "WhatsApp" }] }),
    createHold: (...a: unknown[]) => createHold(...a),
    releaseHold: (...a: unknown[]) => releaseHold(...a),
    cancelHold: (...a: unknown[]) => cancelHold(...a),
  };
});

/** The sellable-units picker asks the inventory endpoint directly. */
vi.mock("../src/lib/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/api.js")>(
      "../src/lib/api.js",
    );
  return { ...actual, api: () => Promise.resolve({ rows: [] }) };
});

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
  // retry:false — a test must see a failure, not a backoff.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntdApp>
        <MemoryRouter initialEntries={["/reservations"]}>
          <Routes>
            <Route path="/reservations" element={<ReservationsPage />} />
          </Routes>
        </MemoryRouter>
      </AntdApp>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });

/** Its still-held serials, read from the fixture rather than hard-coded. */
const heldSerials = (): string[] =>
  hold.items.filter((i) => i.state === "HELD").map((i) => i.serial!);

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
  hold = makeHold();
  createHold.mockClear();
  releaseHold.mockClear();
  cancelHold.mockClear();
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
    // Buy all never has a rest, so nothing is let go on the way.
    expect(releaseHold).not.toHaveBeenCalled();
    expect(cancelHold).not.toHaveBeenCalled();
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
    // somebody's — and the page never asked the server to let it go.
    expect(releaseHold).not.toHaveBeenCalled();
    expect(cancelHold).not.toHaveBeenCalled();
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
    // Exactly the rest, and nothing else.
    expect(releaseHold).toHaveBeenCalledTimes(1);
    expect(releaseHold.mock.calls[0]![0]).toBe(HOLD);
    expect(releaseHold.mock.calls[0]![1]).toEqual([second]);
  });

  it("waits for the release before leaving the page", async () => {
    // The release is a network call now. Navigating first would leave a
    // refusal landing on a page that has already gone, with the customer's
    // other machines silently still held.
    let settleRelease!: () => void;
    releaseHold.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleRelease = () => resolve({ reservation: hold });
        }),
    );

    renderPage();
    await settle();
    const [first] = heldSerials();
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

    expect(navigatedTo).toBeNull();
    await act(async () => {
      settleRelease();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(navigatedTo).toContain(first!);
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
    hold = makeHold(note);
    renderPage();
    await settle();
    const dialog = await openDialog();

    // Once, above the table — not repeated against each machine.
    expect(within(dialog).getAllByText(note)).toHaveLength(1);
  });
});
