/**
 * Multi-select facet filters and their chip bar — docs/rebuild/02-interaction.md §8.
 *
 * Extracted from InventoriPage verbatim: the <details>/<summary> facet with a
 * checkbox list, and the removable-chip bar with its Reset. "Filters are
 * multi-select by default"; "active filters render as removable chips above
 * the table with a Reset that clears all".
 */

import type { ReactNode } from "react";
import styles from "./filters.module.css";

export interface FacetOption {
  readonly id: string;
  readonly name: string;
  readonly count?: number;
}

export function FacetFilter({
  label,
  options,
  selected,
  onToggle,
}: {
  readonly label: string;
  readonly options: readonly FacetOption[];
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
}) {
  return (
    <details className={styles.facet}>
      <summary className={styles.facetSummary}>
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <fieldset className={styles.facetList}>
        <legend className={styles.srOnly}>{label}</legend>
        {options.map((option) => (
          <label key={option.id} className={styles.facetOption}>
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => onToggle(option.id)}
            />
            <span>{option.name}</span>
            {option.count === undefined ? null : (
              // Spaced and named — "A12" as an accessible name was a real bug.
              <span
                className={styles.facetCount}
              >{` ${option.count} unit`}</span>
            )}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export interface FilterChip {
  /** Unique among the current chips. */
  readonly key: string;
  /** "Lokasi: Toko Bandung" — the facet and the value, both visible. */
  readonly label: ReactNode;
  readonly srLabel: string;
  readonly onRemove: () => void;
}

export function FilterChipBar({
  chips,
  onReset,
}: {
  readonly chips: readonly FilterChip[];
  readonly onReset: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={styles.chips} aria-label="Filter aktif">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={styles.chip}
          onClick={chip.onRemove}
        >
          {chip.label} <span aria-hidden="true">×</span>
          <span className={styles.srOnly}>{chip.srLabel}</span>
        </button>
      ))}
      <button type="button" className={styles.reset} onClick={onReset}>
        Reset
      </button>
    </div>
  );
}
