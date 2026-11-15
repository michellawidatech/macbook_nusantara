/**
 * "Scan" beside a serial box on a phone (2026-11-16): the camera where the
 * browser can read barcodes, otherwise the caret in the scan box for a paired
 * handheld. Also: money boxes ask for the number pad.
 */
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "antd";
import { ScanButton } from "../src/components/ScanButton.js";
import { MoneyInput } from "../src/components/MoneyInput.js";

afterEach(() => {
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
});

describe("the Scan button", () => {
  it("puts the caret in the scan box for a handheld when the browser cannot read barcodes", async () => {
    render(
      <App>
        <input data-scan-target aria-label="Serial" />
        <ScanButton />
      </App>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(screen.getByLabelText("Serial")).toHaveFocus();
    expect(
      await screen.findByText("Scan with the handheld now."),
    ).toBeInTheDocument();
  });

  it("opens the camera where it can, and says so when the camera is refused", async () => {
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([]);
      }
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error("denied")) },
    });
    render(
      <App>
        <ScanButton />
      </App>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByText("Scan a barcode")).toBeInTheDocument();
    expect(
      await screen.findByText(/The camera could not be opened/),
    ).toBeInTheDocument();
  });
});

describe("money boxes", () => {
  it("ask for the number pad", () => {
    render(<MoneyInput aria-label="Price" value={0} onChange={() => {}} />);
    expect(screen.getByLabelText("Price")).toHaveAttribute(
      "inputmode",
      "numeric",
    );
  });
});
