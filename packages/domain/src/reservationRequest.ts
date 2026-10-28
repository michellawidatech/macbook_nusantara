/**
 * A reservation REQUEST — what the bot files when a customer wants a unit
 * kept or wants to come and see one at a time (owner, 2026-10-27: *"they can
 * either approve the chat and add it to the reservation list, or we can see
 * the list of who wants to reserve, the unit, the time, and the pending
 * status which they can then approve"*).
 *
 * It is a `ReservationProposal` row, and nothing about its state is stored
 * twice: every status here is DERIVED from the columns the row already has
 * and from the thread's tasks. The bot never confirms one and never holds a
 * unit; a person approves it (which books the `Reservation`) or rejects it.
 *
 * Pure — no clock: `now` is always passed in.
 */

/** How long a request waits for a person before it lapses. */
export const REQUEST_TTL_DAYS = 3;
export const REQUEST_TTL_MS = REQUEST_TTL_DAYS * 86_400_000;

/**
 * - `PENDING` — waiting on a person.
 * - `APPROVED` — booked (`reservationId` / `confirmedAt`).
 * - `REJECTED` — a person said no (`cancelledAt`).
 * - `REPLACED` — the customer asked again before anybody answered; the newer
 *   request stands. Also `cancelledAt`, told apart by `replaced`.
 * - `EXPIRED` — nobody answered before `expiresAt`.
 */
export type RequestStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "REPLACED" | "EXPIRED";

/**
 * What a PENDING request is waiting for: a DP proof the customer says they
 * sent (`DP_PROOF`, a `Perlu verifikasi DP` task on the thread since the
 * request), a DP nobody has mentioned yet (`WAITING_DP`), or nothing — a
 * visit with no unit to keep (`VISIT_ONLY`).
 */
export type RequestWaiting = "DP_PROOF" | "WAITING_DP" | "VISIT_ONLY";

export interface RequestFacts {
  readonly confirmedAt?: string | null;
  readonly reservationId?: string | null;
  readonly cancelledAt?: string | null;
  /** A later request of the same customer was filed at `cancelledAt`. */
  readonly replaced?: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** How many units the customer asked for. */
  readonly unitCount: number;
  /** When a DP proof hand-over was raised on the thread since the request. */
  readonly dpProofAt?: string | null;
}

export function requestStatus(r: RequestFacts, now: Date): RequestStatus {
  if (r.reservationId || r.confirmedAt) return "APPROVED";
  if (r.cancelledAt) return r.replaced ? "REPLACED" : "REJECTED";
  if (new Date(r.expiresAt).getTime() <= now.getTime()) return "EXPIRED";
  return "PENDING";
}

export function requestWaiting(r: RequestFacts): RequestWaiting {
  if (r.dpProofAt) return "DP_PROOF";
  return r.unitCount > 0 ? "WAITING_DP" : "VISIT_ONLY";
}

/** Can a person still approve or reject it? */
export function requestIsOpen(r: RequestFacts, now: Date): boolean {
  return requestStatus(r, now) === "PENDING";
}

const RANK: Record<RequestStatus, number> = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 1,
  REPLACED: 2,
  EXPIRED: 3,
};

/**
 * The Requests tab's order: pending first, the OLDEST first (it has waited
 * longest), then the ones dealt with, newest first, and the lapsed at the
 * bottom.
 */
export function compareRequests(
  a: RequestFacts,
  b: RequestFacts,
  now: Date,
): number {
  const ra = RANK[requestStatus(a, now)];
  const rb = RANK[requestStatus(b, now)];
  if (ra !== rb) return ra - rb;
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  return ra === 0 ? ta - tb : tb - ta;
}

// --- what the customer is told ---------------------------------------------

const JAKARTA_DATE = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const JAKARTA_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "28 Oktober 2026" — a Jakarta calendar day. */
export function jakartaDay(at: Date): string {
  return JAKARTA_DATE.format(at);
}

/** "14.00" — Jakarta wall-clock time, as the shop writes it. */
export function jakartaClock(at: Date): string {
  return JAKARTA_TIME.format(at).replace(":", ".");
}

/** "Rp500rb", "Rp1,5jt" — a DP the way it is said in a chat. */
export function chatRupiah(amount: number): string {
  return amount >= 1_000_000
    ? `Rp${String(Math.round(amount / 100_000) / 10).replace(".", ",")}jt`
    : `Rp${Math.round(amount / 1_000)}rb`;
}

/**
 * The WhatsApp line an approval sends — the owner's template, 2026-10-28:
 * *"Okeyy kak noted, kak [Name, if any] nanti akan kita siapkan [Unit name]
 * nya yaa untuk/di [time of appointment]. Toko kita ada di [Address, opening
 * hours, if not explained before, or if the user asked]"*. The 2026-10-27
 * "DP … sudah kami terima, unit kami tahan sampai …" line is dropped (owner
 * accepted): the template is the whole message.
 */
export function approvalMessage(input: {
  /** "MacBook Air 13" M2 8/256", or null for a visit with no unit. */
  readonly unit: string | null;
  readonly when: Date;
  /** The name the request is under, or null when there is no real one. */
  readonly name?: string | null;
  /** Where the shop is, or null when the chat already has it. */
  readonly place?: {
    readonly address: string;
    readonly hours: string | null;
  } | null;
}): string {
  const at = `${jakartaDay(input.when)} jam ${jakartaClock(input.when)}`;
  const name = input.name?.trim();
  const who = name ? `kak ${name} ` : "";
  const head = input.unit
    ? `Okeyy kak noted, ${who}nanti akan kita siapkan ${input.unit} nya yaa untuk ${at}.`
    : `Okeyy kak noted, ${who}nanti kita tunggu kedatangannya yaa di ${at}.`;
  if (!input.place) return head;
  const hours = input.place.hours ? `, buka ${input.place.hours}` : "";
  return `${head} Toko kita ada di ${input.place.address}${hours}.`;
}

/** The line a rejection sends, with the reason staff gave. */
export function rejectionMessage(reason: string): string {
  const why = reason.trim();
  return `Maaf kak, untuk reservasinya belum bisa kami proses ya 🙏${why ? ` ${why}` : ""}`;
}
