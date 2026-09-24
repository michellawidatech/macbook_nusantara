/**
 * The counting screen's one table, driven the way a counter drives it (owner
 * brief 2026-09-19: *"Show all the unit early, move upward & show status &
 * green/red"*).
 *
 * `test/opnameCount.test.ts` holds the rules; this checks the page keeps them —
 * that every expected unit is on screen before the first scan, that a scan
 * lands at the top, that Delete takes back a READ and never touches a unit,
 * and that posting still does exactly what it did before the table changed.
 *
 * `matchMedia` answers "no" in `test/setup.ts`, so `DataTable` draws its phone
 * layout here: one card per unit. That is the layout a stock take is most
 * often done in, and the row attribute the page reads is on the card too.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpnameSessionPage } from "../src/routes/opname/OpnameSessionPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";

// A whole page rendered into jsdom and driven with real events — the same
// budget the other page tests take.
vi.setConfig({ testTimeout: 60_000 });

const SESSION = "op-live";
/** The rack this count covers. Emptied, then given exactly three units. */
const RACK = "wh-1-rack-3";
/** Not a serial anything in the seed carries. */
const STRANGER = "ASZZ777666ZZ";

/** The three units on the counted rack, in serial order. */
let shelf: string[] = [];
/** A real unit in the same warehouse, on a rack this count does not cover. */
let away = "";
/**
 * The one accessory variant on the shelves — counted by number, never
 * scanned. A quantity on the stock ledger since 2026-09-19, not a unit.
 */
let accessorySku = "";

beforeEach(() => {
  mutate((d) => {
    d.opnames = d.opnames.filter((o) => o.id !== SESSION);
    d.units = d.units.filter((u) => u.serial !== STRANGER);
    d.events = d.events.filter((e) => e.serial !== STRANGER);
    for (const u of d.units) {
      if (u.rackId === RACK) u.rackId = "wh-1-rack-1";
    }
    const tracked = d.units
      .filter(
        (u) =>
          u.status === "TERSEDIA" &&
          u.locationId === d.myWarehouseId &&
          skuTracksSerial(d, u.skuId),
      )
      .sort((a, b) => a.serial.localeCompare(b.serial));
    for (const u of tracked.slice(0, 3)) u.rackId = RACK;
    shelf = tracked.slice(0, 3).map((u) => u.serial);
    away = tracked[3]!.serial;
    // One piece of one accessory in this warehouse, and nothing else counted,
    // so the quantity card has exactly one line to answer.
    accessorySku = d.skus.find((s) => !skuTracksSerial(d, s.id))!.id;
    d.stockMoves = [
      {
        id: "sm-test-1",
        skuId: accessorySku,
        locationId: d.myWarehouseId,
        qty: 1,
        cost: 100_000,
        type: "MASUK",
        at: "2026-09-01T10:00:00.000Z",
        staff: "Michella",
      },
    ];
    d.opnames.unshift({
      id: SESSION,
      code: "SO-2026/09-000098",
      locationIds: [d.myWarehouseId],
      rackIds: [RACK],
      categories: [],
      conditions: [],
      date: "2026-09-19",
      at: new Date().toISOString(),
      counted: [],
      counts: {},
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

/** The table's rows, top to bottom, as the serials they carry. */
function rowOrder(): string[] {
  return [...document.querySelectorAll("[data-count-row]")].map((el) =>
    el.getAttribute("data-count-row")!,
  );
}

function row(serial: string): HTMLElement {
  const el = [
    ...document.querySelectorAll<HTMLElement>("[data-count-row]"),
  ].find((e) => e.getAttribute("data-count-row") === serial);
  if (!el) throw new Error(`no row for ${serial}`);
  return el;
}

/** One serial through the scan box, the way a counter types one. */
async function scan(serial: string) {
  const box = screen.getByPlaceholderText(/Scan or type a serial/i);
  await userEvent.click(box);
  await userEvent.paste(serial);
  await userEvent.keyboard("{Enter}");
}

describe("the counting table", () => {
  it("lists every unit the count expects before anything is scanned", () => {
    renderSession();

    expect([...rowOrder()].sort()).toEqual([...shelf].sort());
    for (const serial of shelf) {
      expect(within(row(serial)).getByText("Not scanned yet")).toBeVisible();
    }
    // Counted by number, so it is the quantity card's, not a row here — and
    // on a count named by rack it is not in scope at all: it sits on none.
    expect(screen.queryByText("Counted by quantity")).toBeNull();
  });

  it("turns a scanned unit green and moves it to the top", async () => {
    renderSession();
    const last = shelf[2]!;
    await scan(last);

    expect(rowOrder()[0]).toBe(last);
    expect(within(row(last)).getByText("Found")).toBeVisible();
    expect(within(row(shelf[0]!)).getByText("Not scanned yet")).toBeVisible();
  });

  it("keeps the most recent scan on top", async () => {
    renderSession();
    await scan(shelf[0]!);
    await scan(shelf[1]!);

    expect(rowOrder()).toEqual([shelf[1], shelf[0], shelf[2]]);
  });

  it("moves a serial scanned twice back to the top, and counts it once", async () => {
    renderSession();
    await scan(shelf[0]!);
    await scan(shelf[1]!);
    await scan(shelf[0]!);

    expect(rowOrder()).toEqual([shelf[0], shelf[1], shelf[2]]);
    expect(screen.getByText("2 scanned")).toBeVisible();
  });

  it("tells a unit filed elsewhere from one the system has never seen", async () => {
    renderSession();
    await scan(away);
    await scan(STRANGER);

    expect(rowOrder().slice(0, 2)).toEqual([STRANGER, away]);
    expect(within(row(STRANGER)).getByText("Not in system")).toBeVisible();
    expect(within(row(away)).getByText("Belongs elsewhere")).toBeVisible();
    // Only the stranger may be taken into stock. The other already exists
    // and needs MOVING — a second record would duplicate a real laptop.
    expect(
      within(row(STRANGER)).getByRole("button", { name: /Add to inventory/i }),
    ).toBeVisible();
    expect(
      within(row(away)).queryByRole("button", { name: /Add to inventory/i }),
    ).toBeNull();
  });

  it("takes a scan back with Delete, and leaves the unit alone", async () => {
    renderSession();
    const serial = shelf[0]!;
    await scan(serial);
    await scan(STRANGER);
    const unitBefore = getDb().units.find((u) => u.serial === serial);
    const eventsBefore = getDb().events.filter((e) => e.serial === serial);

    await userEvent.click(
      screen.getByRole("button", { name: `Delete the scan of ${serial}` }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: `Delete the scan of ${STRANGER}` }),
    );

    // An expected unit goes back below the line; a serial nobody expected
    // leaves the table altogether.
    expect(within(row(serial)).getByText("Not scanned yet")).toBeVisible();
    expect(rowOrder()).not.toContain(STRANGER);
    // The READ was deleted, not the unit: nothing in the store moved.
    expect(getDb().units.find((u) => u.serial === serial)).toEqual(unitBefore);
    expect(getDb().events.filter((e) => e.serial === serial)).toEqual(
      eventsBefore,
    );
    // …and the box has the keyboard back for the next serial.
    expect(screen.getByPlaceholderText(/Scan or type a serial/i)).toHaveFocus();
  });

  it("reopens a saved draft with the serials nobody expected still on it", () => {
    // A draft is stored as `counted` + `unknown`. Reading back only the first
    // lost the stranger on every reload.
    mutate((d) => {
      const o = d.opnames.find((x) => x.id === SESSION)!;
      o.counted = [shelf[0]!];
      o.unknown = [STRANGER, away];
    });
    renderSession();

    expect(rowOrder().slice(0, 3)).toEqual([away, STRANGER, shelf[0]]);
    expect(within(row(STRANGER)).getByText("Not in system")).toBeVisible();
    expect(within(row(shelf[0]!)).getByText("Found")).toBeVisible();
  });

  it("marks the scan box as this page's scan target", () => {
    // Unmarked, a scanner burst into the box was ALSO reported as a scan into
    // "another field", and the chip offered to count it a second time.
    renderSession();
    expect(
      screen
        .getByPlaceholderText(/Scan or type a serial/i)
        .closest("[data-scan-target]"),
    ).not.toBeNull();
  });

  it("keeps a scan the narrowed scope no longer covers, as belonging elsewhere", async () => {
    renderSession();
    const serial = shelf[0]!;
    await scan(serial);

    // What Apply in the scope editor writes — see `applyScope`.
    act(() => {
      mutate((d) => {
        d.opnames.find((o) => o.id === SESSION)!.rackIds = ["wh-1-rack-2"];
      });
    });

    await waitFor(() =>
      expect(within(row(serial)).getByText("Belongs elsewhere")).toBeVisible(),
    );
    expect(rowOrder()[0]).toBe(serial);
  });
});

/**
 * Force the desktop layout for one test — the helper `tillPage.test.tsx`
 * carries. `test/setup.ts` answers "no" to every media query, which is the
 * phone; answering "yes" up to `xl` puts `md` in range, which is what
 * `DataTable` reads to draw a grid instead of cards. The stub is put back
 * before the next test by `setup.ts`'s own `beforeEach`.
 */
function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1200,
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

describe("on a desktop", () => {
  it("draws the owner's six columns, in the owner's order", async () => {
    useDesktopViewport();
    renderSession();
    await scan(shelf[1]!);

    const table = row(shelf[1]!).closest("table")!;
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "Unit",
      "Serial",
      "Warehouse",
      "Status",
      "Description",
      "Action",
    ]);
    // A grid row, and still the latest scan on top.
    expect(row(shelf[1]!).tagName).toBe("TR");
    expect(rowOrder()[0]).toBe(shelf[1]);
  });
});

/** Re-scope the count to the accessories, which sit on no rack. */
function countAccessories() {
  mutate((d) => {
    const o = d.opnames.find((x) => x.id === SESSION)!;
    o.rackIds = [];
    o.categories = ["Accessory"];
  });
}

describe("counting by quantity", () => {
  it("points an accessories-only count at the quantity card, not at a wider scope", () => {
    // "Stock opname can be by serial or no serial": a count of the shelves
    // with nothing to scan is a real count, not a mistake in its scope.
    mutate((d) => {
      const o = d.opnames.find((x) => x.id === SESSION)!;
      o.rackIds = [];
      o.categories = ["Accessory"];
    });
    renderSession();

    expect(
      screen.getByText(/Nothing in this scope has a serial to scan/i),
    ).toBeVisible();
    expect(screen.queryByText(/Widen it/i)).toBeNull();
  });

  it("shows what the shelf should hold, and whether it does", async () => {
    countAccessories();
    renderSession();
    const card = screen
      .getByText("Counted by quantity")
      .closest(".ant-card") as HTMLElement;
    expect(within(card).getByText("Not counted yet")).toBeVisible();

    const qty = within(card).getByRole("spinbutton");
    await userEvent.type(qty, "1");
    await waitFor(() =>
      expect(within(card).getByText("All found")).toBeVisible(),
    );
  });

  it("asks at the review why a shelf came up short", async () => {
    countAccessories();
    renderSession();
    const qty = screen.getByRole("spinbutton");
    await userEvent.type(qty, "0");
    await userEvent.click(
      screen.getByRole("button", { name: /Review & finish/i }),
    );

    expect(
      screen.getByText(/1 product\(s\) counted differently need a note/i),
    ).toBeVisible();
    expect(screen.getByText("1 short")).toBeVisible();
    expect(screen.getByPlaceholderText("Why does it differ?")).toBeVisible();
  });
});

describe("posting a counted shelf", () => {
  it("writes the difference to the stock ledger, and mints no unit", async () => {
    countAccessories();
    const units = getDb().units.length;
    renderSession();
    await userEvent.type(screen.getByRole("spinbutton"), "3");
    await userEvent.click(
      screen.getByRole("button", { name: /Review & finish/i }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("Why does it differ?"),
      "A box behind the till",
    );
    await userEvent.click(screen.getByRole("button", { name: /Post count/i }));
    const confirm = await screen.findByRole("dialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: /Post count/i }),
    );
    await waitFor(() =>
      expect(getDb().opnames.find((o) => o.id === SESSION)?.status).toBe(
        "POSTED",
      ),
    );
    const db = getDb();
    expect(db.units.length).toBe(units);
    const found = db.stockMoves.filter((m) => m.opnameId === SESSION);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      skuId: accessorySku,
      qty: 2,
      type: "OPNAME",
      locationId: db.myWarehouseId,
    });
  });
});

describe("posting, after the table changed", () => {
  it("still marks the unit nobody scanned lost, and records the rest as counted", async () => {
    renderSession();
    const [a, b, gone] = shelf as [string, string, string];
    await scan(a);
    await scan(b);
    await userEvent.click(
      screen.getByRole("button", { name: /Review & finish/i }),
    );

    await userEvent.type(
      screen.getByPlaceholderText(/Required — say what happened/i),
      "Not on the rack",
    );
    await userEvent.click(screen.getByRole("button", { name: /Post count/i }));
    const confirm = await screen.findByRole("dialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: /Post count/i }),
    );

    await waitFor(() =>
      expect(getDb().opnames.find((o) => o.id === SESSION)?.status).toBe(
        "POSTED",
      ),
    );
    const db = getDb();
    const session = db.opnames.find((o) => o.id === SESSION)!;
    expect([...session.counted].sort()).toEqual([a, b].sort());
    expect(session.missing).toEqual([gone]);
    expect(db.units.find((u) => u.serial === gone)?.status).toBe("HILANG");
    const lost = db.events.filter((e) => e.serial === gone).at(-1);
    expect(lost).toMatchObject({ type: "OPNAME_HILANG", toStatus: "HILANG" });
    expect(lost?.note).toMatch(/Not on the rack/);
    for (const serial of [a, b]) {
      expect(db.units.find((u) => u.serial === serial)?.status).toBe(
        "TERSEDIA",
      );
      expect(db.events.filter((e) => e.serial === serial).at(-1)).toMatchObject(
        { type: "DICATAT", note: "Counted at opname" },
      );
    }
  });
});
