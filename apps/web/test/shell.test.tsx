/**
 * S8 — the shell and login.
 *
 * The Definition of Done: "login → shell works, the whole shell is keyboard
 * reachable in visual order, and a route change never blanks the shell."
 *
 * Interaction contracts from 02, not snapshots (01 §7).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { I18nProvider } from "../src/lib/i18n.js";

interface FakeResponse {
  status: number;
  body: unknown;
}

/** A fetch stub that speaks the API's contract, including x-request-id. */
function stubFetch(
  routes: Record<string, FakeResponse | (() => FakeResponse)>,
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = `${init?.method ?? "GET"} ${url}`;
    const entry = routes[key];
    if (entry === undefined) {
      return Promise.reject(new Error(`unstubbed request: ${key}`));
    }
    const { status, body } = typeof entry === "function" ? entry() : entry;
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "x-request-id": "01TESTREQUESTID",
        },
      }),
    );
  });
}

const STAFF = {
  id: "staff_kasir",
  username: "kasir",
  name: "Kasir Toko",
  role: "STAFF" as const,
  canApprove: false,
};

const UNAUTHENTICATED: FakeResponse = {
  status: 401,
  body: { error: { code: "TIDAK_LOGIN", message: "Sesi tidak valid." } },
};

function renderApp(initial = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[initial]}>
          <App />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Vitest's jsdom environment copies a fixed list of globals and localStorage
  // is not on it, so storage is genuinely absent here. The app guards every
  // access for exactly this reason (private mode does the same thing), and the
  // language test below asserts the toggle works without persistence.
  globalThis.localStorage?.clear();
  document.documentElement.lang = "id";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("shows the form when nobody is signed in", async () => {
    vi.stubGlobal("fetch", stubFetch({ "GET /api/auth/me": UNAUTHENTICATED }));
    renderApp();

    expect(
      await screen.findByRole("heading", { name: "Masuk" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nama pengguna")).toHaveFocus();
  });

  it("signs in and lands on the shell", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "GET /api/auth/me": UNAUTHENTICATED,
        "POST /api/auth/login": { status: 200, body: { staff: STAFF } },
      }),
    );
    renderApp();

    await user.type(await screen.findByLabelText("Nama pengguna"), "kasir");
    await user.type(screen.getByLabelText("Kata sandi"), "rahasia");
    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(
      await screen.findByRole("navigation", { name: "Navigasi utama" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Kasir Toko")).toBeInTheDocument();
  });

  it("names the reason and keeps the username when it fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "GET /api/auth/me": UNAUTHENTICATED,
        "POST /api/auth/login": {
          status: 401,
          body: {
            error: {
              code: "TIDAK_LOGIN",
              message: "Nama pengguna atau kata sandi salah.",
            },
          },
        },
      }),
    );
    renderApp();

    const username = await screen.findByLabelText("Nama pengguna");
    await user.type(username, "kasir");
    await user.type(screen.getByLabelText("Kata sandi"), "salah");
    await user.click(screen.getByRole("button", { name: "Masuk" }));

    // The server's own Indonesian message, verbatim (01 §4).
    expect(await screen.findByTestId("login-error")).toHaveTextContent(
      "Nama pengguna atau kata sandi salah.",
    );
    // What was typed is not thrown away.
    expect(username).toHaveValue("kasir");
    // 02 §3: focus goes to the field to fix.
    expect(screen.getByLabelText("Kata sandi")).toHaveFocus();
  });

  it("distinguishes an unreachable server from a rejected password", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if ((init?.method ?? "GET") === "GET" && url === "/api/auth/me") {
          return Promise.resolve(
            new Response(JSON.stringify(UNAUTHENTICATED.body), {
              status: 401,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.reject(new TypeError("network down"));
      }),
    );
    renderApp();

    await user.type(await screen.findByLabelText("Nama pengguna"), "kasir");
    await user.type(screen.getByLabelText("Kata sandi"), "rahasia");
    await user.click(screen.getByRole("button", { name: "Masuk" }));

    expect(await screen.findByTestId("login-error")).toHaveTextContent(
      "Tidak bisa menghubungi server. Coba lagi.",
    );
  });

  it("announces the failure politely instead of stealing focus with an alert", async () => {
    vi.stubGlobal("fetch", stubFetch({ "GET /api/auth/me": UNAUTHENTICATED }));
    renderApp();
    const live = await screen.findByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
  });
});

describe("the shell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "GET /api/auth/me": { status: 200, body: { staff: STAFF } },
      }),
    );
  });

  it("renders every section, the account and the language toggle", async () => {
    renderApp("/inventori");
    const nav = await screen.findByRole("navigation", {
      name: "Navigasi utama",
    });

    for (const label of [
      "Inventori",
      "Penjualan",
      "Barang Masuk",
      "Pesan",
      "Kontrol",
      "Laporan",
    ]) {
      expect(
        within(nav).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Keluar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bahasa" })).toBeInTheDocument();
  });

  it("is keyboard reachable in visual order", async () => {
    const user = userEvent.setup();
    renderApp("/inventori");
    await screen.findByRole("navigation", { name: "Navigasi utama" });

    // The skip link comes first, before any chrome — that is its whole point.
    await user.tab();
    expect(
      screen.getByRole("link", { name: "Lompat ke konten" }),
    ).toHaveFocus();

    // Then the header controls, in the order they are painted.
    await user.tab();
    expect(screen.getByRole("button", { name: "Bahasa" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Keluar" })).toHaveFocus();

    // Then the navigation, top to bottom.
    await user.tab();
    expect(screen.getByRole("link", { name: "Inventori" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Penjualan" })).toHaveFocus();
  });

  it("uses no positive tabindex anywhere — DOM order is the tab order", () => {
    renderApp("/inventori");
    for (const el of document.querySelectorAll("[tabindex]")) {
      expect(Number(el.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
    }
  });

  it("never blanks the shell on a route change", async () => {
    const user = userEvent.setup();
    renderApp("/inventori");

    const nav = await screen.findByRole("navigation", {
      name: "Navigasi utama",
    });
    expect(
      screen.getByRole("heading", { name: "Inventori" }),
    ).toBeInTheDocument();

    await user.click(within(nav).getByRole("link", { name: "Laporan" }));

    // The chrome is the same node it was — not re-created, never absent.
    expect(
      await screen.findByRole("heading", { name: "Laporan" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navigasi utama" })).toBe(
      nav,
    );
    expect(screen.getByText("Kasir Toko")).toBeInTheDocument();
  });

  it("marks the current section for assistive tech, not just visually", async () => {
    renderApp("/laporan");
    const link = await screen.findByRole("link", { name: "Laporan" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("switches language and keeps the shell in place", async () => {
    const user = userEvent.setup();
    renderApp("/inventori");

    await user.click(await screen.findByRole("button", { name: "Bahasa" }));

    expect(
      await screen.findByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("sends the previous request id back as x-correlation-id", async () => {
    const fetchMock = stubFetch({
      "GET /api/auth/me": { status: 200, body: { staff: STAFF } },
      "POST /api/auth/logout": { status: 204, body: undefined },
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderApp("/inventori");
    await user.click(await screen.findByRole("button", { name: "Keluar" }));

    await waitFor(() => {
      const logout = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(logout).toBeDefined();
      const headers = (logout?.[1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers["x-correlation-id"]).toBe("01TESTREQUESTID");
    });
  });
});

describe("01 §5 — components read tokens, never hex", () => {
  const dir = join(import.meta.dirname, "../src");

  function cssFiles(root: string): string[] {
    return readdirSync(root).flatMap((entry) => {
      const full = join(root, entry);
      if (statSync(full).isDirectory()) return cssFiles(full);
      return full.endsWith(".css") ? [full] : [];
    });
  }

  it("has no hex colour outside tokens.css", () => {
    const offenders = cssFiles(dir)
      .filter((f) => !f.endsWith("tokens.css"))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b/.test(line)),
      )
      .map(({ f, i, line }) => `${f}:${i} ${line.trim()}`);

    expect(offenders).toEqual([]);
  });

  it("has no hex colour in a component either", () => {
    function tsxFiles(root: string): string[] {
      return readdirSync(root).flatMap((entry) => {
        const full = join(root, entry);
        if (statSync(full).isDirectory()) return tsxFiles(full);
        return full.endsWith(".tsx") ? [full] : [];
      });
    }
    const offenders = tsxFiles(dir).filter((f) =>
      /#[0-9a-fA-F]{6}\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("never kills an outline without replacing it", () => {
    for (const file of cssFiles(dir)) {
      const css = readFileSync(file, "utf8");
      for (const block of css.split("}")) {
        if (!/outline:\s*none/.test(block)) continue;
        // Either the same rule supplies a ring, or it is the shell's <main>,
        // which is only ever focused programmatically.
        const replaced = /box-shadow/.test(block) || /\.main:focus/.test(block);
        expect(replaced, `outline:none with no replacement in ${file}`).toBe(
          true,
        );
      }
    }
  });
});
