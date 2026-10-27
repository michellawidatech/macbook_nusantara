/**
 * Baileys mode's fetch (2026-10-22): the same Graph request, sent to the
 * shop's gateway — origin moved, token dropped, secret added, nothing else.
 */

import { describe, expect, it, vi } from "vitest";
import {
  gatewayFetch,
  gatewayUrlFor,
  sendText,
  uploadMedia,
} from "../src/index.js";

const CREDS = {
  whatsappToken: "never-sent",
  phoneNumberId: "baileys",
  graphVersion: "v25.0",
};
const TARGET = { url: "http://127.0.0.1:3002/", secret: "gateway-secret-123" };

describe("gatewayUrlFor", () => {
  it("moves the two Graph calls and nothing else", () => {
    expect(
      gatewayUrlFor(
        "https://graph.facebook.com/v25.0/1200651716467039/messages",
        TARGET.url,
      ),
    ).toBe("http://127.0.0.1:3002/graph/v25.0/1200651716467039/messages");
    expect(
      gatewayUrlFor("https://graph.facebook.com/v25.0/x/media", TARGET.url),
    ).toBe("http://127.0.0.1:3002/graph/v25.0/x/media");
    expect(
      gatewayUrlFor("https://graph.facebook.com/v25.0/x/phone_numbers", "h"),
    ).toBeNull();
    expect(gatewayUrlFor("https://example.com/v25.0/x/messages", "h")).toBe(
      null,
    );
  });
});

describe("gatewayFetch", () => {
  it("sends sendText's exact body with the secret and without the token", async () => {
    const base = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ messages: [{ id: "BAE5" }] }), {
          status: 200,
        }),
    );
    const result = await sendText({
      credentials: CREDS,
      to: "6281234567890",
      body: "Halo kak",
      fetchImpl: gatewayFetch(TARGET, base as unknown as typeof fetch),
    });
    expect(result).toEqual({ waMessageId: "BAE5", simulated: false });
    const [url, init] = base.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3002/graph/v25.0/baileys/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-wa-gateway-secret")).toBe("gateway-secret-123");
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "6281234567890",
      type: "text",
      text: { preview_url: false, body: "Halo kak" },
    });
  });

  it("passes an upload's form through untouched", async () => {
    const base = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "m-1" }), { status: 200 }),
    );
    const up = await uploadMedia({
      credentials: CREDS,
      data: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      fetchImpl: gatewayFetch(TARGET, base as unknown as typeof fetch),
    });
    expect(up.mediaId).toBe("m-1");
    expect(base.mock.calls[0]![1]?.body).toBeInstanceOf(FormData);
  });

  it("refuses any other URL rather than letting it reach the network", async () => {
    const base = vi.fn();
    await expect(
      gatewayFetch(
        TARGET,
        base as unknown as typeof fetch,
      )("https://graph.facebook.com/v25.0/me"),
    ).rejects.toThrow(/refusing/);
    expect(base).not.toHaveBeenCalled();
  });
});
