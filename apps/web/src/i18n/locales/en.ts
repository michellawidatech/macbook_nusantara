/**
 * English is the source language, so this holds only the strings that must say
 * something OTHER than the default written at the call site.
 *
 * That is currently one entry, and it is the same one `shim.ts` carried in its
 * `OVERRIDES` map before there was a catalogue: components brought over from
 * xinchuan still pass "Xinchuan CMS" as the default for `app.name`.
 */
export const en: Record<string, string> = {
  "app.name": "Macbook Nusantara",
};
