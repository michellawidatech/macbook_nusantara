/**
 * The keyboard, app-wide (owner ask 2026-09-15): Enter moves to the next field,
 * `/` jumps to the page's search box, `?` lists every shortcut.
 *
 * Mounted once, from `main.tsx`, so every screen has it without being wired
 * up — and so a page rendered on its own in a test does not, which keeps every
 * existing keystroke test meaning what it meant when it was written. The grid
 * arrows and the list rows are not here: `EditableTable` and `DataTable` own
 * those, because they know which rows are theirs. The decisions themselves are
 * `lib/keyboardNav.ts`.
 *
 * ## Why Enter is read twice
 *
 * CAPTURE, before any component sees the key, is the only moment the DOM is
 * still the DOM the person pressed Enter in: which field, what it held, whether
 * its list was open, and whether this Enter is the tail of a scanner burst.
 *
 * BUBBLE, after the field's own handler, is when to act — so a box that commits
 * on Enter (the QC serial, a battery reading, a price) commits FIRST, and a
 * handler that answered the key itself (`preventDefault`) or put the caret
 * somewhere on purpose is left alone. The move itself waits one microtask more,
 * until React has rendered what the commit changed.
 *
 * A closed Select is the exception, and is taken in capture: rc-select opens
 * its list on Enter and calls `preventDefault` as it does, so by the bubble
 * phase the key is claimed and the list is on its way up.
 */
import { useEffect, useState } from "react";
import { getScannerStatus } from "../lib/scanner";
import {
  enterFieldKind,
  focusControl,
  hasCommandModifier,
  isComposing,
  isTypingTarget,
  locateField,
  NAV_OFF_SELECTOR,
  pageSearchBox,
  planEnter,
  relocateField,
  shouldHandleEnter,
  valueOf,
  type EnterPlan,
  type FieldLocator,
} from "../lib/keyboardNav";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";

/**
 * How soon after the keystroke before it an Enter can still be the end of a
 * scan.
 *
 * `lib/scanner.ts` publishes a new `lastScan` the moment a burst commits —
 * usually on the scanner's own Enter, or 80 ms after the last character when
 * the settle timer gets there first. A scanner sends its Enter within
 * milliseconds either way; somebody reading back what they typed before
 * pressing Enter takes longer than a second. Without the window, a scanner
 * that sends no Enter would leave its "scan just ended" standing until the
 * next key, and the first Enter pressed by hand afterwards would not move.
 */
const SCAN_ENTER_WINDOW_MS = 1_000;

interface PendingEnter {
  readonly event: KeyboardEvent;
  readonly field: HTMLElement;
  /** What the field held before its own handler ran. */
  readonly value: string;
  readonly locator: FieldLocator;
}

export interface KeyboardNavOptions {
  /** `?` outside a field. */
  readonly onHelp: () => void;
}

/** Installs the listeners; returns the uninstall. Exported for the tests. */
export function installKeyboardNav({ onHelp }: KeyboardNavOptions): () => void {
  let seenScan = getScannerStatus().lastScan;
  let lastKeyAt = Number.NEGATIVE_INFINITY;
  let pending: PendingEnter | null = null;

  const run = (plan: EnterPlan) => {
    if (plan.kind === "click") plan.target.click();
    else focusControl(plan.target);
  };

  const onCapture = (e: KeyboardEvent) => {
    // Registered after the scanner's own capture listener (that module installs
    // itself on import, and this one imports it), so a burst this Enter ends
    // has already been committed and published by the time this runs.
    const now = performance.now();
    const scan = getScannerStatus().lastScan;
    const endsScan =
      scan !== null && scan !== seenScan && now - lastKeyAt <= SCAN_ENTER_WINDOW_MS;
    seenScan = scan;
    lastKeyAt = now;
    pending = null;

    const field = e.target;
    // A scanner's Enter keeps its native meaning: the till, the count and the
    // QC bench scan machine after machine into one box, and the box commits
    // the serial on that Enter.
    if (endsScan || e.defaultPrevented || !shouldHandleEnter(e, field)) return;
    // Nowhere to go — Enter keeps whatever it meant before.
    const plan = planEnter(field);
    if (plan === null) return;

    if (enterFieldKind(field) === "combobox") {
      // Somebody mid-word in a searchable Select is picking, not leaving. An
      // AutoComplete's text IS its value, so it has no such state.
      const autoComplete = field.closest(".ant-select-auto-complete") !== null;
      if (!autoComplete && valueOf(field) !== "") return;
      e.preventDefault();
      e.stopPropagation();
      run(plan);
      return;
    }
    pending = {
      event: e,
      field,
      value: valueOf(field),
      locator: locateField(field),
    };
  };

  /**
   * After the field's handler and the render it caused.
   *
   * Three outcomes keep the caret where it is, and each is a field saying so:
   * the field went `aria-invalid` (a refused serial, a battery reading out of
   * range — the person has to see it and fix it), the field EMPTIED itself
   * (an "add a value" box, which is waiting for the next value), or the render
   * moved focus elsewhere. When the field's row was re-keyed, the caret is put
   * back into the new field before anything else is decided.
   */
  const settle = (enter: PendingEnter) => {
    const doc = enter.field.ownerDocument;
    const active = doc.activeElement;
    let field: HTMLElement | null = enter.field;
    if (field.isConnected) {
      if (active !== field) return;
    } else {
      if (active !== null && active !== doc.body) return;
      field = relocateField(enter.locator);
      if (field === null) return;
    }
    const refused = field.getAttribute("aria-invalid") === "true";
    const consumed = enter.value.trim() !== "" && valueOf(field) === "";
    const plan = refused || consumed ? null : planEnter(field);
    if (plan !== null) run(plan);
    else if (doc.activeElement !== field) focusControl(field, "end");
  };

  const onBubble = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const enter = pending;
      pending = null;
      if (enter === null || enter.event !== e || e.defaultPrevented) return;
      const doc = enter.field.ownerDocument;
      const active = doc.activeElement;
      // The handler put the caret somewhere on purpose — a count box handing
      // focus back to the page, a dialog opening. A field that simply vanished
      // under a re-render leaves focus on <body>, and that is not a decision.
      if (
        enter.field.isConnected
          ? active !== enter.field
          : active !== null && active !== doc.body
      ) {
        return;
      }
      // Now, not in the microtask: this is what stops the browser's implicit
      // form submission, and the keypress that would otherwise reach whatever
      // gets focus next.
      e.preventDefault();
      queueMicrotask(() => settle(enter));
      return;
    }

    if (e.key !== "/" && e.key !== "?") return;
    if (e.defaultPrevented || hasCommandModifier(e) || isComposing(e)) return;
    const active = document.activeElement;
    if (isTypingTarget(active) || active?.closest(NAV_OFF_SELECTOR)) return;
    if (e.key === "?") {
      e.preventDefault();
      onHelp();
      return;
    }
    const box = pageSearchBox(document);
    if (box === null) return;
    // Before focus moves, or the "/" is typed into the box it just opened.
    e.preventDefault();
    focusControl(box);
  };

  document.addEventListener("keydown", onCapture, true);
  document.addEventListener("keydown", onBubble);
  return () => {
    document.removeEventListener("keydown", onCapture, true);
    document.removeEventListener("keydown", onBubble);
  };
}

export function KeyboardNav() {
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => installKeyboardNav({ onHelp: () => setHelpOpen(true) }), []);
  return (
    <KeyboardShortcutsModal
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
    />
  );
}
