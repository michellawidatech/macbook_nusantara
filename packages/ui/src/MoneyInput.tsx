/**
 * Money input — docs/rebuild/02-interaction.md §9 and §5.
 *
 * "Money inputs accept what people type: 4200000, 4.200.000, 4,2jt, 4200rb.
 * Normalize on blur and show the formatted result." Parsing is the domain
 * layer's parseRupiah — this component adds no arithmetic of its own, and the
 * value that leaves it is a BigInt or null, never a number.
 *
 * Error handling per §5: validate on blur, show the error under the field,
 * keep the value, never clear the input.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatNumber, parseRupiah } from "@nusantara/domain";
import styles from "./MoneyInput.module.css";

const REASONS: Record<string, string> = {
  // KOSONG is not an error: an empty optional field is simply null.
  FORMAT: "Format tidak dikenali — contoh: 4.200.000 atau 4,2jt.",
  PECAHAN: "Harus rupiah bulat, tanpa pecahan.",
};

export interface MoneyInputProps {
  readonly label: ReactNode;
  readonly value: bigint | null;
  readonly onChange: (value: bigint | null) => void;
  /** §5: a server error that maps to this field renders here, not in a toast. */
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly name?: string;
}

/** The editable text for a committed value: plain grouped digits. */
function textOf(value: bigint | null): string {
  return value === null ? "" : formatNumber(value);
}

export function MoneyInput({
  label,
  value,
  onChange,
  error,
  required = false,
  disabled = false,
  autoFocus = false,
  name,
}: MoneyInputProps) {
  const [text, setText] = useState(() => textOf(value));
  const [parseError, setParseError] = useState<string | null>(null);
  const focused = useRef(false);
  const errorId = useId();
  const labelId = useId();

  // An outside change (draft restore, reset) updates the text — but never
  // under the user's cursor while they are typing (02 §3: async content
  // arriving must not fight a typing user).
  useEffect(() => {
    if (!focused.current) {
      setText(textOf(value));
      setParseError(null);
    }
  }, [value]);

  const commit = () => {
    focused.current = false;
    const trimmed = text.trim();
    if (trimmed === "") {
      setParseError(required ? "Wajib diisi." : null);
      onChange(null);
      return;
    }
    const parsed = parseRupiah(trimmed);
    if (!parsed.ok) {
      // Keep the text exactly as typed; name the fix (§5).
      setParseError(
        parsed.reason === "KOSONG" ? null : (REASONS[parsed.reason] ?? null),
      );
      return;
    }
    setParseError(null);
    setText(formatNumber(parsed.value)); // normalize on blur, show the result
    onChange(parsed.value);
  };

  const message = error ?? parseError;

  return (
    // Not a wrapping <label>: the "Rp" prefix inside one would leak into the
    // accessible name ("HargaRp"). Explicit aria-labelledby keeps the name
    // exactly the label text.
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.inputWrap}>
        <span className={styles.prefix} aria-hidden="true">
          Rp
        </span>
        <input
          className={message === null ? styles.input : styles.inputInvalid}
          aria-labelledby={labelId}
          name={name}
          inputMode="numeric"
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          aria-invalid={message !== null}
          aria-describedby={message === null ? undefined : errorId}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Enter commits without leaving the field — the PO screen tabs on.
            if (e.key === "Enter") commit();
          }}
        />
      </div>
      <span id={errorId} className={styles.error} role="alert">
        {message}
      </span>
    </div>
  );
}
