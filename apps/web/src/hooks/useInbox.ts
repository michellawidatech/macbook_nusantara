/**
 * Live inbox data for the Chat page.
 *
 * A customer messaging the shop is an event the staff did not cause, so there
 * is no click to hang a refetch off. Without polling, a message that arrived
 * while somebody had the page open would sit unread until they thought to
 * reload — which, from behind the counter, is indistinguishable from the
 * message never having arrived at all.
 *
 * Three details this hook exists to get right:
 *
 * - **Polling stops when the tab is hidden.** A shop laptop leaves this page
 *   open all day; a request every five seconds against a closed lid is pure
 *   noise in the log and on the battery. It refetches immediately on return,
 *   so coming back to the tab shows current data rather than five-second-old
 *   data.
 * - **A poll never clobbers a newer answer.** Every request carries an
 *   `AbortController` and results are dropped once the hook has moved on, so a
 *   slow response for the previous thread cannot overwrite the one now on
 *   screen.
 * - **A failed poll does not blank the screen.** The last good data stays
 *   rendered and the error is reported alongside it. An inbox that empties
 *   itself because one request timed out reads as "all the messages are gone".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getConversation,
  listThreads,
  type InboxConversation,
  type InboxThread,
} from "../lib/inboxApi.js";

/** Fast enough that a reply feels prompt, slow enough to be free. */
export const POLL_MS = 5_000;

export interface UseInboxResult {
  threads: InboxThread[];
  conversation: InboxConversation | null;
  /** True only until the first response — a poll must not show a spinner. */
  loading: boolean;
  /** The last failure, cleared by the next success. */
  error: Error | null;
  /** Refetch now. Call after sending, so the reply appears without waiting. */
  refresh: () => void;
}

export function useInbox(
  activePhone: string | null | undefined,
): UseInboxResult {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [conversation, setConversation] = useState<InboxConversation | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  // Read inside the effect so changing threads does not restart the timer.
  const phoneRef = useRef(activePhone);
  phoneRef.current = activePhone;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controllers = new Set<AbortController>();

    const load = async () => {
      const controller = new AbortController();
      controllers.add(controller);
      const phone = phoneRef.current;
      try {
        const [list, thread] = await Promise.all([
          listThreads(controller.signal),
          phone
            ? getConversation(phone, controller.signal)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setThreads(list.threads);
        // Only if the user has not switched threads while this was in flight.
        if (phoneRef.current === phone) setConversation(thread);
        setError(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // A thread whose messages were all deleted 404s. That is not worth an
        // error banner — the list beside it is still correct.
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        controllers.delete(controller);
        if (!cancelled) setLoading(false);
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        // `document.hidden` is checked at fire time rather than subscribed to,
        // so a tab hidden mid-interval simply skips its turn.
        if (!document.hidden) await load();
        if (!cancelled) schedule();
      }, POLL_MS);
    };

    void load();
    schedule();

    // Coming back to the tab should show current data, not wait out the timer.
    const onVisible = () => {
      if (!document.hidden && !cancelled) void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const c of controllers) c.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activePhone, nonce]);

  return { threads, conversation, loading, error, refresh };
}
