/**
 * The WhatsApp inbox, as the SPA sees it. See apps/api/src/routes/inbox.ts.
 *
 * These are real rows out of `WaMessage`, not the mock store. The Chat page
 * used to render `useDb().chats`, which is why a message the shop genuinely
 * received — sitting in Postgres, written by the webhook — never appeared on
 * screen for anybody.
 */
import { api } from "./api.js";

/**
 * Why the bot gave a conversation to a person (2026-09-18) — see
 * apps/api/src/routes/inbox.ts `readHandoff`.
 */
export interface Handoff {
  /** packages/agent policy.ts `HANDOFF_TOPICS`, e.g. "stock", "price". */
  topic: string;
  /** The bot's one-line note for the colleague, or null. */
  summary: string | null;
  /** Set when the code rather than the model decided. */
  forcedBy: string | null;
  at: string | null;
}

export interface InboxThread {
  /** The customer's wa_id: digits only, country code first. */
  phone: string;
  name: string | null;
  channel: "WHATSAPP";
  lastText: string | null;
  /** ISO. */
  lastAt: string;
  lastReply: string | null;
  /** Waiting on a person or on the bot. */
  needsReply: boolean;
  pending: number;
  /**
   * False where staff have taken this one thread off the bot, so the list can
   * mark it. True for a thread nobody has ruled on, which is most of them.
   */
  autoReply: boolean;
  /** Set while the bot has handed this thread to a person and nobody answered. */
  handoff: Handoff | null;
  /**
   * ISO, or null once the 24-hour window has closed.
   *
   * Null means a free-form reply cannot be delivered (06 §11) and the reply box
   * must say so rather than looking functional.
   */
  windowClosesAt: string | null;
}

/** What the shop said back, hanging off the message it answered. */
export interface InboxReply {
  text: string;
  byAgent: boolean;
  /** Staff name, or null when the bot wrote it. */
  by: string | null;
  at: string | null;
}

export interface InboxMessage {
  id: string;
  waMessageId: string;
  text: string | null;
  at: string;
  direction: "IN" | "OUT";
  status: "BARU" | "DIJAWAB_AGEN" | "PERLU_STAF" | "DIJAWAB_STAF";
  msgType: string;
  /** Why the bot gave this message to a person, when it did. */
  handoff: Handoff | null;
  reply: InboxReply | null;
}

export interface InboxConversation {
  phone: string;
  name: string | null;
  channel: "WHATSAPP";
  windowClosesAt: string | null;
  messages: InboxMessage[];
  /**
   * The agent's rolling note on this thread, written by the worker's summary
   * pass. Null until a conversation has enough answered turns to be worth
   * summarising — the page says so rather than composing one in the browser.
   */
  summary: { text: string; at: string | null } | null;
  /** A standing instruction staff left about this customer, if any. */
  directive: string | null;
  /** The open hand-over — null once a person has answered or marked it handled. */
  handoff: Handoff | null;
  /** Whether the bot answers this customer unattended. */
  autoReply: AutoReplyState;
  /**
   * Who the shop knows this number to be, matched on the phone. Null for a
   * number that has never bought anything, and the page must say so rather
   * than filling the panel with guesses.
   */
  customer: InboxCustomer | null;
}

/**
 * The per-thread bot switch, and who last pressed it.
 *
 * `by` and `at` are null until somebody actually flips it: a thread with no
 * memory row is on because that is the default, not because a person decided
 * it, and the panel should not name somebody who never touched it.
 */
export interface AutoReplyState {
  enabled: boolean;
  /** Staff name, or null while it has never been changed. */
  by: string | null;
  /** ISO, or null while it has never been changed. */
  at: string | null;
}

/** Only what the shop actually stores. Nothing here is inferred. */
export interface InboxCustomer {
  id: string;
  name: string;
  phone: string;
  /** ISO. When the shop first recorded them. */
  since: string;
  referralSource: string | null;
  orderCount: number;
  openReservations: number;
  lastOrder: {
    code: string;
    at: string;
    /** Whole rupiah as a string: BigInt does not survive JSON. */
    total: string;
  } | null;
}

export interface QueuedReply {
  id: string;
  text: string;
  at: string;
  /** Committed to the outbox. The worker performs the send. */
  status: "QUEUED";
}

export const listThreads = (signal?: AbortSignal) =>
  api<{ threads: InboxThread[] }>("/api/inbox", signal ? { signal } : {});

export const getConversation = (phone: string, signal?: AbortSignal) =>
  api<InboxConversation>(
    `/api/inbox/${encodeURIComponent(phone)}`,
    signal ? { signal } : {},
  );

/**
 * "Dealt with" without a reply — the customer was rung, or walked in. Closes
 * the thread's waiting messages so the bot answers the next one.
 */
export const markHandled = (phone: string) =>
  api<{ closed: number }>(`/api/inbox/${encodeURIComponent(phone)}/handled`, {
    method: "POST",
  });

export const sendReply = (phone: string, text: string) =>
  api<QueuedReply>(`/api/inbox/${encodeURIComponent(phone)}/reply`, {
    method: "POST",
    body: { text },
  });

/**
 * Hand this customer to a person, or back to the bot.
 *
 * Governs the unattended path only — the worker's draft pass skips a thread
 * that is switched off. Replying by hand and asking the bot for a draft work
 * exactly the same either way, because neither sends without a person.
 *
 * PUT, not POST: the body is the state wanted rather than a change to apply,
 * so a double press on a flaky connection is not a double flip.
 */
export const setAutoReply = (phone: string, enabled: boolean) =>
  api<AutoReplyState>(`/api/inbox/${encodeURIComponent(phone)}/auto-reply`, {
    method: "PUT",
    body: { enabled },
  });
