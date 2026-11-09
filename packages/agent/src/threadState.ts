/**
 * What a conversation is in the middle of, carried explicitly (plan Task 12,
 * 2026-11-09).
 *
 * It used to be guessed from the WORDING of the bot's last reply — "does the
 * last line contain 'amankan unitnya'?" — so a customer who gave the time in
 * one message and the name in the next lost the time, and a yes to "Mau aku
 * cariin yang mirip?" forgot what had been offered. The state is written on
 * the answered row (`WaMessage.entities.state`, a sanctioned JSON column; no
 * migration) in the transaction that sends the reply, and read back from the
 * newest bot-answered row. A row from before this release has no state and
 * reads as EMPTY_STATE.
 *
 * Pure: no Prisma, no clock.
 */

export interface BookingDraft {
  /** The unit to see or keep, or null for a visit with none. */
  readonly serial: string | null;
  /** Jakarta wall clock, "2026-11-14T14:00", as `visitTimeOf` reads it. */
  readonly when: string | null;
  readonly name: string | null;
  /** A keep (a unit they want held) rather than a visit to look. */
  readonly keep: boolean;
  /**
   * Messages this draft has been carried past without progress. It is
   * dropped at BOOKING_MAX_AGE so a half-filled booking from earlier cannot
   * be completed by an unrelated line days later (final review, 2026-11-09).
   */
  readonly age?: number;
}

export const BOOKING_MAX_AGE = 4;

export interface ThreadState {
  readonly v: 1;
  /** A reservation request being filled in, one detail per message. */
  readonly booking: BookingDraft | null;
  /** The search the bot offered ("Mau aku cariin yang mirip?"), run on a yes. */
  readonly pendingSearch: string | null;
}

export const EMPTY_STATE: ThreadState = {
  v: 1,
  booking: null,
  pendingSearch: null,
};

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** "2026-11-14T14:00" or nothing: a malformed time is no time. */
const whenOf = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null;

/** The state on a row's entities; anything missing or malformed is empty. */
export function readState(entities: unknown): ThreadState {
  const raw = (entities as { state?: unknown } | null)?.state;
  if (raw === null || typeof raw !== "object") return EMPTY_STATE;
  const s = raw as Record<string, unknown>;
  if (s["v"] !== 1) return EMPTY_STATE;
  const b = s["booking"];
  const booking =
    b !== null && typeof b === "object"
      ? {
          serial: text((b as Record<string, unknown>)["serial"]),
          when: whenOf((b as Record<string, unknown>)["when"]),
          name: text((b as Record<string, unknown>)["name"]),
          keep: (b as Record<string, unknown>)["keep"] === true,
          age:
            typeof (b as Record<string, unknown>)["age"] === "number"
              ? ((b as Record<string, unknown>)["age"] as number)
              : 0,
        }
      : null;
  return { v: 1, booking, pendingSearch: text(s["pendingSearch"]) };
}

/** Is there anything worth writing? An empty state is not stored. */
export function hasState(state: ThreadState): boolean {
  return state.booking !== null || state.pendingSearch !== null;
}
