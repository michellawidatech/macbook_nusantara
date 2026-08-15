/**
 * Routing and the auth gate.
 *
 * The shell renders before data arrives (S8's constraint): the only thing that
 * waits on the network is the very first "who am I", and that shows a small
 * status rather than a blank page.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { useI18n } from "./lib/i18n.js";
import { useSession } from "./lib/session.js";
import { LoginPage } from "./routes/LoginPage.js";
import { PlaceholderPage } from "./routes/PlaceholderPage.js";

export function App() {
  const { t } = useI18n();
  const session = useSession();

  if (session.isPending) {
    return (
      <p role="status" aria-live="polite" style={{ padding: "var(--s-5)" }}>
        {t("loading")}
      </p>
    );
  }

  const staff = session.data ?? null;

  if (staff === null) {
    return (
      <Routes>
        <Route path="/masuk" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/masuk" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/masuk" element={<Navigate to="/inventori" replace />} />
      <Route element={<AppShell staff={staff} />}>
        <Route index element={<Navigate to="/inventori" replace />} />
        <Route
          path="/inventori"
          element={
            <PlaceholderPage
              title={t("nav.inventori")}
              next="Layar Inventori dibangun di sesi berikutnya (S9)."
            />
          }
        />
        <Route
          path="/penjualan"
          element={
            <PlaceholderPage title={t("nav.penjualan")} next="Increment 2." />
          }
        />
        <Route
          path="/inbound"
          element={
            <PlaceholderPage title={t("nav.inbound")} next="Increment 3." />
          }
        />
        <Route
          path="/pesan"
          element={
            <PlaceholderPage title={t("nav.pesan")} next="Increment 6." />
          }
        />
        <Route
          path="/kontrol"
          element={
            <PlaceholderPage title={t("nav.kontrol")} next="Increment 4." />
          }
        />
        <Route
          path="/laporan"
          element={
            <PlaceholderPage title={t("nav.laporan")} next="Increment 8." />
          }
        />
        <Route
          path="*"
          element={
            <PlaceholderPage title="404" next="Halaman tidak ditemukan." />
          }
        />
      </Route>
    </Routes>
  );
}
