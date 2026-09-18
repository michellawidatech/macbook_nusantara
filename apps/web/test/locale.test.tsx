import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../src/layouts/AppLayout.js";
import { NAV_SECTIONS } from "../src/layouts/navigation.js";
import userEvent from "@testing-library/user-event";
import { useTranslation } from "react-i18next";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import { useLanguage } from "../src/i18n/useLanguage.js";
import { useAntdLocale } from "../src/i18n/antdLocale.js";
import { fmtDate } from "../src/lib/format.js";

const STORAGE_KEY = "nusantara-pos.language";

/** Renders the copy, the antd bundle's name and a date, plus the switch. */
function Probe() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const antd = useAntdLocale();
  return (
    <div>
      <span data-testid="copy">{t("Stock")}</span>
      <span data-testid="antd">{antd.locale}</span>
      <span data-testid="date">{fmtDate("2026-08-20T00:00:00.000Z")}</span>
      <button onClick={() => setLanguage(language === "id" ? "en" : "id")}>
        switch
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("LocaleProvider", () => {
  it("starts in English and switches the whole tree at once", async () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("copy")).toHaveTextContent("Stock");
    expect(screen.getByTestId("antd")).toHaveTextContent("en");

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("copy")).toHaveTextContent("Stok");
    // The antd bundle follows too — this is what ConfigProvider is handed.
    expect(screen.getByTestId("antd")).toHaveTextContent("id");
  });

  it("persists the choice and reads it back on the next mount", async () => {
    const first = render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("id");
    first.unmount();

    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("copy")).toHaveTextContent("Stok");
  });

  it("formats dates in the active language", async () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    // en-GB abbreviates August as "Aug"; id-ID as "Agu".
    expect(screen.getByTestId("date")).toHaveTextContent("Aug");
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("date")).toHaveTextContent("Agu");
  });

  it("ignores a junk stored value rather than rendering nothing", () => {
    localStorage.setItem(STORAGE_KEY, "martian");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("copy")).toHaveTextContent("Stock");
  });
});

describe("useTranslation outside a provider", () => {
  it("falls back to English instead of throwing", () => {
    function Bare() {
      const { t } = useTranslation();
      return <span data-testid="copy">{t("common.delete", "Delete")}</span>;
    }
    // The whole point of the shim's FALLBACK: a shared component must render
    // on its own in a test without being wrapped.
    render(<Bare />);
    expect(screen.getByTestId("copy")).toHaveTextContent("Delete");
  });
});

describe("the switch in the account menu", () => {
  function renderShell() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <LocaleProvider>
          {/* The shell reads the colour-scheme context now that Appearance
              sits beside Language in the account menu (2026-08-26). Unlike
              `useTranslation`, `useColorScheme` throws without a provider —
              deliberately, since a theme that silently falls back is a theme
              nobody notices is broken. */}
          <ThemeProvider>
            <MemoryRouter initialEntries={["/stock/opname"]}>
              <Routes>
                <Route
                  element={
                    <AppLayout
                      staff={{
                        id: "s1",
                        username: "stub_admin",
                        name: "Stub Admin",
                        role: "OWNER",
                        canApprove: true,
                        mustChangePassword: false,
                      }}
                    />
                  }
                >
                  <Route path="/stock/opname" element={<div />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );
  }

  /**
   * Opens on click — see the `trigger` prop and why it is not the default.
   *
   * The nav drawer has to be opened first. Since 2026-08-24 the account menu
   * lives at the foot of the sider rather than in the header, and this shell
   * renders its compact form under the stubbed matchMedia — where there is no
   * sider, so the account rides along in the drawer instead. Opening it is
   * genuinely the first step of the journey on a phone, not test scaffolding.
   */
  async function openAccountMenu(name: string) {
    if (!screen.queryByRole("button", { name })) {
      await userEvent.click(
        screen.getByRole("button", { name: /Open navigation|Buka navigasi/ }),
      );
    }
    await userEvent.click(await screen.findByRole("button", { name }));
    await screen.findByRole("menuitem", { name: /English/ });
  }

  it("translates the nav without touching NAV_SECTIONS", async () => {
    renderShell();
    // The stubbed matchMedia answers "no" to every query, so the shell renders
    // its compact form and the nav lives in the Drawer.
    await userEvent.click(
      screen.getByRole("button", { name: "Open navigation" }),
    );
    // By text, not by role name: an open submenu's accessible name absorbs
    // every child under it, so "Stock" would have to be matched as
    // "StockPurchase OrderStock In (QC)…".
    expect(screen.getByText("Stock")).toBeInTheDocument();

    await openAccountMenu("Account menu");
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Bahasa Indonesia/ }),
    );

    expect(screen.getByText("Stok")).toBeInTheDocument();
    // The nav data itself is untouched — it is the catalogue key.
    expect(NAV_SECTIONS[0]?.label).toBe("Stock");
    // ...and the hamburger's own label followed too.
    expect(
      screen.getByRole("button", { name: "Buka navigasi" }),
    ).toBeInTheDocument();
  });

  it("names the active language for a screen reader, not just visually", async () => {
    renderShell();
    await openAccountMenu("Account menu");

    // antd 6 puts no `aria-selected` on a Dropdown's items, so the check glyph
    // is the only signal of which language is live — it has to carry a word.
    expect(
      screen.getByRole("menuitem", { name: /English.*Active/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Bahasa Indonesia" }),
    ).toBeInTheDocument();
  });
});
