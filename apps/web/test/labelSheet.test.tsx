import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabelSheet, PrintLabelsModal } from "../src/components/LabelSheet";
import {
  DEFAULT_SETUP,
  tiling,
  type LabelSetup,
} from "../src/lib/labelPaper.js";
import type { LabelDatum } from "../src/lib/labels.js";

/**
 * A sticker for a serial.
 *
 * `barcode` defaults to the serial itself — what a real sticker carries since
 * the owner retired the supplier-code "store barcode" on 2026-09-21.
 */
const label = (serial: string, barcode = serial): LabelDatum => ({
  serial,
  barcode,
  line1: 'PRO 13" 2017',
  line2: "i5 8/128 NTB",
});

/** The sheet renders `.label-cell` per sticker and `.label-page` per sheet. */
const cells = (c: HTMLElement) => c.querySelectorAll(".label-cell");
const pages = (c: HTMLElement) => c.querySelectorAll(".label-page");
/** The one `<style>` the sheet injects is its `@page` rule. */
const pageCss = (c: HTMLElement) => c.querySelector("style")?.textContent ?? "";

const withSetup = (patch: Partial<LabelSetup>): LabelSetup => ({
  ...DEFAULT_SETUP,
  ...patch,
});

describe("LabelSheet", () => {
  it("prints the serial as text as well as encoding it", () => {
    // The sticker's text and its symbol have to be the same string, or nobody
    // can check one against the other by eye. Both are the serial as stored —
    // nothing in front of it since 2026-09-21.
    render(<LabelSheet labels={[label("C02740137JKM")]} />);
    expect(screen.getByText("C02740137JKM")).toBeInTheDocument();
    expect(screen.getByText('PRO 13" 2017')).toBeInTheDocument();
    expect(screen.getByText("i5 8/128 NTB")).toBeInTheDocument();
  });

  it("encodes a square QR for every serial by default", async () => {
    // The owner's decision (2026-08-28): the sticker is read by the shop's own
    // phones, and a QR survives a creased, half-covered label in a way a row
    // of bars cannot. Generation is async, so the SVGs arrive after the first
    // paint.
    const { container } = render(
      <LabelSheet labels={[label("SB1234567890"), label("SB1234567891")]} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("svg").length).toBe(2);
    });
    // Square, and sized off the label height rather than stretched to the
    // width the bars used to want.
    for (const box of container.querySelectorAll<HTMLElement>(
      "[aria-hidden='true']",
    )) {
      if (box.style.width === "") continue;
      expect(box.style.width).toBe(box.style.height);
    }
  });

  it("keeps the QR big enough to read on the smallest thermal label", async () => {
    // `labelHeightMm - 10` asks for a 5mm square at LABEL_MIN_MM, which is
    // under one dot per module on a 203dpi head — a grey smudge, not a code.
    const { container } = render(
      <LabelSheet
        labels={[label("ASBJ347203KLM")]}
        setup={withSetup({ mode: "ROLL", labelWidthMm: 40, labelHeightMm: 15 })}
      />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll("svg").length).toBe(1);
    });
    const box = container.querySelector<HTMLElement>("[aria-hidden='true']")!;
    expect(box.style.width).toBe("8mm");
    expect(box.style.height).toBe("8mm");
  });

  it("draws a Code 128 for the desk that still has a 1-D handheld", () => {
    const { container } = render(
      <LabelSheet
        labels={[label("ASB1234567890")]}
        setup={withSetup({ symbology: "CODE128" })}
      />,
    );
    // Bars, not one empty box. A 13-character serial is 16 symbols — start,
    // 13 data, checksum, stop — at 3 bars each, plus the stop's trailing bar:
    // 49. `test/code128.test.ts` owns the encoding; this only checks that
    // choosing Code 128 actually draws one. Unlike the QR it is synchronous.
    // One rect per module of the Code 128, so the count moves with the
    // encoded string's length.
    expect(container.querySelectorAll("svg rect").length).toBe(49);
  });

  it("omits the second line rather than printing an empty one", () => {
    const { container } = render(
      <LabelSheet
        labels={[
          {
            serial: "SB1234567890",
            barcode: "SB1234567890",
            line1: "Magic Mouse",
            line2: "",
          },
        ]}
      />,
    );
    const cell = cells(container)[0]!;
    // The QR block's serial and one code line, and no stray blank element.
    expect(cell.textContent).toBe("SB1234567890Magic Mouse");
  });

  describe("pagination", () => {
    const full = tiling(DEFAULT_SETUP).perPage;

    it("fits a full sheet on one page", () => {
      const { container } = render(
        <LabelSheet
          labels={Array.from({ length: full }, (_, i) => label(`S${i}`))}
        />,
      );
      expect(pages(container).length).toBe(1);
      expect(cells(container).length).toBe(full);
    });

    it("spills one past a full sheet onto a second page", () => {
      const { container } = render(
        <LabelSheet
          labels={Array.from({ length: full + 1 }, (_, i) => label(`S${i}`))}
        />,
      );
      expect(pages(container).length).toBe(2);
      expect(cells(container).length).toBe(full + 1);
    });

    it("honours a different sticker stock", () => {
      const stock = withSetup({ labelWidthMm: 70, labelHeightMm: 40 });
      // A4 less a 5mm margin each side leaves 200 × 287, which takes 2 across
      // and 7 down at 70 × 40. Derived rather than declared — that is the
      // point of `tiling`: four numbers that can disagree became two that
      // cannot.
      expect(tiling(stock).columns).toBe(2);
      expect(tiling(stock).rows).toBe(7);
      const { container } = render(
        <LabelSheet
          labels={Array.from({ length: 15 }, (_, i) => label(`S${i}`))}
          setup={stock}
        />,
      );
      expect(pages(container).length).toBe(2);
    });

    it("keeps the sheet the shop already prints", () => {
      // 50 × 30 on A4 is 4 across and 9 down — exactly what the old
      // hard-coded DEFAULT_GEOMETRY declared, now computed from the paper and
      // the sticker instead.
      const t = tiling(DEFAULT_SETUP);
      expect([t.columns, t.rows, t.perPage]).toEqual([4, 9, 36]);
    });

    it("puts one label on each page of a thermal roll", () => {
      // The owner's second printer (2026-08-28). The label IS the page, so
      // three stickers are three pages — a 210mm page with a 50mm sticker in
      // the corner would feed 210mm of stock per machine.
      const { container } = render(
        <LabelSheet
          labels={Array.from({ length: 3 }, (_, i) => label(`S${i}`))}
          setup={withSetup({
            mode: "ROLL",
            labelWidthMm: 50,
            labelHeightMm: 25,
          })}
        />,
      );
      expect(pages(container).length).toBe(3);
      expect(cells(container).length).toBe(3);
    });
  });

  describe("the page rule", () => {
    it("sizes the named page to the chosen paper", () => {
      const { container } = render(
        <LabelSheet
          labels={[label("S1")]}
          setup={withSetup({ paperId: "F4" })}
        />,
      );
      // F4 is 215 × 330 and no browser knows the name, which is exactly why
      // the rule is emitted in millimetres.
      expect(pageCss(container)).toContain("215mm 330mm");
    });

    it("sizes it to the sticker on a roll", () => {
      const { container } = render(
        <LabelSheet
          labels={[label("S1")]}
          setup={withSetup({
            mode: "ROLL",
            labelWidthMm: 50,
            labelHeightMm: 25,
          })}
        />,
      );
      expect(pageCss(container)).toContain("50mm 25mm");
    });
  });

  it("renders nothing but the root when there is nothing to print", () => {
    const { container } = render(<LabelSheet labels={[]} />);
    expect(pages(container).length).toBe(0);
    expect(cells(container).length).toBe(0);
  });
});

/**
 * The print dialog's own check on what it is about to encode (owner ask
 * 2026-08-28).
 *
 * A sheet of stickers cannot be un-printed and a roll of thermal stock costs
 * money, so the last cheap moment to notice a bad serial is before the Print
 * button, not after it.
 */
describe("PrintLabelsModal validation", () => {
  const open = (labels: LabelDatum[]) =>
    render(
      <AntdApp>
        <PrintLabelsModal open labels={labels} onClose={() => undefined} />
      </AntdApp>,
    );

  /**
   * The dialog's own Print button.
   *
   * A regex ending the name rather than an exact match: antd puts an
   * `aria-label`-ed printer icon inside the button, and that label is part of
   * the computed accessible name. Found asynchronously because a Modal mounts
   * through a portal after the first paint.
   */
  const printButton = () => screen.findByRole("button", { name: /Print$/ });

  it("prints without comment when every serial is sound", async () => {
    open([label("SBJ347203KLM")]);
    expect(await printButton()).toBeEnabled();
    expect(screen.queryByText(/look wrong/)).toBeNull();
    expect(screen.queryByText(/cannot be printed/)).toBeNull();
  });

  it("refuses the run when a serial cannot be encoded at all", async () => {
    // Not silently dropped from the sheet: 35 stickers where 36 were asked
    // for is discovered by somebody hunting a shelf for the missing one.
    open([
      label("SBJ347203KLM"),
      { serial: "", barcode: "", line1: "Mac", line2: "" },
    ]);
    expect(await printButton()).toBeDisabled();
    expect(screen.getByText(/cannot be printed/)).toBeInTheDocument();
  });

  it("names the offending serial rather than only counting it", async () => {
    open([label("SBJ34I203KLM")]);
    await printButton();
    // Scoped to the alert: the serial is also printed on the sticker in the
    // preview below, which is not what this is asking about.
    const alert = within(screen.getByRole("alert"));
    // The SERIAL, not the sticker: what is in doubt is the machine's own
    // number, and that is what somebody has to go and check.
    expect(alert.getByText("SBJ34I203KLM")).toBeInTheDocument();
    expect(alert.getByText(/I or an O/)).toBeInTheDocument();
  });

  it("still prints a serial that merely looks wrong", async () => {
    // It will scan back perfectly; what is in doubt is the serial, not the
    // sticker. Refusing would leave the machine with no label at all.
    open([label("SBJ34I203KLM")]);
    expect(await printButton()).toBeEnabled();
    expect(screen.getByText(/look wrong/)).toBeInTheDocument();
  });

  it("does not let one unencodable serial blank the whole sheet", async () => {
    // `QRCode.toString("")` rejects, and one rejection inside `Promise.all`
    // used to take every QR on the page with it — thirty-six blank squares
    // because of one bad row.
    open([
      { serial: "", barcode: "", line1: "Mac", line2: "" },
      label("ASBJ347203KLM"),
      label("ASBJ347203KLN"),
    ]);
    // `document`, not render's `container`: a Modal's body goes to the body
    // through a portal, so the returned container holds none of it.
    await waitFor(() => {
      expect(document.querySelectorAll("svg[viewBox]").length).toBeGreaterThan(
        0,
      );
    });
  });
});
