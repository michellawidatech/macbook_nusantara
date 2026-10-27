/**
 * The gateway's HTTP face — loopback only, one shared secret.
 *
 *     GET  /health                       no secret: the installer's probe
 *     GET  /status                       state, QR (while waiting), number, since
 *     POST /link                         a QR — only with no session (409), rationed (429)
 *     POST /logout                       unlink, and delete the session's files
 *     POST /graph/{v}/{phone-id}/media     the worker's upload, Graph-shaped
 *     POST /graph/{v}/{phone-id}/messages  the worker's send, Graph-shaped
 *     POST /messages/revoke              {to, id}: unsend for everyone (the inbox)
 *     POST /messages/edit                {to, id, text}: correct a sent text
 *
 * Callers: the API (owner-only `/api/whatsapp/connection`, which adds the
 * secret) and the worker (its fetch, rewritten in Baileys mode). Nothing here
 * is reachable from the network: `main.ts` binds 127.0.0.1, and the secret is
 * there for the other accounts on the same machine.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Logger } from "@nusantara/logging";
import { GATEWAY_SECRET_HEADER } from "./config.js";
import {
  graphCallOf,
  graphErrorBody,
  parseEditRequest,
  parseRetractRequest,
  parseSendRequest,
  sentBody,
} from "./graph.js";
import { MediaStore } from "./limits.js";
import { GatewayError, errInfo, type SessionApi } from "./session.js";

/** A QC photo is well under this; WhatsApp's own image limit is 5 MB. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const JSON_LIMIT = 256 * 1024;

export interface ServerDeps {
  readonly secret: string;
  readonly session: SessionApi;
  readonly logger: Logger;
  readonly media?: MediaStore;
  readonly now?: () => number;
}

/** Constant time, and constant in the length of what was sent too. */
function secretMatches(given: string | undefined, secret: string): boolean {
  if (!given || !secret) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limit) throw new TooLarge();
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function createGatewayServer(deps: ServerDeps): Server {
  const { session, logger } = deps;
  const media = deps.media ?? new MediaStore();
  const now = deps.now ?? Date.now;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";

    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { status: "ok", app: "wa-gateway" });
    }

    const given = req.headers[GATEWAY_SECRET_HEADER];
    if (
      !secretMatches(typeof given === "string" ? given : undefined, deps.secret)
    ) {
      return send(res, 401, {
        error: {
          code: "UNAUTHORIZED",
          message: "missing or wrong gateway secret",
        },
      });
    }

    if (req.method === "GET" && path === "/status") {
      return send(res, 200, session.status());
    }

    if (req.method === "POST" && path === "/link") {
      const r = await session.link();
      if (r.ok) return send(res, 200, r.status);
      const message =
        r.code === "CONNECTED"
          ? "a WhatsApp session is already connected — disconnect it first"
          : r.code === "BUSY"
            ? "a WhatsApp session is connecting"
            : "too many link attempts — wait before trying again";
      if (r.retryAfterMs !== undefined) {
        res.setHeader("retry-after", String(Math.ceil(r.retryAfterMs / 1000)));
      }
      return send(res, r.httpStatus, {
        error: {
          code: r.code,
          message,
          ...(r.retryAfterMs !== undefined
            ? { retryAfterSec: Math.ceil(r.retryAfterMs / 1000) }
            : {}),
        },
        status: r.status,
      });
    }

    if (req.method === "POST" && path === "/logout") {
      return send(res, 200, await session.logout());
    }

    if (
      req.method === "POST" &&
      (path === "/messages/revoke" || path === "/messages/edit")
    ) {
      let parsed: unknown;
      try {
        parsed = JSON.parse((await readBody(req, JSON_LIMIT)).toString("utf8"));
      } catch {
        return send(res, 400, graphErrorBody(400, "the body is not JSON"));
      }
      const edit = path === "/messages/edit";
      const request = edit
        ? parseEditRequest(parsed)
        : parseRetractRequest(parsed);
      if (typeof request === "string") {
        return send(res, 400, graphErrorBody(400, request));
      }
      try {
        if ("text" in request && typeof request.text === "string") {
          await session.editText(request.to, request.id, request.text);
        } else {
          await session.revoke(request.to, request.id);
        }
        return send(res, 200, { ok: true });
      } catch (err) {
        const status = err instanceof GatewayError ? err.status : 502;
        logger.warn(
          {
            evt: edit ? "wa-gateway.edit.failed" : "wa-gateway.revoke.failed",
            err: errInfo(err),
          },
          edit
            ? "an edit through WhatsApp failed"
            : "an unsend through WhatsApp failed",
        );
        return send(
          res,
          status,
          graphErrorBody(
            status,
            err instanceof Error ? err.message : "the request failed",
          ),
        );
      }
    }

    const call = req.method === "POST" ? graphCallOf(path) : null;
    if (call === "media") {
      let form: FormData;
      try {
        const raw = await readBody(req, MAX_BODY_BYTES);
        form = await new Request("http://gateway.local/media", {
          method: "POST",
          headers: { "content-type": req.headers["content-type"] ?? "" },
          body: raw,
        }).formData();
      } catch (err) {
        if (err instanceof TooLarge)
          return send(res, 413, graphErrorBody(413, "the upload is too large"));
        return send(res, 400, graphErrorBody(400, "not a multipart upload"));
      }
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return send(res, 400, graphErrorBody(400, "no file in the upload"));
      }
      const type = form.get("type");
      const mimeType =
        (typeof type === "string" && type) || file.type || "image/jpeg";
      const id = media.put(
        Buffer.from(await file.arrayBuffer()),
        mimeType,
        now(),
      );
      return send(res, 200, { id });
    }

    if (call === "messages") {
      let parsed: unknown;
      try {
        parsed = JSON.parse((await readBody(req, JSON_LIMIT)).toString("utf8"));
      } catch {
        return send(res, 400, graphErrorBody(400, "the body is not JSON"));
      }
      const request = parseSendRequest(parsed);
      if (typeof request === "string") {
        return send(res, 400, graphErrorBody(400, request));
      }
      try {
        if (request.kind === "text") {
          const id = await session.send(request);
          return send(res, 200, sentBody(id));
        }
        const item = media.take(request.mediaId, now());
        if (!item) {
          return send(
            res,
            400,
            graphErrorBody(400, "unknown or expired media id"),
          );
        }
        const id = await session.send({
          kind: "image",
          to: request.to,
          bytes: item.bytes,
          mimeType: item.mimeType,
          ...(request.caption ? { caption: request.caption } : {}),
        });
        return send(res, 200, sentBody(id));
      } catch (err) {
        const status = err instanceof GatewayError ? err.status : 502;
        logger.warn(
          { evt: "wa-gateway.send.failed", err: errInfo(err) },
          "a send through WhatsApp failed",
        );
        return send(
          res,
          status,
          graphErrorBody(
            status,
            err instanceof Error ? err.message : "the send failed",
          ),
        );
      }
    }

    return send(res, 404, {
      error: { code: "NOT_FOUND", message: "not found" },
    });
  };

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      logger.error(
        { evt: "wa-gateway.http.failed", err: errInfo(err) },
        "a gateway request failed",
      );
      if (!res.headersSent)
        send(res, 500, graphErrorBody(500, "gateway error"));
      else res.end();
    });
  });
}
