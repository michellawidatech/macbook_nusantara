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
  /** The kinds of this thread's open action items. */
  openActions: ChatActionKind[];
  /**
   * ISO, or null once the 24-hour window has closed.
   *
   * Null means a free-form reply cannot be delivered (06 §11) and the reply box
   * must say so rather than looking functional.
   */
  windowClosesAt: string | null;
  /** Customer.name, else the name they told the bot, else Meta's. */
  displayName: string | null;
  /** Inbound messages after the staff read marker. */
  unread: number;
  /** The three markers the list draws as icons. */
  tags: ThreadTags;
  /** The router's last 0–100 lead score, or null. */
  leadScore: number | null;
}

export interface ThreadTags {
  /** Marked as a lead, by the bot or by staff. */
  lead: boolean;
  /** An open (TERJADWAL) hold for this number. */
  reservation: boolean;
  /** Handed to a person, or an open action item. */
  escalation: boolean;
}

export type EvaluationRating = "GOOD" | "BAD";
export type EvaluationStatus = "OPEN" | "APPLIED" | "DISMISSED";

/** Staff's verdict on one bot reply, as the bubble shows it. */
export interface ReplyEvaluation {
  id: string;
  rating: EvaluationRating;
  status: EvaluationStatus;
}

/** What the shop said back, hanging off the message it answered. */
export interface InboxReply {
  text: string;
  byAgent: boolean;
  /** Staff name, or null when the bot wrote it. */
  by: string | null;
  at: string | null;
  /** Staff's verdict on this reply, or null while nobody has rated it. */
  evaluation?: ReplyEvaluation | null;
  /**
   * The sent item (`InboxConversation.sent`) this reply IS — what its ⋯ menu
   * edits or unsends. Null when no outbox row matches it, and then it has no
   * menu.
   */
  outboxId?: string | null;
}

/**
 * One text or photo the shop sent this customer (2026-10-23) — see
 * apps/api/src/routes/inboxSent.ts. `canEdit` / `canUnsend` are decided by
 * the server: WhatsApp's 15-minute and ~48-hour limits, and whether the shop
 * sends through the linked device at all (the Cloud API can do neither).
 */
export interface SentItem {
  id: string;
  kind: "WA_REPLY" | "WA_IMAGE";
  status: "PENDING" | "SENDING" | "SENT" | "FAILED";
  createdAt: string;
  sentAt: string | null;
  /** A text: what the customer has now. */
  body?: string;
  /** A photo: drawn through `sentPhotoUrl`. */
  photoId?: string;
  /** A picture staff sent from their own device (2026-10-27). */
  chatMediaId?: string;
  /** The line sent under a picture, when there was one. */
  caption?: string;
  /** Who sent a picture from their own device. */
  sentBy?: string | null;
  /** The message it answered. */
  inReplyTo: string | null;
  /**
   * The worker's one polite follow-up (2026-10-27) — a visit reminder or a
   * quiet lead's nudge. Absent on everything else.
   */
  followUp?: "visit_reminder" | "lead_nudge";
  /** Unsent for everyone. */
  retractedAt: string | null;
  editedAt: string | null;
  /**
   * Staff name behind the last edit / the unsend (2026-10-27), or null for
   * one done before the log said who — the bubble then keeps the bare word.
   */
  editedBy?: string | null;
  retractedBy?: string | null;
  canEdit: boolean;
  canUnsend: boolean;
}

export interface InboxMessage {
  id: string;
  waMessageId: string;
  text: string | null;
  at: string;
  direction: "IN" | "OUT";
  status: "BARU" | "DIJAWAB_AGEN" | "PERLU_STAF" | "DIJAWAB_STAF";
  msgType: string;
  /** A tester's `/new`: the conversation starts over after this message. */
  reset?: boolean;
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
  /** Open action items first, then the latest few done. */
  actions: ChatAction[];
  /** What the customer told the bot about themselves. Null until they did. */
  profile: CustomerProfile | null;
  /** Whether this thread is a lead, and whose call that was. */
  lead: LeadState;
  /** The customer's open holds. */
  reservations: InboxReservation[];
  /** What they asked to hear about when it is back in stock (2026-10-27). */
  watches?: StockWatch[];
  /** Every text and photo sent to this number, oldest first. */
  sent?: SentItem[];
}

export interface LeadState {
  on: boolean;
  /** The router's last 0–100 score. */
  score: number | null;
  by: "BOT" | "STAFF" | null;
}

export interface InboxReservation {
  code: string;
  /** ISO — the visit time, when one was agreed. */
  scheduledFor: string | null;
  status: "TERJADWAL";
  units: Array<{ serial: string | null; name: string }>;
}

export type ChatActionKind =
  | "NEGOTIATION"
  | "PRICE"
  | "STOCK"
  | "RESERVATION"
  | "PHOTOS"
  | "OTHER"
  /** Ready to buy, wants a unit kept or asks how to pay (2026-10-27). */
  | "CLOSING";

/**
 * "Tell me when it's in stock" (2026-10-27). The bot writes one when the
 * customer says yes to being told; staff only close it. Money is whole
 * rupiah as a string.
 */
export interface StockWatch {
  id: string;
  /** What they asked for, in the shop's words. */
  query: string;
  /** The product or variant the words named, when exactly one. */
  label: string | null;
  budget: string | null;
  createdAt: string;
  /** When the worker left a colleague the task to tell them. */
  notifiedAt: string | null;
  closedAt: string | null;
}

/**
 * The task a hand-over left for a person (owner ask 2026-09-29) — enough to
 * act on without reading the conversation. Money is whole rupiah as a string.
 */
export interface ChatAction {
  id: string;
  kind: ChatActionKind;
  status: "OPEN" | "DONE";
  /** The finer reason, a handoff topic. */
  topic: string;
  /** The bot's note for the colleague. */
  summary: string;
  /** The customer's words that raised it, or last changed it. */
  customerText: string | null;
  unit: { serial: string; name: string; grade: string | null } | null;
  /** What the POS asks for the unit now. */
  listPrice: string | null;
  /** The unit's landed cost — the shop's floor. Staff only. */
  cost: string | null;
  /** NEGOTIATION: what the customer offered, kept current until answered. */
  askPrice: string | null;
  /** What the shop answered with. */
  staffPrice: string | null;
  createdAt: string;
  /** Moves when the customer changes their offer. */
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export type ProfileFactKind = "USAGE" | "APP" | "PREFERENCE" | "ABOUT";

/** One thing the customer said about themselves, as a tag. */
export interface ProfileFact {
  id: string;
  kind: ProfileFactKind;
  value: string;
  source: "BOT" | "STAFF";
}

/**
 * The customer's own words about themselves, plus the bot's estimates.
 * Unverified. Money is whole rupiah as a string.
 */
export interface CustomerProfile {
  name: string | null;
  /** The bot's guess — always shown labelled as an estimate. */
  ageEstimate: string | null;
  /** Job or school, the bot's guess. */
  occupation: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
  /** The old free-text "use", still shown if set. */
  useCase: string | null;
  currentDevice: string | null;
  /** The old free-text preference. */
  preference: string | null;
  facts: ProfileFact[];
  updatedAt: string;
}

/** The fields staff may correct in place. Budget as a rupiah string or null. */
export type ProfilePatch = Partial<
  Pick<
    CustomerProfile,
    | "name"
    | "ageEstimate"
    | "occupation"
    | "budgetMin"
    | "budgetMax"
    | "useCase"
    | "currentDevice"
    | "preference"
  >
>;

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

/**
 * *Clear chat* (2026-10-27): the conversation leaves the list and the bot
 * forgets it, as after a tester's `/new`. Nothing is deleted; the customer
 * writing again brings the thread back with only the new messages.
 */
export const clearConversation = (phone: string) =>
  api<{ clearedAt: string; closed: number }>(
    `/api/inbox/${encodeURIComponent(phone)}/clear`,
    { method: "POST" },
  );

/**
 * *Delete conversation*, for good — owner only. `confirm` is the number as
 * typed back. The customer's profile, ratings and corrections stay.
 */
export const deleteConversation = (phone: string, confirm: string) =>
  api<{ deleted: number }>(`/api/inbox/${encodeURIComponent(phone)}`, {
    method: "DELETE",
    body: { confirm },
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

/** Every message up to now counts as read by staff. */
export const markRead = (phone: string) =>
  api<{ ok: true }>(`/api/inbox/${encodeURIComponent(phone)}/read`, {
    method: "POST",
  });

/** Correct what the bot recorded about this customer. */
export const patchProfile = (phone: string, body: ProfilePatch) =>
  api<CustomerProfile>(`/api/inbox/${encodeURIComponent(phone)}/profile`, {
    method: "PATCH",
    body,
  });

export const addProfileFact = (
  phone: string,
  body: { kind: ProfileFactKind; value: string },
) =>
  api<{ fact: ProfileFact }>(
    `/api/inbox/${encodeURIComponent(phone)}/profile/facts`,
    { method: "POST", body },
  );

/** Soft: the server stamps `removedAt`. */
export const removeProfileFact = (phone: string, id: string) =>
  api<{ ok: true }>(
    `/api/inbox/${encodeURIComponent(phone)}/profile/facts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

/**
 * Queue a unit's QC photos (at most three) to this customer. 409 when the
 * 24-hour window has closed, 404 for an unknown serial or one with no photos.
 */
export const attachMedia = (phone: string, serials: readonly string[]) =>
  api<{ queued: number; units: number; skipped: string[] }>(
    `/api/inbox/${encodeURIComponent(phone)}/media`,
    { method: "POST", body: { serials } },
  );

/**
 * Send a picture from this device (2026-10-27): a JPG, PNG or WebP of at most
 * 5 MB, as a data URL, with an optional caption. 409 once the 24-hour window
 * has closed, 413 / 415 for a file the server will not take.
 */
export const sendPicture = (phone: string, image: string, caption?: string) =>
  api<SentItem>(`/api/inbox/${encodeURIComponent(phone)}/picture`, {
    method: "POST",
    body: { image, ...(caption ? { caption } : {}) },
  });

/** Where a sent photo's bytes are; 404 once the unit sold (photos purged). */
export const sentPhotoUrl = (phone: string, outboxId: string) =>
  `/api/inbox/${encodeURIComponent(phone)}/sent/${encodeURIComponent(outboxId)}/photo`;

/** Delete a sent message for everyone. 409 past the limit or on the Cloud API. */
export const unsendSent = (phone: string, outboxId: string) =>
  api<SentItem>(
    `/api/inbox/${encodeURIComponent(phone)}/sent/${encodeURIComponent(outboxId)}/unsend`,
    { method: "POST" },
  );

/** Correct a sent text, within WhatsApp's 15 minutes. */
export const editSent = (phone: string, outboxId: string, text: string) =>
  api<SentItem>(
    `/api/inbox/${encodeURIComponent(phone)}/sent/${encodeURIComponent(outboxId)}/edit`,
    { method: "POST", body: { text } },
  );

/** Close a stock watch — the customer was told, or bought elsewhere. */
export const closeStockWatch = (phone: string, id: string) =>
  api<{ watches: StockWatch[] }>(
    `/api/inbox/${encodeURIComponent(phone)}/watches/${encodeURIComponent(id)}/close`,
    { method: "POST" },
  );
