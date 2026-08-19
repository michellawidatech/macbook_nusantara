/**
 * Command palette — docs/rebuild/02-interaction.md §2.
 *
 * "⌘K / Ctrl+K — go to page, find SKU, find order, find serial." The palette
 * itself knows nothing about pages, SKUs or serials: it has a **pluggable
 * provider registry**, and whoever is mounted (the shell, the current page)
 * contributes commands for as long as it lives. That is what lets Increment 3
 * add "scan a serial from anywhere" without touching this file.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Overlay } from "./Overlay.js";
import { useShortcut } from "./shortcuts.js";
import styles from "./CommandPalette.module.css";

export interface Command {
  readonly id: string;
  readonly label: string;
  /** Small right-hand hint — a section name, a shortcut, a serial. */
  readonly hint?: string;
  readonly run: () => void;
}

export type CommandProvider = (query: string) => readonly Command[];

interface CommandRegistry {
  readonly register: (id: string, provider: CommandProvider) => () => void;
  readonly collect: (query: string) => readonly Command[];
  /** The palette re-renders when providers come and go — even while open. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly version: () => number;
}

const CommandContext = createContext<CommandRegistry | undefined>(undefined);

export function CommandRegistryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const providers = useRef(new Map<string, CommandProvider>());
  const listeners = useRef(new Set<() => void>());
  const version = useRef(0);

  const registry = useMemo<CommandRegistry>(() => {
    const notify = () => {
      version.current += 1;
      for (const listener of listeners.current) listener();
    };
    return {
      register: (id, provider) => {
        providers.current.set(id, provider);
        notify();
        return () => {
          providers.current.delete(id);
          notify();
        };
      },
      collect: (query) => {
        const out: Command[] = [];
        for (const provider of providers.current.values())
          out.push(...provider(query));
        return out;
      },
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      version: () => version.current,
    };
  }, []);

  return (
    <CommandContext.Provider value={registry}>
      {children}
    </CommandContext.Provider>
  );
}

function useCommandRegistry(): CommandRegistry {
  const ctx = useContext(CommandContext);
  if (ctx === undefined)
    throw new Error(
      "useCommandProvider dipakai di luar <CommandRegistryProvider>",
    );
  return ctx;
}

/** Contribute commands while this component is mounted. */
export function useCommandProvider(
  id: string,
  provider: CommandProvider,
): void {
  const registry = useCommandRegistry();
  const fresh = useRef(provider);
  fresh.current = provider;
  useEffect(
    () => registry.register(id, (q) => fresh.current(q)),
    [registry, id],
  );
}

/** Case-insensitive substring match — fancy ranking can come when it is missed. */
export function matchCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...commands];
  return commands.filter((c) => c.label.toLowerCase().includes(q));
}

export function CommandPalette() {
  const registry = useCommandRegistry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  // A provider mounting or unmounting re-renders the open palette, so its
  // list is never stale.
  useSyncExternalStore(registry.subscribe, registry.version);

  useShortcut({
    combo: "mod+k",
    description: "Palet perintah — cari halaman, SKU, order, serial",
    handler: () => {
      setQuery("");
      setActive(0);
      setOpen(true);
    },
  });

  const results = open ? matchCommands(registry.collect(query), query) : [];
  const clamped = Math.min(active, Math.max(0, results.length - 1));

  const runCommand = (command: Command | undefined) => {
    if (command === undefined) return;
    setOpen(false);
    command.run();
  };

  return (
    <Overlay
      open={open}
      onOpenChange={setOpen}
      title="Palet perintah"
      variant="dialog"
    >
      <input
        className={styles.input}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={
          results.length === 0 ? undefined : `${listId}-${clamped}`
        }
        aria-label="Cari perintah"
        placeholder="Ketik untuk mencari…"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            runCommand(results[clamped]);
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label="Hasil" className={styles.list}>
        {results.map((command, i) => (
          <li
            key={command.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === clamped}
            className={i === clamped ? styles.optionActive : styles.option}
            onMouseEnter={() => setActive(i)}
          >
            <button
              type="button"
              className={styles.optionButton}
              tabIndex={-1}
              onClick={() => runCommand(command)}
            >
              <span>{command.label}</span>
              {command.hint === undefined ? null : (
                <span className={styles.hint}>{command.hint}</span>
              )}
            </button>
          </li>
        ))}
        {results.length === 0 ? (
          <li className={styles.empty}>Tidak ada perintah yang cocok.</li>
        ) : null}
      </ul>
    </Overlay>
  );
}
