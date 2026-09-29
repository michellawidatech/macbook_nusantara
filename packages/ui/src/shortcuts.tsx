/**
 * The shortcut registry — docs/rebuild/02-interaction.md §2.
 *
 * "A shortcut that only works when a specific element has focus is not a
 * shortcut. Register on the page, not the input." So there is one window-level
 * listener, owned by this provider, and pages declare what they mean with
 * `useShortcut` — which simultaneously binds the key and feeds the `?` help
 * sheet, so the help can never drift from the behaviour.
 *
 * The other §2 rule enforced centrally: "Never bind a bare letter key while a
 * text input has focus." Bare keys (letters, `/`, `?`) are ignored when the
 * event target is editable; modifier combos still fire.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export interface ShortcutSpec {
  /** "mod+k", "alt+1", "/", "?", "n", "mod+enter" — mod is ⌘ or Ctrl. */
  readonly combo: string;
  /** Shown verbatim in the `?` help sheet. */
  readonly description: string;
  /** "Global" (default) or the page's name — the help sheet groups by this. */
  readonly group?: string;
  readonly handler: (event: KeyboardEvent) => void;
  readonly enabled?: boolean;
}

interface Registration extends ShortcutSpec {
  readonly id: number;
}

interface ShortcutRegistry {
  readonly register: (spec: ShortcutSpec) => () => void;
  readonly list: () => readonly Registration[];
}

const ShortcutContext = createContext<ShortcutRegistry | undefined>(undefined);

interface ParsedCombo {
  readonly key: string;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1] ?? "";
  return {
    key,
    mod: parts.includes("mod"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
  };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function matches(event: KeyboardEvent, combo: ParsedCombo): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (combo.mod !== mod) return false;
  if (combo.alt !== event.altKey) return false;
  // `?` already needs Shift on most layouts; only explicit `shift+` is checked.
  if (combo.shift && !event.shiftKey) return false;
  return event.key.toLowerCase() === combo.key;
}

export function ShortcutProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  // A ref, not state: registrations change on every route mount and none of
  // that needs a render here.
  const registrations = useRef<Registration[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = isEditable(event.target);
      // Latest registration wins: a page shortcut shadows a global one for as
      // long as the page is mounted.
      for (let i = registrations.current.length - 1; i >= 0; i -= 1) {
        const reg = registrations.current[i];
        if (reg === undefined || reg.enabled === false) continue;
        const combo = parseCombo(reg.combo);
        // §2: a bare key never fires from inside a text input.
        if (editable && !combo.mod && !combo.alt) continue;
        if (!matches(event, combo)) continue;
        event.preventDefault();
        reg.handler(event);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const registry = useMemo<ShortcutRegistry>(
    () => ({
      register: (spec) => {
        const entry: Registration = { ...spec, id: nextId.current++ };
        registrations.current.push(entry);
        return () => {
          registrations.current = registrations.current.filter(
            (r) => r.id !== entry.id,
          );
        };
      },
      list: () => [...registrations.current],
    }),
    [],
  );

  return (
    <ShortcutContext.Provider value={registry}>
      {children}
    </ShortcutContext.Provider>
  );
}

export function useShortcutRegistry(): ShortcutRegistry {
  const ctx = useContext(ShortcutContext);
  if (ctx === undefined)
    throw new Error("useShortcut dipakai di luar <ShortcutProvider>");
  return ctx;
}

/**
 * Bind a shortcut for this component's lifetime, and list it under `?`.
 *
 * Outside a <ShortcutProvider> the shortcut is inert rather than fatal: a page
 * rendered bare — in a test, in isolation — must render, not crash. The shell
 * furniture (KeyboardHelp, CommandPalette) still requires the provider,
 * because mounting those without it IS a wiring mistake.
 */
export function useShortcut(spec: ShortcutSpec): void {
  const registry = useContext(ShortcutContext);
  // The handler is kept fresh through a ref so callers may pass inline
  // closures without re-registering (and re-ordering) every render.
  const handler = useRef(spec.handler);
  handler.current = spec.handler;

  const { combo, description, group, enabled } = spec;
  useEffect(() => {
    if (registry === undefined) return;
    return registry.register({
      combo,
      description,
      group,
      enabled,
      handler: (e) => handler.current(e),
    });
  }, [registry, combo, description, group, enabled]);
}

/** Human form of a combo for the help sheet: `mod+k` → `⌘K` or `Ctrl+K`. */
export function formatCombo(combo: string): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iP(hone|ad|od)/.test(navigator.platform);
  return combo
    .split("+")
    .map((part) => {
      if (part === "mod") return isMac ? "⌘" : "Ctrl";
      if (part === "alt") return isMac ? "⌥" : "Alt";
      if (part === "shift") return "Shift";
      if (part === "enter") return "Enter";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(isMac ? "" : "+");
}
