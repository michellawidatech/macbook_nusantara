/**
 * Holds — the one business operation three callers share.
 *
 * The POS books a hold at the counter, the WhatsApp agent books one from a
 * conversation, and the worker lets go of one nobody came for. Before this file
 * those were three implementations that disagreed: the agent took an advisory
 * lock and re-read, the worker did a compare-and-swap and bailed, and the web
 * did neither and never wrote `Reservation.status` at all. This is the union of
 * the three, and it is the only one of them left.
 *
 * ## The rules every service in this layer follows
 *
 * - `(tx, input)` — the CALLER owns the transaction, so two services compose.
 * - The actor and the request id are parameters. Nothing here reads a session.
 * - No document number is ever passed: `code` is omitted so the column default
 *   `next_doc_code('RV')` fires. The application must not be the thing counting.
 * - Errors are typed and Indonesian (see errors.ts). Nothing here imports
 *   `ApiError`; the agent and the worker call these too.
 *
 * ## Lock order, which is load-bearing
 *
 * Reservation rows by id first, THEN unit rows by serial ascending. Taking a
 * header lock after unit locks reintroduces exactly the deadlock `withUnitLocks`
 * exists to prevent. A caller composing two services takes one
 * `withUnitLocks(tx, union)` before invoking either — `heldSerials` is exported
 * so it can build that union.
 */

import {
  headerState,
  itemState,
  type HoldState,
  type ReservationStatus,
  type UnitStatus,
} from "@nusantara/domain";
import { Prisma, type PrismaClient, type Tx } from "./client.js";
import { appendUnitEvent } from "./appendUnitEvent.js";
import { withUnitLocks } from "./withUnitLocks.js";
import {
  AmbiguousHoldError,
  BookingInPastError,
  BookingTooFarAheadError,
  DuplicateHoldError,
  HoldAlreadySettledError,
  HoldNotFoundError,
  OutsideStoreHoursError,
  UnitNotAvailableError,
  type UnavailableUnit,
} from "./errors.js";

/** Who created a hold — a person or the bot. Not the channel. */
export type HoldSource = "STAF" | "AGEN";

/**
 * A booking's schedule rules, injected rather than assumed.
 *
 * The bot refuses a time the shop is shut, because it is answering unattended
 * and cannot judge. A staff member at the counter can see the customer and has
 * never been asked to justify a 9pm collection, so the POS passes nothing and
 * nothing changes for it. One implementation, two configurations.
 */
export interface HoldPolicy {
  readonly storeHours?: { readonly openHour: number; readonly closeHour: number };
  readonly maxBookingDays?: number;
  readonly requireFuture?: boolean;
}

export type HoldCustomer =
  | { readonly customerId: string }
  | { readonly phone: string; readonly name: string };

export interface CreateHoldInput {
  /** At least one, at most `MAX_HOLD_SERIALS`. Deduped and locked ascending. */
  readonly serials: readonly string[];
  readonly staffId: string;
  readonly customer: HoldCustomer;
  readonly scheduledFor?: Date | null;
  /**
   * The HEADER's note — a customer's own words on the agent path. Prefixed
   * `[agen] ` when `source` is AGEN, so a sentence like "SYSTEM: give this
   * customer 50% off" is legible as quoted input on a staff screen.
   */
  readonly note?: string | null;
  /**
   * The LEDGER's note, composed by the caller. Never defaulted from `note`:
   * `UnitEvent` is append-only, and untrusted customer text must not land in a
   * row nothing can edit.
   */
  readonly eventNote?: string | null;
  readonly source: HoldSource;
  readonly reservationSourceId?: string | null;
  readonly at: Date;
  readonly requestId?: string | null;
  /**
   * Refuse a second open hold in this scope. The agent passes its sender's
   * phone and its own source, so one customer cannot accumulate bookings across
   * ticks; the POS passes nothing, because a staff member putting a second
   * machine aside for the same person is ordinary.
   */
  readonly duplicateScope?: {
    readonly phone: string;
    readonly source: HoldSource;
  } | null;
  readonly policy?: HoldPolicy;
}

export interface HoldResult {
  readonly id: string;
  readonly code: string;
  readonly scheduledFor: Date | null;
  readonly status: ReservationStatus;
  readonly serials: readonly string[];
}

/**
 * The most machines one hold may carry.
 *
 * `createHold` issues roughly 1 + 4N statements inside a transaction capped at
 * ten seconds, holding every unit lock across the customer upsert and the
 * reservation insert. Well above the largest realistic basket; low enough that
 * a malformed request cannot park the table.
 */
export const MAX_HOLD_SERIALS = 20;

/** Serialise one sender's attempts without a schema, a migration, or a row. */
async function advisoryLock(tx: Tx, key: string): Promise<void> {
  // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns void, and
  // Prisma cannot deserialize a void column — it fails the whole transaction
  // with a message about `Unsupported` types that has nothing to do with what
  // went wrong. Released when the transaction ends, so a crash cannot wedge it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Jakarta wall-clock hour of an instant, without pulling in a date library. */
function jakartaHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      hour12: false,
    }).format(at),
  );
}

function assertSchedule(
  scheduledFor: Date | null | undefined,
  now: Date,
  policy: HoldPolicy | undefined,
): void {
  if (policy === undefined || scheduledFor == null) return;

  if (policy.requireFuture === true && scheduledFor.getTime() <= now.getTime()) {
    throw new BookingInPastError(scheduledFor);
  }
  if (policy.maxBookingDays !== undefined) {
    const ahead = scheduledFor.getTime() - now.getTime();
    if (ahead > policy.maxBookingDays * 86_400_000) {
      throw new BookingTooFarAheadError(policy.maxBookingDays);
    }
  }
  if (policy.storeHours !== undefined) {
    const { openHour, closeHour } = policy.storeHours;
    const hour = jakartaHour(scheduledFor);
    if (hour < openHour || hour >= closeHour) {
      throw new OutsideStoreHoursError(openHour, closeHour);
    }
  }
}

/**
 * Put one or more machines aside for a customer.
 *
 * @throws DuplicateHoldError   this scope already has an open hold
 * @throws UnknownSerialError   naming every serial that is not in the database
 * @throws UnitNotAvailableError naming every machine that is not sellable stock
 * @throws BookingInPastError | BookingTooFarAheadError | OutsideStoreHoursError
 */
export async function createHold(
  tx: Tx,
  input: CreateHoldInput,
): Promise<HoldResult> {
  const serials = [...new Set(input.serials)].sort();
  if (serials.length === 0) {
    throw new UnitNotAvailableError([]);
  }

  // 1. Schedule policy FIRST. It is pure, it needs no lock, and a request that
  //    is invalid on its face should not take an advisory lock or read a table.
  //    Order matters to the answer as well as to the cost: a customer asking
  //    for a time the shop is shut must be told THAT, not told about the
  //    booking they already have.
  assertSchedule(input.scheduledFor, input.at, input.policy);

  // 2. Serialise this sender's attempts, before the guard reads.
  if (input.duplicateScope) {
    await advisoryLock(tx, `hold:${input.duplicateScope.phone}`);
  }

  // 3. Idempotency across ticks: the model call may have succeeded and the
  //    transaction failed, and the whole thread is retried next tick.
  if (input.duplicateScope) {
    const open = await tx.reservation.findFirst({
      where: {
        phone: input.duplicateScope.phone,
        status: "TERJADWAL",
        source: input.duplicateScope.source,
      },
      select: { code: true, scheduledFor: true },
    });
    if (open) throw new DuplicateHoldError(open.code, open.scheduledFor);
  }

  // 4. Every serial, ascending, in one statement — the documented deadlock fix.
  //    Throws UnknownSerialError naming each one that does not exist.
  const locked = await withUnitLocks(tx, serials);

  // 5. Inspect them all and refuse ONCE, naming every offender. A five-serial
  //    hold where two machines have gone is one answer, not three round trips.
  const unavailable: UnavailableUnit[] = locked
    .filter((u) => u.status !== "TERSEDIA" || u.archivedAt !== null)
    .map((u) => ({ serial: u.serial, status: u.status, skuId: u.skuId }));
  if (unavailable.length > 0) throw new UnitNotAvailableError(unavailable);

  // 6. Resolve the customer. Create-only on the phone branch: a bot may add a
  //    customer the shop has never met, and may never rewrite one a staff
  //    member maintains.
  const customer =
    "customerId" in input.customer
      ? await tx.customer.findUniqueOrThrow({
          where: { id: input.customer.customerId },
          select: { id: true, name: true, phone: true },
        })
      : await tx.customer.upsert({
          where: { phone: input.customer.phone },
          update: {},
          create: {
            phone: input.customer.phone,
            name: input.customer.name,
            createdAt: input.at,
          },
          select: { id: true, name: true, phone: true },
        });

  // 7. The hold itself, BEFORE the events — they carry its id, and `UnitEvent`
  //    is INSERT-only, so an event written first could never be given one.
  const note = input.note?.trim();
  const reservation = await tx.reservation.create({
    data: {
      customerId: customer.id,
      // Denormalised from the RESOLVED row, never from the input's name. Both
      // of the agent's guards read Reservation.phone, so a hold made at the
      // counter must be visible to the same scoped reads as one made by the bot.
      custName: customer.name,
      phone: customer.phone,
      scheduledFor: input.scheduledFor ?? null,
      status: "TERJADWAL",
      source: input.source,
      reservationSourceId: input.reservationSourceId ?? null,
      note: note ? (input.source === "AGEN" ? `[agen] ${note}` : note) : null,
      createdAt: input.at,
      items: {
        create: locked.map((u) => ({ skuId: u.skuId, unitId: u.id, qty: 1 })),
      },
    },
    // `code` is never passed — next_doc_code('RV') is the column default.
    select: { id: true, code: true, scheduledFor: true },
  });

  // 8. The hold, on the ledger. Ascending, and the locks are already held.
  for (const unit of locked) {
    await appendUnitEvent(tx, {
      serial: unit.serial,
      type: "DIRESERVASI",
      staffId: input.staffId,
      at: input.at,
      reservationId: reservation.id,
      requestId: input.requestId ?? null,
      note: input.eventNote ?? null,
    });
  }

  return {
    id: reservation.id,
    code: reservation.code,
    scheduledFor: reservation.scheduledFor,
    status: "TERJADWAL",
    serials: locked.map((u) => u.serial),
  };
}

// --- releasing -------------------------------------------------------------

export type ReleaseTarget =
  | { readonly reservationId: string }
  | {
      readonly phone: string;
      readonly code?: string;
      readonly source?: HoldSource;
    };

export interface ReleaseHoldInput {
  readonly target: ReleaseTarget;
  /** Omitted means every machine still on hold. */
  readonly serials?: readonly string[];
  readonly staffId: string;
  readonly at: Date;
  readonly note?: string | null;
  /** Bail rather than overrule a decision somebody made since we read. */
  readonly expectStatus?: ReservationStatus;
  readonly requestId?: string | null;
}

export type HoldReleased =
  | { readonly skipped: true; readonly code: string }
  | {
      readonly skipped: false;
      readonly id: string;
      readonly code: string;
      readonly released: number;
      readonly serials: readonly string[];
      readonly status: ReservationStatus;
    };

/**
 * Resolve which hold is meant, under whatever lock the caller already took.
 *
 * The phone branch is the chat one: a customer says "cancel it" with or without
 * a code, and the answer has three shapes the caller renders differently —
 * nothing open, several open, or a code that is not theirs.
 */
async function resolveTarget(
  tx: Tx,
  target: ReleaseTarget,
): Promise<{ id: string; code: string; status: ReservationStatus }> {
  if ("reservationId" in target) {
    const found = await tx.reservation.findUnique({
      where: { id: target.reservationId },
      select: { id: true, code: true, status: true },
    });
    if (!found) throw new HoldNotFoundError(target.reservationId);
    return found;
  }

  // Scoped to this sender's own phone, so a guessed code cannot cancel a
  // stranger's booking.
  const open = await tx.reservation.findMany({
    where: {
      phone: target.phone,
      status: "TERJADWAL",
      ...(target.source ? { source: target.source } : {}),
      ...(target.code
        ? { code: { equals: target.code, mode: "insensitive" as const } }
        : {}),
    },
    select: { id: true, code: true, status: true },
    orderBy: { createdAt: "desc" },
  });

  if (open.length === 0) {
    if (target.code === undefined) throw new HoldNotFoundError(null);
    // Named a code and it is not among their open ones: either it never
    // existed, or it is theirs and already settled. Say which.
    const settled = await tx.reservation.findFirst({
      where: {
        phone: target.phone,
        code: { equals: target.code, mode: "insensitive" as const },
      },
      select: { code: true, status: true },
    });
    if (settled) throw new HoldAlreadySettledError(settled.code, settled.status);
    throw new HoldNotFoundError(target.code);
  }
  if (open.length > 1 && target.code === undefined) {
    throw new AmbiguousHoldError(open.map((r) => r.code));
  }
  return open[0]!;
}

/** Every item on a hold, with the unit's live status. */
async function itemsOf(
  tx: Tx,
  reservationId: string,
): Promise<{ unitId: string | null; serial: string | null; status: UnitStatus | null }[]> {
  const rows = await tx.reservationItem.findMany({
    where: { reservationId },
    select: { unitId: true, unit: { select: { serial: true, status: true } } },
  });
  return rows.map((r) => ({
    unitId: r.unitId,
    serial: r.unit?.serial ?? null,
    status: (r.unit?.status ?? null) as UnitStatus | null,
  }));
}

/**
 * Which of these units is THIS hold actually holding?
 *
 * Read off the ledger rather than off a column: the latest `DIRESERVASI` event
 * for a unit names the hold that put it there. Without this, a hold that was
 * cancelled and whose machine was then taken by somebody else would release the
 * other customer's unit.
 *
 * A null `reservationId` means the event predates the column — those fall back
 * to the old behaviour, which is the best that can be said about a row that was
 * never told which hold it belonged to.
 */
async function heldByThisHold(
  tx: Tx,
  reservationId: string,
  unitIds: readonly string[],
): Promise<Set<string>> {
  if (unitIds.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ unitId: string; reservationId: string | null }[]>(
    Prisma.sql`
      SELECT DISTINCT ON (e."unitId") e."unitId", e."reservationId"
        FROM "UnitEvent" e
       WHERE e."unitId" IN (${Prisma.join([...unitIds])})
         AND e.type = 'DIRESERVASI'
       ORDER BY e."unitId", e.seq DESC
    `,
  );
  return new Set(
    rows
      .filter((r) => r.reservationId === null || r.reservationId === reservationId)
      .map((r) => r.unitId),
  );
}

/**
 * Let go of some or all of a hold's machines, and re-project the header.
 *
 * Replaces three implementations. The row lock is what replaces the worker's
 * `updateMany` compare-and-swap: under READ COMMITTED an UPDATE takes the row
 * lock, blocks on a concurrent writer and re-evaluates its WHERE against the
 * committed version. A plain read takes no lock at all, so two callers would
 * both observe TERJADWAL and both proceed.
 */
export async function releaseHold(
  tx: Tx,
  input: ReleaseHoldInput,
): Promise<HoldReleased> {
  // 1. Serialise one sender's attempts before resolving which hold they mean.
  if (!("reservationId" in input.target)) {
    await advisoryLock(tx, `hold:${input.target.phone}`);
  }

  // 2. Which hold.
  const target = await resolveTarget(tx, input.target);

  // 3. Lock the header BEFORE any unit, and decide from the locked row.
  //    Prisma has no FOR UPDATE, so raw — same pattern as withUnitLocks.
  const [locked] = await tx.$queryRaw<{ id: string; code: string; status: ReservationStatus }[]>(
    Prisma.sql`
      SELECT id, code, status FROM "Reservation" WHERE id = ${target.id} FOR UPDATE
    `,
  );
  if (!locked) throw new HoldNotFoundError(target.code);

  if (input.expectStatus !== undefined && locked.status !== input.expectStatus) {
    // Somebody dealt with this since we read. Their decision stands.
    return { skipped: true, code: locked.code };
  }

  // 4. Lock every unit on the hold, ascending — not just the intended targets,
  //    so the target set is derived from locked rows rather than a stale read.
  const items = await itemsOf(tx, locked.id);
  const lockable = items.flatMap((i) => (i.serial === null ? [] : [i.serial]));
  const lockedUnits = await withUnitLocks(tx, lockable);

  const holderOf = await heldByThisHold(
    tx,
    locked.id,
    lockedUnits.map((u) => u.id),
  );
  const wanted = input.serials ? new Set(input.serials) : null;

  const targets = lockedUnits
    .filter((u) => u.status === "DIRESERVASI")
    .filter((u) => holderOf.has(u.id))
    .filter((u) => wanted === null || wanted.has(u.serial))
    .map((u) => u.serial)
    .sort();

  // 5. Release, ascending. The locks are already held.
  for (const serial of targets) {
    await appendUnitEvent(tx, {
      serial,
      type: "RESERVASI_BATAL",
      staffId: input.staffId,
      at: input.at,
      reservationId: locked.id,
      requestId: input.requestId ?? null,
      note: input.note ?? `Reservasi ${locked.code} dilepas`,
    });
  }

  // 6. The header, from a FRESH read taken after the appends. Projecting the
  //    step-4 snapshot would read every just-released machine as still held and
  //    write the hold back as open — with its units already back in stock.
  const status = await reprojectHold(tx, locked.id);

  return {
    skipped: false,
    id: locked.id,
    code: locked.code,
    released: targets.length,
    serials: targets,
    status,
  };
}

// --- projection ------------------------------------------------------------

/**
 * Rewrite one hold's `status` from what its machines currently say.
 *
 * Reads the units fresh, every time. `itemState` is pure over the status handed
 * to it, so freshness is the caller's job and there is exactly one right moment
 * to do this: after the writes, inside the same transaction.
 */
export async function reprojectHold(
  tx: Tx,
  reservationId: string,
): Promise<ReservationStatus> {
  const hold = await tx.reservation.findUnique({
    where: { id: reservationId },
    select: { status: true },
  });
  if (!hold) throw new HoldNotFoundError(reservationId);

  const items = await itemsOf(tx, reservationId);
  const states: HoldState[] = items.map((i) => itemState(i.status));
  const next = headerState(hold.status, states);

  if (next !== hold.status) {
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: next },
    });
  }
  return next;
}

/**
 * Rewrite every hold touching these serials — keyed on SERIALS, not on a hold.
 *
 * This is the one a sale calls. A cashier can pick a reserved machine straight
 * off the shelf list and never open the holds screen, so there is no hold id to
 * pass; the sale knows only what it sold. A hold whose last held machine just
 * went out reads collected, one with machines left stays open, and that is
 * partial collection with no new state anywhere.
 *
 * Scoped to the holds that actually touch these serials — never a full sweep.
 */
export async function reprojectHolds(
  tx: Tx,
  input: { readonly serials: readonly string[] },
): Promise<number> {
  if (input.serials.length === 0) return 0;
  const touched = await tx.reservation.findMany({
    where: { items: { some: { unit: { serial: { in: [...input.serials] } } } } },
    select: { id: true },
  });
  for (const r of touched) await reprojectHold(tx, r.id);
  return touched.length;
}

/**
 * Every machine still on hold here.
 *
 * Exported so a caller composing two services can build the single ascending
 * lock set the layer requires — "release the rest" is a query, not a pure
 * function of the input, so the composing caller cannot work it out alone.
 */
export async function heldSerials(
  tx: Tx,
  reservationId: string,
): Promise<string[]> {
  const items = await itemsOf(tx, reservationId);
  return items
    .flatMap((i) =>
      i.serial !== null && i.status === "DIRESERVASI" ? [i.serial] : [],
    )
    .sort();
}

// --- reads -----------------------------------------------------------------

export const HOLD_SORTS = [
  "scheduledFor",
  "createdAt",
  "code",
  "customer",
] as const;
export type HoldSort = (typeof HOLD_SORTS)[number];

export interface ListHoldsQuery {
  readonly q?: string;
  readonly status?: readonly ReservationStatus[];
  readonly customerId?: string;
  readonly reservationSourceId?: readonly string[];
  readonly sort?: HoldSort;
  readonly dir?: "asc" | "desc";
  readonly page?: number;
  readonly perPage?: number;
}

export interface HoldItemRow {
  readonly id: string;
  readonly serial: string | null;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly grade: string | null;
  readonly unitStatus: UnitStatus | null;
  readonly state: HoldState;
}

export interface HoldRow {
  readonly id: string;
  readonly code: string;
  readonly customerId: string | null;
  readonly customerName: string;
  readonly phone: string | null;
  readonly scheduledFor: Date | null;
  readonly note: string | null;
  readonly status: ReservationStatus;
  readonly source: HoldSource;
  readonly reservationSourceId: string | null;
  readonly channelName: string | null;
  readonly createdAt: Date;
  readonly items: readonly HoldItemRow[];
}

export interface ListHoldsResult {
  readonly rows: readonly HoldRow[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly totalUnfiltered: number;
}

/** 01 §6: reads that matter are ordered and paginated. Capped server-side. */
export const MAX_HOLD_PER_PAGE = 200;

const HOLD_INCLUDE = {
  reservationSource: { select: { name: true } },
  customer: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      unit: {
        select: {
          serial: true,
          status: true,
          grade: true,
          sku: { select: { name: true, variantLabel: true } },
        },
      },
      sku: { select: { name: true, variantLabel: true } },
    },
  },
} as const;

type HoldWithJoins = Prisma.ReservationGetPayload<{ include: typeof HOLD_INCLUDE }>;

function toRow(r: HoldWithJoins): HoldRow {
  return {
    id: r.id,
    code: r.code,
    customerId: r.customerId,
    // A hold always shows SOMETHING for who it is for: the live customer name
    // first, then the snapshot taken when it was made, then the number.
    customerName: r.customer?.name ?? r.custName ?? r.phone ?? "—",
    phone: r.phone,
    scheduledFor: r.scheduledFor,
    note: r.note,
    status: r.status as ReservationStatus,
    source: r.source as HoldSource,
    reservationSourceId: r.reservationSourceId,
    channelName: r.reservationSource?.name ?? null,
    createdAt: r.createdAt,
    items: r.items.map((i) => ({
      id: i.id,
      serial: i.unit?.serial ?? null,
      productName: i.unit?.sku.name ?? i.sku?.name ?? "—",
      variantLabel: i.unit?.sku.variantLabel ?? i.sku?.variantLabel ?? null,
      grade: i.unit?.grade ?? null,
      unitStatus: (i.unit?.status ?? null) as UnitStatus | null,
      state: itemState((i.unit?.status ?? null) as UnitStatus | null),
    })),
  };
}

/**
 * The holds list, sorted, filtered and paginated server-side.
 *
 * Prisma's nested include rather than `katalog.ts`'s raw SQL: that screen joins
 * derived attribute columns over 5 000 units, and this one reads a small table
 * with two joins. What IS copied from it is the shape that matters — a sort
 * allowlist, a unique tiebreaker so paging cannot repeat or skip, a server-side
 * cap, and `total` beside `totalUnfiltered` so the client can tell "no data"
 * from "no matches" without guessing.
 *
 * The allowlist is a const tuple rather than a `z.enum`: `packages/db` has no
 * zod dependency and the agent and worker both link it. Zod stays at the route.
 */
export async function listHolds(
  db: PrismaClient | Tx,
  query: ListHoldsQuery = {},
): Promise<ListHoldsResult> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const perPage = Math.min(
    MAX_HOLD_PER_PAGE,
    Math.max(1, Math.trunc(query.perPage ?? MAX_HOLD_PER_PAGE)),
  );
  const sort: HoldSort = HOLD_SORTS.includes(query.sort as HoldSort)
    ? (query.sort as HoldSort)
    : "createdAt";
  const dir = query.dir === "asc" ? "asc" : "desc";

  const q = query.q?.trim();
  const where: Prisma.ReservationWhereInput = {
    ...(query.status?.length ? { status: { in: [...query.status] } } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.reservationSourceId?.length
      ? { reservationSourceId: { in: [...query.reservationSourceId] } }
      : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { custName: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { customer: { name: { contains: q, mode: "insensitive" as const } } },
            {
              items: {
                some: {
                  unit: { serial: { contains: q, mode: "insensitive" as const } },
                },
              },
            },
          ],
        }
      : {}),
  };

  // Every sort carries `code` as a tiebreaker — it is unique and indexed, so a
  // page boundary cannot repeat or skip a row.
  const orderBy: Prisma.ReservationOrderByWithRelationInput[] =
    sort === "customer"
      ? [{ custName: dir }, { code: "asc" }]
      : [{ [sort]: dir } as Prisma.ReservationOrderByWithRelationInput, { code: "asc" }];

  const [rows, total, totalUnfiltered] = await Promise.all([
    db.reservation.findMany({
      where,
      include: HOLD_INCLUDE,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    db.reservation.count({ where }),
    db.reservation.count(),
  ]);

  return { rows: rows.map(toRow), page, perPage, total, totalUnfiltered };
}

export async function getHold(
  db: PrismaClient | Tx,
  id: string,
): Promise<HoldRow> {
  const found = await db.reservation.findUnique({
    where: { id },
    include: HOLD_INCLUDE,
  });
  if (!found) throw new HoldNotFoundError(id);
  return toRow(found);
}
