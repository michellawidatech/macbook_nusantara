/**
 * The shop's day, as one machine-readable fact that prose and logic share.
 *
 * Its own module so `systemFacts.ts` and `tools.ts` can both read it without
 * importing each other. The owner's answer sheet says the same hours
 * ("10.00 – 20.00 WIB", docs/chatbot/knowledge-2026-09-18.md); if they ever
 * change, both change.
 */
export const STORE_HOURS = { openHour: 10, closeHour: 20 } as const;
