/** Read-only money/date formatting — must agree with MoneyInput's display. */
import type { Language } from "../i18n/catalogue.js";
import { makeT, type TFunction } from "../i18n/translate.js";

/**
 * The BCP-47 tag the two date formatters below use, and the lookup `fmtNone`
 * reads its one word from.
 *
 * Module state, and the trade is deliberate. `fmtDate` and `fmtDateTime` are
 * handed to antd as bare `render` references on a dozen table columns
 * (`render: fmtDateTime`); turning them into a hook would rewrite every one of
 * those call sites to buy a re-render the locale context already causes. The
 * app has exactly ONE language at a time — one provider, one storage key, no
 * per-route or per-modal override — so these variables mirror a genuinely
 * global fact rather than hiding local state.
 *
 * What it costs, written down plainly: React cannot see this. Assigning it
 * re-renders nothing. It works only because `LocaleProvider` assigns it in the
 * same breath as the context value that DOES re-render the tree, and before
 * that render runs. Nothing else may call `setFormatLanguage`.
 */
let dateLocale = "en-GB";
let t: TFunction = makeT("en");

/** Points the formatters at a language. `LocaleProvider` only. */
export function setFormatLanguage(language: Language): void {
  dateLocale = language === "id" ? "id-ID" : "en-GB";
  t = makeT(language);
}

/**
 * What an empty cell says when the missing value is a word — a name, a date,
 * a note, a grade: "None", never a dash (owner 2026-09-21: *"if there is no
 * data, pls do not say —, say 0 if numerical or None if categorical"*). A
 * missing AMOUNT or count is a number instead — `fmtRp(0)`, or a plain 0.
 *
 * A function rather than a constant because the word follows the language,
 * the way `fmtDate` does and for the same reason.
 */
export const fmtNone = (): string => t("common.none", "None");

/**
 * Money stays `id-ID` in BOTH languages. The currency is rupiah whatever the
 * interface says, and `Rp 1.500.000` is how a rupiah figure is written on an
 * Indonesian receipt regardless of who is reading it — comma grouping would
 * read as a different number.
 *
 * A missing amount is `Rp 0`, not a dash — a number says 0 when there is none
 * (owner 2026-09-21; `fmtNone` has the rule).
 */
export const fmtRp = (n: number | null | undefined): string =>
  `Rp ${Math.round(n ?? 0).toLocaleString("id-ID")}`;

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
