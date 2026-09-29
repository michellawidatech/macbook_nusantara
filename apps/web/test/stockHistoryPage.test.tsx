/**
 * S/N Tracking, driven the way somebody looks a unit up.
 *
 * The page reads the store again (2026-09-07). It had been migrated to
 * `GET /api/katalog/unit` ahead of every screen that WRITES a unit, and those
 * all still write the store — so a unit accepted at Inbound & QC never
 * appeared here at all. The first test below is that bug, and it is the one
 * worth keeping longest: a tracker that cannot see what the shop just did is
 * not tracking anything.
 *
 * The mis-narration case is the other reason this file exists. Two customers
 * held the same unit at different times; the page once searched the store's
 * reservations for a row mentioning the serial and took the first match, so
 * both events named whoever was first. Each event carries its own document
 * code now, and the context is resolved through that.
 *
 * Since 2026-09-19 the page opens on a LIST of every serial and the history is
 * one click, one Enter or one scan away. The list stays mounted behind the
 * history, hidden, so history assertions look only at what is visible.
 */
import { App as AntdApp } from "antd";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockHistoryPage } from "../src/routes/stock/StockHistoryPage.js";
import { addQcPhoto, getDb, mutate } from "../src/mock/store.js";
import { deliverScan } from "../src/lib/scanner.js";
import { fmtRp } from "../src/lib/format.js";
import { latestEvents } from "../src/lib/serialTracker.js";
import type { MockDb, Unit } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 60_000 });

/** The store, read through the one door it has. */
function snapshot(): MockDb {
  return getDb();
}

const SERIAL = "SC02TL1234567";
const OTHER = "SC02TL7654321";
const SEARCH = "Search or scan a serial, product or warehouse";

/** `?serial=` for the history, null for the list. */
function renderPage(serial: string | null = SERIAL) {
  return render(
    <AntdApp>
      <MemoryRouter
        initialEntries={[
          serial === null
            ? "/stock/history"
            : `/stock/history?serial=${serial}`,
        ]}
      >
        <Routes>
          <Route path="/stock/history" element={<StockHistoryPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

/**
 * Text on screen, leaving out the list hidden behind an open history — which
 * is mounted, so a plain `getAllByText` would count its warehouse names too.
 */
const visible = (text: string | RegExp) =>
  screen.queryAllByText(text, { ignore: "script, style, [hidden] *" });

/** This file's own units, and nothing of anybody else's. */
beforeEach(() => {
  mutate((d) => {
    const mine = new Set([SERIAL, OTHER]);
    d.units = d.units.filter((u) => !mine.has(u.serial));
    d.events = d.events.filter((e) => !mine.has(e.serial));
    d.unitNotes = d.unitNotes.filter((n) => !mine.has(n.serial));
    d.reservations = d.reservations.filter((r) => !r.id.startsWith("rsv-tl"));
  });
});

/** A unit on the shelf, with the arrival and QC pass behind it. */
function addUnit(serial = SERIAL, extra: Partial<Unit> = {}) {
  const db = snapshot();
  const sku = db.skus.find((s) => s.id === "m-air-m2-v1")!;
  const po = db.pos.find((p) => p.id === "po-1")!;
  mutate((d) => {
    d.units.push({
      serial,
      skuId: sku.id,
      status: "TERSEDIA",
      locationId: po.locationId,
      rackId: `${po.locationId}-rack-2`,
      buy: 9_400_000,
      description: "Mulus, Fullset dus",
      poId: po.id,
      grade: "A",
      batteryHealth: 94,
      ...extra,
    });
    d.events.push(
      {
        id: `tl-${serial}-1`,
        serial,
        seq: 1,
        type: "DITERIMA",
        at: "2026-09-01T03:00:00.000Z",
        fromStatus: "-",
        toStatus: "QC",
        locationId: po.locationId,
        refCode: po.code,
        staff: "Michella",
      },
      {
        id: `tl-${serial}-2`,
        serial,
        seq: 2,
        type: "QC_SELESAI",
        at: "2026-09-02T03:00:00.000Z",
        fromStatus: "QC",
        toStatus: "TERSEDIA",
        locationId: po.locationId,
        note: "Mulus, Fullset dus",
        staff: "Michella",
      },
    );
  });
  return { sku, po };
}

/**
 * Force the desktop layout for one test — `test/setup.ts` stubs `matchMedia`
 * to answer "no", which puts every test on the phone layout (cards, no column
 * headers) unless it says otherwise. The stub is reinstalled before each test.
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

describe("a unit the shop has just accepted", () => {
  /**
   * The owner's report, 2026-09-07: *"when I accept a product into the
   * inventory it did not load immediately in the serial tracker"*. It could
   * not: QC wrote to the store and this page asked the API.
   */
  it("appears here as soon as it exists, with no reload", async () => {
    renderPage();
    await settle();
    // Nothing yet — this is the state the bug left the page in permanently.
    expect(visible(SERIAL).length).toBeGreaterThan(0);
    expect(screen.queryByText("Mulus, Fullset dus")).toBeNull();

    act(() => {
      addUnit();
    });
    await settle();

    // The description is on the card AND on the QC row of the timeline, and
    // the warehouse is on the card and on the timeline.
    expect(visible("Mulus, Fullset dus").length).toBeGreaterThan(0);
    expect(visible("Toko Kelapa Gading").length).toBeGreaterThan(0);
  });
});

describe("the unit card", () => {
  it("shows the unit, its shelf and its own asking price", async () => {
    // Per serial since 2026-09-08: the card used to print the variant's
    // `Sku.price` whatever the unit had been priced at.
    const { sku, po } = addUnit(SERIAL, { price: 9_950_000 });
    renderPage();
    await settle();

    expect(visible(new RegExp(`${SERIAL} — ${sku.name}`)).length).toBe(1);
    expect(visible("Toko Kelapa Gading").length).toBeGreaterThan(0);
    // The rack, which the API-backed page could only ever render as "—".
    expect(visible("Rack 2")).toHaveLength(1);
    // The invoice is on the card and again on the arrival row.
    expect(visible(po.code).length).toBeGreaterThan(0);

    expect(visible(fmtRp(9_950_000))).toHaveLength(1);
    expect(visible(fmtRp(sku.price))).toHaveLength(0);
    expect(
      screen.queryByText("Not priced yet — the variant's asking price"),
    ).toBeNull();
    // The buy price stays what the unit cost.
    expect(visible(fmtRp(9_400_000))).toHaveLength(1);
  });

  it("quotes the variant's price for a unit nobody has priced, and says so", async () => {
    const { sku } = addUnit();
    renderPage();
    await settle();

    expect(visible(fmtRp(sku.price))).toHaveLength(1);
    expect(
      screen.getByText("Not priced yet — the variant's asking price"),
    ).toBeInTheDocument();
  });
});

describe("a serial nobody has", () => {
  it("is answered on the page, not reported as a failure", async () => {
    renderPage("SC02NOSUCH11");
    await settle();

    // The serial stays on screen and the two things worth doing are offered.
    expect(visible("SC02NOSUCH11").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Check intake/ }),
    ).toBeInTheDocument();
  });
});

describe("the timeline's context", () => {
  function hold(
    id: string,
    code: string,
    customerId: string,
    sourceId: string,
  ) {
    mutate((d) => {
      d.reservations.push({
        id,
        code,
        customerId,
        when: "2026-09-05T08:00:00.000Z",
        note: "",
        sourceId,
        items: [{ id: `${id}-i1`, serial: SERIAL }],
        status: "ACTIVE",
      });
    });
  }

  function holdEvent(seq: number, type: string, code: string) {
    mutate((d) => {
      d.events.push({
        id: `tl-h${seq}`,
        serial: SERIAL,
        seq,
        type,
        at: `2026-09-0${seq}T03:00:00.000Z`,
        fromStatus: "TERSEDIA",
        toStatus: type === "DIRESERVASI" ? "DIRESERVASI" : "TERSEDIA",
        locationId: "wh-1",
        refCode: code,
        staff: "Michella",
      });
    });
  }

  it("names the customer and the channel a hold came in on", async () => {
    addUnit();
    hold("rsv-tl-1", "RV-2026/09-000901", "c-3", "rsv-src-wa");
    holdEvent(3, "DIRESERVASI", "RV-2026/09-000901");
    renderPage();
    await settle();

    expect(
      screen.getByText(/Held for Budi Santoso — came in from WhatsApp/),
    ).toBeInTheDocument();
  });

  /** The bug the per-event document code exists to fix, seen from the screen. */
  it("tells two customers' holds apart on one unit", async () => {
    addUnit();
    hold("rsv-tl-1", "RV-2026/09-000901", "c-3", "rsv-src-wa");
    hold("rsv-tl-2", "RV-2026/09-000902", "c-4", "rsv-src-ig");
    holdEvent(3, "DIRESERVASI", "RV-2026/09-000901");
    holdEvent(4, "RESERVASI_BATAL", "RV-2026/09-000901");
    holdEvent(5, "DIRESERVASI", "RV-2026/09-000902");
    renderPage();
    await settle();

    // Both names appear. Taking the first reservation that mentioned the
    // serial named whoever was first on every one of the three rows.
    expect(visible(/Budi Santoso/).length).toBeGreaterThan(0);
    expect(visible(/Rina Kartika/).length).toBeGreaterThan(0);
  });

  it("says where a unit is when the event names no document", async () => {
    addUnit();
    renderPage();
    await settle();
    // The QC pass carries no code, so its line is the location — which is what
    // the server-side reading did with an event that joined to nothing.
    const lifecycle = screen.getByText("Lifecycle").closest(".ant-card");
    expect(lifecycle).not.toBeNull();
    expect(
      within(lifecycle as HTMLElement).getAllByText("Toko Kelapa Gading")
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("the list of every serial (owner ask 2026-09-19)", () => {
  const historyButtons = () =>
    screen.getAllByRole("button", { name: /^Check history of / });

  it("opens on every serial the store holds, newest movement first", async () => {
    renderPage(null);
    await settle();

    const db = snapshot();
    expect(screen.getByText(`1–20 of ${db.units.length}`)).toBeInTheDocument();
    // No history is open, so there is nothing to go back from.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    const last = latestEvents(db.events);
    const atOf = (serial: string) => Date.parse(last.get(serial)?.at ?? "");
    const newest = Math.max(...db.units.map((u) => atOf(u.serial)));
    const first = historyButtons()[0]!
      .getAttribute("aria-label")!
      .replace("Check history of ", "");
    expect(atOf(first)).toBe(newest);
  });

  it("opens a history from its row, and the back arrow returns to the same list", async () => {
    addUnit();
    renderPage(null);
    await settle();

    // Typing narrows the list; it does not open anything by itself.
    await userEvent.type(screen.getByLabelText(SEARCH), "SC02TL");
    await settle();
    expect(historyButtons()).toHaveLength(1);

    await userEvent.click(
      screen.getByRole("button", { name: `Check history of ${SERIAL}` }),
    );
    await settle();
    expect(visible(new RegExp(`^${SERIAL} — `))).toHaveLength(1);
    expect(screen.getByText("Lifecycle")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await settle();
    // The same list, still narrowed by what was typed.
    expect(screen.queryByText("Lifecycle")).toBeNull();
    expect(screen.getByLabelText(SEARCH)).toHaveValue("SC02TL");
    expect(historyButtons()).toHaveLength(1);
  });

  it("opens a serial straight from the search box on Enter, marker or not", async () => {
    addUnit();
    renderPage(null);
    await settle();

    // The case prints the number without the `S` its barcode carries.
    await userEvent.type(
      screen.getByLabelText(SEARCH),
      `${SERIAL.slice(1)}{Enter}`,
    );
    await settle();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(visible("Mulus, Fullset dus").length).toBeGreaterThan(0);
  });

  it("only narrows the list when what was entered is not a serial", async () => {
    renderPage(null);
    await settle();

    await userEvent.type(screen.getByLabelText(SEARCH), "Gudang{Enter}");
    await settle();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByText(/^Showing \d+ of \d+$/)).toBeInTheDocument();
  });

  it("opens a scanned serial, read off the shop's own sticker", async () => {
    addUnit();
    renderPage(null);
    await settle();

    // `AS` is CV Apel Segar's origin code; the sticker is it plus the serial.
    await act(async () => {
      deliverScan(`AS${SERIAL}`);
    });
    await settle();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(visible(new RegExp(`^${SERIAL} — `))).toHaveLength(1);
  });

  it("narrows to a ticked category from the Unit column's header, on a desktop", async () => {
    useDesktopViewport();
    renderPage(null);
    await settle();

    const trigger = document.querySelector<HTMLElement>(
      ".ant-table-filter-trigger",
    );
    expect(trigger).not.toBeNull();
    await userEvent.click(trigger!);
    await settle();

    const ipad = (await screen.findByText("iPad")).closest(
      ".ant-tree-treenode",
    );
    const box = ipad?.querySelector<HTMLElement>(".ant-tree-checkbox");
    expect(box).toBeTruthy();
    await userEvent.click(box!);
    await settle();

    const db = snapshot();
    const categoryOf = (skuId: string) => {
      const sku = db.skus.find((s) => s.id === skuId);
      return db.models.find((m) => m.id === sku?.modelId)?.category;
    };
    const ipads = db.units.filter((u) => categoryOf(u.skuId) === "iPad");
    expect(ipads.length).toBeGreaterThan(0);
    expect(
      screen.getByText(`Showing ${ipads.length} of ${db.units.length}`),
    ).toBeInTheDocument();
  });
});

describe("a unit's QC photographs (owner ask 2026-09-29)", () => {
  const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

  it("are on the unit card", async () => {
    addUnit();
    mutate((d) => addQcPhoto(d, SERIAL, PHOTO));
    renderPage();
    await settle();
    expect(screen.getAllByAltText(`Photo of ${SERIAL}`).length).toBeGreaterThan(
      0,
    );
  });

  it("are on the unit's row of the list", async () => {
    addUnit();
    // Newest movement first: put this unit on the list's first page.
    mutate((d) => {
      for (const e of d.events)
        if (e.serial === SERIAL) e.at = "2099-01-01T00:00:00.000Z";
      addQcPhoto(d, SERIAL, PHOTO);
    });
    renderPage(null);
    await settle();
    expect(screen.getAllByAltText(`Photo of ${SERIAL}`)).toHaveLength(1);
  });
});
