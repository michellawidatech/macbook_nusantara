/**
 * A named, empty section.
 *
 * S8 builds the shell only; the data screens arrive in S9 and the increments.
 * 02 §12: "Every empty state has a next action. No screen ever dead-ends" —
 * so this says what it is and what comes next rather than showing nothing.
 */

import styles from "./PlaceholderPage.module.css";

export function PlaceholderPage({
  title,
  next,
}: {
  title: string;
  next: string;
}) {
  return (
    <section className={styles.wrap} aria-labelledby="placeholder-title">
      <h1 id="placeholder-title" className={styles.title}>
        {title}
      </h1>
      <p className={styles.body}>{next}</p>
    </section>
  );
}
