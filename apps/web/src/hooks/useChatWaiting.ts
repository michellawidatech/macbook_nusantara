/**
 * How many chats are waiting for a person (owner, 2026-10-28: *"give
 * notification persisting in the entire app if there is anything that they
 * need to answer"*). ONE poll for the whole app, however many places show the
 * number — the sidebar notice and the Chatbot leaf's count share it — every
 * 30 seconds while anything is listening and the tab is visible.
 *
 * A failed poll keeps the last answer: a notice that vanishes because one
 * request timed out reads as "nothing to answer".
 *
 * Instagram (2026-11-16): `count` already holds the Instagram DM threads
 * waiting on a person (`instagram` is that part of it), and `comments` is the
 * NEW Instagram comments — counted apart so the notice can say which, and
 * added together by `waitingTotal` for a badge.
 */
import { useEffect, useState } from "react";
import { getWaitingChats } from "../lib/chatApi.js";

export const WAITING_POLL_MS = 30_000;

export interface ChatWaiting {
  /** Chats of both channels waiting on a person. */
  readonly count: number;
  /** The thread key waiting longest. */
  readonly oldest: string | null;
  /** The Instagram DM threads among `count`. */
  readonly instagram: number;
  /** NEW Instagram comments. */
  readonly comments: number;
}

/** Everything that waits on a person: chats plus comments. */
export const waitingTotal = (w: ChatWaiting): number => w.count + w.comments;

let current: ChatWaiting = {
  count: 0,
  oldest: null,
  instagram: 0,
  comments: 0,
};
const listeners = new Set<(w: ChatWaiting) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const answer = await getWaitingChats();
    const next: ChatWaiting = {
      count: answer.count,
      oldest: answer.oldest,
      instagram: answer.instagram ?? 0,
      comments: answer.comments ?? 0,
    };
    if (
      next.count === current.count &&
      next.oldest === current.oldest &&
      next.instagram === current.instagram &&
      next.comments === current.comments
    )
      return;
    current = next;
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
