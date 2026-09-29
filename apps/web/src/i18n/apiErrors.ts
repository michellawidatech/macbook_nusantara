import type { TFunction } from "./translate.js";

/**
 * One place to turn a thrown error into copy fit for a toast.
 *
 * A server `message` is passed through untranslated on purpose: it already
 * arrives in Indonesian (see `lib/api.ts`), and it is written for a human. Only
 * the fallback — the one string this app owns — goes through `t`.
 */
export function describeApiError(error: unknown, t?: TFunction): string {
  if (error instanceof Error && error.message) return error.message;
  const fallback = "Something went wrong. Try again.";
  return t ? t("common.genericError", fallback) : fallback;
}
