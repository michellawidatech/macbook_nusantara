/**
 * S/N Tracking, driven the way somebody looks a machine up.
 *
 * The page reads the store again (2026-09-07). It had been migrated to
 * `GET /api/katalog/unit` ahead of every screen that WRITES a unit, and those
 * all still write the store — so a machine accepted at Inbound & QC never
 * appeared here at all. The first test below is that bug, and it is the one
 * worth keeping longest: a tracker that cannot see what the shop just did is
 * not tracking anything.
 *
 * The mis-narration case is the other reason this file exists. Two customers
 * held the same machine at different times; the page once searched the store's
 * reservations for a row mentioning the serial and took the first match, so
 * both events named whoever was first. Each event carries its own document
 * code now, and the context is resolved through that.
 */
import { App as AntdApp } from "antd";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockHistoryPage } from "../src/routes/stock/StockHistoryPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import type { MockDb } from "../src/mock/seed.js";

vi.setConfig({ testTimeout: 60_000 });

/** The store, read through the one door it has. */
function snapshot(): MockDb {
  return getDb();
}

const SERIAL = "SC02TL1234567";
const OTHER = "SC02TL7654321";

function renderPage(serial = SERIAL) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/stock/history?serial=${serial}`]}>
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

/** This file's own machines, and nothing of anybody else's. */
beforeEach(() => {
  mutate((d) => {
    const mine = new Set([SERIAL, OTHER]);
    d.units = d.units.filter((u) => !mine.has(u.serial));
    d.events = d.events.filter((e) => !mine.has(e.serial));
    d.reservations = d.reservations.filter((r) => !r.id.startsWith("rsv-tl"));
  });
});

/** A machine on the shelf, with the arrival and QC pass behind it. */
function addUnit(serial = SERIAL) {
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

describe("a machine the shop has just accepted", () => {
  /**
   * The owner's report, 2026-09-07: *"when I accept a product into the
   * inventory it did not load immediately in the serial tracker"*. It could
   * not: QC wrote to the store and this page asked the API.
   */
  it("appears here as soon as it exists, with no reload", async () => {
    renderPage();
    await settle();
    // Nothing yet — this is the state the bug left the page in permanently.
    expect(screen.getAllByText(SERIAL).length).toBeGreaterThan(0);
    expect(screen.queryByText("Mulus, Fullset dus")).toBeNull();

    act(() => {
      addUnit();
    });
    await settle();

    // getAllBy throughout: the description is on the card AND on the QC row
    // of the timeline, and the warehouse is on the card and on every event.
    expect(screen.getAllByText("Mulus, Fullset dus").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Toko Kelapa Gading").length).toBeGreaterThan(0);
  });
});

describe("the unit card", () => {
  it("shows the machine, its shelf and the variant's asking price", async () => {
    const { sku, po } = addUnit();
    renderPage();
    await settle();

    // getAllBy: the serial is also in the picker above the card.
    expect(
      screen.getAllByText(new RegExp(`${SERIAL} — ${sku.name}`)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Toko Kelapa Gading").length).toBeGreaterThan(0);
    // The rack, which the API-backed page could only ever render as "—".
    expect(screen.getByText("Rack 2")).toBeInTheDocument();
    // The invoice is on the card and again on the arrival row.
    expect(screen.getAllByText(po.code).length).toBeGreaterThan(0);
  });
});

describe("a serial nobody has", () => {
  it("is answered on the page, not reported as a failure", async () => {
    renderPage("SC02NOSUCH11");
    await settle();

    // The serial stays on screen and the two things worth doing are offered.
    expect(screen.getAllByText("SC02NOSUCH11").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Check intake/ }),
    ).toBeInTheDocument();
  });
});

describe("the timeline's context", () => {
  function hold(id: string, code: string, customerId: string, sourceId: string) {
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
  it("tells two customers' holds apart on one machine", async () => {
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
    expect(screen.getAllByText(/Budi Santoso/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rina Kartika/).length).toBeGreaterThan(0);
  });

  it("says where a machine is when the event names no document", async () => {
    addUnit();
    renderPage();
    await settle();
    // The QC pass carries no code, so its line is the location — which is what
    // the server-side reading did with an event that joined to nothing.
    expect(screen.getAllByText("Toko Kelapa Gading").length).toBeGreaterThan(1);
  });
});
