/**
 * ScanField — 02 §2 "Barcode scanners".
 *
 * The DoD case lives here: "A scripted 200-scan burst into ScanField drops
 * nothing and never loses focus."
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanField, type ScanOutcome } from "../src/ScanField.js";

afterEach(() => {
  vi.useRealTimers();
});

const input = () => screen.getByLabelText("Serial") as HTMLInputElement;

describe("ScanField — 02 §2", () => {
  it("is focused on mount", () => {
    render(<ScanField label="Serial" onScan={() => ({ ok: true })} />);
    expect(input()).toHaveFocus();
  });

  it("submits on Enter, uppercased and trimmed, then clears and refocuses", async () => {
    const scans: string[] = [];
    render(
      <ScanField
        label="Serial"
        onScan={(s) => {
          scans.push(s);
          return { ok: true };
        }}
      />,
    );

    input().value = "  nus0001  ";
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(scans).toEqual(["NUS0001"]));
    expect(input().value).toBe("");
    expect(input()).toHaveFocus();
  });

  it("submits nothing for an empty Enter", async () => {
    const onScan = vi.fn((): ScanOutcome => ({ ok: true }));
    render(<ScanField label="Serial" onScan={onScan} />);
    fireEvent.keyDown(input(), { key: "Enter" });
    await Promise.resolve();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("a 200-scan burst drops nothing, stays in order, and never loses focus", async () => {
    const scans: string[] = [];
    render(
      <ScanField
        label="Serial"
        onScan={async (s) => {
          // Async and slower than the scans arrive — the queue absorbs it.
          await Promise.resolve();
          scans.push(s);
          return { ok: true };
        }}
      />,
    );

    for (let i = 0; i < 200; i += 1) {
      input().value = `NUS${String(i).padStart(7, "0")}`;
      fireEvent.keyDown(input(), { key: "Enter" });
    }

    await waitFor(() => expect(scans).toHaveLength(200));
    expect(scans[0]).toBe("NUS0000000");
    expect(scans[199]).toBe("NUS0000199");
    // In order, none repeated, none skipped.
    expect(new Set(scans).size).toBe(200);
    expect(scans).toEqual([...scans].sort());
    expect(input()).toHaveFocus();
    expect(input().value).toBe("");
  });

  it("commits a settled burst without Enter — some scanners do not send one", async () => {
    vi.useFakeTimers();
    let t = 0;
    const scans: string[] = [];
    render(
      <ScanField
        label="Serial"
        now={() => t}
        onScan={(s) => {
          scans.push(s);
          return { ok: true };
        }}
      />,
    );

    // Ten characters, 10 ms apart: unmistakably a scanner.
    const serial = "NUSA123456";
    for (const ch of serial) {
      t += 10;
      fireEvent.keyDown(input(), { key: ch });
      input().value += ch;
    }

    await vi.advanceTimersByTimeAsync(80); // BURST_SETTLE_MS + margin
    expect(scans).toEqual(["NUSA123456"]);
  });

  it("does not auto-commit hand typing — a human waits for Enter", async () => {
    vi.useFakeTimers();
    let t = 0;
    const onScan = vi.fn((): ScanOutcome => ({ ok: true }));
    render(<ScanField label="Serial" now={() => t} onScan={onScan} />);

    // Fast for a human, slow for a scanner: 150 ms between keys.
    for (const ch of "NUSA12") {
      t += 150;
      fireEvent.keyDown(input(), { key: ch });
      input().value += ch;
    }

    await vi.advanceTimersByTimeAsync(500);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("keeps an unknown serial in the field, selected, with recovery inline", async () => {
    const recovered: string[] = [];
    render(
      <ScanField
        label="Serial"
        onScan={() => ({ ok: false, reason: "unknown" })}
        recoveryActions={[
          { label: "Cari manual", run: (s) => recovered.push(`cari:${s}`) },
          {
            label: "Tambah sebagai unit baru",
            run: (s) => recovered.push(`tambah:${s}`),
          },
        ]}
      />,
    );

    input().value = "GHOST01";
    fireEvent.keyDown(input(), { key: "Enter" });

    // §5: the message names the record. §2: the value stays for correction.
    expect(await screen.findByTestId("scan-message")).toHaveTextContent(
      "Serial GHOST01 tidak dikenal.",
    );
    expect(input().value).toBe("GHOST01");
    expect(input()).toHaveFocus();

    // The two §2 recovery actions, inline — not an error dialog.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cari manual" }));
    expect(recovered).toEqual(["cari:GHOST01"]);
    // Recovery clears the field and hands focus back for the next scan.
    expect(input().value).toBe("");
    expect(input()).toHaveFocus();
  });

  it("announces a duplicate politely and keeps going", async () => {
    render(
      <ScanField
        label="Serial"
        onScan={() => ({ ok: false, reason: "duplicate" })}
      />,
    );

    input().value = "NUS0001";
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(await screen.findByTestId("scan-message")).toHaveTextContent(
      "Serial NUS0001 sudah dipindai.",
    );
    // Cleared — the next scan proceeds without ceremony.
    expect(input().value).toBe("");
    expect(input()).toHaveFocus();
    // Announced, never a focus trap (§3).
    const live = screen.getByTestId("scan-message").closest("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("offers a visible way back when focus is lost", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ScanField label="Serial" onScan={() => ({ ok: true })} />
        <button type="button">Di luar</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Di luar" }));
    expect(input()).not.toHaveFocus();

    // The chip flips to reclaim mode and one click restores the scanner.
    await user.click(screen.getByRole("button", { name: "Klik untuk scan" }));
    expect(input()).toHaveFocus();
  });
});
