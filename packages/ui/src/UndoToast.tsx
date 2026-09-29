/**
 * Undo toast — docs/rebuild/02-interaction.md §6 and §3.
 *
 * "Confirmation dialogs are a tax on every correct action to prevent a rare
 * wrong one. Prefer undo." The action has already applied (§4 optimistic);
 * this toast is the window to take it back — 8 s per §6's table.
 *
 * Contracts held here:
 *   - toasts are aria-live="polite", never focus traps (§3): showing one moves
 *     focus nowhere, and the Urungkan button is reached by Tab, not by force;
 *   - the timer is visible — a countdown in seconds plus a draining bar — and
 *     reduced-motion users keep the numeric countdown (§14);
 *   - hovering or focusing a toast pauses its clock: reading about an action
 *     must not spend the time to undo it.
 *
 * The clock is deadline-based (`endAt`), not decrement-based: a tick that
 * arrives late — a throttled background tab, a busy main thread — still
 * expires at the right moment, and the tick itself only forces a render.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./UndoToast.module.css";

export interface UndoToastInput {
  readonly message: string;
  readonly onUndo?: () => void;
  /** Runs when the window closes without an undo — for deferred commits. */
  readonly onExpire?: () => void;
  readonly durationMs?: number;
}

interface ToastState {
  readonly id: number;
  readonly message: string;
  readonly onUndo?: (() => void) | undefined;
  readonly onExpire?: (() => void) | undefined;
  readonly durationMs: number;
  /** The moment this toast expires — while running. */
  readonly endAt: number;
  /** Milliseconds left — while paused. null when the clock is running. */
  readonly pausedRemaining: number | null;
}

interface ToastApi {
  readonly showUndo: (input: UndoToastInput) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === undefined)
    throw new Error("useToast dipakai di luar <ToastProvider>");
  return ctx;
}

const TICK_MS = 100;

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastState[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const nextId = useRef(1);
  // Guards onExpire against double firing if a render lags behind two ticks.
  const expiredIds = useRef(new Set<number>());

  const showUndo = useCallback((input: UndoToastInput) => {
    const durationMs = input.durationMs ?? 8_000;
    setToasts((prev) => [
      ...prev,
      {
        id: nextId.current++,
        message: input.message,
        onUndo: input.onUndo,
        onExpire: input.onExpire,
        durationMs,
        endAt: Date.now() + durationMs,
        pausedRemaining: null,
      },
    ]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const snapshot = useRef<readonly ToastState[]>(toasts);
  snapshot.current = toasts;

  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const t = Date.now();
      // Side effects run here, in the interval callback — never inside a
      // state updater (CLAUDE.md's toast rule).
      const expired = snapshot.current.filter(
        (toast) =>
          toast.pausedRemaining === null &&
          toast.endAt <= t &&
          !expiredIds.current.has(toast.id),
      );
      if (expired.length > 0) {
        for (const toast of expired) expiredIds.current.add(toast.id);
        setToasts((prev) =>
          prev.filter((toast) => !expiredIds.current.has(toast.id)),
        );
        for (const toast of expired) toast.onExpire?.();
      }
      setNow(t); // the render tick that moves the visible countdown
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [toasts.length]);

  const setPaused = useCallback((id: number, paused: boolean) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (paused && t.pausedRemaining === null) {
          return { ...t, pausedRemaining: Math.max(0, t.endAt - Date.now()) };
        }
        if (!paused && t.pausedRemaining !== null) {
          return {
            ...t,
            endAt: Date.now() + t.pausedRemaining,
            pausedRemaining: null,
          };
        }
        return t;
      }),
    );
  }, []);

  const api = useMemo(() => ({ showUndo }), [showUndo]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {toasts.map((toast) => {
          const remaining =
            toast.pausedRemaining ?? Math.max(0, toast.endAt - now);
          const seconds = Math.ceil(remaining / 1_000);
          const fraction = Math.min(1, remaining / toast.durationMs);
          return (
            <div
              key={toast.id}
              className={styles.toast}
              onMouseEnter={() => setPaused(toast.id, true)}
              onMouseLeave={() => setPaused(toast.id, false)}
              onFocus={() => setPaused(toast.id, true)}
              onBlur={() => setPaused(toast.id, false)}
            >
              <span className={styles.message}>{toast.message}</span>
              {toast.onUndo === undefined ? null : (
                <button
                  type="button"
                  className={styles.undo}
                  onClick={() => {
                    toast.onUndo?.();
                    dismiss(toast.id);
                  }}
                >
                  Urungkan
                </button>
              )}
              <span className={styles.seconds} aria-hidden="true">
                {seconds}
              </span>
              <span
                className={styles.timer}
                style={{ transform: `scaleX(${fraction})` }}
                data-testid="toast-timer"
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
