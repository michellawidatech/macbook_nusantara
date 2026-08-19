/**
 * English-only stand-in for react-i18next (aliased in vite.config.ts).
 *
 * The copied xinchuan components call t(key, 'Default text', { vars }) with
 * the English string inline, so no catalogue is needed — we interpolate the
 * default and override the handful of keys that must say something else here.
 */

const OVERRIDES: Record<string, string> = {
  "app.name": "Nusantara POS",
};

type Vars = Record<string, unknown>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

function t(key: string, defaultValue?: string | Vars, options?: Vars): string {
  const def =
    typeof defaultValue === "string"
      ? defaultValue
      : ((defaultValue?.defaultValue as string | undefined) ?? key);
  const vars =
    typeof defaultValue === "string"
      ? options
      : (defaultValue as Vars | undefined);
  return interpolate(OVERRIDES[key] ?? def, vars);
}

export function useTranslation() {
  return { t, i18n: { language: "en" } };
}
