/**
 * Money display — docs/rebuild/02-interaction.md §9.
 *
 * Right-aligned, tabular figures, and "negative and zero states are visually
 * distinct (loss, free) — not just a minus sign in the same colour". The
 * distinction also carries a word in the title, because meaning is never
 * encoded in colour alone (§14).
 */

import { formatNumber, formatRupiah } from "@nusantara/domain";
import styles from "./Money.module.css";

export function Money({
  value,
  bare = false,
}: {
  readonly value: bigint;
  /** Without the Rp prefix — for table cells where Rp lives in the header (§8). */
  readonly bare?: boolean;
}) {
  const cls =
    value < 0n ? styles.negative : value === 0n ? styles.zero : styles.money;
  const title = value < 0n ? "rugi" : value === 0n ? "gratis" : undefined;
  return (
    <span className={cls} title={title}>
      {bare ? formatNumber(value) : formatRupiah(value)}
    </span>
  );
}
