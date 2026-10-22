import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  LabelSheet,
  PrintLabelsModal,
  QR_MM,
} from "../src/components/LabelSheet";
import { labelFor, type LabelDatum } from "../src/lib/labels.js";
import type { CatalogModel, Sku, Unit } from "../src/mock/seed.js";

/** A sticker for a serial. */
const label = (serial: string, barcode = serial): LabelDatum => ({
  serial,
  barcode,
  name: 'MacBook Air 13" 2020',
  code: 'AIR 13" 2020 I5 8/256',
});

const cells = (c: HTMLElement) =>
  c.querySelectorAll<HTMLElement>(".label-cell");
/** The one `<style>` the sheet injects holds its `@page` rule. */
const pageCss = (c: HTMLElement) => c.querySelector("style")?.textContent ?? "";

/**
 * The owner's sticker (2026-10-22): always 50 × 30 mm, a square QR on the
 * left, the product name and the SKU code on the right, and no serial text.
 */
describe("LabelSheet", () => {
  it("prints a 50 × 30 mm page with the product name and SKU code and no serial text", async () => {
    const { container } = render(
      <LabelSheet labels={[label("C02740137JKM")]} />,
    );
    expect(pageCss(container)).toMatch(
      /@page label-sheet \{ size: 50mm 30mm; margin: 0; \}/,
    );
    const [cell] = cells(container);
    expect(cell!.style.width).toBe("50mm");
    expect(cell!.style.height).toBe("30mm");
    expect(cell!.textContent).toBe('MacBook Air 13" 2020AIR 13" 2020 I5 8/256');
    expect(cell!.textContent).not.toContain("C02740137JKM");
    // The serial is in the QR, which arrives asynchronously.
    await waitFor(() => {
      expect(cell!.querySelector(".label-qr svg")).not.toBeNull();
    });
  });

  it("puts a square QR on the left, filling the height less a margin", () => {
    const { container } = render(
      <LabelSheet labels={[label("SB1234567890")]} />,
    );
    const qr = container.querySelector<HTMLElement>(".label-qr")!;
    expect(qr.style.width).toBe(`${QR_MM}mm`);
    expect(qr.style.height).toBe(`${QR_MM}mm`);
    expect(qr.style.left).toBe("2mm");
    expect(QR_MM).toBeLessThan(LABEL_HEIGHT_MM);
    expect(QR_MM).toBeGreaterThanOrEqual(24);
    expect(LABEL_WIDTH_MM).toBe(50);
  });

  it("clamps a long product name instead of spilling onto the next sticker", () => {
    const { container } = render(
      <LabelSheet
        labels={[
          {
            ...label("SB1234567890"),
            name: "MacBook Pro 16-inch with an unusually long product name 2023",
          },
        ]}
      />,
    );
    const cell = cells(container)[0]!;
    expect(cell.style.overflow).toBe("hidden");
    const name = cell.querySelector<HTMLElement>(".label-name")!;
    expect(name.style.overflow).toBe("hidden");
    expect(name.style.webkitLineClamp).toBe("3");
  });

  it("is one sticker per page, with no blank page after the last", () => {
    const { container } = render(
      <LabelSheet
        labels={Array.from({ length: 3 }, (_, i) => label(`SB12345678${i}0`))}
      />,
    );
    const all = [...cells(container)];
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.style.breakAfter)).toEqual([
      "page",
      "page",
      "auto",
    ]);
  });

  it("omits the code line rather than printing an empty one", () => {
    const { container } = render(
      <LabelSheet labels={[{ ...label("SB1234567890"), code: "" }]} />,
    );
    expect(container.querySelector(".label-code")).toBeNull();
  });

  it("renders no sticker when there is nothing to print", () => {
    const { container } = render(<LabelSheet labels={[]} />);
    expect(cells(container).length).toBe(0);
  });
});

describe("labelFor", () => {
  it("carries the product name and the SKU code, and encodes the serial", () => {
    const sku = {
      id: "s1",
      modelId: "m1",
      code: 'AIR 13" 2020 I5 8/256',
      name: 'MacBook Air 13" 2020',
      variantLabel: "i5 · 8GB · 256GB",
      price: 0,
    } as Sku;
    const unit = { serial: "C02740137JKM", skuId: "s1" } as Unit;
    expect(labelFor(unit, sku, { name: "x" } as CatalogModel)).toEqual({
      serial: "C02740137JKM",
      barcode: "C02740137JKM",
      name: 'MacBook Air 13" 2020',
      code: 'AIR 13" 2020 I5 8/256',
    });
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
      { serial: "", barcode: "", name: "Mac", code: "" },
    ]);
    expect(await printButton()).toBeDisabled();
    expect(screen.getByText(/cannot be printed/)).toBeInTheDocument();
  });

  it("names the offending serial rather than only counting it", async () => {
    open([label("SBJ34I203KLM")]);
    await printButton();
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
      { serial: "", barcode: "", name: "Mac", code: "" },
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
