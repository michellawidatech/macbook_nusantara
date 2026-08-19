/**
 * Overlay — docs/rebuild/02-interaction.md §3.
 *
 * One primitive, two shapes: a right-hand drawer and a centred dialog. Radix
 * supplies what must be correct by default (01 §1): the focus trap, focus on
 * the first control at open, and focus returned to the opener at close.
 *
 * The clause this component exists for: overlays "close on Esc and on outside
 * click **unless they hold unsaved input**, in which case outside click is
 * ignored and Esc asks once." `dirty` is that flag. The first Esc shows the
 * question inline; the second closes. Any edit re-arms the question.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import styles from "./Overlay.module.css";

export interface OverlayProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly variant?: "drawer" | "dialog";
  /** Holds unsaved input (§3): outside click ignored, Esc asks once. */
  readonly dirty?: boolean;
  readonly children: ReactNode;
}

export function Overlay({
  open,
  onOpenChange,
  title,
  variant = "dialog",
  dirty = false,
  children,
}: OverlayProps) {
  // Esc has been pressed once while dirty; the next one closes.
  const [escArmed, setEscArmed] = useState(false);

  // §3: "Overlay closes → focus goes to the control that opened it." Owned
  // here rather than delegated: Radix restores focus in most browsers, but a
  // controlled Root with no Trigger is exactly the case where it can miss, and
  // this contract is too important to depend on library internals.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      return;
    }
    const el = opener.current;
    if (el === null) return;
    opener.current = null;
    // After Radix's own teardown, so the two never fight.
    const id = setTimeout(() => el.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // Re-arm whenever the overlay reopens or its dirtiness changes: "asks once"
  // is once per question, not once per lifetime.
  useEffect(() => {
    setEscArmed(false);
  }, [open, dirty]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.backdrop} />
        <Dialog.Content
          className={variant === "drawer" ? styles.drawer : styles.dialog}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (dirty && !escArmed) {
              e.preventDefault();
              setEscArmed(true);
            }
          }}
          onInteractOutside={(e) => {
            if (dirty) e.preventDefault();
          }}
        >
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close className={styles.close} aria-label="Tutup">
              ×
            </Dialog.Close>
          </header>

          {escArmed ? (
            <p className={styles.escWarning} role="alert">
              Perubahan belum disimpan — tekan Esc sekali lagi untuk menutup.
            </p>
          ) : null}

          <div className={styles.body}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
