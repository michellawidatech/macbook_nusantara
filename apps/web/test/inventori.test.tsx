/**
 * S9 — the Inventori screen's interaction contracts (02 §8).
 *
 * The Definition of Done: "a shared URL reproduces the exact view, and empty
 * vs no-match states are distinguishable."
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/lib/i18n.js";
import { InventoriPage } from "../src/routes/InventoriPage.js";

const COLUMNS = [
  {
    id: "attr_0_0",
    key: "prosesor",
    label: "Prosesor",
    unit: null,
    categoryId: "cat_0",
  },
  {
    id: "attr_0_1",
    key: "siklus",
    label: "Siklus",
    unit: "x",
    categoryId: "cat_0",
  },
];

const FILTERS = {
  lokasi: [
    { id: "loc_toko", name: "Toko Bandung" },
    { id: "loc_gudang", name: "Gudang Pusat" },
  ],
  kategori: [{ id: "cat_0", name: "MacBook" }],
  status: [{ id: "TERSEDIA", name: "TERSEDIA", count: 40 }],
  grade: [{ id: "A", name: "A", count: 12 }],
};

function row(n: number) {
  return {
    id: `unit_${n}`,
    serial: `NUS000000${n}`,
    status: "TERSEDIA",
    grade: "A",
    skuCode: `SKU-000${n}`,
    skuName: `MacBook Air M1 256GB nomor ${n}`,
    kategori: "MacBook",
    lokasi: "Gudang Pusat",
    landed: "9000000",
    intakeAt: "2026-08-15T00:00:00.000Z",
    attrs: { attr_0_0: "M1", attr_0_1: "120" },
  };
}

/** Records every inventori URL the page asks for. */
function stub(
  overrides: {
    rows?: unknown[];
    total?: number;
    totalUnfiltered?: number;
  } = {},
) {
  const seen: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = url.startsWith("/api/katalog/inventori/filters")
      ? FILTERS
      : (seen.push(url),
        {
          rows: overrides.rows ?? [row(1), row(2)],
          columns: COLUMNS,
          page: Number(
            new URL(url, "http://x").searchParams.get("page") ?? "1",
          ),
          perPage: 50,
          total: overrides.total ?? 2,
          totalUnfiltered: overrides.totalUnfiltered ?? 5000,
        });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "R1" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

let lastUrl = "";
function UrlProbe() {
  const loc = useLocation();
  lastUrl = `${loc.pathname}${loc.search}`;
  return null;
}

function renderPage(initial = "/inventori") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[initial]}>
          <UrlProbe />
          <Routes>
            <Route path="/inventori" element={<InventoriPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inventori — 02 §8", () => {
  it("renders rows and the attribute columns the server derived", async () => {
    stub();
    renderPage();

    expect(
      await screen.findByRole("columnheader", { name: /Prosesor/ }),
    ).toBeInTheDocument();
    // The unit is shown next to the label, from CategoryAttribute.unit.
    expect(
      screen.getByRole("columnheader", { name: /Siklus \(x\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("NUS0000001")).toBeInTheDocument();
    expect(screen.getAllByText("M1").length).toBeGreaterThan(0);
  });

  it("shows Rp once in the header, not on every cell", async () => {
    stub();
    renderPage();

    expect(
      await screen.findByRole("columnheader", { name: /Modal \(Rp\)/ }),
    ).toBeInTheDocument();
    // The header is static and resolves before the rows arrive, so wait for a
    // row before asking about cells.
    await screen.findByText("NUS0000001");
    const cells = screen.getAllByText("9.000.000");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.textContent).not.toContain("Rp");
  });

  it("mirrors a multi-select filter into the URL", async () => {
    const user = userEvent.setup();
    const seen = stub();
    renderPage();

    await user.click(
      await screen.findByText("Lokasi", { selector: "summary" }),
    );
    await user.click(await screen.findByLabelText("Toko Bandung"));

    await waitFor(() => expect(lastUrl).toContain("lokasi=loc_toko"));

    await user.click(screen.getByLabelText("Gudang Pusat"));
    await waitFor(() =>
      expect(lastUrl).toContain("lokasi=loc_toko%2Cloc_gudang"),
    );

    // And the server was asked for exactly that.
    await waitFor(() =>
      expect(seen.some((u) => u.includes("lokasi=loc_toko%2Cloc_gudang"))).toBe(
        true,
      ),
    );
  });

  it("reproduces the exact view from a shared URL", async () => {
    const seen = stub();
    renderPage(
      "/inventori?lokasi=loc_toko,loc_gudang&status=TERSEDIA&sort=landed&dir=desc&page=2",
    );

    // The checkboxes come back checked...
    await user_expectChecked("Toko Bandung");
    await user_expectChecked("Gudang Pusat");

    // ...the chips show what is filtered...
    expect(
      screen.getByRole("button", { name: /Lokasi: Toko Bandung/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Status: TERSEDIA/ }),
    ).toBeInTheDocument();

    // ...and the request carried every parameter.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const url = seen[0]!;
    expect(url).toContain("lokasi=loc_toko%2Cloc_gudang");
    expect(url).toContain("status=TERSEDIA");
    expect(url).toContain("sort=landed");
    expect(url).toContain("dir=desc");
    expect(url).toContain("page=2");
  });

  it("removes one filter from its chip and keeps the rest", async () => {
    const user = userEvent.setup();
    stub();
    renderPage("/inventori?lokasi=loc_toko,loc_gudang&status=TERSEDIA");

    await user.click(
      await screen.findByRole("button", { name: /Lokasi: Toko Bandung/ }),
    );

    await waitFor(() => expect(lastUrl).not.toContain("loc_toko"));
    expect(lastUrl).toContain("lokasi=loc_gudang");
    expect(lastUrl).toContain("status=TERSEDIA");
  });

  it("resets every filter at once", async () => {
    const user = userEvent.setup();
    stub();
    renderPage("/inventori?lokasi=loc_toko&status=TERSEDIA&q=NUS");

    await user.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(() => expect(lastUrl).toBe("/inventori"));
  });

  it("sorts a fresh column ascending, and flips the active one", async () => {
    const user = userEvent.setup();
    stub();
    renderPage();
    await screen.findByText("NUS0000001");

    // A column that is not the current sort starts ascending.
    await user.click(screen.getByRole("button", { name: /^Modal/ }));
    await waitFor(() => expect(lastUrl).toContain("sort=landed"));
    expect(lastUrl).toContain("dir=asc");

    // Clicking the active column flips it.
    await user.click(screen.getByRole("button", { name: /^Modal/ }));
    await waitFor(() => expect(lastUrl).toContain("dir=desc"));

    // Switching to a different column starts ascending again, and the URL now
    // records both halves rather than a bare dir.
    await user.click(screen.getByRole("button", { name: /^Serial/ }));
    await waitFor(() => expect(lastUrl).toContain("sort=serial"));
    expect(lastUrl).toContain("dir=asc");
  });

  it("returns to page 1 when the filters change", async () => {
    const user = userEvent.setup();
    stub();
    renderPage("/inventori?page=3");

    await user.click(await screen.findByText("Grade", { selector: "summary" }));
    // findByLabelText, not findByRole: jsdom does not implement the
    // <details> toggle, so a role query would treat the closed panel's
    // contents as hidden. The toggle itself is a browser behaviour.
    await user.click(await screen.findByLabelText(/^A\b/));

    await waitFor(() => expect(lastUrl).toContain("grade=A"));
    expect(lastUrl).not.toContain("page=3");
  });

  it("distinguishes no data from no matches", async () => {
    stub({ rows: [], total: 0, totalUnfiltered: 0 });
    const view = renderPage();
    expect(await screen.findByTestId("empty-none")).toHaveTextContent(
      /Belum ada unit/,
    );
    view.unmount();

    vi.unstubAllGlobals();
    stub({ rows: [], total: 0, totalUnfiltered: 5000 });
    renderPage("/inventori?q=zzz");
    expect(await screen.findByTestId("empty-nomatch")).toHaveTextContent(
      /Tidak ada yang cocok/,
    );
  });

  it("debounces the search box instead of round-tripping a keystroke", async () => {
    const user = userEvent.setup();
    const seen = stub();
    renderPage();
    await screen.findByText("NUS0000001");
    const before = seen.length;

    await user.type(
      screen.getByPlaceholderText("Cari serial atau SKU…"),
      "NUS",
    );

    // 02 §1: a keystroke is local state only; the URL updates once, after 250 ms.
    expect(seen.length).toBe(before);
    await waitFor(() => expect(lastUrl).toContain("q=NUS"), { timeout: 2_000 });
  });

  it("announces the row count politely", async () => {
    stub({ total: 4_242 });
    renderPage();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("4.242 unit"));
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

/** Small helper so the shared-URL test reads as a list of claims. */
async function user_expectChecked(label: string) {
  const box = await screen.findByLabelText(label);
  expect(box).toBeChecked();
}
