/**
 * State that survives a reload, on this device.
 *
 * Two owner asks share it: the nav's rail and its open sections (2026-09-15),
 * and the order form's auto-save — *"Add an auto-save mechanism and a save
 * draft Invoice fallback for every step"* (2026-09-15). There were briefly two
 * hooks of this name in two folders; one is enough, and two called the same
 * thing is a wrong import waiting to happen.
 *
 * The store already saves everything that has somewhere to go. This is for
 * what does not yet: an invoice with no supplier, a nav preference that
 * belongs to a desk rather than to a person.
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
 */
import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export function usePersistentState<T>(
  key: string,
  initial: T | (() => T),
  parse?: (stored: unknown) => T | undefined,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => {
    const fallback = () =>
      typeof initial === "function" ? (initial as () => T)() : initial;
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback();
      const parsed: unknown = JSON.parse(stored);
      if (parse === undefined) return parsed as T;
      const checked = parse(parsed);
      return checked === undefined ? fallback() : checked;
    } catch {
      return fallback();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage refused. The state still works; it just will not outlive the
      // page, which is what it did before this hook existed.
    }
  }, [key, value]);

  /** Forget what is stored. The state in memory is the caller's to reset. */
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing reachable to remove, which is the goal anyway.
    }
  }, [key]);

  return [value, setValue, clear];
}
