/**
 * Render smoke tests for the two scanner surfaces that are not part of a page's
 * own flow: the header chip and the Settings panel.
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ScannerChip } from "../src/components/ScannerChip.js";
import { ScannerSettings } from "../src/routes/settings/ScannerSettings.js";
import { __resetScanner, registerScanTarget } from "../src/lib/scanner.js";

beforeEach(() => {
  __resetScanner();
});

describe("ScannerChip", () => {
  it("stays out of the header on a page that takes no scans", () => {
    const { container } = render(
      <AntdApp>
        <ScannerChip />
      </AntdApp>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows the scanner as ready once a page is listening", async () => {
    registerScanTarget(() => undefined);
    render(
      <AntdApp>
        <ScannerChip />
      </AntdApp>,
    );
    expect(await screen.findByRole("button")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Scanner ready"),
    );
  });
});

describe("ScannerSettings", () => {
  it("renders, and says nothing has been scanned yet", () => {
    render(
      <AntdApp>
        <ScannerSettings />
      </AntdApp>,
    );
    expect(screen.getByText("Nothing scanned yet.")).toBeInTheDocument();
    // The panel's whole purpose: the threshold is editable, not baked in.
    expect(screen.getByText(/Fastest a hand can type/i)).toBeInTheDocument();
    const threshold = document.querySelector<HTMLInputElement>(
      ".ant-input-number input",
    );
    expect(threshold?.value).toBe("50");
  });
});
