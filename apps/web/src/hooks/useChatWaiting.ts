/**
 * How many chats are waiting for a person (owner, 2026-10-28: *"give
 * notification persisting in the entire app if there is anything that they
 * need to answer"*). ONE poll for the whole app, however many places show the
 * number — the sidebar notice and the Chatbot leaf's count share it — every
 * 30 seconds while anything is listening and the tab is visible.
 *
 * A failed poll keeps the last answer: a notice that vanishes because one
 * request timed out reads as "nothing to answer".
 */
import { useEffect, useState } from "react";
import { getWaitingChats } from "../lib/chatApi.js";

export const WAITING_POLL_MS = 30_000;

export interface ChatWaiting {
  readonly count: number;
  readonly oldest: string | null;
}

let current: ChatWaiting = { count: 0, oldest: null };
const listeners = new Set<(w: ChatWaiting) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const next = await getWaitingChats();
    if (next.count === current.count && next.oldest === current.oldest) return;
    current = { count: next.count, oldest: next.oldest };
    for (const l of listeners) l(current);
  } catch {
    // Keep the last answer.
  }
}

/** Ask again now — after a reply, so the notice clears without waiting. */
export function refreshChatWaiting(): void {
  void poll();
}

export function useChatWaiting(): ChatWaiting {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    if (timer === null) {
      void poll();
      timer = setInterval(() => void poll(), WAITING_POLL_MS);
    }
    return () => {
      listeners.delete(setState);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return state;
}
