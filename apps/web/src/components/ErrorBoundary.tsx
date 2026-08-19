/**
 * The shell's error boundary — 02 §12: "Every error state has a retry. No
 * screen ever dead-ends."
 *
 * It wraps the routed content, not the shell chrome, so a crashing screen
 * leaves the navigation usable and the user is never stranded on a blank page.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../lib/i18n.js";
import styles from "./ErrorBoundary.module.css";

interface Props {
  readonly children: ReactNode;
  /** Changing this resets the boundary — the route path does nicely. */
  readonly resetKey?: string;
}

interface State {
  readonly error: Error | null;
}

class Boundary extends Component<
  Props & { labels: Record<string, string> },
  State
> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only sink here; the SPA does not ship logs.
    console.error("render error", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    // A user who navigates away from a broken screen gets a working one.
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <div className={styles.wrap} role="alert">
        <h2 className={styles.title}>{this.props.labels["title"]}</h2>
        <p className={styles.detail}>{this.state.error.message}</p>
        <button
          type="button"
          className={styles.retry}
          onClick={() => this.setState({ error: null })}
        >
          {this.props.labels["retry"]}
        </button>
      </div>
    );
  }
}

export function ErrorBoundary({ children, resetKey }: Props) {
  const { t } = useI18n();
  return (
    <Boundary
      resetKey={resetKey}
      labels={{ title: t("error.title"), retry: t("error.retry") }}
    >
      {children}
    </Boundary>
  );
}
