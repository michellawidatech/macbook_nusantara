/**
 * Instagram comments, the auto-reply settings and the owner's connection card
 * (2026-11-16) — see apps/api/src/routes/instagram.ts and
 * docs/superpowers/specs/2026-11-16-instagram-design.md.
 *
 * The DMs are NOT here: they are `/api/inbox` threads keyed `ig:<IGSID>`
 * (lib/inboxApi.ts). Every action below is queued by the server (an `Outbox`
 * row the worker sends) and audited with who did it; what comes back is the
 * comment as it now stands.
 */
import { api } from "./api.js";

export type IgCommentStatus = "NEW" | "REPLIED" | "DMED" | "DONE" | "HIDDEN";

export const IG_COMMENT_STATUSES: readonly IgCommentStatus[] = [
  "NEW",
  "REPLIED",
  "DMED",
  "DONE",
  "HIDDEN",
];

/** Instagram's limit on a DM or a reply: 1000 UTF-8 bytes. */
export const IG_TEXT_MAX_BYTES = 1000;

/** UTF-8 length, the way Instagram counts (an emoji is four). */
export const utf8Bytes = (text: string): number =>
  new TextEncoder().encode(text).length;

/** The post a comment is on. */
export interface IgCommentMedia {
  id: string;
  igMediaId: string;
  caption: string | null;
  mediaType: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  at: string | null;
}

export interface IgComment {
  id: string;
  igCommentId: string;
  fromId: string;
  /** The commenter's @username (without the @), when Meta sent one. */
  username: string | null;
  text: string | null;
  /** A reply under another comment, not a top-level comment. */
  isReply: boolean;
  /** ISO. */
  at: string;
  status: IgCommentStatus;
  /** The public reply under it, by staff or by the auto-reply. */
  reply: {
    text: string;
    at: string | null;
    byAgent: boolean;
    by: string | null;
    /** False while it is still queued for Instagram. */
    posted: boolean;
  } | null;
  /** The one private DM Instagram allows for it. */
  dm: {
    text: string;
    at: string | null;
    by: string | null;
    byAgent: boolean;
  } | null;
  /** One private DM per comment, within 7 days of it. */
  canPrivateReply: boolean;
  media: IgCommentMedia;
}

export type IgCommentCounts = Record<IgCommentStatus, number>;

export interface IgCommentFilter {
  status?: IgCommentStatus | null;
  /** `IgMedia.id`. */
  media?: string | null;
  q?: string | null;
  limit?: number;
}

/** A post with comments, for the filter. */
export interface IgPost {
  id: string;
  igMediaId: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  comments: number;
}

export interface InstagramSettings {
  autoReply: boolean;
  /** The public reply under a first top-level comment. */
  replyTemplate: string;
  /** The private DM sent with it. */
  dmTemplate: string;
  updatedAt: string | null;
}

export interface InstagramConnection {
  connected: boolean;
  account: {
    igUserId: string | null;
    username: string | null;
    name: string | null;
    accountType: string | null;
    checkedAt: string | null;
    lastError: string | null;
    tokenRefreshedAt: string | null;
    tokenExpiresAt: string | null;
  } | null;
  /** The newest delivery from Meta's webhook, or null when none came yet. */
  lastEventAt: string | null;
  /** How many Instagram accounts have written to the shop. */
  senders: number;
  /** Whether Meta approved the Human Agent 7-day reply. */
  humanAgent: boolean;
}

const commentPath = (id: string, action: string) =>
  `/api/instagram/comments/${encodeURIComponent(id)}/${action}`;

/** Newest first, with every status's count (unfiltered). */
export function listComments(
  filter: IgCommentFilter = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.media) params.set("media", filter.media);
  if (filter.q && filter.q.trim()) params.set("q", filter.q.trim());
  if (filter.limit) params.set("limit", String(filter.limit));
  const query = params.toString();
  return api<{ comments: IgComment[]; counts: IgCommentCounts }>(
    `/api/instagram/comments${query ? `?${query}` : ""}`,
    signal ? { signal } : {},
  );
}

/** The posts that have comments. */
export const listPosts = () => api<{ media: IgPost[] }>("/api/instagram/media");

/** A public reply under the comment. */
export const replyToComment = (id: string, text: string) =>
  api<IgComment>(commentPath(id, "reply"), {
    method: "POST",
    body: { text },
  });

/** The one private DM Instagram allows; 409 once sent or past 7 days. */
export const privateReply = (id: string, text: string) =>
  api<IgComment>(commentPath(id, "private-reply"), {
    method: "POST",
    body: { text },
  });

/** Hide the comment on Instagram, or show it again. */
export const hideComment = (id: string, hidden: boolean) =>
  api<IgComment>(commentPath(id, "hide"), {
    method: "POST",
    body: { hidden },
  });

/** Dealt with — or, with `done: false`, reopened. 409 while hidden. */
export const markCommentDone = (id: string, done: boolean) =>
  api<IgComment>(commentPath(id, "done"), {
    method: "POST",
    body: { done },
  });

export const getInstagramSettings = () =>
  api<InstagramSettings>("/api/instagram/settings");

/** The owner's — 403 for anybody else. */
export const saveInstagramSettings = (
  body: Pick<InstagramSettings, "autoReply" | "replyTemplate" | "dmTemplate">,
) => api<InstagramSettings>("/api/instagram/settings", { method: "PUT", body });

/** The owner's — 403 for anybody else. */
export const getInstagramConnection = () =>
  api<InstagramConnection>("/api/instagram/connection");
