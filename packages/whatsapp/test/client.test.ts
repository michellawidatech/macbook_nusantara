/**
 * The send client's failure modes — 06 §11, §12.
 *
 * The interesting cases are all the ones where Graph answers 200 and the
 * message did not go anywhere. Those are what an inline `if (!response.ok)`
 * misses, and what would otherwise mark an outbox row SENT and lose a reply.
 */

import { describe, expect, it, vi } from "vitest";
import { canSend, sendText, type WhatsAppCredentials } from "../src/index.js";

const CREDS: WhatsAppCredentials = {
  whatsappToken: "test-token",
  phoneNumberId: "1200651716467039",
  graphVersion: "v25.0",
};

/** A fetch that answers once with the given status and body. */
function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("canSend", () => {
  it("is false without a token or a phone number id", () => {
    expect(canSend({ ...CREDS, whatsappToken: "" })).toBe(false);
    expect(canSend({ ...CREDS, phoneNumberId: "" })).toBe(false);
    expect(canSend(CREDS)).toBe(true);
  });
});

describe("sendText", () => {
  it("simulates instead of throwing when no credential is configured", async () => {
    const fetchImpl = stubFetch(200, {});
    const result = await sendText({
      credentials: { ...CREDS, whatsappToken: "" },
      to: "628980092978",
      body: "halo",
      fetchImpl,
    });

    expect(result).toEqual({ waMessageId: null, simulated: true });
    // The point of simulation mode: nothing left the machine.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the pinned Graph version and returns the message id", async () => {
    const fetchImpl = stubFetch(200, { messages: [{ id: "wamid.OUT1" }] });
    const result = await sendText({
      credentials: CREDS,
      to: "628980092978",
      body: "halo",
      fetchImpl,
    });

    expect(result).toEqual({ waMessageId: "wamid.OUT1", simulated: false });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://graph.facebook.com/v25.0/1200651716467039/messages",
    );
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-token",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "628980092978",
      type: "text",
      text: { body: "halo" },
    });
  });

  it("throws on a Graph error carried by a 200", async () => {
    // The 24-hour window failure: HTTP is fine, the message is not delivered.
    const fetchImpl = stubFetch(200, {
      error: {
        message: "Message failed to send outside the window",
        code: 131047,
      },
    });

    await expect(
      sendText({
        credentials: CREDS,
        to: "628980092978",
        body: "halo",
        fetchImpl,
      }),
    ).rejects.toThrow(/#131047/);
  });

  it("throws when a 200 carries no message id", async () => {
    const fetchImpl = stubFetch(200, { messages: [] });

    await expect(
      sendText({
        credentials: CREDS,
        to: "628980092978",
        body: "halo",
        fetchImpl,
      }),
    ).rejects.toThrow(/no message id/);
  });

  it("throws on a non-JSON body, which means a proxy answered", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    ) as unknown as typeof fetch;

    await expect(
      sendText({
        credentials: CREDS,
        to: "628980092978",
        body: "halo",
        fetchImpl,
      }),
    ).rejects.toThrow(/non-JSON body/);
  });
});
