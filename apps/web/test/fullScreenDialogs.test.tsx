/**
 * On a phone every dialog is the whole screen (owner-approved mockup,
 * 2026-11-16) — decided once, in `ThemeProvider`, rather than page by page.
 * A confirmation stays a small dialog, a bottom sheet stays a sheet, and a
 * desktop keeps its widths.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Drawer, Modal } from "antd";
import { ThemeProvider, FULL_SCREEN } from "../src/theme/ThemeProvider.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";

function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: (() => {
          const min = /min-width:\s*(\d+)px/.exec(query);
          return min !== null && Number(min[1]) <= 1200;
        })(),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

const wrap = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <ThemeProvider>{node}</ThemeProvider>
    </LocaleProvider>,
  );

describe("dialogs on a phone", () => {
  it("are full screen", async () => {
    wrap(
      <Modal open title="Stock Out" width={1080} okText="Send">
        body
      </Modal>,
    );
    await screen.findByText("body");
    expect(document.querySelector(`.${FULL_SCREEN}`)).not.toBeNull();
  });

  it("leave a bottom sheet a sheet, and make a side drawer full screen", async () => {
    wrap(
      <>
        <Drawer open placement="bottom" title="Filters">
          sheet
        </Drawer>
        <Drawer open placement="right" title="Customer">
          side
        </Drawer>
      </>,
    );
    await screen.findByText("side");
    const fulls = Array.from(document.querySelectorAll(`.${FULL_SCREEN}`));
    expect(fulls.some((el) => el.textContent?.includes("side"))).toBe(true);
    expect(fulls.some((el) => el.textContent?.includes("sheet"))).toBe(false);
  });

  it("are left alone on a desktop", async () => {
    useDesktopViewport();
    wrap(
      <Modal open title="Stock Out" width={1080}>
        body
      </Modal>,
    );
    await screen.findByText("body");
    expect(document.querySelector(`.${FULL_SCREEN}`)).toBeNull();
  });
});
