/**
 * The two languages this build ships, and the maps that back them.
 *
 * English is the default and the source: CLAUDE.md says copy is English-first,
 * so every string's English form is the one written inline at the call site and
 * Indonesian is opt-in.
 */
import { en } from "./locales/en.js";
import { id } from "./locales/id.js";

export type Language = "en" | "id";

export function isLanguage(value: string | null): value is Language {
  return value === "en" || value === "id";
}

/**
 * The switcher's own options.
 *
 * These labels are endonyms and are never run through `t`. Someone who has the
 * app stuck in a language they cannot read needs to recognise their own
 * language's name to get back out of it — "Inggris" is no help to a reader who
 * only has English.
 */
export const LANGUAGES: readonly { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "id", label: "Bahasa Indonesia" },
];

/**
 * A catalogue is a flat map holding TWO kinds of key, deliberately mixed:
 *
 * - dotted namespaced keys (`common.delete`) — what the components carried over
 *   from xinchuan call, always with an English default written beside them;
 * - English source strings (`Stock`, `Stock In (QC)`) — what `navTrail()`
 *   returns and `PageContainer` hands straight to `t()`. The labels in
 *   `layouts/navigation.tsx` must stay English (navigation.test.tsx asserts on
 *   them), so the English label IS the key and translation happens at render.
 *
 * The two cannot collide: every dotted key contains a `.`, no nav label does.
 *
 * The consequence, written down because it is a trade rather than an accident:
 * an English word used as a key gets the same translation everywhere it
 * appears. "Return" is "Retur" in this app, in every context. At this size that
 * is a feature — the nav block doubles as a glossary, so a page body translated
 * later resolves through it before anyone writes a dotted key for it. If a call
 * site ever needs a different sense of the same word, give it a dotted key;
 * `translate.ts` looks there first.
 */
export const CATALOGUES: Record<Language, Record<string, string>> = { en, id };
