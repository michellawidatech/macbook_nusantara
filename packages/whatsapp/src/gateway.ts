/**
 * The Graph client, pointed at the shop's own WhatsApp gateway instead of
 * Meta (owner decision 2026-10-22, docs/whatsapp-baileys.md).
 *
 * `sendText`, `uploadMedia` and `sendImage` all take a `fetchImpl`. In Baileys
 * mode the worker hands them this one, and that is the WHOLE difference: the
 * request is built exactly as for graph.facebook.com, and only its origin is
 * moved to `apps/wa-gateway` on loopback, which answers in Graph's shapes. The
 * send code, the outbox's retries and the 24-hour rule are not forked.
 *
 * Two headers change on the way: the Graph bearer token is dropped (in this
 * mode there is no token, and the gateway must never be handed one) and the
 * gateway's shared secret is added.
 *
 * A URL that is not one of the two Graph calls the client makes is REFUSED,
 * not passed through: this function is handed to the WhatsApp client and to
 * nothing else, so anything else reaching it is a bug, and must not quietly
 * reach the network — least of all Meta's, with no token, from a shop that
 * chose not to use it.
 */

export const GATEWAY_SECRET_HEADER = "x-wa-gateway-secret";

const GRAPH =
  /^https:\/\/graph\.facebook\.com\/([A-Za-z0-9.]+)\/([A-Za-z0-9_-]+)\/(messages|media)$/;

export interface GatewayTarget {
  /** `http://127.0.0.1:3002` — the gateway's origin, no trailing path. */
  readonly url: string;
  readonly secret: string;
}

/** The gateway URL a Graph URL becomes, or null for any other URL. */
export function gatewayUrlFor(graphUrl: string, base: string): string | null {
  const m = GRAPH.exec(graphUrl);
  if (!m) return null;
  return `${base.replace(/\/+$/, "")}/graph/${m[1]}/${m[2]}/${m[3]}`;
}

export function gatewayFetch(
  target: GatewayTarget,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const to = gatewayUrlFor(url, target.url);
    if (!to) throw new Error(`wa-gateway: refusing to send ${url}`);
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.set(GATEWAY_SECRET_HEADER, target.secret);
    return baseFetch(to, { ...init, headers });
  };
}
