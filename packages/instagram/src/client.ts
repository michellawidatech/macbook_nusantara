/**
 * The Instagram Graph client — Instagram API with Instagram Login
 * (2026-11-16, docs/instagram-connect.md has the citations).
 *
 *     POST https://graph.instagram.com/{ver}/{IG_USER_ID}/messages
 *     Authorization: Bearer {IG_ACCESS_TOKEN}
 *
 * …and, since 2026-11-23, the Instagram API with UNIFIED login, which is all
 * Meta offers a new app: a Business Integration System User token (it starts
 * `EAA`), sent to graph.facebook.com with the account id in the path. The
 * edges are the same; `/me` is the system user, not the account, so the
 * account is read by its id; and the token is not refreshed
 * (`isBusinessToken`). Meta's "instagram-api-with-unified-login" pages.
 *
 * Same rules as `@nusantara/whatsapp`: no `process.env` here — every
 * credential is an argument; a `fetchImpl` seam so no test touches the
 * network; a failure THROWS (the outbox worker's backoff runs on the throw);
 * and Graph's error is flattened into one line that never contains the token.
 * The Graph version is the ONE constant both channels share (CLAUDE.md).
 */

export const IG_GRAPH_HOST = "https://graph.instagram.com";
/** Where a Unified-login (Facebook) token is sent. */
export const FB_GRAPH_HOST = "https://graph.facebook.com";

/**
 * A Unified-login token — a Business Integration System User token, which
 * starts `EAA` like every Facebook token; an Instagram-login token starts
 * `IG`. It goes to graph.facebook.com and is never refreshed.
 */
export const isBusinessToken = (token: string): boolean => /^EAA/.test(token);

export interface InstagramCredentials {
  /** A long-lived Instagram user access token. Never logged, never stored. */
  readonly accessToken: string;
  /** The professional account's IG user id (`entry[].id` on a delivery). */
  readonly igUserId: string;
  readonly graphVersion: string;
}

export const canSendInstagram = (c: InstagramCredentials): boolean =>
  Boolean(c.accessToken && c.igUserId);

/** Graph's error envelope, as much as is worth a log line. */
interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

/** A Graph call that failed: the HTTP status and Meta's own code. */
export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface CallOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Strip anything that looks like a token from text bound for a log line. */
export function redact(text: string, token: string): string {
  let out = text;
  if (token) out = out.split(token).join("[token]");
  return out.replace(/(access_token=)[^&\s"]+/g, "$1[token]");
}

async function call<T>(
  credentials: Pick<InstagramCredentials, "accessToken">,
  method: "GET" | "POST",
  url: string,
  body: unknown,
  opts: CallOptions,
): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const response = await doFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  let parsed: (T & { error?: GraphError }) | null = null;
  try {
    parsed = (await response.json()) as T & { error?: GraphError };
  } catch {
    parsed = null;
  }
  if (!response.ok || !parsed || parsed.error) {
    const e = parsed?.error;
    const line = [
      e?.code !== undefined ? `#${e.code}` : null,
      e?.error_subcode !== undefined ? `(subcode ${e.error_subcode})` : null,
      e?.message ?? e?.type ?? `HTTP ${response.status}`,
    ]
      .filter(Boolean)
      .join(" ");
    throw new InstagramApiError(
      redact(`Instagram: ${line}`, credentials.accessToken),
      response.status,
      e?.code ?? null,
    );
  }
  return parsed;
}

const base = (c: InstagramCredentials) =>
  `${isBusinessToken(c.accessToken) ? FB_GRAPH_HOST : IG_GRAPH_HOST}/${c.graphVersion}`;

export interface SendResult {
  readonly messageId: string | null;
}

/**
 * One text DM. `tag: "HUMAN_AGENT"` sends a person's reply between 24 hours
 * and 7 days after the customer's last message (needs Meta's Human Agent
 * feature on the app).
 */
export async function sendText(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly igsid: string;
    readonly text: string;
    readonly tag?: "HUMAN_AGENT";
  },
): Promise<SendResult> {
  const res = await call<{ message_id?: string }>(
    input.credentials,
    "POST",
    `${base(input.credentials)}/${input.credentials.igUserId}/messages`,
    {
      recipient: { id: input.igsid },
      message: { text: input.text },
      ...(input.tag ? { messaging_type: "MESSAGE_TAG", tag: input.tag } : {}),
    },
    input,
  );
  return { messageId: res.message_id ?? null };
}

/** One picture DM, by a URL Instagram fetches (it takes no upload). */
export async function sendImageUrl(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly igsid: string;
    readonly url: string;
    readonly tag?: "HUMAN_AGENT";
  },
): Promise<SendResult> {
  const res = await call<{ message_id?: string }>(
    input.credentials,
    "POST",
    `${base(input.credentials)}/${input.credentials.igUserId}/messages`,
    {
      recipient: { id: input.igsid },
      message: { attachment: { type: "image", payload: { url: input.url } } },
      ...(input.tag ? { messaging_type: "MESSAGE_TAG", tag: input.tag } : {}),
    },
    input,
  );
  return { messageId: res.message_id ?? null };
}

/** The one private DM a comment allows (within 7 days of it). */
export async function privateReply(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly commentId: string;
    readonly text: string;
  },
): Promise<SendResult> {
  const res = await call<{ message_id?: string }>(
    input.credentials,
    "POST",
    `${base(input.credentials)}/${input.credentials.igUserId}/messages`,
    {
      recipient: { comment_id: input.commentId },
      message: { text: input.text },
    },
    input,
  );
  return { messageId: res.message_id ?? null };
}

/** A public reply under a comment. Returns the new comment's id. */
export async function replyToComment(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly commentId: string;
    readonly text: string;
  },
): Promise<{ commentId: string | null }> {
  const res = await call<{ id?: string }>(
    input.credentials,
    "POST",
    `${base(input.credentials)}/${encodeURIComponent(input.commentId)}/replies`,
    { message: input.text },
    input,
  );
  return { commentId: res.id ?? null };
}

/** Hide or show a comment. */
export async function setCommentHidden(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly commentId: string;
    readonly hidden: boolean;
  },
): Promise<void> {
  await call<{ success?: boolean }>(
    input.credentials,
    "POST",
    `${base(input.credentials)}/${encodeURIComponent(input.commentId)}?hide=${input.hidden ? "true" : "false"}`,
    undefined,
    input,
  );
}

export interface IgProfile {
  readonly username: string | null;
  readonly name: string | null;
}

/** A messaging user's name and @username (they must have written to us). */
export async function getProfile(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly igsid: string;
  },
): Promise<IgProfile> {
  const res = await call<{ username?: string; name?: string }>(
    input.credentials,
    "GET",
    `${base(input.credentials)}/${encodeURIComponent(input.igsid)}?fields=name,username`,
    undefined,
    input,
  );
  return { username: res.username ?? null, name: res.name ?? null };
}

export interface IgMediaInfo {
  readonly caption: string | null;
  readonly mediaType: string | null;
  readonly permalink: string | null;
  /** media_url for a picture, thumbnail_url for a video. */
  readonly thumbnailUrl: string | null;
  readonly timestamp: Date | null;
}

export async function getMedia(
  input: CallOptions & {
    readonly credentials: InstagramCredentials;
    readonly mediaId: string;
  },
): Promise<IgMediaInfo> {
  const res = await call<{
    caption?: string;
    media_type?: string;
    media_url?: string;
    permalink?: string;
    thumbnail_url?: string;
    timestamp?: string;
  }>(
    input.credentials,
    "GET",
    `${base(input.credentials)}/${encodeURIComponent(input.mediaId)}?fields=caption,media_type,media_url,permalink,thumbnail_url,timestamp`,
    undefined,
    input,
  );
  const ts = res.timestamp ? new Date(res.timestamp) : null;
  return {
    caption: res.caption ?? null,
    mediaType: res.media_type ?? null,
    permalink: res.permalink ?? null,
    thumbnailUrl:
      (res.media_type === "VIDEO" ? res.thumbnail_url : res.media_url) ??
      res.thumbnail_url ??
      res.media_url ??
      null,
    timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : null,
  };
}

export interface IgMe {
  readonly igUserId: string | null;
  readonly username: string | null;
  readonly name: string | null;
  readonly accountType: string | null;
}

/** The connected account itself. */
export async function getMe(
  input: CallOptions & { readonly credentials: InstagramCredentials },
): Promise<IgMe> {
  if (isBusinessToken(input.credentials.accessToken)) {
    // `/me` would be the system user; the account is read by its id.
    const res = await call<{ id?: string; username?: string; name?: string }>(
      input.credentials,
      "GET",
      `${base(input.credentials)}/${encodeURIComponent(input.credentials.igUserId)}?fields=id,username,name`,
      undefined,
      input,
    );
    return {
      igUserId: res.id ?? null,
      username: res.username ?? null,
      name: res.name ?? null,
      accountType: null,
    };
  }
  const res = await call<{
    user_id?: string | number;
    username?: string;
    name?: string;
    account_type?: string;
  }>(
    input.credentials,
    "GET",
    `${base(input.credentials)}/me?fields=user_id,username,name,account_type`,
    undefined,
    input,
  );
  return {
    igUserId: res.user_id !== undefined ? String(res.user_id) : null,
    username: res.username ?? null,
    name: res.name ?? null,
    accountType: res.account_type ?? null,
  };
}

/**
 * Subscribe the account to this app's webhooks (messages and comments) —
 * without it the callback verifies and nothing is ever delivered. Idempotent.
 */
export async function subscribeApp(
  input: CallOptions & { readonly credentials: InstagramCredentials },
): Promise<void> {
  const c = input.credentials;
  const who = isBusinessToken(c.accessToken)
    ? encodeURIComponent(c.igUserId)
    : "me";
  await call<{ success?: boolean }>(
    c,
    "POST",
    `${base(c)}/${who}/subscribed_apps?subscribed_fields=messages,comments`,
    undefined,
    input,
  );
}

export interface RefreshedToken {
  readonly accessToken: string;
  readonly expiresAt: Date;
}

/**
 * Extend a long-lived token by 60 days. Meta allows it once the token is at
 * least 24 hours old and not yet expired.
 */
export async function refreshToken(
  input: CallOptions & {
    readonly accessToken: string;
    readonly now: Date;
  },
): Promise<RefreshedToken> {
  // The refresh endpoint takes the token as a query parameter, not a header,
  // and is not versioned. The URL never reaches a log line (`redact`).
  const res = await call<{ access_token?: string; expires_in?: number }>(
    { accessToken: input.accessToken },
    "GET",
    `${IG_GRAPH_HOST}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(input.accessToken)}`,
    undefined,
    input,
  );
  if (!res.access_token || !res.expires_in)
    throw new InstagramApiError(
      "Instagram: refresh returned no token",
      200,
      null,
    );
  return {
    accessToken: res.access_token,
    expiresAt: new Date(input.now.getTime() + res.expires_in * 1000),
  };
}
