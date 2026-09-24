/**
 * The theme's colours, as antd actually resolves them (owner report
 * 2026-09-19: "when something is selected it might be highlighted as dark
 * green which is hard to see").
 *
 * antd derives a selected thing's fill from the seed, and for this app's deep
 * emerald it derived a mid green in light (#a5b8af, #72ab93 on hover) and a
 * near-invisible one in dark (#0f3228). The fills are stated in tokens.ts now;
 * this checks they reach antd, and that the dark scheme's primary reads on a
 * dark card.
 */
import { theme } from "antd";
import { describe, expect, it } from "vitest";
import { buildTheme } from "../src/theme/theme.js";
import { SELECTION } from "../src/theme/tokens.js";

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("what a selected thing is filled with", () => {
  it("is a pale tint in the light scheme, under dark text", () => {
    const t = theme.getDesignToken(buildTheme("light"));
    expect(t.controlItemBgActive).toBe(SELECTION.light.bg);
    expect(t.controlItemBgActiveHover).toBe(SELECTION.light.bgHover);
    expect(t.colorPrimaryBg).toBe(SELECTION.light.bg);
    // Pale: black text on the hover still reads at better than 15:1.
    expect(contrast("#000000", SELECTION.light.bgHover)).toBeGreaterThan(15);
  });

  it("is visible against a dark card, under white text", () => {
    const t = theme.getDesignToken(buildTheme("dark"));
    expect(t.controlItemBgActive).toBe(SELECTION.dark.bg);
    expect(contrast(SELECTION.dark.bg, t.colorBgContainer)).toBeGreaterThan(
      1.6,
    );
    expect(contrast("#ffffff", SELECTION.dark.bg)).toBeGreaterThan(7);
  });
});

describe("the primary as text", () => {
  it("reads on a white card in light, and on a dark card in dark", () => {
    const light = theme.getDesignToken(buildTheme("light"));
    const dark = theme.getDesignToken(buildTheme("dark"));
    expect(
      contrast(light.colorPrimary, light.colorBgContainer),
    ).toBeGreaterThan(4.5);
    expect(contrast(dark.colorPrimary, dark.colorBgContainer)).toBeGreaterThan(
      4.5,
    );
  });
});
