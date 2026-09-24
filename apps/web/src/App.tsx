/** Routing and the auth gate. The shell renders before data arrives (S8). */
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "./layouts/AppLayout.js";
import { useSession, watchSession } from "./lib/session.js";
import { LoginPage } from "./routes/LoginPage.js";
import { ChangePasswordPage } from "./routes/ChangePasswordPage.js";
import { PAGE_ROUTES } from "./pages.js";

export function App() {
  const session = useSession();
  const queryClient = useQueryClient();

  // A 401 or a 403 GANTI_SANDI heard by ANY request moves this gate, so a
  // session that ends under an open page lands on the right screen.
  useEffect(() => watchSession(queryClient), [queryClient]);

  if (session.isPending) {
    return <Spin style={{ margin: 48 }} />;
  }
  const staff = session.data ?? null;
  if (staff === null) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  // On a password somebody else chose: this screen and nothing else, whatever
  // the address says (owner ask 2026-09-18). The API refuses the rest anyway.
  if (staff.mustChangePassword) {
    return <ChangePasswordPage staff={staff} />;
  }
  return (
    <Routes>
      <Route
        path="/login"
        element={<Navigate to="/stock/inventory" replace />}
      />
      <Route element={<AppLayout staff={staff} />}>
        {/* The pages come from `pages.tsx` — one table of every screen. */}
        {PAGE_ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}

        {/* The shift opens on stock, which is the screen a shift opens on. */}
        <Route index element={<Navigate to="/stock/inventory" replace />} />
        {/* Redirects, deliberately NOT in `PAGE_ROUTES`: a redirect is on its
            way somewhere else, and is not a screen. */}
        {/* Inbound merged the Purchase Order and Stock In (QC) screens on
            2026-08-24. Both old paths still resolve, because a bookmark should
            not break on an IA change. */}
        <Route path="/stock/po" element={<Navigate to="/inbound" replace />} />
        <Route path="/stock/in" element={<Navigate to="/inbound" replace />} />
        {/* Reservation left the Stock section on 2026-08-20. The old path is
            kept as a redirect rather than deleted: it is what every bookmark,
            every pasted link in the staff group chat and every one of this
            app's own older screens still points at. */}
        <Route
          path="/stock/reservations"
          element={<Navigate to="/reservations" replace />}
        />
        {/* Inventory absorbed Stock Movement on 2026-08-26 — one table, from
            the product down to the serial. The old path redirects. */}
        <Route
          path="/stock/adjustment"
          element={<Navigate to="/stock/inventory" replace />}
        />
        {/* One page, both directions (2026-08-24). The old leaf paths still
            resolve so bookmarks survive the merge. */}
        <Route
          path="/return/customer"
          element={<Navigate to="/returns" replace />}
        />
        <Route
          path="/return/supplier"
          element={<Navigate to="/returns" replace />}
        />
        {/* Finance went from three screens to two (2026-08-24): one ledger for
            every movement, and Transaction History for sales alone. */}
        <Route
          path="/finance/expense"
          element={<Navigate to="/finance/income-expense" replace />}
        />
        <Route
          path="/finance/cashflow"
          element={<Navigate to="/finance/income-expense" replace />}
        />
        {/* Payable & Receivable was one page of two tabs for a day
            (2026-09-21); they are two leaves since 2026-09-22. */}
        <Route
          path="/finance/payable-receivable"
          element={<Navigate to="/finance/receivable" replace />}
        />
        {/* The inbox and the knowledge base are two tabs of one page since
            2026-08-26. The old leaf path still resolves. */}
        <Route
          path="/chat/knowledge"
          element={<Navigate to="/chat" replace />}
        />
        <Route path="*" element={<Navigate to="/stock/inventory" replace />} />
      </Route>
    </Routes>
  );
}
