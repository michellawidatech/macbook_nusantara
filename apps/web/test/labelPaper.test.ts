/**
 * Page setup for labels — `lib/labelPaper.ts`.
 *
 * The tiling maths is the part worth pinning down: it is arithmetic nobody
 * looks at, its output is a sheet of sticker stock, and getting it wrong by
 * one column is a wasted sheet rather than a visible bug.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETUP,
  PAPERS,
  pageRule,
  paperById,
  tiling,
  type LabelSetup,
} from "../src/lib/labelPaper.js";

const setup = (patch: Partial<LabelSetup> = {}): LabelSetup => ({
  ...DEFAULT_SETUP,
  ...patch,
});

describe("tiling on a sheet", () => {
  it("reproduces the sheet the shop already prints", () => {
    // 50 × 30 stickers on A4 with a 5mm margin: 4 across, 9 down. That was a
    // hard-coded constant before this file; it is now a consequence of the
    // two numbers somebody can read off the pack.
    const t = tiling(DEFAULT_SETUP);
    expect(t.columns).toBe(4);
    expect(t.rows).toBe(9);
    expect(t.perPage).toBe(36);
  });

  it("does not charge the last column for a gap it does not need", () => {
    // Three 60mm labels with 10mm between them span exactly 200mm — the
    // usable width of A4 at a 5mm margin — because the last column has no
    // gap after it. A formula without that correction divides 200 by 70 and
    // says two fit where three do, losing a third of every sheet.
    expect(tiling(setup({ labelWidthMm: 60, gapMm: 10 })).columns).toBe(3);
  });

  it("still loses a column when the gap really is too wide", () => {
    // 4 × 50 + 3 × 20 = 260mm, well past A4's 200mm of usable width.
    expect(tiling(setup({ gapMm: 20 })).columns).toBe(3);
  });

  it("fits more down an F4 than an A4, which is the point of having it", () => {
    const a4 = tiling(setup({ paperId: "A4" }));
    const f4 = tiling(setup({ paperId: "F4" }));
    expect(f4.rows).toBeGreaterThan(a4.rows);
    expect(f4.pageHeightMm).toBe(330);
  });

  it("takes the margin off both edges, not one", () => {
    // 210 − 2 × 30 = 150mm, which takes three 50mm labels rather than four.
    expect(tiling(setup({ marginMm: 30 })).columns).toBe(3);
  });

  it("never reports a page that holds nothing", () => {
    // A sticker wider than the paper is somebody mistyping; the answer is a
    // page of one and an `overflows` flag, not a division by zero or a
    // perPage of 0 that would make `Math.ceil(n / perPage)` infinite.
    const t = tiling(setup({ labelWidthMm: 205, marginMm: 20 }));
    expect(t.columns).toBe(1);
    expect(t.perPage).toBeGreaterThan(0);
    expect(t.overflows).toBe(true);
  });
});

describe("tiling on a roll", () => {
  it("makes the label the page", () => {
    const t = tiling(
      setup({ mode: "ROLL", labelWidthMm: 50, labelHeightMm: 25 }),
    );
    expect(t.perPage).toBe(1);
    expect(t.pageWidthMm).toBe(50);
    expect(t.pageHeightMm).toBe(25);
  });

  it("ignores the paper, the margin and the gap", () => {
    // None of the three exists on a thermal printer: there is no paper wider
    // than the sticker to leave a margin on.
    const t = tiling(
      setup({ mode: "ROLL", paperId: "F4", marginMm: 12, gapMm: 8 }),
    );
    expect(t.marginMm).toBe(0);
    expect(t.gapMm).toBe(0);
    expect(t.pageWidthMm).toBe(DEFAULT_SETUP.labelWidthMm);
  });
});

describe("pageRule", () => {
  it("names the same page global.css scopes the sheet to", () => {
    expect(pageRule(DEFAULT_SETUP)).toContain("@page label-sheet");
  });

  it("writes millimetres rather than a paper name", () => {
    // `size: F4` is not something any browser knows, and F4 being unknown is
    // the whole reason it is in this list.
    expect(pageRule(setup({ paperId: "F4" }))).toContain("215mm 330mm");
  });

  it("leaves no margin — the sheet's own padding places the stickers", () => {
    expect(pageRule(DEFAULT_SETUP)).toContain("margin: 0");
  });
});

describe("paperById", () => {
  it("falls back to the first paper rather than returning nothing", () => {
    // A stored preference for a paper that has since been removed must not
    // take the print dialog down with it.
    expect(paperById("NOT-A-PAPER")).toBe(PAPERS[0]);
  });
});
