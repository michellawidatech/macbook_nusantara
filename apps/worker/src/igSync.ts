/**
 * The Instagram sync pass (2026-11-16) — everything Instagram the worker has
 * to FETCH, kept out of the webhook (which must answer Meta at once) and out
 * of every transaction (no network I/O inside one).
 *
 * 1. **Who wrote in.** An Instagram thread with no `IgContact` gets one from
 *    the User Profile API: the @username the inbox and the staff alert show,
 *    and the display name, which also goes onto the thread's unnamed rows so
 *    the bot can call them by it. A failure waits an hour.
 * 2. **Which post a comment is on.** An `IgMedia` stub (the webhook wrote it
 *    with `fetchedAt` = the epoch) gets its caption, picture and link; a post
 *    commented on in the last 30 days is refetched daily, because Instagram's
 *    picture links do not last.
 * 3. **The account and its token.** `/me` once an hour into `IgConnection`;
 *    and the long-lived token (60 days) refreshed every 7 days. The new token
 *    is used at once and, with `IG_TOKEN_FILE` set, written back into that env
 *    file so a restart keeps it. It is never logged and never stored in the
 *    database — only when it expires is.
 * 4. **A NEW comment is a person's job.** One WhatsApp alert to the staff
 *    alert numbers per comment author per 15 minutes, for comments nobody
 *    (no auto-reply either) has answered.
 */

import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { enqueueOutbox, Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { igsidOf } from "@nusantara/domain";
import { loadNotifyNumbers, staffAlertText } from "@nusantara/agent";
import {
  canSendInstagram,
  getMe,
  getMedia,
  getProfile,
  refreshToken,
  isBusinessToken,
  subscribeApp,
  type InstagramCredentials,
} from "@nusantara/instagram";
import type { InstagramConfig } from "./config.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const IG_REFRESH_EVERY_MS = 7 * DAY;
export const IG_COMMENT_ALERT_QUIET_MS = 15 * 60 * 1000;

/**
 * The token the worker is using right now. One per process, shared by the
 * send and sync passes, so a refresh reaches the next send.
 */
export interface IgTokenState {
  accessToken: string;
  refreshedAt: Date | null;
  expiresAt: Date | null;
  /** The last refresh attempt, so a refusal is tried again a day later. */
  lastAttemptAt: Date | null;
  /**
   * A Unified-login account subscribed to the app's webhooks by this process
   * (2026-11-23) — once per start; the call is idempotent at Meta.
   */
  subscribed?: boolean;
}

export function igTokenState(config: InstagramConfig): IgTokenState {
  return {
    accessToken: config.credentials.accessToken,
    refreshedAt: config.tokenRefreshedAt,
    expiresAt: null,
    lastAttemptAt: null,
    subscribed: false,
  };
}

export function currentCredentials(
  config: InstagramConfig,
  state: IgTokenState | undefined,
): InstagramCredentials {
  return state
    ? { ...config.credentials, accessToken: state.accessToken }
    : config.credentials;
}

export interface IgSyncDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly instagram: InstagramConfig;
  readonly token: IgTokenState;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly maxPerTick?: number;
  /** Where a POS link in an alert points. */
  readonly baseUrl?: string;
}

export interface IgSyncResult {
  readonly contacts: number;
  readonly media: number;
  readonly alerts: number;
  readonly refreshed: boolean;
  readonly dormant: boolean;
}

const errText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 500);

export async function igSyncPass(deps: IgSyncDeps): Promise<IgSyncResult> {
  const now = (deps.now ?? (() => new Date()))();
  // Comment alerts need no Graph call: they run even with no token.
  const alerts = await alertNewComments(deps, now);
  if (!canSendInstagram(currentCredentials(deps.instagram, deps.token)))
    return { contacts: 0, media: 0, alerts, refreshed: false, dormant: true };
  const refreshed = await refreshIfDue(deps, now);
  const contacts = await syncContacts(deps, now);
  const media = await syncMedia(deps, now);
  await syncAccount(deps, now);
  return { contacts, media, alerts, refreshed, dormant: false };
}

async function syncContacts(deps: IgSyncDeps, now: Date): Promise<number> {
  const { db } = deps;
  const max = deps.maxPerTick ?? 10;
  const retryBefore = new Date(now.getTime() - HOUR);
  const rows = await db.$queryRaw<Array<{ from: string }>>(Prisma.sql`
    SELECT m."from"
      FROM "WaMessage" m
     WHERE m."direction" = 'IN' AND m."from" LIKE 'ig:%'
       AND NOT EXISTS (
             SELECT 1 FROM "IgContact" c
              WHERE c."igsid" = substr(m."from", 4)
                AND (c."fetchedAt" IS NOT NULL
                     OR c."updatedAt" > (${retryBefore}::timestamptz AT TIME ZONE 'UTC')))
     GROUP BY m."from"
     ORDER BY MAX(m."ts") DESC
     LIMIT ${max}
  `);
  let done = 0;
  for (const { from } of rows) {
    const igsid = igsidOf(from);
    if (!igsid || !/^\d{5,32}$/.test(igsid)) continue;
    try {
      const p = await getProfile({
        credentials: currentCredentials(deps.instagram, deps.token),
        igsid,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      const username = p.username?.trim().slice(0, 64) || null;
      await db.igContact.upsert({
        where: { igsid },
        create: {
          igsid,
          username,
          name: p.name,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        update: {
          username,
          name: p.name,
          fetchedAt: now,
          lastError: null,
          updatedAt: now,
        },
      });
      if (p.name)
        await db.waMessage.updateMany({
          where: { from, direction: "IN", name: null },
          data: { name: p.name.slice(0, 120) },
        });
      done += 1;
    } catch (e) {
      await db.igContact.upsert({
        where: { igsid },
        create: {
          igsid,
          lastError: errText(e),
          createdAt: now,
          updatedAt: now,
        },
        update: { lastError: errText(e), updatedAt: now },
      });
      deps.logger.warn(
        {
          evt: "worker.ig.profile_failed",
          ctx: { from },
          err: { message: errText(e) },
        },
        "could not read an Instagram sender's profile",
      );
    }
  }
  return done;
}

async function syncMedia(deps: IgSyncDeps, now: Date): Promise<number> {
  const { db } = deps;
  const max = deps.maxPerTick ?? 10;
  const stale = await db.igMedia.findMany({
    where: {
      OR: [
        {
          permalink: null,
          fetchedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
        },
        {
          fetchedAt: { lt: new Date(now.getTime() - DAY) },
          comments: {
            some: { ts: { gt: new Date(now.getTime() - 30 * DAY) } },
          },
        },
      ],
    },
    orderBy: { fetchedAt: "asc" },
    take: max,
    select: { id: true, igMediaId: true },
  });
  let done = 0;
  for (const m of stale) {
    try {
      const info = await getMedia({
        credentials: currentCredentials(deps.instagram, deps.token),
        mediaId: m.igMediaId,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      await db.igMedia.update({
        where: { id: m.id },
        data: {
          caption: info.caption,
          mediaType: info.mediaType,
          permalink: info.permalink,
          thumbnailUrl: info.thumbnailUrl,
          timestamp: info.timestamp,
          fetchedAt: now,
        },
      });
      done += 1;
    } catch (e) {
      // Tried again in ten minutes (a stub) or a day (a fetched post).
      await db.igMedia.update({
        where: { id: m.id },
        data: { fetchedAt: now },
      });
      deps.logger.warn(
        {
          evt: "worker.ig.media_failed",
          ctx: { mediaId: m.igMediaId },
          err: { message: errText(e) },
        },
        "could not read an Instagram post",
      );
    }
  }
  return done;
}

export const IG_CONNECTION_ID = "singleton";

async function syncAccount(deps: IgSyncDeps, now: Date): Promise<void> {
  const { db } = deps;
  const row = await db.igConnection.findUnique({
    where: { id: IG_CONNECTION_ID },
    select: { checkedAt: true },
  });
  if (row?.checkedAt && now.getTime() - row.checkedAt.getTime() < HOUR) return;
  const tokenFields = {
    ...(deps.token.refreshedAt
      ? { tokenRefreshedAt: deps.token.refreshedAt }
      : {}),
    ...(deps.token.expiresAt ? { tokenExpiresAt: deps.token.expiresAt } : {}),
  };
  try {
    const me = await getMe({
      credentials: currentCredentials(deps.instagram, deps.token),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    const data = {
      igUserId: me.igUserId,
      username: me.username,
      name: me.name,
      accountType: me.accountType,
      checkedAt: now,
      lastError: null,
      updatedAt: now,
      ...tokenFields,
    };
    await db.igConnection.upsert({
      where: { id: IG_CONNECTION_ID },
      create: { id: IG_CONNECTION_ID, ...data },
      update: data,
    });
    if (me.igUserId && me.igUserId !== deps.instagram.credentials.igUserId)
      deps.logger.warn(
        { evt: "worker.ig.account_mismatch" },
        "IG_USER_ID is not the account this token belongs to",
      );
    // A Unified-login account must be subscribed to the app or Meta delivers
    // nothing (2026-11-23). Once per process; a failure is retried next hour.
    if (isBusinessToken(deps.token.accessToken) && !deps.token.subscribed) {
      try {
        await subscribeApp({
          credentials: currentCredentials(deps.instagram, deps.token),
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
        deps.token.subscribed = true;
        deps.logger.info(
          { evt: "worker.ig.subscribed" },
          "subscribed the Instagram account to the app's webhooks",
        );
      } catch (e) {
        deps.logger.warn(
          { evt: "worker.ig.subscribe_failed", err: { message: errText(e) } },
          "could not subscribe the Instagram account to the app's webhooks",
        );
      }
    }
  } catch (e) {
    const data = {
      checkedAt: now,
      lastError: errText(e),
      updatedAt: now,
      ...tokenFields,
    };
    await db.igConnection.upsert({
      where: { id: IG_CONNECTION_ID },
      create: { id: IG_CONNECTION_ID, ...data },
      update: data,
    });
  }
}

/** Refresh the token when it is a week old, or of unknown age once a day. */
async function refreshIfDue(deps: IgSyncDeps, now: Date): Promise<boolean> {
  const t = deps.token;
  // A Unified-login token is not refreshed: graph.instagram.com's refresh is
  // for Instagram-login tokens only (2026-11-23).
  if (isBusinessToken(t.accessToken)) return false;
  const due = t.refreshedAt
    ? now.getTime() - t.refreshedAt.getTime() >= IG_REFRESH_EVERY_MS
    : true;
  if (!due) return false;
  if (t.lastAttemptAt && now.getTime() - t.lastAttemptAt.getTime() < DAY)
    return false;
  t.lastAttemptAt = now;
  try {
    const r = await refreshToken({
      accessToken: t.accessToken,
      now,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    t.accessToken = r.accessToken;
    t.refreshedAt = now;
    t.expiresAt = r.expiresAt;
    if (deps.instagram.tokenFile) {
      try {
        rewriteEnvFile(deps.instagram.tokenFile, {
          IG_ACCESS_TOKEN: r.accessToken,
          IG_TOKEN_REFRESHED_AT: now.toISOString(),
        });
      } catch (e) {
        deps.logger.error(
          { evt: "worker.ig.token_file_failed", err: { message: errText(e) } },
          "the refreshed Instagram token could not be written back — it is in use until the worker restarts",
        );
      }
    }
    await deps.db.igConnection.upsert({
      where: { id: IG_CONNECTION_ID },
      create: {
        id: IG_CONNECTION_ID,
        tokenRefreshedAt: now,
        tokenExpiresAt: r.expiresAt,
        updatedAt: now,
      },
      update: {
        tokenRefreshedAt: now,
        tokenExpiresAt: r.expiresAt,
        updatedAt: now,
      },
    });
    deps.logger.info(
      {
        evt: "worker.ig.token_refreshed",
        ctx: { expiresAt: r.expiresAt.toISOString() },
      },
      "refreshed the Instagram token",
    );
    return true;
  } catch (e) {
    deps.logger.warn(
      { evt: "worker.ig.token_refresh_failed", err: { message: errText(e) } },
      "could not refresh the Instagram token — trying again tomorrow",
    );
    return false;
  }
}

/**
 * Replace (or append) `KEY='value'` lines in an env file, atomically: a temp
 * file beside it, mode 600, renamed over it. Every other line is kept as it
 * was.
 */
export function rewriteEnvFile(
  path: string,
  updates: Record<string, string>,
): void {
  const text = readFileSync(path, "utf8");
  const pending = new Map(Object.entries(updates));
  const lines = text.split(/\r?\n/).map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    const key = m?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}='${value}'`;
    }
    return line;
  });
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const [key, value] of pending) lines.push(`${key}='${value}'`);
  const tmp = join(dirname(path), `.${Date.now()}.ig-token.tmp`);
  writeFileSync(tmp, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

async function alertNewComments(deps: IgSyncDeps, now: Date): Promise<number> {
  const { db } = deps;
  const fresh = await db.igComment.findMany({
    where: { status: "NEW", ts: { gt: new Date(now.getTime() - DAY) } },
    orderBy: { ts: "asc" },
    take: 20,
    select: {
      igCommentId: true,
      fromId: true,
      fromUsername: true,
      text: true,
      media: { select: { caption: true } },
    },
  });
  if (fresh.length === 0) return 0;
  let alerted = 0;
  for (const c of fresh) {
    const made = await db.$transaction(async (tx) => {
      const already = await tx.outbox.count({
        where: {
          OR: [
            { payload: { path: ["alertForComment"], equals: c.igCommentId } },
            {
              AND: [
                { payload: { path: ["alertForCommenter"], equals: c.fromId } },
                {
                  createdAt: {
                    gt: new Date(now.getTime() - IG_COMMENT_ALERT_QUIET_MS),
                  },
                },
              ],
            },
          ],
        },
      });
      if (already > 0) return false;
      const numbers = await loadNotifyNumbers(tx);
      if (numbers.length === 0) return false;
      const caption = c.media.caption?.split("\n")[0]?.trim();
      const body = staffAlertText({
        phone: c.fromId,
        name: null,
        username: c.fromUsername,
        comment: true,
        customerText: c.text ?? "",
        summary: caption ? `Komentar di: ${caption}` : "Komentar baru",
        ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
      });
      for (const to of numbers)
        await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: {
            to,
            body,
            staffAlert: true,
            alertForComment: c.igCommentId,
            alertForCommenter: c.fromId,
          },
        });
      return true;
    });
    if (made) alerted += 1;
  }
  return alerted;
}
