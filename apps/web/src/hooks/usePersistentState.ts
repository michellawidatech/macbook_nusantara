/**
 * State that survives a reload, on this device.
 *
 * Two owner asks share it: the nav's rail and its open sections (2026-09-15),
 * and the order form's auto-save — *"Add an auto-save mechanism and a save
 * draft Invoice fallback for every step"* (2026-09-15). There were briefly two
 * hooks of this name in two folders; one is enough, and two called the same
 * thing is a wrong import waiting to happen.
 *
 * Since 2026-09-21 it is also where work in progress lives. The owner asked
 * for the in-app tab strip to go — *"the user must be able to drag the feature
 * and open it in another tab and all the things of the user input will be
 * saved locally"* — and the strip was what kept a half-built sale alive while
 * somebody glanced at Inventory. A page now keeps its drafts here instead
 * (`draftKey`), which outlives a navigation, a reload and the browser tab.
 *
 * The store already saves everything that has somewhere to go. This is for
 * what does not yet: a sale not rung up, an invoice with no supplier, a nav
 * preference that belongs to a desk rather than to a person.
 *
 * `localStorage`, and every read and write is wrapped. Safari throws on it in
 * private browsing, a full quota throws on write, and a preference is never
 * worth taking the shell down for — a refusal degrades to ordinary state,
 * which is exactly what the caller had before this hook existed.
 *
 * `parse` is the guard on what comes back. What is stored was written by
 * whatever build the browser last ran, so a value it does not recognise has to
 * fall back to `initial` rather than reach a component as a shape it cannot
 * render. Omitting it trusts the stored JSON, which is right only for a value
 * whose every shape is renderable — a boolean, a string.
 *
 * ## Two tabs, one value
 *
 * Every tab of this device reads the same key, and a page open in two of them
 * would otherwise keep two copies in memory and let whichever wrote last
 * silently erase the other. So a write in one tab is taken up by the others
 * (the `storage` event). Writing back the identical text fires no event, so
 * the two never ping-pong.
 *
 * ## A key that changes
 *
 * `/inbound/po-1` and `/inbound/po-2` are the same mounted component, so a key
 * built from a route parameter changes under a live component. The value is
 * re-read for the new key rather than carried across to it.
 *
 * A `null` key is ordinary state: nothing is read or written. That is for a
 * shared component — a list — whose caller decides whether it is worth
 * keeping, without the component needing two code paths.
 */
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

/** Where a page keeps work in progress. One prefix, so it can be found. */
export function draftKey(name: string): string {
  return `nusantara.draft.${name}`;
}

function read<T>(
  key: string | null,
  initial: T | (() => T),
  parse?: (stored: unknown) => T | undefined,
): T {
  const fallback = () =>
    typeof initial === "function" ? (initial as () => T)() : initial;
  if (key === null) return fallback();
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback();
    return decode(stored, parse) ?? fallback();
  } catch {
    return fallback();
  }
}

function decode<T>(
  text: string,
  parse?: (stored: unknown) => T | undefined,
): T | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parse === undefined ? (parsed as T) : parse(parsed);
  } catch {
    return undefined;
  }
}

export function usePersistentState<T>(
  key: string | null,
  initial: T | (() => T),
  parse?: (stored: unknown) => T | undefined,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [held, setHeld] = useState<{ key: string | null; value: T }>(() => ({
    key,
    value: read(key, initial, parse),
  }));

  // A new key under a live component: read it, during render, so the first
  // paint for the new key already shows its own value.
  let current = held;
  if (held.key !== key) {
    current = { key, value: read(key, initial, parse) };
    setHeld(current);
  }

  useEffect(() => {
    if (key === null || current.key !== key) return;
    try {
      // Nothing is removed rather than written: `JSON.stringify(undefined)`
      // is not JSON, and the other tabs read a removal as "back to the start".
      if (current.value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(current.value));
    } catch {
      // Storage refused. The state still works; it just will not outlive the
      // page, which is what it did before this hook existed.
    }
  }, [key, current]);

  // Another tab wrote this key: take its value up. A removal is a draft
  // finished or thrown away over there, and here it goes back to the start.
  useEffect(() => {
    if (key === null) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      // A removal is taken up even when the start is "nothing" — a customer
      // cleared over there is cleared here.
      if (e.newValue === null) {
        setHeld({ key, value: read(key, initial, parse) });
        return;
      }
      const next = decode(e.newValue, parse);
      if (next !== undefined) setHeld({ key, value: next });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // `initial` and `parse` are the caller's constants; re-subscribing on
    // every render for them would drop events between the two listeners.
  }, [key]);

  const setValue: Dispatch<SetStateAction<T>> = useCallback(
    (action) =>
      setHeld((prev) => ({
        key: prev.key,
        value:
          typeof action === "function"
            ? (action as (was: T) => T)(prev.value)
            : action,
      })),
    [],
  );

  /** Forget what is stored. The state in memory is the caller's to reset. */
  const clear = useCallback(() => {
    if (key === null) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing reachable to remove, which is the goal anyway.
    }
  }, [key]);

  return [current.value, setValue, clear];
}
