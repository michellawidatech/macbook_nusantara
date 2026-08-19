/**
 * ScanField — docs/rebuild/02-interaction.md §2, "Barcode scanners".
 *
 * "A scanner is a keyboard that types very fast and ends with Enter. Treat it
 * as a first-class input." The owner's answer to open question 3: serials are
 * mostly scanned but sometimes hand-typed from a photo or a worn label — so
 * this field is lenient. Typing submits on Enter like anything else; there is
 * no format wall, because a typo surfaces as "serial tidak dikenal" with
 * inline recovery, which is more honest than a validator's guess.
 *
 * The contract, line by line:
 *   - focused on mount, re-focused after every scan;
 *   - a "Scanner siap" chip reclaims focus when it is lost to a stray click;
 *   - bursts (< 30 ms between characters) are detected and committed
 *     immediately after the burst ends, without waiting for Enter — some
 *     scanners do not send one;
 *   - unknown serial is a recoverable state, not an error dialog: the value
 *     stays in the field, selected, with the consumer's recovery actions
 *     inline, and focus never leaves;
 *   - a duplicate scan errors nothing — the consumer highlights its existing
 *     line; here it announces politely and keeps going;
 *   - scans queue: a burst faster than the handler never drops one.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./ScanField.module.css";

export type ScanOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "unknown" | "duplicate";
      /** §5: name the record. Defaults name the serial if omitted. */
      readonly message?: string;
    };

export interface ScanRecoveryAction {
  readonly label: string;
  readonly run: (serial: string) => void;
}

export interface ScanFieldProps {
  readonly label: ReactNode;
  readonly onScan: (serial: string) => ScanOutcome | Promise<ScanOutcome>;
  /** Rendered inline on an unknown serial — e.g. Cari manual / Tambah unit. */
  readonly recoveryActions?: readonly ScanRecoveryAction[];
  readonly placeholder?: string;
  /** Injectable clock for deterministic burst tests (same idea as withRetry). */
  readonly now?: () => number;
}

/** Below this gap between characters, the input is a scanner, not a hand. */
const BURST_GAP_MS = 30;
/** A burst this long is a barcode; shorter fast runs are just quick typing. */
const BURST_MIN_CHARS = 4;
/** Silence after a burst that means the scanner has finished. */
const BURST_SETTLE_MS = 60;

export function ScanField({
  label,
  onScan,
  recoveryActions = [],
  placeholder,
  now = () => performance.now(),
}: ScanFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [failure, setFailure] = useState<{
    serial: string;
    outcome: Extract<ScanOutcome, { ok: false }>;
  } | null>(null);

  // Burst detection state lives in refs: it changes per keystroke and must
  // never cause a render (02 §1, < 50 ms keystroke budget).
  const lastKeyAt = useRef(0);
  const fastRun = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Scans are processed strictly in order; a new scan awaits the queue tail.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(settleTimer.current);
  }, []);

  const submit = useCallback(
    (raw: string) => {
      clearTimeout(settleTimer.current);
      fastRun.current = 0;
      const serial = raw.trim().toUpperCase();
      if (serial === "") return;

      queue.current = queue.current.then(async () => {
        const outcome = await onScan(serial);
        const input = inputRef.current;

        if (outcome.ok) {
          setFailure(null);
          if (input !== null) input.value = "";
        } else if (outcome.reason === "unknown") {
          // Recoverable state: value stays, selected for correction or reuse
          // by the recovery actions. The next scan overwrites it.
          setFailure({ serial, outcome });
          if (input !== null) {
            input.value = serial;
            input.select();
          }
        } else {
          // Duplicate: announce and keep going — a double scan is a hand
          // slip, not an intent to buy two (§2).
          setFailure({ serial, outcome });
          if (input !== null) input.value = "";
        }

        // Re-focused after every scan, whatever the outcome.
        input?.focus();
      });
    },
    [onScan],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Enter never submits a surrounding form (§2)
      submit(e.currentTarget.value);
      return;
    }
    if (e.key.length !== 1) return;

    const t = now();
    fastRun.current =
      t - lastKeyAt.current < BURST_GAP_MS ? fastRun.current + 1 : 1;
    lastKeyAt.current = t;

    // A settled burst commits itself: scanners that do not send Enter still
    // land their serial, and a scanned code skips any debounce (§2).
    clearTimeout(settleTimer.current);
    if (fastRun.current >= BURST_MIN_CHARS) {
      const input = e.currentTarget;
      settleTimer.current = setTimeout(
        () => submit(input.value),
        BURST_SETTLE_MS,
      );
    }
  };

  const message =
    failure === null
      ? null
      : (failure.outcome.message ??
        (failure.outcome.reason === "unknown"
          ? `Serial ${failure.serial} tidak dikenal.`
          : `Serial ${failure.serial} sudah dipindai.`));

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{label}</span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </label>
        {/* Focus is the scanner's lifeline. When it is lost, say so and make
            getting it back one click (§2). */}
        <button
          type="button"
          className={focused ? styles.readyChip : styles.reclaimChip}
          onClick={() => inputRef.current?.focus()}
          tabIndex={-1}
          aria-hidden={focused}
        >
          {focused ? "Scanner siap" : "Klik untuk scan"}
        </button>
      </div>

      {/* Announced politely; never a focus trap (§3). */}
      <div className={styles.messages} aria-live="polite">
        {message === null ? null : (
          <span
            className={
              failure?.outcome.reason === "unknown"
                ? styles.unknown
                : styles.duplicate
            }
            data-testid="scan-message"
          >
            {message}
            {failure?.outcome.reason === "unknown"
              ? recoveryActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className={styles.recovery}
                    onClick={() => {
                      action.run(failure.serial);
                      setFailure(null);
                      const input = inputRef.current;
                      if (input !== null) input.value = "";
                      input?.focus();
                    }}
                  >
                    {action.label}
                  </button>
                ))
              : null}
          </span>
        )}
      </div>
    </div>
  );
}
