/**
 * The API's one way to reach apps/wa-gateway on loopback: the shared secret,
 * a timeout, and a JSON answer — or "did not answer", which every caller
 * turns into its own clear refusal rather than a spinner.
 *
 * Two callers: the owner's `/api/whatsapp/connection` (link, unlink, status)
 * and the inbox's unsend / edit (2026-10-23). Never called inside a database
 * transaction (CLAUDE.md): both read, call this, and only then write.
 */

import type { Logger } from "@nusantara/logging";

/** The gateway's header; the same constant `@nusantara/whatsapp` exports. */
export const GATEWAY_SECRET_HEADER = "x-wa-gateway-secret";
const TIMEOUT_MS = 8_000;

export interface GatewayTarget {
  readonly url: string;
  readonly secret: string;
}

export type GatewayAnswer =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false };

export async function callGateway(opts: {
  readonly gateway: GatewayTarget | null;
  readonly logger: Logger;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly fetchImpl?: typeof fetch;
}): Promise<GatewayAnswer> {
  const { gateway, logger, method, path } = opts;
  if (!gateway) return { ok: false };
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${gateway.url}${path}`, {
      method,
      headers: {
        [GATEWAY_SECRET_HEADER]: gateway.secret,
        ...(opts.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    return {
      ok: true,
      status: res.status,
      body: text ? (JSON.parse(text) as unknown) : {},
    };
  } catch (err) {
    logger.warn(
      {
        evt: "whatsapp.gateway.unreachable",
        ctx: { path },
        err: {
          message: err instanceof Error ? err.message : String(err),
        },
      },
      "the WhatsApp gateway did not answer",
    );
    return { ok: false };
  }
}
