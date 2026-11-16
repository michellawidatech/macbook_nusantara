/**
 * Chatbot → Comments (2026-11-16): a comment with its post, status chips with
 * counts, and the four actions — reply publicly, the one private DM, hide,
 * done — each posted to its own route. `fetch` is stubbed, so what is checked
 * is the request the page really makes.
 */
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IgComment } from "../src/lib/instagramApi.js";

vi.setConfig({ testTimeout: 90_000 });

const COMMENT: IgComment = {
  id: "c1",
  igCommentId: "17900000000000001",
  fromId: "17841400000000444",
  username: "budi.mac",
  text: "Harga Air M2 berapa kak?",
  isReply: false,
  at: "2026-11-16T04:00:00.000Z",
  status: "NEW",
  reply: null,
  dm: null,
  canPrivateReply: true,
  media: {
    id: "m1",
    igMediaId: "17800000000000001",
    caption: "MacBook Air M2 8/256 mulus, ready kak",
    mediaType: "IMAGE",
    permalink: "https://www.instagram.com/p/ABC123/",
    thumbnailUrl: "https://cdn.example/thumb.jpg",
    at: "2026-11-15T04:00:00.000Z",
  },
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let calls: Call[] = [];
let comment: IgComment;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body =
    typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body });
  if (
    url.startsWith("/api/instagram/comments?") ||
    url === "/api/instagram/comments"
  )
    return Promise.resolve(
      json(200, {
        comments: [comment],
        counts: { NEW: 1, REPLIED: 2, DMED: 0, DONE: 4, HIDDEN: 0 },
      }),
    );
  if (url === "/api/instagram/media")
    return Promise.resolve(
      json(200, {
        media: [
          {
            id: "m1",
            igMediaId: "17800000000000001",
            caption: COMMENT.media.caption,
            permalink: COMMENT.media.permalink,
            thumbnailUrl: COMMENT.media.thumbnailUrl,
            comments: 7,
          },
        ],
      }),
    );
  if (url === "/api/instagram/settings")
    return Promise.resolve(
      json(200, {
        autoReply: false,
        replyTemplate: "Cek DM ya kak",
        dmTemplate: "Halo kak, terima kasih sudah komen",
        updatedAt: null,
      }),
    );
  if (url === "/api/inbox/waiting?instagram=1")
    return Promise.resolve(
      json(200, { count: 0, oldest: null, instagram: 0, comments: 1 }),
    );
  const action = /^\/api\/instagram\/comments\/c1\/(.+)$/.exec(url)?.[1];
  if (action === "reply") {
    comment = {
      ...comment,
      status: "REPLIED",
      reply: {
        text: (body as { text: string }).text,
        at: "2026-11-16T05:00:00.000Z",
        byAgent: false,
        by: "Dina",
        posted: false,
      },
    };
    return Promise.resolve(json(201, comment));
  }
  if (action === "private-reply") {
    comment = {
      ...comment,
      status: "DMED",
      canPrivateReply: false,
      dm: {
        text: (body as { text: string }).text,
        at: "2026-11-16T05:00:00.000Z",
        by: "Dina",
        byAgent: false,
      },
    };
    return Promise.resolve(json(201, comment));
  }
  if (action === "hide") {
    comment = { ...comment, status: "HIDDEN" };
    return Promise.resolve(json(200, comment));
  }
  if (action === "done") {
    comment = { ...comment, status: "DONE" };
    return Promise.resolve(json(200, comment));
  }
  return Promise.resolve(
    json(404, { error: { code: "TIDAK_ADA", message: "not found" } }),
  );
}

vi.mock("../src/lib/session.js", async (original) => ({
  ...(await original<typeof import("../src/lib/session.js")>()),
  useSession: () => ({ data: { role: "STAFF" } }),
}));

const { CommentsPanel } =
  await import("../src/routes/chatbot/CommentsPanel.js");
const { ChatbotPage } = await import("../src/routes/chatbot/ChatbotPage.js");

function draw() {
  return render(
    <AntdApp>
      <CommentsPanel />
    </AntdApp>,
  );
}

const row = async () =>
  (await screen.findByText("Harga Air M2 berapa kak?")).closest(
    "[data-comment]",
  ) as HTMLElement;

const posted = (path: string) =>
  calls.filter((c) => c.method === "POST" && c.url === path);

beforeEach(() => {
  calls = [];
  comment = { ...COMMENT };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Comments tab", () => {
  it("shows the comment with its post, its author and its status", async () => {
    draw();
    const r = await row();
    expect(within(r).getByText("@budi.mac")).toBeInTheDocument();
    expect(within(r).getByText(/MacBook Air M2 8\/256 mulus/)).toBeTruthy();
    const link = within(r).getByRole("link", { name: "Open post" });
    expect(link).toHaveAttribute("href", "https://www.instagram.com/p/ABC123/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(r).getByRole("img", { name: "Post" })).toHaveAttribute(
      "src",
      "https://cdn.example/thumb.jpg",
    );
    expect(within(r).getByText("New")).toBeInTheDocument();

    // Status chips carry their counts, All first.
    const chips = screen.getByRole("group", {
      name: "Filter comments by status",
    });
    expect(within(chips).getByText("All (7)")).toBeInTheDocument();
    expect(within(chips).getByText("Done (4)")).toBeInTheDocument();
  });

  it("filters by status through the query string", async () => {
    const user = userEvent.setup();
    draw();
    await row();
    await user.click(screen.getByText("Replied (2)"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/instagram/comments?status=REPLIED"),
      ).toBe(true),
    );
  });

  it("posts a public reply to the comment's reply route", async () => {
    const user = userEvent.setup();
    draw();
    const r = await row();
    await user.click(within(r).getByRole("button", { name: /Reply publicly/ }));
    await user.type(
      within(r).getByRole("textbox", { name: "Public reply" }),
      "Cek DM ya kak",
    );
    await user.click(within(r).getByRole("button", { name: /Post reply/ }));
    await waitFor(() =>
      expect(posted("/api/instagram/comments/c1/reply")).toHaveLength(1),
    );
    expect(posted("/api/instagram/comments/c1/reply")[0]!.body).toEqual({
      text: "Cek DM ya kak",
    });
    expect(
      await within(await row()).findByText(/Replied publicly by Dina/),
    ).toBeInTheDocument();
  });

  it("sends the one private DM, starting from the owner's template", async () => {
    const user = userEvent.setup();
    draw();
    const r = await row();
    // The template has loaded before the box opens.
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/instagram/settings")).toBe(true),
    );
    await user.click(within(r).getByRole("button", { name: /Send DM$/ }));
    const box = within(r).getByRole("textbox", { name: "Private DM" });
    await waitFor(() =>
      expect(box).toHaveValue("Halo kak, terima kasih sudah komen"),
    );
    const sendButtons = within(r).getAllByRole("button", { name: /Send DM/ });
    await user.click(sendButtons[sendButtons.length - 1]!);
    await waitFor(() =>
      expect(posted("/api/instagram/comments/c1/private-reply")).toHaveLength(
        1,
      ),
    );
    expect(posted("/api/instagram/comments/c1/private-reply")[0]!.body).toEqual(
      { text: "Halo kak, terima kasih sudah komen" },
    );
    // Instagram allows one: the button is off afterwards.
    await waitFor(() =>
      expect(
        within(r).getByRole("button", { name: /Send DM$/ }),
      ).toBeDisabled(),
    );
  });

  it("hides the comment, then refuses Mark done until it is shown", async () => {
    const user = userEvent.setup();
    draw();
    const r = await row();
    await user.click(within(r).getByRole("button", { name: /Hide/ }));
    await waitFor(() =>
      expect(posted("/api/instagram/comments/c1/hide")).toHaveLength(1),
    );
    expect(posted("/api/instagram/comments/c1/hide")[0]!.body).toEqual({
      hidden: true,
    });
    expect(
      await within(r).findByRole("button", { name: /Unhide/ }),
    ).toBeInTheDocument();
    expect(within(r).getByRole("button", { name: /Mark done/ })).toBeDisabled();
  });

  it("marks the comment done", async () => {
    const user = userEvent.setup();
    draw();
    const r = await row();
    await user.click(within(r).getByRole("button", { name: /Mark done/ }));
    await waitFor(() =>
      expect(posted("/api/instagram/comments/c1/done")).toHaveLength(1),
    );
    expect(posted("/api/instagram/comments/c1/done")[0]!.body).toEqual({
      done: true,
    });
    expect(
      await within(r).findByRole("button", { name: /Reopen/ }),
    ).toBeInTheDocument();
  });

  it("disables Send DM when Instagram no longer allows one", async () => {
    comment = { ...COMMENT, canPrivateReply: false };
    draw();
    const r = await row();
    expect(within(r).getByRole("button", { name: /Send DM$/ })).toBeDisabled();
  });
});

describe("/chat?tab=comments", () => {
  it("opens the Comments tab, where a staff alert or the notice points", async () => {
    render(
      <AntdApp>
        <MemoryRouter initialEntries={["/chat?tab=comments"]}>
          <ChatbotPage />
        </MemoryRouter>
      </AntdApp>,
    );
    expect(await row()).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Comments/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
