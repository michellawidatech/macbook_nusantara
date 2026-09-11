/**
 * The nav column's glass treatment — owner ask 2026-09-09.
 *
 * > *"I want a glass inspired, but please don't revamp a lot, just the
 * > navbar."*
 *
 * A rendered test rather than a token test, because what the ask is about is
 * the STRUCTURE: a gradient column carrying two floating translucent panels,
 * the mark and the menu in one and the account foot in the other. Every value
 * in it lives in `NAV`, so a test asserting the values would only be checking
 * that the tokens file says what the tokens file says. What can actually break
 * is a panel losing its blur, the two drifting apart, or the whole thing
 * ending up on the wrong element — and only the tree can show that.
 *
 * jsdom does not paint, so nothing here claims the column LOOKS right. It
 * claims the treatment reaches the elements it was written for, which is the
 * half a test can hold.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "../src/layouts/AppLayout.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import { NAV } from "../src/theme/tokens.js";

/**
 * Force the desktop layout.
 *
 * `test/setup.ts` answers "no" to every media query, so without this the shell
 * renders its phone form — which has no sider at all, and the panels this file
 * is about are the sider's.
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

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
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

/** Every element carrying the panel treatment, in document order. */
const panels = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      `[style*="backdrop-filter"], [style*="-webkit-backdrop-filter"]`,
    ),
  );

beforeEach(() => {
  localStorage.clear();
  useDesktopViewport();
});

describe("the glass nav", () => {
  it("floats two panels, and only two", () => {
    renderShell();
    // The menu, and the account foot. A third would mean the treatment had
    // been copied onto something inside one of them — glass on glass, which
    // is the way this kind of design falls apart.
    expect(panels()).toHaveLength(2);
  });

  it("gives both panels the same glass, so neither reads as a mistake", () => {
    renderShell();
    const [menuPanel, footPanel] = panels();
    for (const panel of [menuPanel, footPanel]) {
      // Compared through the DOM's own parse rather than as strings: jsdom
      // normalises `0.10` to `0.1`, and a test that failed on that would be
      // testing the serializer.
      expect(panel!.style.backgroundColor || panel!.style.background).toBe(
        "rgba(255, 255, 255, 0.1)",
      );
      expect(panel!.style.backdropFilter).toContain(NAV.blur);
      expect(panel!.style.borderRadius).toBe(`${NAV.panelRadius}px`);
    }
  });

  /*
   * The `-webkit-` prefix is NOT asserted, and the omission is deliberate:
   * jsdom's CSSStyleDeclaration drops the property entirely, so it is absent
   * from the inline style whatever the component wrote. A test for it would
   * be a test of jsdom. It is set beside the unprefixed one in `glassPanel`,
   * where Safari — every iPad in the shop — is the reason.
   */

  it("keeps the mark and the menu in the first panel", () => {
    renderShell();
    // The brand moved INSIDE the panel on 2026-09-09. Above it, it would be a
    // caption for the window rather than a heading for the nav.
    const [menuPanel] = panels();
    expect(menuPanel!.contains(screen.getByText("Macbook Nusantara"))).toBe(
      true,
    );
    expect(menuPanel!.querySelector(".ant-menu")).not.toBeNull();
  });

  it("paints the column with a gradient, which is what the glass reads against", () => {
    renderShell();
    const sider = document.querySelector<HTMLElement>(".ant-layout-sider");
    // A translucent panel over a FLAT colour is just another flat colour, and
    // the blur has nothing to blur.
    expect(sider!.style.background).toContain("linear-gradient");
  });
});
