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
import { saleOfSerial, saleSwapBlock } from "../src/lib/saleSwap.js";

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
      // A running number first (owner ask, 2026-11-09).
      "No.",
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

/**
 * A unit on service is on the shelf of the warehouse it is serviced in
 * (owner report 2026-11-09: a count of warehouses 02, 03 and 05 filed every
 * unit on service in 02 and 05 as "Belongs elsewhere").
 */
describe("a unit on service", () => {
  /** Put the third shelf unit on service, on its own rack, in an open visit. */
  function sendToService(serial: string) {
    mutate((d) => {
      // By id as well: an earlier test's visit may name a different serial.
      d.services = d.services.filter(
        (r) => r.serial !== serial && r.id !== "svc-opname-test",
      );
      const u = d.units.find((x) => x.serial === serial)!;
      u.status = "SERVIS";
      d.services.push({
        id: "svc-opname-test",
        serial,
        fromLocationId: u.locationId,
        openedAt: "2026-11-01T10:00:00.000Z",
        arrivedAt: "2026-11-01T10:00:00.000Z",
        fees: [],
        raisedBy: "ADJUSTMENT",
        staff: "Michella",
      });
    });
  }

  it("is expected in its warehouse, and counted when scanned", async () => {
    const serial = shelf[2]!;
    sendToService(serial);
    renderSession();

    expect(rowOrder()).toContain(serial);
    await scan(serial);
    expect(within(row(serial)).getByText("Found")).toBeVisible();
    expect(within(row(serial)).queryByText("Belongs elsewhere")).toBeNull();
  });

  it("leaves its service visit when it is marked lost", async () => {
    const gone = shelf[2]!;
    sendToService(gone);
    renderSession();
    await scan(shelf[0]!);
    await scan(shelf[1]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Review & finish/i }),
    );
    await userEvent.type(
      screen.getByPlaceholderText(/Required — say what happened/i),
      "Not at the bench",
    );
    await userEvent.click(screen.getByRole("button", { name: /Post count/i }));
    const confirm = await screen.findByRole("dialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: /Post count/i }),
    );

    await waitFor(() =>
      expect(getDb().units.find((u) => u.serial === gone)?.status).toBe(
        "HILANG",
      ),
    );
    const visit = getDb().services.find((r) => r.id === "svc-opname-test");
    expect(visit?.closedAt).toBeDefined();
  });
});

/**
 * A serial typed wrong, found by the count (owner ask 2026-11-19): one unit
 * read as a not-scanned row AND a not-in-system row. `lib/opnameMatch.ts` is
 * the rule; this checks the page offers the pair and that Match makes it one.
 */
describe("tabs and the typo match", () => {
  /** shelf[2] with its last character changed — what was keyed at intake. */
  const typoOf = (serial: string) =>
    serial.slice(0, -1) + (serial.endsWith("Y") ? "X" : "Y");

  it("groups the rows by tab, with the two disagreeing lists side by side", async () => {
    renderSession();
    await scan(shelf[0]!);
    await scan(away);
    await scan(STRANGER);

    await userEvent.click(screen.getByText("Found (1)"));
    expect(rowOrder()).toEqual([shelf[0]]);

    await userEvent.click(screen.getByText("To check (4)"));
    const left = screen
      .getByText("Expected here, not scanned (2)")
      .closest(".ant-card")! as HTMLElement;
    const right = screen
      .getByText("Scanned, not expected here (2)")
      .closest(".ant-card")! as HTMLElement;
    const serialsIn = (el: HTMLElement) =>
      [...el.querySelectorAll("[data-count-row]")].map((e) =>
        e.getAttribute("data-count-row"),
      );
    expect(serialsIn(left).sort()).toEqual([shelf[1], shelf[2]].sort());
    expect(serialsIn(right)).toEqual([STRANGER, away]);
    // Only a serial no unit carries can be matched: `away` is a real unit.
    // By text, not role: a role query computes every name in a two-table
    // page and takes half a minute in jsdom.
    expect(within(row(STRANGER)).getByText("Match")).toBeVisible();
    expect(within(row(away)).queryByText("Match")).toBeNull();
  });

  it("suggests the pair, and Match corrects the unit to the serial on its case", async () => {
    const real = shelf[2]!;
    const onCase = typoOf(real);
    renderSession();
    await scan(onCase);

    await userEvent.click(screen.getByText(/To check \(4\) · 1 possible typo/));
    const pair = document.querySelector<HTMLElement>(
      `[data-typo="${onCase}"]`,
    )!;
    await userEvent.click(within(pair).getByRole("button", { name: /Match/ }));
    const dialog = await screen.findByRole("dialog");
    // The scanned serial is the default answer.
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Match/ }),
    );

    await waitFor(() =>
      expect(getDb().units.some((u) => u.serial === onCase)).toBe(true),
    );
    expect(getDb().units.some((u) => u.serial === real)).toBe(false);
    // The history moved with it, and says what happened.
    expect(getDb().events.some((e) => e.serial === real)).toBe(false);
    expect(
      getDb().events.find((e) => e.serial === onCase && e.type === "DICATAT")
        ?.note,
    ).toContain(`${real} → ${onCase}`);
    // One row, found.
    await userEvent.click(screen.getByText(/^All \(/));
    expect(rowOrder()).not.toContain(real);
    expect(within(row(onCase)).getByText("Found")).toBeVisible();
  });

  it("replaces the scan instead when the system's serial is the right one", async () => {
    const real = shelf[2]!;
    const keyed = typoOf(real);
    const before = getDb().units.find((u) => u.serial === real);
    renderSession();
    await scan(keyed);

    await userEvent.click(
      within(row(keyed)).getByRole("button", { name: /Match/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText(/the one in the system/));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Match/ }),
    );

    await waitFor(() => expect(rowOrder()).not.toContain(keyed));
    expect(within(row(real)).getByText("Found")).toBeVisible();
    expect(getDb().units.find((u) => u.serial === real)).toEqual(before);
  });
});

/**
 * A sale recorded on the wrong serial (owner ask 2026-11-19): the unit the
 * receipt names is still on the shelf and reads Sold, and the one that went
 * out is never scanned. `lib/saleSwap.ts` is the rule; this checks the page
 * offers Swap on the sold scan and that it makes the count agree.
 */
describe("swapping a sale onto the unit that went out", () => {
  /** A sold unit whose sale can be corrected, filed back on the counted rack. */
  function soldOnRack(): string {
    const db = getDb();
    const sold = db.units.find(
      (u) =>
        u.status === "TERJUAL" &&
        saleSwapBlock(db, u.serial, shelf[2]!) === undefined,
    )!.serial;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === sold)!;
      u.rackId = RACK;
      // Sold from the counted warehouse, so it comes back into this count.
      for (const e of d.events) {
        if (e.serial === sold) e.locationId = d.myWarehouseId;
      }
      u.locationId = d.myWarehouseId;
    });
    return sold;
  }

  it("offers Swap only on a scanned unit the system says is sold", async () => {
    const sold = soldOnRack();
    renderSession();
    await scan(sold);
    await scan(away);
    await userEvent.click(screen.getByText(/^To check \(/));
    expect(within(row(sold)).getByText("Swap")).toBeVisible();
    expect(within(row(away)).queryByText("Swap")).toBeNull();
  });

  it("moves the sale to the missing unit and counts the scanned one as found", async () => {
    const sold = soldOnRack();
    const missing = shelf[2]!;
    const code = saleOfSerial(getDb(), sold)!.code;
    renderSession();
    await scan(shelf[0]!);
    await scan(shelf[1]!);
    await scan(sold);

    await userEvent.click(screen.getByText(/^To check \(/));
    await userEvent.click(within(row(sold)).getByText("Swap"));
    const dialog = await screen.findByRole("dialog");
    // The serial is drawn a character at a time (the typo highlight), so
    // the radio is found by its value.
    await userEvent.click(
      dialog.querySelector<HTMLInputElement>(`input[value="${missing}"]`)!,
    );
    expect(dialog.textContent).toContain(`will name ${missing}`);
    await userEvent.click(within(dialog).getByRole("button", { name: /Swap/ }));

    await waitFor(() =>
      expect(getDb().units.find((u) => u.serial === missing)?.status).toBe(
        "TERJUAL",
      ),
    );
    expect(getDb().units.find((u) => u.serial === sold)?.status).toBe(
      "TERSEDIA",
    );
    const order = getDb().orders.find((o) => o.code === code)!;
    expect(order.serials).toContain(missing);
    expect(order.serials).not.toContain(sold);

    await userEvent.click(screen.getByText(/^All \(/));
    expect(rowOrder()).not.toContain(missing);
    expect(within(row(sold)).getByText("Found")).toBeVisible();
  });
});
