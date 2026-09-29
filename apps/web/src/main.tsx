import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { KeyboardNav } from "./components/KeyboardNav";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Above ThemeProvider, not beside it: ThemeProvider calls
          useAntdLocale() in its own body to feed the app's one
          ConfigProvider, and that hook reads this context. */}
      <LocaleProvider>
        <ThemeProvider>
          {/* Enter to the next field, `/` and `?`, for every screen at once
              (owner ask 2026-09-15). Here rather than in the shell so no page
              has to be wired to get it, and inside ThemeProvider so the
              shortcuts dialog is themed and translated like the rest. */}
          <KeyboardNav />
          {/* No ErrorBoundary here, and the omission is the point.

              One around the router catches the same throws and answers them the
              worst possible way: the fallback replaces the sidebar, the account
              menu and the router itself, so a bad row on Inventory takes every
              other page with it and the only way out is a manual reload. The
              boundary belongs where the page is — `AppLayout` wraps its
              `Outlet` in one and feeds it the pathname as a reset key, so the
              shell survives, and navigating away is enough to recover. */}
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
