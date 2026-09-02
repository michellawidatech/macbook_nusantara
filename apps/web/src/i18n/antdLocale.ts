import enUS from "antd/locale/en_US";
import idID from "antd/locale/id_ID";
import { useLanguage } from "./useLanguage.js";

/**
 * antd's own bundle for the active language — pagination, Table's sort and
 * filter tooltips, Modal's OK/Cancel, Empty's "no data", DatePicker's chrome.
 *
 * Consumed by `ThemeProvider`, which owns the app's ONE ConfigProvider. That is
 * why this is a hook handing a value over rather than a second ConfigProvider:
 * a nested one would own half the configuration and the two would drift.
 *
 * It does NOT cover the calendar grid. antd's DatePicker takes its month and
 * weekday names from dayjs's GLOBAL locale, which no ConfigProvider can reach —
 * `LocaleProvider`'s `applyGlobals()` sets that, and has to keep doing so or
 * the picker says "Silahkan pilih" over a grid headed Mon/Tue/Wed.
 */
export function useAntdLocale() {
  const { language } = useLanguage();
  return language === "id" ? idID : enUS;
}
