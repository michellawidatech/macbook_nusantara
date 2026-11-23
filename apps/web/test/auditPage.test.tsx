/**
 * The chatbot audit's page (2026-11-18): last night, the trend and the
 * flags from `/api/audit`, a flag opening its chat with the flagged line
 * highlighted, and the account menu offering it only to the account with
 * `canViewAudit`. The API is the control; this pins the courtesy half.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App as AntdApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuditPage } from "../src/routes/audit/AuditPage.js";
import { AppLayout } from "../src/layouts/AppLayout.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import type { Staff } from "../src/lib/session.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => localStorage.clear());

const RUN = {
  id: "r1",
  startedAt: "2026-11-18T18:00:00.000Z",
  finishedAt: "2026-11-18T18:30:00.000Z",
  model: "claude-sonnet-5-5",
  status: "FAILED",
  reason: "The Anthropic token was refused for claude-sonnet-5-5 (403).",
  chats: 4,
  flags: 2,
  inputTokens: 1000,
  outputTokens: 100,
  costMicros: "12000",
  byCategory: { MISSED_SALE: 1, TONE: 1, BAD: 1, IMPROVE: 1 },
  chatsWithBad: 1,
};
const FLAG = {
  id: "f1",
  threadId: "t1",
  from: "628111000777",
  tester: true,
  messageId: "m1",
  category: "MISSED_SALE",
  severity: "BAD",
  quote: "Air 2014, 2,3jt",
  suggestion: "Ask what it is for before recommending.",
  createdAt: "2026-11-18T18:10:00.000Z",
  dismissedAt: null,
  dismissedBy: null,
};
const THREAD = {
  thread: {
    id: "t1",
    from: "628111000777",
    reviewedFrom: "2026-11-18T07:00:00.000Z",
    reviewedTo: "2026-11-18T07:01:00.000Z",
  },
  lines: [
    {
      messageId: "m1",
      at: "2026-11-18T07:00:00.000Z",
      who: "customer",
      text: "mau cari macbook",
    },
    {
      messageId: "m1",
      at: "2026-11-18T07:00:05.000Z",
      who: "bot",
      text: "Air 2014, 2,3jt",
    },
  ],
  flags: [{ ...FLAG, dismissedAt: null }],
};

const MODELS = [
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    worksWithSetupToken: false,
    takesEffort: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    worksWithSetupToken: true,
    takesEffort: false,
  },
];

const SCORE = {
  days: 30,
  chats: 4,
  good: 2,
  couldBeBetter: 1,
  bad: 1,
  botReplies: 20,
  flaggedReplies: 3,
  byCategory: [
    { category: "MISSED_SALE", flags: 2, bad: 1, chats: 2 },
    { category: "TONE", flags: 1, bad: 0, chats: 1 },
    { category: "OTHER", flags: 0, bad: 0, chats: 0 },
  ],
};

function serve(opts: { run?: object; flags?: object[]; score?: object } = {}) {
  const posted: string[] = [];
  let model = "claude-sonnet-5-5";
  let pending: { days: number; at: string } | null = null;
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url !== "/api/audit/run") posted.push(url);
      if (url === "/api/audit/model" && init?.method === "PUT") {
        posted.push(`PUT ${url} ${String(init.body)}`);
        model = (JSON.parse(String(init.body)) as { model: string }).model;
      }
      if (url === "/api/audit/run" && init?.method === "POST") {
        posted.push(`POST ${url} ${String(init.body)}`);
        pending = {
          days: (JSON.parse(String(init.body)) as { days: number }).days,
          at: "2026-11-20T07:00:00.000Z",
        };
      }
      const body = url.startsWith("/api/audit/score")
        ? (opts.score ?? SCORE)
        : url === "/api/audit/run"
          ? { pending }
          : url.startsWith("/api/audit/model")
            ? { model, defaultModel: "claude-sonnet-5-5", models: MODELS }
            : url.startsWith("/api/audit/runs")
              ? { runs: [opts.run ?? RUN] }
              : url.startsWith("/api/audit/flags?")
                ? { flags: opts.flags ?? [FLAG], nextCursor: null }
                : url.startsWith("/api/audit/threads/")
                  ? THREAD
                  : {
                      flag: {
                        id: "f1",
                        dismissedAt: "2026-11-19T00:00:00.000Z",
                      },
                    };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  ) as typeof globalThis.fetch;
  return posted;
}

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LocaleProvider>
        <AntdApp>
          <MemoryRouter initialEntries={["/audit"]}>
            <Routes>
              <Route path="/audit" element={<AuditPage />} />
            </Routes>
          </MemoryRouter>
        </AntdApp>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe("the chatbot audit page", () => {
  it("shows last night, why it failed, the trend and the flags", async () => {
    serve();
    renderPage();
    expect(
      await screen.findByText("The review could not run"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/refused for claude-sonnet-5-5/),
    ).toBeInTheDocument();
    // A failed review opens the settings, where the fix is.
    expect(screen.getByText("Last 30 nights")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("“Air 2014, 2,3jt”")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Tester").length).toBeGreaterThan(0);
  });

  it("shows only the open flags to look at, bad first, and keeps settings and history folded after a good review", async () => {
    serve({
      run: { ...RUN, status: "DONE", reason: null },
      flags: [
        { ...FLAG, id: "f2", severity: "IMPROVE", quote: "Okee kak" },
        FLAG,
        {
          ...FLAG,
          id: "f3",
          quote: "old one",
          dismissedAt: "2026-11-19T00:00:00.000Z",
        },
      ],
    });
    renderPage();
    expect(
      await screen.findByText("Needs your attention (2)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("The review could not run")).toBeNull();
    expect(screen.queryByText("Last 30 nights")).toBeNull();
    expect(screen.queryByText("“old one”")).toBeNull();
    const quotes = screen.getAllByText(/^“/).map((el) => el.textContent);
    expect(quotes).toEqual(["“Air 2014, 2,3jt”", "“Okee kak”"]);
  });

  it("breaks down how the bot did — conversations, replies and each kind of problem", async () => {
    serve();
    renderPage();
    expect(
      await screen.findByText("50% of 4 conversations had no problem"),
    ).toBeInTheDocument();
    const split = screen.getByTestId("audit-score-split").textContent;
    expect(split).toContain("Good 2 (50%)");
    expect(split).toContain("Could be better 1 (25%)");
    expect(split).toContain("Bad 1 (25%)");
    expect(
      screen.getByText("85% of 20 bot replies had no problem"),
    ).toBeInTheDocument();
    // A category with no flag is not a row.
    const card = screen.getByTestId("audit-score");
    expect(within(card).getByText("Missed sale")).toBeInTheDocument();
    expect(within(card).queryByText("Other")).toBeNull();
  });

  it("says so when no conversation was reviewed in the period", async () => {
    serve({ score: { ...SCORE, chats: 0, good: 0, couldBeBetter: 0, bad: 0 } });
    renderPage();
    expect(
      await screen.findByText(
        "No conversation was reviewed in the last 30 days.",
      ),
    ).toBeInTheDocument();
  });

  it("says so when nothing needs attention", async () => {
    serve({ run: { ...RUN, status: "DONE", reason: null }, flags: [] });
    renderPage();
    expect(
      await screen.findByText("Nothing needs your attention."),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs your attention (0)")).toBeInTheDocument();
  });

  it("opens a flag's chat with the flagged line highlighted, and dismisses it", async () => {
    const posted = serve();
    renderPage();
    fireEvent.click((await screen.findAllByText("“Air 2014, 2,3jt”"))[0]!);
    const chat = await screen.findByTestId("audit-chat");
    await waitFor(() =>
      expect(
        chat.querySelector('[data-flagged="true"]')?.textContent,
      ).toContain("Air 2014, 2,3jt"),
    );
    // The drawer's own button (the row has one too).
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" }).at(-1)!);
    await waitFor(() =>
      expect(posted).toEqual(["/api/audit/flags/f1/dismiss"]),
    );
  });

  it("asks the worker to run the review now, and says it is running", async () => {
    const posted = serve();
    renderPage();
    const button = await screen.findByRole("button", {
      name: /Run the review now/,
    });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(posted).toContain('POST /api/audit/run {"days":7}'),
    );
    expect(
      await screen.findByRole("button", { name: /Review running/ }),
    ).toBeDisabled();
  });

  it("picks the reviewer model, marking the default and the one a setup token runs", async () => {
    const posted = serve();
    renderPage();
    expect(await screen.findByText("Reviewer")).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Reviewer model" });
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.mouseDown(select);
    expect(
      await screen.findByText("Works with a setup token"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Haiku 4.5"));
    await waitFor(() =>
      expect(posted).toContain(
        'PUT /api/audit/model {"model":"claude-haiku-4-5"}',
      ),
    );
    expect(
      await screen.findByText("Saved. The next review uses this model."),
    ).toBeInTheDocument();
  });
});

function useDesktopViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min !== null && Number(min[1]) <= 1200,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

describe("the account menu", () => {
  beforeEach(() => useDesktopViewport());
  const person = (canViewAudit: boolean): Staff => ({
    id: "s1",
    username: "widatech",
    name: "Widatech",
    role: "OWNER",
    canApprove: true,
    canViewFinance: true,
    canViewAudit,
    mustChangePassword: false,
  });
  const shell = (p: Staff) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LocaleProvider>
          <ThemeProvider>
            <MemoryRouter initialEntries={["/stock/opname"]}>
              <Routes>
                <Route element={<AppLayout staff={p} />}>
                  <Route path="/stock/opname" element={<div />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ThemeProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );

  it("offers the audit only to the account with the switch", async () => {
    const { unmount } = shell(person(false));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Account menu" })[0]!,
    );
    expect(await screen.findByText("Sign out")).toBeInTheDocument();
    expect(screen.queryByText("Chatbot audit")).toBeNull();
    unmount();
    shell(person(true));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Account menu" })[0]!,
    );
    expect(await screen.findByText("Chatbot audit")).toBeInTheDocument();
  });
});
