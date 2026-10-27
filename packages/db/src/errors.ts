/**
 * What a service says when it refuses.
 *
 * These are thrown by `packages/db`'s service functions and caught by three
 * different callers: the REST API turns them into the `{ error: { code,
 * message, field? } }` contract, the agent turns them into the JSON its model
 * reads, and the worker logs them. None of that belongs here, which is why
 * nothing in this file imports Express, `ApiError`, or anything from `apps/`.
 *
 * ## Every message is Indonesian
 *
 * `errorHandler` puts `err.message` straight into the response body and the SPA
 * shows it verbatim to a cashier (01 §4). A class here that carried an English
 * developer message would put that sentence on the shop floor. Same rule
 * `UnknownSerialError` and `IllegalUnitTransitionError` already follow.
 *
 * ## The plural ones are plural on purpose
 *
 * `UnitNotAvailableError` collects every offending machine rather than throwing
 * on the first, for the same reason `UnknownSerialError` names every missing
 * serial: a five-serial hold where two machines have gone should be one answer,
 * not three round trips.
 */

import type { ReservationStatus, UnitStatus } from "@nusantara/domain";

/** One machine that cannot be held, and why. */
export interface UnavailableUnit {
  readonly serial: string;
  readonly status: UnitStatus;
  /** So a caller can offer alternatives from the same variant. */
  readonly skuId: string;
}

/**
 * One or more machines are not sellable stock.
 *
 * Thrown after every serial has been locked and inspected, so the list is
 * complete and the caller can name all of them at once.
 */
export class UnitNotAvailableError extends Error {
  readonly units: readonly UnavailableUnit[];

  constructor(units: readonly UnavailableUnit[]) {
    const named = units.map((u) => `${u.serial} (${u.status})`).join(", ");
    super(`Sudah tidak tersedia: ${named}.`);
    this.name = "UnitNotAvailableError";
    this.units = units;
  }
}

/**
 * No such hold — or none belonging to whoever asked.
 *
 * `ref` is null when the caller named nothing and nothing was open, and the
 * code when they named one that is not theirs. The agent renders those as two
 * different sentences, so collapsing them would lose a distinction a customer
 * hears.
 */
export class HoldNotFoundError extends Error {
  readonly ref: string | null;

  constructor(ref: string | null = null) {
    super(
      ref === null
        ? "Tidak ada reservasi aktif."
        : `Reservasi ${ref} tidak ditemukan.`,
    );
    this.name = "HoldNotFoundError";
    this.ref = ref;
  }
}

/** Several holds are open and the caller named none of them. */
export class AmbiguousHoldError extends Error {
  readonly codes: readonly string[];

  constructor(codes: readonly string[]) {
    super(
      `Ada beberapa reservasi aktif: ${codes.join(", ")}. Sebutkan kodenya.`,
    );
    this.name = "AmbiguousHoldError";
    this.codes = codes;
  }
}

/**
 * This caller already has an open hold in the scope it asked about.
 *
 * Carries the existing code so the caller can hand it back rather than making a
 * second booking — which is the whole point of the guard.
 */
export class DuplicateHoldError extends Error {
  readonly code: string;
  readonly scheduledFor: Date | null;

  constructor(code: string, scheduledFor: Date | null) {
    super(`Nomor ini sudah punya reservasi aktif: ${code}.`);
    this.name = "DuplicateHoldError";
    this.code = code;
    this.scheduledFor = scheduledFor;
  }
}

/** The hold has already been collected or cancelled. */
export class HoldAlreadySettledError extends Error {
  readonly code: string;
  readonly status: ReservationStatus;

  constructor(code: string, status: ReservationStatus) {
    super(`Reservasi ${code} sudah ${status}.`);
    this.name = "HoldAlreadySettledError";
    this.code = code;
    this.status = status;
  }
}

// --- schedule policy -------------------------------------------------------
//
// Three classes rather than one with a reason field, because the three produce
// three different sentences for a customer and two of them carry a number the
// sentence needs. A caller that has not opted into `policy` never sees any.

export class BookingInPastError extends Error {
  readonly scheduledFor: Date;

  constructor(scheduledFor: Date) {
    super("Waktu yang diminta sudah lewat.");
    this.name = "BookingInPastError";
    this.scheduledFor = scheduledFor;
  }
}

export class BookingTooFarAheadError extends Error {
  readonly maxDays: number;

  constructor(maxDays: number) {
    super(`Reservasi paling jauh ${maxDays} hari dari sekarang.`);
    this.name = "BookingTooFarAheadError";
    this.maxDays = maxDays;
  }
}

export class OutsideStoreHoursError extends Error {
  readonly openHour: number;
  readonly closeHour: number;

  constructor(openHour: number, closeHour: number) {
    super(`Toko buka ${openHour}:00 sampai ${closeHour}:00.`);
    this.name = "OutsideStoreHoursError";
    this.openHour = openHour;
    this.closeHour = closeHour;
  }
}

// --- reservation requests (2026-10-27) --------------------------------------

/** No such reservation request. */
export class RequestNotFoundError extends Error {
  constructor(id: string) {
    super(`Permintaan reservasi ${id} tidak ditemukan.`);
    this.name = "RequestNotFoundError";
  }
}

/**
 * The request was already approved, rejected, replaced by a newer one, or
 * lapsed — somebody (or the clock) decided first, and that decision stands.
 */
export class RequestSettledError extends Error {
  readonly state: "APPROVED" | "REJECTED" | "REPLACED" | "EXPIRED";
  constructor(state: RequestSettledError["state"]) {
    const word = {
      APPROVED: "sudah disetujui",
      REJECTED: "sudah ditolak",
      REPLACED: "sudah diganti permintaan yang lebih baru",
      EXPIRED: "sudah kedaluwarsa",
    }[state];
    super(`Permintaan reservasi ini ${word}.`);
    this.name = "RequestSettledError";
    this.state = state;
  }
}
