/**
 * Holds, as the SPA sees them. See apps/api/src/routes/reservations.ts.
 *
 * ⚠️ **Dormant since 2026-09-08, deliberately, and not dead.** The page reads
 * the store again, and the reason is the one S/N Tracking came back under a
 * day earlier: the MACHINES a hold claims live in the store — the till reads
 * `db.units`, and so do Inventory and QC — so a hold booked through this
 * client marked a Postgres unit `DIRESERVASI` while the store's copy of the
 * same machine stayed `TERSEDIA`, and the till sold it out from under the
 * customer it was being held for. A hold that does not hold anything is worse
 * than a hold nobody can see.
 *
 * What that costs, stated plainly: a hold the WhatsApp agent books is a real
 * `Reservation` row and the page cannot see it. Today that is theoretical —
 * `packages/agent`'s `reserve` capability has exactly one caller, the worker,
 * and the worker is not deployed (it is optional on the Mac mini; see
 * docs/deploy-macmini.md §8). The day it ships, this page and the till move over
 * together, and everything here is still tested and waiting for them.
 *
 * The types below are still imported by the page: its view model is
 * deliberately this shape, so moving back is a change to one block.
 *
 * Money would cross as strings; a hold carries none. Dates cross as ISO
 * strings and are parsed at the render edge.
 */
import { api } from "./api.js";

export type ReservationStatus = "TERJADWAL" | "SELESAI" | "BATAL";
/** `SOFT` (2026-10-27): reserved for somebody who paid no DP — still on sale. */
export type HoldState = "HELD" | "SOFT" | "BOUGHT" | "RELEASED";
/** Who made the hold — a person or the bot. Not the channel. */
export type HoldSource = "STAF" | "AGEN";

export interface HoldItem {
  readonly id: string;
  readonly serial: string | null;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly grade: string | null;
  readonly unitStatus: string | null;
  /**
   * Derived server-side from the unit's status, in the same read that produced
   * the row. Never stored: whether a machine is held, bought or let go is a
   * fact about the MACHINE, and a second copy is the one that goes stale.
   */
  readonly state: HoldState;
}

export interface Hold {
  readonly id: string;
  readonly code: string;
  readonly customerId: string | null;
  readonly customerName: string;
  readonly phone: string | null;
  /** ISO, or null when the customer named no time. */
  readonly scheduledFor: string | null;
  readonly note: string | null;
  readonly status: ReservationStatus;
  readonly source: HoldSource;
  readonly reservationSourceId: string | null;
  /** The "Came from" channel, already joined. */
  readonly channelName: string | null;
  /** ISO. */
  readonly createdAt: string;
  readonly items: readonly HoldItem[];
}

export interface HoldPage {
  readonly rows: readonly Hold[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  /** So the screen can tell "no holds yet" from "nothing matched". */
  readonly totalUnfiltered: number;
}

export interface ReservationSource {
  readonly id: string;
  readonly name: string;
}

export const holdsKey = ["reservations"] as const;
export const holdSourcesKey = ["reservations", "sources"] as const;

/**
 * Every hold.
 *
 * The list is filtered, searched and sorted in the browser by `ProTable`, which
 * builds its own facet options by scanning the rows — so this asks for the
 * server's whole page (`perPage` defaults to its 200 cap) rather than paging.
 * Above 200 holds that stops being honest and the table needs a controlled
 * total; `total` in the response is what will say so.
 */
export const listHolds = (signal?: AbortSignal) =>
  api<HoldPage>("/api/reservations", signal ? { signal } : {});

export const getHold = (id: string) =>
  api<{ reservation: Hold }>(`/api/reservations/${encodeURIComponent(id)}`);

/** The channel list the create form's "Came from" select offers. */
export const listHoldSources = (signal?: AbortSignal) =>
  api<{ sources: ReservationSource[] }>(
    "/api/reservations/sources",
    signal ? { signal } : {},
  );

export interface CreateHoldBody {
  readonly serials: readonly string[];
  /** One of these two, never both. */
  readonly customerId?: string;
  readonly phone?: string;
  readonly name?: string;
  /** ISO. */
  readonly scheduledFor?: string;
  readonly note?: string;
  readonly reservationSourceId?: string;
}

/**
 * Put machines aside.
 *
 * `idempotencyKey` is not optional in practice: this is the mutation a user can
 * double-click, and without a key a slow connection makes two holds — or, worse,
 * one hold and one "that unit is not available" for the hold they just made.
 */
export const createHold = (body: CreateHoldBody, idempotencyKey: string) =>
  api<{ reservation: Hold }>("/api/reservations", {
    method: "POST",
    body,
    idempotencyKey,
  });

/** Let some machines go. The rest stay held. */
export const releaseHold = (
  id: string,
  serials: readonly string[],
  idempotencyKey: string,
) =>
  api<{ reservation: Hold }>(
    `/api/reservations/${encodeURIComponent(id)}/release`,
    { method: "POST", body: { serials }, idempotencyKey },
  );

/** Let the whole hold go. Every machine still on it returns to stock. */
export const cancelHold = (id: string, idempotencyKey: string) =>
  api<{ reservation: Hold }>(
    `/api/reservations/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: {}, idempotencyKey },
  );
