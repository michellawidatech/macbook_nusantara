/**
 * The keyboard help sheet — docs/rebuild/02-interaction.md §2.
 *
 * `?` lists this page's shortcuts. The list is read live from the registry, so
 * whatever the current page registered is what appears — the sheet cannot go
 * stale, because it has no content of its own.
 */

import { useState } from "react";
import { Overlay } from "./Overlay.js";
import { formatCombo, useShortcut, useShortcutRegistry } from "./shortcuts.js";
import styles from "./KeyboardHelp.module.css";

export function KeyboardHelp() {
  const registry = useShortcutRegistry();
  const [open, setOpen] = useState(false);

  useShortcut({
    combo: "?",
    description: "Bantuan pintasan keyboard",
    handler: () => setOpen(true),
  });

  // Snapshot on render while open; grouped, Global first.
  const groups = new Map<string, { combo: string; description: string }[]>();
  if (open) {
    for (const reg of registry.list()) {
      const group = reg.group ?? "Global";
      const list = groups.get(group) ?? [];
      list.push({ combo: reg.combo, description: reg.description });
      groups.set(group, list);
    }
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === "Global" ? -1 : b === "Global" ? 1 : a.localeCompare(b),
  );

  return (
    <Overlay
      open={open}
      onOpenChange={setOpen}
      title="Pintasan keyboard"
      variant="dialog"
    >
      {ordered.map(([group, entries]) => (
        <section key={group} className={styles.group}>
          <h3 className={styles.groupTitle}>{group}</h3>
          <dl className={styles.list}>
            {entries.map((entry) => (
              <div key={`${group}:${entry.combo}`} className={styles.row}>
                <dt>
                  <kbd className={styles.kbd}>{formatCombo(entry.combo)}</kbd>
                </dt>
                <dd className={styles.description}>{entry.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Overlay>
  );
}
