/**
 * The scanner engine. These are the behaviours the shop actually depends on:
 * a scan is not typing, a scan is not lost, and a scan is never entered twice.
 */
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetScanner,
  __setScannerClock,
  getScannerStatus,
  registerScanTarget,
  setScannerSettings,
  subscribeScanMiss,
} from "../src/lib/scanner.js";
import { useScanTarget } from "../src/hooks/useScanTarget.js";

let now = 0;

/** Let the engine's promise queue drain. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function press(key: string, el: Element = document.body): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
}

/** Type a serial at a fixed inter-character gap, as a scanner would. */
function scan(serial: string, gapMs: number, el?: Element): KeyboardEvent[] {
  const events: KeyboardEvent[] = [];
  now += 10_000; // a clear break from whatever ran before
  for (const ch of serial) {
    now += gapMs;
    events.push(press(ch, el));
  }
  return events;
}

beforeEach(() => {
  __resetScanner();
  now = 0;
  __setScannerClock(() => now);
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("burst detection", () => {
  it("routes a scanner's burst to the page, uppercased", async () => {
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));

    scan("sm39k90hgpn", 5);
    press("Enter");
    await flush();

    expect(seen).toEqual(["SM39K90HGPN"]);
  });

  it("leaves hand typing alone", async () => {
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));

    // 150 ms per character is a brisk human. Nothing here is a scan.
    scan("SM39K90HGPN", 150);
    press("Enter");
    await flush();

    expect(seen).toEqual([]);
  });

  it("commits a scanner that sends no Enter, once the burst settles", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));

    scan("SM39K90HGPN", 5);
    expect(seen).toEqual([]); // nothing yet — the burst might continue

    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual(["SM39K90HGPN"]);
  });

  it("does not commit twice when the scanner sends Enter as well", async () => {
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));

    scan("SM39K90HGPN", 5);
    press("Enter");
    await flush();
    // Long past the settle window: the Enter must have cancelled the timer.
    await new Promise((r) => setTimeout(r, 150));

    expect(seen).toEqual(["SM39K90HGPN"]);
  });

  it("keeps a plain Enter working when no scan is in flight", () => {
    registerScanTarget(() => undefined);
    const ev = press("Enter");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("drops nothing and keeps order across a 200-scan burst", async () => {
    const seen: string[] = [];
    registerScanTarget(async (s) => {
      // An async handler is the realistic case; the queue must still hold order.
      await Promise.resolve();
      seen.push(s);
    });

    const sent = Array.from({ length: 200 }, (_, i) => `SN${i}ABCDEF`);
    for (const s of sent) {
      scan(s, 5);
      press("Enter");
    }
    await flush();

    expect(seen).toEqual(sent);
  });
});

describe("routing by focus", () => {
  it("stays out of the way when the scan field already has focus", async () => {
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));

    const input = document.createElement("input");
    input.setAttribute("data-scan-target", "");
    document.body.appendChild(input);
    input.focus();

    const events = scan("SM39K90HGPN", 5, input);
    press("Enter", input);
    await flush();

    // The field types it natively; claiming it too would enter it twice.
    expect(seen).toEqual([]);
    expect(events.some((e) => e.defaultPrevented)).toBe(false);
  });

  it("offers, but does not steal, a scan aimed at another field", async () => {
    const seen: string[] = [];
    const strays: string[] = [];
    registerScanTarget((s) => void seen.push(s));
    subscribeScanMiss((m) => {
      if (m.reason === "other-field") strays.push(m.serial);
    });

    const price = document.createElement("input");
    document.body.appendChild(price);
    price.focus();

    const events = scan("SM39K90HGPN", 5, price);
    press("Enter", price);
    await flush();

    expect(seen).toEqual([]);
    expect(strays).toEqual(["SM39K90HGPN"]);
    // Nothing was prevented — the characters had somewhere real to go.
    expect(events.some((e) => e.defaultPrevented)).toBe(false);
  });

  it("keeps scanned characters off the page when it does claim them", () => {
    registerScanTarget(() => undefined);
    const events = scan("SM39K90HGPN", 5);
    // The first character cannot be known to be a scan; the rest can.
    expect(events.slice(1).every((e) => e.defaultPrevented)).toBe(true);
  });

  it("reports armed only while a scan could actually land", () => {
    const unregister = registerScanTarget(() => undefined);
    expect(getScannerStatus().armed).toBe(true);

    const price = document.createElement("input");
    document.body.appendChild(price);
    price.focus();
    expect(getScannerStatus().armed).toBe(false);

    price.blur();
    expect(getScannerStatus().armed).toBe(true);

    unregister();
    expect(getScannerStatus().hasTarget).toBe(false);
  });
});

describe("a scan that cannot be delivered", () => {
  it("says so rather than vanishing when no page takes serials", async () => {
    const misses: string[] = [];
    subscribeScanMiss((m) => void misses.push(`${m.reason}:${m.serial}`));

    // No target registered at all — the login screen, or any page that has
    // nothing to do with serials.
    scan("SM39K90HGPN", 5);
    press("Enter");
    await flush();

    expect(misses).toEqual(["no-target:SM39K90HGPN"]);
  });
});

describe("settings", () => {
  it("ignores scans entirely when switched off", async () => {
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));
    setScannerSettings({ enabled: false });

    scan("SM39K90HGPN", 5);
    press("Enter");
    await flush();

    expect(seen).toEqual([]);
  });

  it("records the run-breaking gaps that explain a short scan", async () => {
    const seen: string[] = [];
    registerScanTarget((s) => void seen.push(s));

    // One slow character in the middle, well over the 50 ms default.
    now += 10_000;
    for (const [i, ch] of [..."SM39K90HGPN"].entries()) {
      now += i === 5 ? 120 : 4;
      press(ch);
    }
    press("Enter");
    await flush();

    // The scan is split, and the reading says exactly why.
    expect(seen).toEqual(["90HGPN"]);
    expect(getScannerStatus().lastScan?.rawGaps).toContain(120);
  });
});

describe("useScanTarget", () => {
  it("registers exactly one target under StrictMode's double-mount", async () => {
    const seen: string[] = [];
    function Page() {
      useScanTarget((s) => void seen.push(s));
      return null;
    }
    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );

    scan("SM39K90HGPN", 5);
    press("Enter");
    await flush();

    expect(seen).toEqual(["SM39K90HGPN"]);
  });
});
