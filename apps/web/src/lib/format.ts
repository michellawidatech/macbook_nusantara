/** Read-only money/date formatting — must agree with MoneyInput's display. */
import type { Language } from "../i18n/catalogue.js";

/**
 * The BCP-47 tag the two date formatters below use.
 *
 * Module state, and the trade is deliberate. `fmtDate` and `fmtDateTime` are
 * handed to antd as bare `render` references on a dozen table columns
 * (`render: fmtDateTime`); turning them into a hook would rewrite every one of
 * those call sites to buy a re-render the locale context already causes. The
 * app has exactly ONE language at a time — one provider, one storage key, no
 * per-route or per-modal override — so this variable mirrors a genuinely global
 * fact rather than hiding local state.
 *
 * What it costs, written down plainly: React cannot see this. Assigning it
 * re-renders nothing. It works only because `LocaleProvider` assigns it in the
 * same breath as the context value that DOES re-render the tree, and before
 * that render runs. Nothing else may call `setDateLocale`.
 */
let dateLocale = "en-GB";

/** Points the date formatters at a language. `LocaleProvider` only. */
export function setDateLocale(language: Language): void {
  dateLocale = language === "id" ? "id-ID" : "en-GB";
}

/**
 * Money stays `id-ID` in BOTH languages. The currency is rupiah whatever the
 * interface says, and `Rp 1.500.000` is how a rupiah figure is written on an
 * Indonesian receipt regardless of who is reading it — comma grouping would
 * read as a different number.
 */
export const fmtRp = (n: number | null | undefined): string =>
  n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export const fmtDate = (v: string): string =>
  new Date(v).toLocaleDateString(dateLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * Just the clock — for something that happened moments ago and will happen
 * again in a minute, where the date is noise. The autosave status line is the
 * case it exists for.
 */
export const fmtTime = (v: string): string =>
  new Date(v).toLocaleTimeString(dateLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });

export const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString(dateLocale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
