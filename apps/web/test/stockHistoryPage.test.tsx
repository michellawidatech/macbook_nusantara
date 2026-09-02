/**
 * S/N Tracking, driven the way somebody looks a machine up.
 *
 * The page had no test at all while it read the mock. It has one now because
 * it fetches: what it renders is a READING of a ledger it no longer owns, and
 * the two things worth pinning are that a serial nobody has is answered rather
 * than reported as a failure, and that the timeline's context comes from what
 * the server joined rather than from a guess.
 *
 * The mis-narration case is the reason this file exists. Two customers held
 * the same machine at different times; the old page searched the mock's
 * reservations for a row mentioning the serial and took the first match, so
 * both events named whoever was first. Here each event carries its own hold.
 */
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockHistoryPage } from "../src/routes/stock/StockHistoryPage.js";
import { ApiRequestError } from "../src/lib/api.js";
import type { UnitTimeline } from "../src/lib/unitsApi.js";

vi.setConfig({ testTimeout: 60_000 });

const SERIAL = "TLA0000001";

let timeline: UnitTimeline | Error;

const baseUnit: UnitTimeline["unit"] = {
  serial: SERIAL,
  status: "TERSEDIA",
  locationName: "Gudang Utama",
  grade: "A",
  buy: "12000000",
  landed: "12400000",
  intakeAt: "2026-08-20T03:00:00.000Z",
  archivedAt: null,
  skuId: "sku_tl",
  skuCode: "AIR-M2-8-256",
  productName: "MacBook Air M2 256GB",
  variantLabel: "8/256",
  price: "15500000",
  modelName: "MacBook Air M2",
  categoryName: "MacBook",
  purchaseOrderCode: "PI-2026/08-000004",
  description: null,
  rackName: null,
};

const ev = (
  seq: number,
  type: string,
  context: UnitTimeline["events"][number]["context"] = null,
): UnitTimeline["events"][number] => ({
  id: `e${seq}`,
  seq,
  type,
  at: "2026-08-20T03:00:00.000Z",
  fromStatus: null,
  toStatus: "TERSEDIA",
  locationName: "Gudang Utama",
  staffName: "Kasir Timeline",
  code: null,
  note: null,
  refCode: null,
  context,
});

vi.mock("../src/lib/unitsApi.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/unitsApi.js")>(
      "../src/lib/unitsApi.js",
    );
  return {
    ...actual,
    getUnitTimeline: () =>
      timeline instanceof Error
        ? Promise.reject(timeline)
        : Promise.resolve(timeline),
    searchUnits: () =>
      Promise.resolve({
        units: [
          { serial: SERIAL, productName: "MacBook Air M2 256GB", variantLabel: "8/256" },
        ],
      }),
  };
});

function renderPage(serial = SERIAL) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntdApp>
        <MemoryRouter initialEntries={[`/stock/history?serial=${serial}`]}>
          <Routes>
            <Route path="/stock/history" element={<StockHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </AntdApp>
    </QueryClientProvider>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });

beforeEach(() => {
  timeline = { unit: baseUnit, events: [ev(1, "DITERIMA")] };
});

describe("the unit card", () => {
  it("shows the machine and the variant's asking price", async () => {
    renderPage();
    await settle();

    // getAllBy: the serial is also in the picker above the card.
    expect(
      screen.getAllByText(/TLA0000001 — MacBook Air M2 256GB/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Gudang Utama")).toBeInTheDocument();
    expect(screen.getByText("PI-2026/08-000004")).toBeInTheDocument();
  });

  it("says '—' for the two facts the schema does not record yet", async () => {
    // `Unit` has no description column and there is no Rack model. The rows
    // stay, because "we do not record that" is a different answer from the
    // question not being asked.
    renderPage();
    await settle();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});

describe("a serial nobody has", () => {
  it("is answered on the page, not reported as a failure", async () => {
    timeline = new ApiRequestError(404, {
      code: "TIDAK_DITEMUKAN",
      message: "Serial tidak ditemukan: NOSUCH1.",
    });
    renderPage("NOSUCH1");
    await settle();

    // The serial stays on screen and the two things worth doing are offered.
    expect(screen.getAllByText("NOSUCH1").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /Check intake/ }),
    ).toBeInTheDocument();
  });

  it("shows a real failure as a warning instead, so it cannot read as a bad serial", async () => {
    timeline = new ApiRequestError(500, {
      code: "KESALAHAN_SERVER",
      message: "Terjadi kesalahan di server.",
    });
    renderPage();
    await settle();

    expect(screen.getByText("Terjadi kesalahan di server.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check intake/ })).toBeNull();
  });
});

describe("the timeline's context", () => {
  it("names the customer and channel a hold came in on", async () => {
    timeline = {
      unit: baseUnit,
      events: [
        ev(2, "DIRESERVASI", {
          kind: "HOLD",
          reservationCode: "RV-2026/08-000009",
          customerName: "Budi Santoso",
          channelName: "WhatsApp",
        }),
        ev(1, "DITERIMA"),
      ],
    };
    renderPage();
    await settle();

    expect(
      screen.getByText(/Held for Budi Santoso — came in from WhatsApp/),
    ).toBeInTheDocument();
  });

  /** The bug the server-side join exists to fix, seen from the screen. */
  it("tells two customers' holds apart on one machine", async () => {
    timeline = {
      unit: baseUnit,
      events: [
        ev(4, "DIRESERVASI", {
          kind: "HOLD",
          reservationCode: "RV-2026/08-000010",
          customerName: "Siti Rahayu",
          channelName: "Instagram",
        }),
        ev(3, "RESERVASI_BATAL", {
          kind: "HOLD",
          reservationCode: "RV-2026/08-000009",
          customerName: "Budi Santoso",
          channelName: "WhatsApp",
        }),
        ev(2, "DIRESERVASI", {
          kind: "HOLD",
          reservationCode: "RV-2026/08-000009",
          customerName: "Budi Santoso",
          channelName: "WhatsApp",
        }),
        ev(1, "DITERIMA"),
      ],
    };
    renderPage();
    await settle();

    // Both names appear. The old page rendered whichever hold matched the
    // serial first, so the second customer never showed at all.
    expect(screen.getAllByText(/Budi Santoso/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Siti Rahayu/).length).toBeGreaterThan(0);
  });

  it("adds no line to an event that carries no context", async () => {
    timeline = { unit: baseUnit, events: [ev(1, "DITERIMA")] };
    renderPage();
    await settle();
    expect(screen.queryByText(/Waiting for QC/)).toBeNull();
  });
});
