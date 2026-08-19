/**
 * Indonesian first, English available.
 *
 * The UI is Indonesian (CLAUDE.md); the toggle exists because the owner reads
 * some reports in English. This is a plain dictionary rather than a library:
 * two languages and a few dozen strings do not need i18next, and a dependency
 * here would be a dependency in every component.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "id" | "en";

const STRINGS = {
  id: {
    "app.name": "Nusantara POS",
    "nav.label": "Navigasi utama",
    "nav.inventori": "Inventori",
    "nav.penjualan": "Penjualan",
    "nav.inbound": "Barang Masuk",
    "nav.pesan": "Pesan",
    "nav.kontrol": "Kontrol",
    "nav.laporan": "Laporan",
    "account.menu": "Menu akun",
    "account.logout": "Keluar",
    "lang.toggle": "Bahasa",
    "login.title": "Masuk",
    "login.username": "Nama pengguna",
    "login.password": "Kata sandi",
    "login.submit": "Masuk",
    "login.submitting": "Sedang masuk…",
    "login.failed": "Nama pengguna atau kata sandi salah.",
    "login.offline": "Tidak bisa menghubungi server. Coba lagi.",
    "error.title": "Ada yang salah di halaman ini",
    "error.retry": "Coba lagi",
    loading: "Memuat…",
    "skip.content": "Lompat ke konten",
  },
  en: {
    "app.name": "Nusantara POS",
    "nav.label": "Main navigation",
    "nav.inventori": "Inventory",
    "nav.penjualan": "Sales",
    "nav.inbound": "Inbound",
    "nav.pesan": "Messages",
    "nav.kontrol": "Control",
    "nav.laporan": "Reports",
    "account.menu": "Account menu",
    "account.logout": "Sign out",
    "lang.toggle": "Language",
    "login.title": "Sign in",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.submitting": "Signing in…",
    "login.failed": "Wrong username or password.",
    "login.offline": "Could not reach the server. Try again.",
    "error.title": "Something went wrong on this page",
    "error.retry": "Try again",
    loading: "Loading…",
    "skip.content": "Skip to content",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["id"];

interface I18n {
  readonly lang: Lang;
  readonly t: (key: StringKey) => string;
  readonly setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18n | undefined>(undefined);

const STORAGE_KEY = "nusantara.lang";

/**
 * Storage is optional, not assumed: private browsing disables it, and some
 * test environments do not provide it at all. Indonesian is the default, so
 * losing the preference costs nothing but a click.
 */
function initialLang(): Lang {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "en" ? "en" : "id";
  } catch {
    return "id";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // A preference that cannot be saved is still a preference for this session.
    }
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key) => STRINGS[lang][key] }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (ctx === undefined)
    throw new Error("useI18n dipakai di luar I18nProvider");
  return ctx;
}
