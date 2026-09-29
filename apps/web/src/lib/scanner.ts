/**
 * Barcode scanner input, for the whole app.
 *
 * What actually arrives: the "Barcode to PC" server — and every physical
 * barcode scanner — is a keyboard. The owner's configured output profile is
 * literally `BARCODE` followed by `ENTER`, emitted with `robotjs.typeString()`
 * into whatever element has OS focus. There is no socket to open and no
 * endpoint to call (port 57891 is the phone↔server protocol, and this version
 * of the server has no websocket output block). One mechanism therefore covers
 * both the phone and the hardware scanner, which is why this file is the whole
 * integration.
 *
 * So the only real problem is telling a burst apart from a hand, and putting
 * the result where the page wants it.
 *
 * The burst algorithm is ported from `packages/ui/src/ScanField.tsx`, which
 * already had it proven under test — a fast-run counter, a settle timer so a
 * scanner that sends no Enter still commits, an injectable clock so tests are
 * deterministic, and a promise queue so a burst never drops or reorders a scan.
 * That kit is shelved (nothing imports it, it has no build, and its CSS tokens
 * do not exist at HEAD), so the logic is ported rather than revived.
 *
 * ## Routing
 *
 * When a burst lands, exactly one of three things is true about `activeElement`:
 *
 * | focus | what happens | why |
 * |---|---|---|
 * | inside `[data-scan-target]` | nothing — the field types natively and commits on its own Enter | it already has the value; intercepting would enter it twice |
 * | not editable at all (body, a button, a table) | intercepted and routed to the page's handler | the "just scan, it lands" case. Also stops Enter activating a focused button |
 * | some other editable field (a price, a note, a search box) | NOT intercepted — the serial is reported via `subscribeScanMiss` instead | see below |
 *
 * The third row is a deliberate trade-off. A burst cannot be recognised until
 * two characters have arrived, so intercepting mid-stream would always leak the
 * first characters into the wrong field, and they cannot be cleanly retracted
 * from a controlled React input or from antd `Select`'s internal search box.
 * Buffering every keystroke app-wide to avoid that leak would put a delay on
 * ALL typing, which is a worse bargain. So the scan is not stolen — but it is
 * not lost either: it is handed to whoever subscribes, which is what puts the
 * "use it" prompt on screen.
 *
 * Note this makes interception leak-free rather than best-effort: in the one
 * case where characters have somewhere to go, nothing is prevented.
 */

/** A scan's fate, as reported back by the page that handled it. */
export type ScanOutcome =
  | { readonly ok: true; readonly message?: string }
  | {
      readonly ok: false;
      readonly reason: "unknown" | "duplicate" | "rejected";
      readonly message?: string;
    };

export type ScanHandler = (
  serial: string,
) => ScanOutcome | Promise<ScanOutcome> | void | Promise<void>;

/** Where a detected burst ended up. Recorded so Settings can show it. */
export type ScanRoute = "target" | "routed" | "stray";

/** One detected scan, kept so the Settings panel can show real numbers. */
export interface ScanTiming {
  readonly serial: string;
  /** Gaps between the characters that were accepted into this burst. */
  readonly gaps: readonly number[];
  /**
   * Every gap seen since the previous scan, run-breaking ones included.
   *
   * `gaps` can only ever hold values below the threshold — that is what being
   * in the run means — so on its own it can never show why a scan came out
   * short. This can: a 61 ms spike sitting in the middle of a row of 3 ms gaps
   * is exactly the reading that says "raise the threshold".
   */
  readonly rawGaps: readonly number[];
  readonly route: ScanRoute;
}

export interface ScannerSettings {
  readonly enabled: boolean;
  /** Below this gap between characters, the input is a scanner, not a hand. */
  readonly burstGapMs: number;
  /** A run this long is a barcode; shorter fast runs are just quick typing. */
  readonly minChars: number;
  /** Silence after a burst that means the scanner has finished. */
  readonly settleMs: number;
}

export interface ScannerStatus {
  readonly enabled: boolean;
  /** Is a page listening for scans right now? */
  readonly hasTarget: boolean;
  /**
   * Would a scan *right now* reach the page?
   *
   * True when focus is in the registered field (it types straight in) or on
   * nothing editable at all (it gets routed). False only when focus sits in
   * some other text field, which is the one case a scan cannot be claimed —
   * and the case the chip exists to get the user out of.
   */
  readonly armed: boolean;
  readonly lastScan: ScanTiming | null;
}

/**
 * Defaults.
 *
 * The shelved component used 30 ms, which is right for hardware. `typeString`
 * on macOS is more variable than a hardware scanner, so this starts at 50 ms —
 * still comfortably below a hand, which even at 200 WPM is ~60 ms per
 * character and would have to hold that for `minChars` consecutive gaps.
 * Settings can move it once the live timings say what the phone really does.
 */
const DEFAULTS: ScannerSettings = {
  enabled: true,
  burstGapMs: 50,
  minChars: 4,
  settleMs: 80,
};

const STORAGE_KEY = "nusantara.scanner";

/**
 * Reads defensively, exactly as `theme/ThemeProvider.tsx` does: Safari throws
 * on `localStorage` in private browsing, and a scanner preference is not worth
 * taking the whole app down for.
 */
function readStoredSettings(): ScannerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const p = parsed as Partial<Record<keyof ScannerSettings, unknown>>;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULTS.enabled,
      burstGapMs: num(p.burstGapMs, DEFAULTS.burstGapMs, 5, 500),
      minChars: num(p.minChars, DEFAULTS.minChars, 2, 20),
      settleMs: num(p.settleMs, DEFAULTS.settleMs, 10, 1000),
    };
  } catch {
    return DEFAULTS;
  }
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fallback;
}

let settings: ScannerSettings = readStoredSettings();

export function getScannerSettings(): ScannerSettings {
  return settings;
}

export function setScannerSettings(patch: Partial<ScannerSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A preference that cannot be persisted still applies for this session.
  }
  publish({ enabled: settings.enabled });
}

// ---------------------------------------------------------------------------
// Status store — the same module-level `useSyncExternalStore` shape as
// mock/store.ts, so the detector lives outside React and survives StrictMode's
// double-mount without registering a second listener.
// ---------------------------------------------------------------------------

const statusListeners = new Set<() => void>();
let status: ScannerStatus = {
  enabled: settings.enabled,
  hasTarget: false,
  armed: false,
  lastScan: null,
};

/** Replace-on-change. The snapshot identity must be stable or React spins. */
function publish(patch: Partial<ScannerStatus>): void {
  const next = { ...status, ...patch };
  if (
    next.enabled === status.enabled &&
    next.hasTarget === status.hasTarget &&
    next.armed === status.armed &&
    next.lastScan === status.lastScan
  ) {
    return;
  }
  status = next;
  statusListeners.forEach((l) => l());
}

export function getScannerStatus(): ScannerStatus {
  return status;
}

export function subscribeScannerStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => void statusListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Target registration. A stack, so a modal's target takes precedence over the
// page behind it and hands control back when it unmounts.
// ---------------------------------------------------------------------------

interface Registration {
  handler: ScanHandler;
}

const targets: Registration[] = [];

export function registerScanTarget(handler: ScanHandler): () => void {
  const entry: Registration = { handler };
  targets.push(entry);
  syncFocusState();
  return () => {
    const i = targets.indexOf(entry);
    if (i !== -1) targets.splice(i, 1);
    syncFocusState();
  };
}

/**
 * A scan that was recognised but could not be delivered.
 *
 * Silence is the worst possible answer here. A scanner gives no feedback of its
 * own, so a scan that goes nowhere leaves the user unable to tell a flat
 * battery from a disconnected phone from a page that simply does not take
 * serials. Every recognised burst ends in either a handler or one of these.
 */
export interface ScanMiss {
  readonly serial: string;
  readonly reason:
    /** Recognised, but nothing on this page accepts a serial. */
    | "no-target"
    /** This page does take serials, but focus was in a different field. */
    | "other-field";
}

const missListeners = new Set<(miss: ScanMiss) => void>();

export function subscribeScanMiss(fn: (miss: ScanMiss) => void): () => void {
  missListeners.add(fn);
  return () => void missListeners.delete(fn);
}

function miss(serial: string, reason: ScanMiss["reason"]): void {
  missListeners.forEach((l) => l({ serial, reason }));
}

/**
 * The chip's click-to-reclaim, and the page's refocus-after-scan.
 *
 * A page that has a scan box gets focus put back in it. A page that has none —
 * Stock In routes scans into rows rather than into a field, so it deliberately
 * has no box — is re-armed instead by dropping focus out of whatever text
 * field was holding it, which is the actual thing standing in the way.
 */
export function focusScanTarget(): boolean {
  const host = document.querySelector<HTMLElement>("[data-scan-target]");
  const input =
    host instanceof HTMLInputElement
      ? host
      : (host?.querySelector<HTMLInputElement>("input") ?? null);
  if (input !== null) {
    input.focus();
    input.select();
    return true;
  }
  const active = document.activeElement;
  if (isEditable(active) && active instanceof HTMLElement) {
    active.blur();
    return true;
  }
  return false;
}

/**
 * Hand a serial to the current page as though it had been scanned. This is what
 * the "use it" action on a stray scan calls. Returns false when no page is
 * listening, so the caller can say so rather than dropping it silently.
 */
export function deliverScan(serial: string): boolean {
  const clean = serial.trim().toUpperCase();
  if (clean === "" || targets.length === 0) return false;
  route(clean);
  return true;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

let clock: () => number = () => performance.now();

let buffer: string[] = [];
let gaps: number[] = [];
/** Diagnostic only: every gap since the last commit, capped so it cannot grow. */
let rawGaps: number[] = [];
let lastKeyAt = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

/** Scans run strictly in order; a burst faster than a handler never drops one. */
let queue: Promise<void> = Promise.resolve();

/**
 * The last run of characters that arrived too fast to be a hand.
 *
 * Recorded for every route, not just the ones this module delivers. A burst
 * into a `[data-scan-target]` field is typed natively and never passes through
 * `route()` — which is precisely the case that needs remembering, because the
 * field it landed in is the one that has to tell a scan from a hand.
 */
let lastBurst: { text: string; at: number } | null = null;

/**
 * How long a burst stays claimable. Long enough to survive a page committing
 * the field it landed in, short enough that retyping the same serial by hand
 * ten minutes later is judged on its own.
 */
const BURST_CLAIM_MS = 5_000;

/**
 * Did this text arrive from a scanner rather than from somebody's hands?
 *
 * The owner's rule of 2026-09-01: *"if it is scanned (know it by the typing
 * speed), then validate with S"*. Speed is the only evidence there is — a
 * keyboard-wedge scanner sends keystrokes and nothing else — and this module
 * is already measuring it for the routing, so the question is answered from
 * the record rather than by timing the same characters twice.
 *
 * Compares the text as well as the timing. A burst is claimed by the field
 * holding what the burst said; a field holding something else was not the one
 * scanned into, whatever else was happening on the page.
 */
export function wasScannedText(value: string): boolean {
  if (lastBurst === null) return false;
  if (clock() - lastBurst.at > BURST_CLAIM_MS) return false;
  return lastBurst.text === value.trim().toUpperCase();
}

function isEditable(el: Element | null): boolean {
  if (el === null) return false;
  if (el instanceof HTMLInputElement) {
    // An <input type="button"> takes keystrokes but holds no text.
    return !["button", "checkbox", "radio", "submit", "reset", "file"].includes(
      el.type,
    );
  }
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function inScanTarget(el: Element | null): boolean {
  return el instanceof Element && el.closest("[data-scan-target]") !== null;
}

function reset(): void {
  clearTimeout(settleTimer);
  settleTimer = undefined;
  buffer = [];
  gaps = [];
}

function route(serial: string): void {
  const entry = targets[targets.length - 1];
  if (entry === undefined) {
    miss(serial, "no-target");
    return;
  }
  queue = queue.then(async () => {
    await entry.handler(serial);
  });
}

function commit(kind: ScanRoute): void {
  const serial = buffer.join("").trim().toUpperCase();
  const recorded = gaps.slice();
  const raw = rawGaps.slice();
  reset();
  if (serial.length < settings.minChars) return;
  rawGaps = [];
  lastBurst = { text: serial, at: clock() };

  publish({ lastScan: { serial, gaps: recorded, rawGaps: raw, route: kind } });

  if (kind === "routed") route(serial);
  else if (kind === "stray") {
    miss(serial, targets.length > 0 ? "other-field" : "no-target");
  }
  // "target" needs no delivery — the field typed it itself.
}

function onKeyDown(e: KeyboardEvent): void {
  if (!settings.enabled) return;
  // A shortcut is not a scan.
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const active = document.activeElement;
  const kind: ScanRoute = inScanTarget(active)
    ? "target"
    : isEditable(active)
      ? "stray"
      : "routed";

  if (e.key === "Enter") {
    // Only claim Enter when a burst is actually in flight, or a deliberate
    // Enter on a focused button would stop working.
    if (buffer.length >= settings.minChars) {
      if (kind === "routed") e.preventDefault();
      commit(kind);
    } else {
      reset();
    }
    return;
  }

  if (e.key.length !== 1) return; // Shift, Tab, arrows…

  const t = clock();
  const gap = t - lastKeyAt;
  lastKeyAt = t;

  rawGaps.push(Math.round(gap));
  if (rawGaps.length > 40) rawGaps.shift();

  if (gap < settings.burstGapMs && buffer.length > 0) {
    buffer.push(e.key);
    gaps.push(gap);
    // Once there is evidence of a burst, keep the characters off the page.
    // Only in the "routed" case, where they have nowhere useful to go anyway —
    // this is what keeps interception leak-free.
    if (kind === "routed") e.preventDefault();
  } else {
    buffer = [e.key];
    gaps = [];
  }

  // A settled burst commits itself, so a scanner that sends no Enter still
  // lands its serial.
  clearTimeout(settleTimer);
  if (buffer.length >= settings.minChars) {
    settleTimer = setTimeout(() => commit(kind), settings.settleMs);
  }
}

function syncFocusState(): void {
  const active = document.activeElement;
  publish({
    hasTarget: targets.length > 0,
    armed: targets.length > 0 && (inScanTarget(active) || !isEditable(active)),
  });
}

if (typeof document !== "undefined") {
  // Capture phase: seen before React's own handlers and before the element's
  // default, which is what makes preventDefault meaningful.
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", syncFocusState, true);
  document.addEventListener("focusout", syncFocusState, true);
}

/** Test seam: deterministic timing without waiting on a real clock. */
export function __setScannerClock(fn: () => number): void {
  clock = fn;
}

/** Test seam: clear all cross-test state. */
export function __resetScanner(): void {
  lastBurst = null;
  reset();
  lastKeyAt = 0;
  rawGaps = [];
  targets.length = 0;
  missListeners.clear();
  queue = Promise.resolve();
  settings = DEFAULTS;
  status = {
    enabled: true,
    hasTarget: false,
    armed: false,
    lastScan: null,
  };
}
