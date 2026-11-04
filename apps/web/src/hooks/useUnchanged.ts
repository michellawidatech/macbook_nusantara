/**
 * "Nothing changed" — the test behind every grey Save (owner list
 * 2026-11-03: *"if nothing changes, the button should be grey. This is true
 * for all action button that saves / changes state"*).
 *
 * The value a dialog opened with is captured on first render and again
 * whenever `resetKey` changes (the record being edited), and compared
 * structurally with what the form holds now.
 */
import { useEffect, useRef, useState } from "react";

/** Structural equality: arrays by order, objects by key, `undefined` = absent. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!sameValue(ra[k], rb[k])) return false;
  return true;
}

export function useUnchanged<T>(
  initial: T,
  current: T,
  resetKey?: string | number,
): boolean {
  const held = useRef<{ key: string | number | undefined; value: T } | null>(
    null,
  );
  if (held.current === null || held.current.key !== resetKey)
    held.current = { key: resetKey, value: initial };
  return sameValue(held.current.value, current);
}

/**
 * The same question for a dialog that LOADS its fields in an effect when it
 * opens (most edit dialogs here). What it opened with is the state on the
 * render right after that effect ran — so call this AFTER the dialog's own
 * load `useEffect`, whose effects run first. True until then.
 */
export function useOpenedWith<T>(current: T, key: unknown): boolean {
  const held = useRef<{
    key: unknown;
    armed: boolean;
    captured: boolean;
    value?: T;
  }>({ key: undefined, armed: false, captured: false });
  const [, bump] = useState(0);
  const h = held.current;
  if (h.key !== key) {
    held.current = { key, armed: false, captured: false };
  } else if (h.armed && !h.captured) {
    h.value = current;
    h.captured = true;
  }
  useEffect(() => {
    const now = held.current;
    if (!now.armed && !now.captured) {
      now.armed = true;
      bump((n) => n + 1);
    }
  });
  const now = held.current;
  return now.captured ? sameValue(now.value, current) : true;
}
