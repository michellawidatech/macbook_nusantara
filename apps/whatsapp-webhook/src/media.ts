/**
 * `GET /webhook/media/:outboxId/:token` — a picture Instagram is fetching
 * (2026-11-16). Instagram's send API takes an image by URL and nothing else,
 * and the only public origin this deployment has is the funnel, which
 * publishes `/webhook` and everything under it (ops/whatsapp-funnel).
 *
 * What it serves is deliberately narrow: the bytes of the photo ONE
 * `IG_IMAGE` outbox row names, only when the token in the address is the one
 * the worker wrote onto that row just before sending it (32 random bytes,
 * compared in constant time), only while the row is queued, sending or sent,
 * not unsent, and under a day old. Anything else is 404 — the same answer for
 * "no such row" and "wrong token", so the route says nothing about which ids
 * exist. A `ChatMedia` is served only to the thread it was uploaded for.
 */

import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

/** How long after it was queued a picture may still be fetched. */
export const MEDIA_URL_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

interface ImagePayload {
  to?: string;
  photoId?: string;
  chatMediaId?: string;
  mediaToken?: string;
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function mediaHandler(deps: {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly now?: () => Date;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    const notFound = () => {
      res.status(404).type("text/plain").send("Not found");
    };
    try {
      const outboxId = String(req.params["outboxId"] ?? "");
      const token = String(req.params["token"] ?? "");
      if (!outboxId || !TOKEN.test(token)) return notFound();
      const row = await deps.db.outbox.findUnique({
        where: { id: outboxId },
        select: {
          kind: true,
          status: true,
          payload: true,
          createdAt: true,
          retractedAt: true,
        },
      });
      const now = (deps.now ?? (() => new Date()))();
      const p = (row?.payload ?? {}) as ImagePayload;
      if (
        !row ||
        row.kind !== "IG_IMAGE" ||
        row.status === "FAILED" ||
        row.retractedAt !== null ||
        now.getTime() - row.createdAt.getTime() > MEDIA_URL_TTL_MS ||
        typeof p.mediaToken !== "string" ||
        !sameToken(p.mediaToken, token)
      )
        return notFound();

      let bytes: Uint8Array | null = null;
      let type: string | null = null;
      if (p.photoId) {
        const photo = await deps.db.unitNotePhoto.findUnique({
          where: { id: p.photoId },
          select: { data: true, contentType: true },
        });
        bytes = photo?.data ?? null;
        type = photo?.contentType ?? null;
      } else if (p.chatMediaId) {
        const media = await deps.db.chatMedia.findUnique({
          where: { id: p.chatMediaId },
          select: { from: true, data: true, contentType: true },
        });
        if (media && media.from === p.to) {
          bytes = media.data;
          type = media.contentType;
        }
      }
      if (!bytes || bytes.length === 0) return notFound();
      res
        .status(200)
        .set("Cache-Control", "private, max-age=300")
        .type(type ?? "image/jpeg")
        .send(Buffer.from(bytes));
      deps.logger.info(
        { evt: "webhook.ig.media_served", ctx: { outboxId } },
        "served a picture Instagram is fetching",
      );
    } catch (err) {
      deps.logger.error(
        {
          evt: "webhook.ig.media_failed",
          ...(err instanceof Error
            ? { err: { name: err.name, message: err.message } }
            : {}),
        },
        "could not serve a picture",
      );
      res.status(500).type("text/plain").send("error");
    }
  };
}
