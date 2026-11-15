import { describe, expect, it } from "vitest";
import {
  InstagramApiError,
  canSendInstagram,
  getMe,
  getMedia,
  getProfile,
  privateReply,
  redact,
  refreshToken,
  replyToComment,
  sendImageUrl,
  sendText,
  setCommentHidden,
} from "../src/index.js";

const credentials = {
  accessToken: "IGQ-secret-token",
  igUserId: "17841400000000000",
  graphVersion: "v25.0",
};

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(reply: unknown, status = 200) {
  const seen: Seen[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { seen, impl };
}

describe("the Instagram Graph client", () => {
  it("needs a token and an account id to send at all", () => {
    expect(canSendInstagram(credentials)).toBe(true);
    expect(canSendInstagram({ ...credentials, accessToken: "" })).toBe(false);
    expect(canSendInstagram({ ...credentials, igUserId: "" })).toBe(false);
  });

  it("sends a text DM with a Bearer header to the account's messages edge", async () => {
    const f = fakeFetch({ recipient_id: "99", message_id: "mid.1" });
    const r = await sendText({
      credentials,
      igsid: "99",
      text: "halo kak",
      fetchImpl: f.impl,
    });
    expect(r.messageId).toBe("mid.1");
    expect(f.seen[0]!.url).toBe(
      "https://graph.instagram.com/v25.0/17841400000000000/messages",
    );
    expect(f.seen[0]!.method).toBe("POST");
    expect(f.seen[0]!.headers["Authorization"]).toBe("Bearer IGQ-secret-token");
    expect(f.seen[0]!.body).toEqual({
      recipient: { id: "99" },
      message: { text: "halo kak" },
    });
  });

  it("tags a person's late reply as HUMAN_AGENT", async () => {
    const f = fakeFetch({ message_id: "mid.2" });
    await sendText({
      credentials,
      igsid: "99",
      text: "maaf baru balas",
      tag: "HUMAN_AGENT",
      fetchImpl: f.impl,
    });
    expect(f.seen[0]!.body).toMatchObject({
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });
  });

  it("sends a picture by URL", async () => {
    const f = fakeFetch({ message_id: "mid.3" });
    const r = await sendImageUrl({
      credentials,
      igsid: "99",
      url: "https://example.test/webhook/media/o1/t",
      fetchImpl: f.impl,
    });
    expect(r.messageId).toBe("mid.3");
    expect(f.seen[0]!.body).toEqual({
      recipient: { id: "99" },
      message: {
        attachment: {
          type: "image",
          payload: { url: "https://example.test/webhook/media/o1/t" },
        },
      },
    });
    const g = fakeFetch({});
    expect(
      (
        await sendImageUrl({
          credentials,
          igsid: "99",
          url: "https://x.test/a",
          tag: "HUMAN_AGENT",
          fetchImpl: g.impl,
        })
      ).messageId,
    ).toBeNull();
    expect(g.seen[0]!.body).toMatchObject({ tag: "HUMAN_AGENT" });
  });

  it("sends the private reply to the comment, not the person", async () => {
    const f = fakeFetch({});
    const r = await privateReply({
      credentials,
      commentId: "c1",
      text: "cek DM ya kak",
      fetchImpl: f.impl,
    });
    expect(r.messageId).toBeNull();
    expect(f.seen[0]!.body).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "cek DM ya kak" },
    });
    const g = fakeFetch({ message_id: "m" });
    expect(
      (
        await privateReply({
          credentials,
          commentId: "c1",
          text: "x",
          fetchImpl: g.impl,
        })
      ).messageId,
    ).toBe("m");
  });

  it("replies under a comment and hides one", async () => {
    const f = fakeFetch({ id: "reply.1" });
    expect(
      (
        await replyToComment({
          credentials,
          commentId: "c1",
          text: "Cek DM ya kak",
          fetchImpl: f.impl,
        })
      ).commentId,
    ).toBe("reply.1");
    expect(f.seen[0]!.url).toBe("https://graph.instagram.com/v25.0/c1/replies");
    expect(f.seen[0]!.body).toEqual({ message: "Cek DM ya kak" });
    const none = fakeFetch({});
    expect(
      (
        await replyToComment({
          credentials,
          commentId: "c1",
          text: "x",
          fetchImpl: none.impl,
        })
      ).commentId,
    ).toBeNull();

    const h = fakeFetch({ success: true });
    await setCommentHidden({
      credentials,
      commentId: "c1",
      hidden: true,
      fetchImpl: h.impl,
    });
    await setCommentHidden({
      credentials,
      commentId: "c1",
      hidden: false,
      fetchImpl: h.impl,
    });
    expect(h.seen.map((s) => s.url)).toEqual([
      "https://graph.instagram.com/v25.0/c1?hide=true",
      "https://graph.instagram.com/v25.0/c1?hide=false",
    ]);
    expect(h.seen[0]!.body).toBeUndefined();
  });

  it("reads a profile, a post and the account", async () => {
    const p = fakeFetch({ username: "budi.mac", name: "Budi" });
    expect(
      await getProfile({ credentials, igsid: "99", fetchImpl: p.impl }),
    ).toEqual({
      username: "budi.mac",
      name: "Budi",
    });
    expect(p.seen[0]!.method).toBe("GET");
    expect(p.seen[0]!.url).toBe(
      "https://graph.instagram.com/v25.0/99?fields=name,username",
    );
    const empty = fakeFetch({});
    expect(
      await getProfile({ credentials, igsid: "99", fetchImpl: empty.impl }),
    ).toEqual({
      username: null,
      name: null,
    });

    const pic = fakeFetch({
      caption: "Air M2",
      media_type: "IMAGE",
      media_url: "https://cdn/img.jpg",
      permalink: "https://instagram.com/p/x",
      timestamp: "2026-11-15T10:00:00+0000",
    });
    const m = await getMedia({
      credentials,
      mediaId: "m1",
      fetchImpl: pic.impl,
    });
    expect(m).toEqual({
      caption: "Air M2",
      mediaType: "IMAGE",
      permalink: "https://instagram.com/p/x",
      thumbnailUrl: "https://cdn/img.jpg",
      timestamp: new Date("2026-11-15T10:00:00Z"),
    });
    const vid = fakeFetch({
      media_type: "VIDEO",
      thumbnail_url: "https://cdn/t.jpg",
      media_url: "https://cdn/v.mp4",
      timestamp: "nope",
    });
    const v = await getMedia({
      credentials,
      mediaId: "m2",
      fetchImpl: vid.impl,
    });
    expect(v.thumbnailUrl).toBe("https://cdn/t.jpg");
    expect(v.timestamp).toBeNull();
    const bare = fakeFetch({
      media_type: "VIDEO",
      media_url: "https://cdn/v.mp4",
    });
    expect(
      (await getMedia({ credentials, mediaId: "m3", fetchImpl: bare.impl }))
        .thumbnailUrl,
    ).toBe("https://cdn/v.mp4");
    const nothing = fakeFetch({});
    expect(
      await getMedia({ credentials, mediaId: "m4", fetchImpl: nothing.impl }),
    ).toEqual({
      caption: null,
      mediaType: null,
      permalink: null,
      thumbnailUrl: null,
      timestamp: null,
    });

    const me = fakeFetch({
      user_id: 17841400000000000,
      username: "macbooknusantara",
      name: "MN",
      account_type: "Business",
    });
    expect(await getMe({ credentials, fetchImpl: me.impl })).toEqual({
      igUserId: "17841400000000000",
      username: "macbooknusantara",
      name: "MN",
      accountType: "Business",
    });
    const meEmpty = fakeFetch({});
    expect(
      (await getMe({ credentials, fetchImpl: meEmpty.impl })).igUserId,
    ).toBeNull();
  });

  it("refreshes a token and reports when it now expires", async () => {
    const f = fakeFetch({
      access_token: "IGQ-new",
      token_type: "bearer",
      expires_in: 5184000,
    });
    const now = new Date("2026-11-16T00:00:00Z");
    const r = await refreshToken({
      accessToken: "IGQ-old",
      now,
      fetchImpl: f.impl,
    });
    expect(r.accessToken).toBe("IGQ-new");
    expect(r.expiresAt).toEqual(new Date("2027-01-15T00:00:00Z"));
    expect(f.seen[0]!.url).toBe(
      "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=IGQ-old",
    );
    const bad = fakeFetch({ token_type: "bearer" });
    await expect(
      refreshToken({ accessToken: "IGQ-old", now, fetchImpl: bad.impl }),
    ).rejects.toThrow("refresh returned no token");
  });

  it("throws Meta's code and never the token", async () => {
    const f = fakeFetch(
      {
        error: {
          message: "Invalid OAuth access_token=IGQ-secret-token",
          code: 190,
          error_subcode: 463,
        },
      },
      400,
    );
    const err = await sendText({
      credentials,
      igsid: "99",
      text: "x",
      fetchImpl: f.impl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect((err as InstagramApiError).status).toBe(400);
    expect((err as InstagramApiError).code).toBe(190);
    expect((err as Error).message).toContain("#190");
    expect((err as Error).message).toContain("(subcode 463)");
    expect((err as Error).message).not.toContain("IGQ-secret-token");

    const typed = fakeFetch({ error: { type: "OAuthException" } }, 200);
    await expect(
      sendText({ credentials, igsid: "99", text: "x", fetchImpl: typed.impl }),
    ).rejects.toThrow("OAuthException");
    const notJson = (async () =>
      new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    const e2 = await sendText({
      credentials,
      igsid: "99",
      text: "x",
      fetchImpl: notJson,
    }).catch((e) => e);
    expect((e2 as InstagramApiError).code).toBeNull();
    expect((e2 as Error).message).toBe("Instagram: HTTP 502");
  });

  it("redacts a token in text and in a query string", () => {
    expect(redact("x tok y", "tok")).toBe("x [token] y");
    expect(redact("u?access_token=abc&b=1", "")).toBe(
      "u?access_token=[token]&b=1",
    );
  });
});
