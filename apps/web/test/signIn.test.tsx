/**
 * The app's own sign-in (owner ask 2026-09-18), rendered.
 *
 * "Initially all will be 'password', then in the first time login need to
 * change their password." These drive the real `App` gate against a stubbed
 * API: the sign-in form, the forced change that follows it, and the session
 * watch that moves the gate when some other request hears first. The server's
 * side of the same rules is apps/api/test/accounts.test.ts.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { LocaleProvider } from "../src/i18n/LocaleProvider.js";
import { ThemeProvider } from "../src/theme/ThemeProvider.js";
import { api } from "../src/lib/api.js";
import { StaffAccountsSettings } from "../src/routes/settings/StaffAccountsSettings.js";
import type { Staff } from "../src/lib/session.js";

vi.setConfig({ testTimeout: 60_000 });

/**
 * The shell, stubbed: what is under test is the GATE in front of it. The real
 * AppLayout mounts Inventory over the whole demo shop, which is its own tests'
 * job and costs minutes in jsdom.
 */
vi.mock("../src/layouts/AppLayout.js", () => ({
  AppLayout: ({ staff }: { staff: Staff }) => (
    <main aria-label="Shop">Signed in as {staff.name}</main>
  ),
}));

const ERSEN: Staff = {
  id: "s_ersen",
  username: "ersen",
  name: "Ersen",
  role: "OWNER",
  canApprove: true,
  canViewFinance: true,
  mustChangePassword: true,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[];
/** path → responder. A missing path hangs, the way a slow server would. */
let routes: Record<
  string,
  (body: unknown) => { status: number; json?: unknown }
>;

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  routes = {};
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const handler = routes[`${method} ${path}`];
      if (!handler) return new Promise<Response>(() => undefined);
      const { status, json: payload } = handler(body);
      return json(status, payload);
    },
  ) as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/stock/inventory"]}>
            <App />
          </MemoryRouter>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return client;
}

const unauthorised = () => ({
  status: 401,
  json: { error: { code: "TIDAK_LOGIN", message: "Sesi tidak valid." } },
});

describe("signing in", () => {
  it("keeps the username, clears the password and says only that it was wrong", async () => {
    routes["GET /api/auth/me"] = unauthorised;
    routes["POST /api/auth/login"] = () => ({
      status: 401,
      json: {
        error: {
          code: "TIDAK_LOGIN",
          message: "Nama pengguna atau kata sandi salah.",
        },
      },
    });
    renderApp();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "ersen");
    await user.type(screen.getByLabelText("Password"), "tebakan");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Wrong username or password."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("ersen");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(calls.find((c) => c.path === "/api/auth/login")?.body).toEqual({
      username: "ersen",
      password: "tebakan",
    });
  });

  it("sends a first sign-in straight to choosing a password, and nowhere else", async () => {
    routes["GET /api/auth/me"] = unauthorised;
    routes["POST /api/auth/login"] = () => ({
      status: 200,
      json: { staff: ERSEN },
    });
    renderApp();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "ersen");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Choose your own password" }),
    ).toBeInTheDocument();
    // The shop is not drawn behind it.
    expect(
      screen.queryByRole("main", { name: "Shop" }),
    ).not.toBeInTheDocument();
  });
});

describe("choosing a password", () => {
  beforeEach(() => {
    routes["GET /api/auth/me"] = () => ({
      status: 200,
      json: { staff: ERSEN },
    });
  });

  it("refuses the shop's starting password and a mismatch before asking the server", async () => {
    renderApp();
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Current password"),
      "password",
    );
    await user.type(screen.getByLabelText("New password"), "Password");
    await user.type(
      screen.getByLabelText("Type the new password again"),
      "Password2",
    );
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(
      await screen.findByText(
        "That is the shop's starting password. Choose one of your own.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The two new passwords are different."),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/api/auth/password")).toBe(false);
  });

  it("saves, and lets the person into the shop", async () => {
    routes["POST /api/auth/password"] = () => ({
      status: 200,
      json: { staff: { ...ERSEN, mustChangePassword: false } },
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Current password"),
      "password",
    );
    await user.type(
      screen.getByLabelText("New password"),
      "kopi susu gula aren",
    );
    await user.type(
      screen.getByLabelText("Type the new password again"),
      "kopi susu gula aren",
    );
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    // Past the gate: the shell is drawn.
    expect(
      await screen.findByRole("main", { name: "Shop" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Choose your own password" }),
    ).not.toBeInTheDocument();
    expect(calls.find((c) => c.path === "/api/auth/password")?.body).toEqual({
      currentPassword: "password",
      newPassword: "kopi susu gula aren",
    });
  });

  it("puts a server refusal of the current password on that field", async () => {
    routes["POST /api/auth/password"] = () => ({
      status: 400,
      json: {
        error: {
          code: "VALIDASI",
          message: "Kata sandi sekarang salah.",
          field: "currentPassword",
        },
      },
    });
    renderApp();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Current password"), "salah");
    await user.type(
      screen.getByLabelText("New password"),
      "kopi susu gula aren",
    );
    await user.type(
      screen.getByLabelText("Type the new password again"),
      "kopi susu gula aren",
    );
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(
      await screen.findByText("That is not your current password."),
    ).toBeInTheDocument();
  });
});

describe("a session that ends under an open page", () => {
  it("moves to the change screen on GANTI_SANDI and to sign-in on a 401", async () => {
    routes["GET /api/auth/me"] = () => ({
      status: 200,
      json: { staff: { ...ERSEN, mustChangePassword: false } },
    });
    routes["GET /api/inbox"] = () => ({
      status: 403,
      json: { error: { code: "GANTI_SANDI", message: "Ganti kata sandi." } },
    });
    routes["GET /api/katalog/produk"] = unauthorised;
    renderApp();
    await screen.findByRole("main", { name: "Shop" });

    await api("/api/inbox").catch(() => undefined);
    expect(
      await screen.findByRole("heading", { name: "Choose your own password" }),
    ).toBeInTheDocument();

    await api("/api/katalog/produk").catch(() => undefined);
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
  });
});

describe("the owner's account screen", () => {
  it("lists the accounts and names a new one after the person", async () => {
    routes["GET /api/staff"] = () => ({
      status: 200,
      json: {
        accounts: [
          {
            ...ERSEN,
            mustChangePassword: false,
            active: true,
            lastLoginAt: "2026-09-18T03:00:00.000Z",
            createdAt: "2026-09-18T02:00:00.000Z",
            hasPassword: true,
          },
          {
            id: "s_mila",
            username: "mila",
            name: "Mila",
            role: "STAFF",
            canApprove: false,
            canViewFinance: false,
            active: true,
            mustChangePassword: true,
            lastLoginAt: null,
            createdAt: "2026-09-18T02:00:00.000Z",
            hasPassword: true,
          },
        ],
      },
    });
    routes["POST /api/staff"] = (body) => ({
      status: 201,
      json: {
        account: {
          ...(body as object),
          id: "s_new",
          active: true,
          mustChangePassword: true,
          lastLoginAt: null,
          createdAt: "2026-09-18T04:00:00.000Z",
          hasPassword: true,
        },
      },
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <ThemeProvider>
            <StaffAccountsSettings
              me={{ ...ERSEN, mustChangePassword: false }}
            />
          </ThemeProvider>
        </LocaleProvider>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("Waiting for first sign-in"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You — change your own password under My account"),
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add account/ }));
    // The labels carry the required star, so match their start.
    await user.type(await screen.findByLabelText(/^Name/), "Mila Dua");
    // "mila" is taken, so the suggestion is numbered.
    expect(screen.getByLabelText(/^Username/)).toHaveValue("mila2");
    await user.click(
      screen.getAllByRole("button", { name: /Add account/ }).at(-1)!,
    );

    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        name: "Mila Dua",
        username: "mila2",
        role: "STAFF",
        canApprove: false,
        canViewFinance: false,
      }),
    );
    // antd names the dialog with its title too, so the words appear twice.
    expect(
      (await screen.findAllByText("Tell Mila Dua how to sign in")).length,
    ).toBeGreaterThan(0);
  });
});
