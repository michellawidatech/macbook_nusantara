/**
 * The shop's day, as one machine-readable fact that prose and logic share.
 *
 * Its own module so `systemFacts.ts` and `tools.ts` can both read it without
 * importing each other. The owner's answer sheet says the same hours
 * ("10.00 – 20.00 WIB", docs/chatbot/knowledge-2026-09-18.md); if they ever
 * change, both change.
 */
export const STORE_HOURS = { openHour: 10, closeHour: 20 } as const;

/** Jakarta keeps UTC+7 all year — no daylight saving to account for. */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * When the shop last closed, if it is closed at `at`; null while it is open.
 * The closed-shop line is said once per closed period (2026-11-16), so a
 * reply needs to know where the current one began.
 */
export function closedSince(at: Date): Date | null {
  const local = new Date(at.getTime() + JAKARTA_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= STORE_HOURS.openHour && hour < STORE_HOURS.closeHour) return null;
  const close = new Date(local);
  close.setUTCHours(STORE_HOURS.closeHour, 0, 0, 0);
  // Before opening, the shop closed the evening before.
  if (hour < STORE_HOURS.openHour) close.setUTCDate(close.getUTCDate() - 1);
  return new Date(close.getTime() - JAKARTA_OFFSET_MS);
}
