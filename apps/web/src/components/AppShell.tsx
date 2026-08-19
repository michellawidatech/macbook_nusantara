/**
 * The app shell — 01 §5 and 02 §12.
 *
 * The shell is chrome, not content: it renders immediately and stays rendered.
 * A route change swaps only the <main>, so navigating never blanks the screen
 * (02 §12: "Never move content after it loads").
 *
 * Tab order follows visual order: skip link → nav → main → account controls are
 * reached in the order they appear, because that is the order they appear in
 * the DOM. No tabindex above 0 anywhere.
 */

import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useI18n, type StringKey } from "../lib/i18n.js";
import { useLogout, type Staff } from "../lib/session.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import styles from "./AppShell.module.css";

const SECTIONS: readonly { path: string; key: StringKey }[] = [
  { path: "/inventori", key: "nav.inventori" },
  { path: "/penjualan", key: "nav.penjualan" },
  { path: "/inbound", key: "nav.inbound" },
  { path: "/pesan", key: "nav.pesan" },
  { path: "/kontrol", key: "nav.kontrol" },
  { path: "/laporan", key: "nav.laporan" },
];

export function AppShell({ staff }: { staff: Staff }) {
  const { t, lang, setLang } = useI18n();
  const location = useLocation();
  const logout = useLogout();

  return (
    <div className={styles.shell}>
      {/* First in the DOM, so it is the first stop for a keyboard user. */}
      <a href="#konten" className={styles.skip}>
        {t("skip.content")}
      </a>

      <header className={styles.header}>
        <span className={styles.brand}>{t("app.name")}</span>

        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.langToggle}
            aria-label={t("lang.toggle")}
            onClick={() => setLang(lang === "id" ? "en" : "id")}
          >
            {lang === "id" ? "ID" : "EN"}
          </button>

          <div className={styles.account}>
            <span className={styles.accountName}>{staff.name}</span>
            <span className={styles.accountRole}>{staff.role}</span>
          </div>

          <button
            type="button"
            className={styles.logout}
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {t("account.logout")}
          </button>
        </div>
      </header>

      <nav className={styles.nav} aria-label={t("nav.label")}>
        <ul className={styles.navList}>
          {SECTIONS.map((s) => (
            <li key={s.path}>
              <NavLink
                to={s.path}
                className={({ isActive }) =>
                  isActive
                    ? `${styles.navLink} ${styles.navLinkActive}`
                    : styles.navLink
                }
              >
                {t(s.key)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main id="konten" className={styles.main} tabIndex={-1}>
        {/* Keyed by path: navigating away from a crashed screen clears it. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
