/**
 * DraftStore — docs/rebuild/02-interaction.md §7.
 *
 * "Cart, PO lines and grading sessions autosave to localStorage on every
 * change, keyed by staff id. On mount, if a draft exists, show a quiet inline
 * bar: 'Draft dari 14:32 — Pulihkan / Buang.' Never auto-restore silently;
 * never discard silently either."
 *
 * Money survives: BigInt is serialized with a marker and revived, because a
 * cart draft that comes back with `number` prices has silently broken the
 * money rule (02 §9) in the one place nobody is looking.
 *
 * Storage is optional, not assumed — private browsing and some test
 * environments have none. A draft that cannot be saved costs a reload's worth
 * of typing, never a crash.
 */

import { useEffect, useRef, useState } from "react";
import styles from "./draft.module.css";

const BIGINT_MARKER = "$bigint";

interface StoredDraft {
  readonly savedAt: string;
  readonly json: string;
}

export function draftKey(staffId: string, entity: string): string {
  return `nusantara.draft.${staffId}.${entity}`;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? { [BIGINT_MARKER]: v.toString() } : v,
  );
}

function revive(json: string): unknown {
  return JSON.parse(json, (_k, v: unknown) => {
    if (
      v !== null &&
      typeof v === "object" &&
      BIGINT_MARKER in (v as Record<string, unknown>) &&
      typeof (v as Record<string, unknown>)[BIGINT_MARKER] === "string"
    ) {
      return BigInt((v as Record<string, string>)[BIGINT_MARKER] as string);
    }
    return v;
  });
}

export function saveDraft(
  key: string,
  value: unknown,
  now: Date = new Date(),
): void {
  try {
    const stored: StoredDraft = {
      savedAt: now.toISOString(),
      json: serialize(value),
    };
    globalThis.localStorage?.setItem(key, JSON.stringify(stored));
  } catch {
    // Quota or no storage: the live state is still on screen.
  }
}

export function loadDraft<T>(key: string): { value: T; savedAt: Date } | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return null;
    const stored = JSON.parse(raw) as StoredDraft;
    return {
      value: revive(stored.json) as T,
      savedAt: new Date(stored.savedAt),
    };
  } catch {
    // A corrupt draft is not worth an error dialog; it is simply not offered.
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/**
 * Autosave `value` under `key`, debounced. "On every change" (§7) means every
 * settled change — a 400 ms debounce keeps a fast typist from writing a draft
 * per keystroke while still surviving any crash more than half a second after
 * the last edit.
 */
export function useDraftAutosave(
  key: string,
  value: unknown,
  options: { readonly enabled?: boolean; readonly delayMs?: number } = {},
): void {
  const { enabled = true, delayMs = 400 } = options;
  const first = useRef(true);

  useEffect(() => {
    // The mount render is not an edit; saving it would overwrite a real draft
    // with the empty state the page just booted with.
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled) return;
    const id = setTimeout(() => saveDraft(key, value), delayMs);
    return () => clearTimeout(id);
  }, [key, value, enabled, delayMs]);
}

/**
 * Read the draft once, on mount. Deciding what to do with it is the user's,
 * via <DraftBar> — never the code's.
 */
export function useDraftOnMount<T>(
  key: string,
): { value: T; savedAt: Date } | null {
  const [draft] = useState(() => loadDraft<T>(key));
  return draft;
}

/** "Draft dari 14:32 — Pulihkan / Buang." Quiet, inline, and explicit. */
export function DraftBar({
  savedAt,
  onRestore,
  onDiscard,
}: {
  readonly savedAt: Date;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
}) {
  const time = savedAt.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={styles.bar} role="status">
      <span>Draft dari {time}</span>
      <button type="button" className={styles.action} onClick={onRestore}>
        Pulihkan
      </button>
      <button type="button" className={styles.discard} onClick={onDiscard}>
        Buang
      </button>
    </div>
  );
}
