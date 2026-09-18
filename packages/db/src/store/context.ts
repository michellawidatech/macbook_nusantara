/**
 * What every collection adapter shares: the row types, the write context, and
 * the conversions between the browser's vocabulary and the schema's.
 *
 * docs/store-on-postgres.md is the design. The short version: the browser
 * reads one object shaped like `MockDb`; each collection of it has an adapter
 * here that can PROJECT it out of PostgreSQL and WRITE a changeset back into
 * it. The adapters never decide policy on their own — the commit
 * (`commit.ts`) owns the order, the locks, the conflict check and the ledger
 * rules — so each one is only the mapping, written out once.
 */
import type { z } from "zod";
import type {
  CollectionName,
  PAYMENT_STATES,
  SALE_SOURCES,
  SingletonName,
  serverSchemas,
} from "@nusantara/store";
import type { Tx } from "../client.js";
import type {
  OpnameStatus,
  PayStatus,
  PayTarget,
  Platform,
  POStatus,
  ReservationStatus,
} from "../../generated/client/index.js";
import { StoreValidationError } from "./errors.js";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

/** A collection's row as the server holds it: money in BigInt. */
export type RowOf<C extends CollectionName> = z.output<
  (typeof serverSchemas.rows)[C]
>;

export type SingletonOf<S extends SingletonName> = z.output<
  (typeof serverSchemas.singletons)[S]
>;

/** One row of a changeset, decoded. */
export interface RowWrite<R> {
  readonly key: string;
  /** The row as the browser last saw it. Absent on an insert. */
  readonly base?: R;
  /** The row as the browser wants it. Absent on a removal. */
  readonly next?: R;
}

export interface ProjectContext {
  /** The signed-in person. `myWarehouseId` is theirs. */
  readonly staffId: string;
}

/**
 * `live` is a till: rows are attributed to the session and document numbers
 * come from `next_doc_code`. `import` is the B2Soft migration: the documents
 * already have numbers and the history already has names.
 */
export type StoreMode = "live" | "import";

export interface Adapter<C extends CollectionName> {
  readonly collection: C;
  /**
   * Rows as the browser reads them. With `keys`, only those rows — and a key
   * whose row is gone (removed, archived, cancelled) is simply absent.
   */
  project(
    tx: Tx,
    ctx: ProjectContext,
    keys?: readonly string[],
  ): Promise<RowOf<C>[]>;
  /** Lock the existing rows behind these keys before their version is read. */
  lock(tx: Tx, keys: readonly string[]): Promise<void>;
  /** Write rows that have already been validated, locked and checked. */
  write(
    ctx: WriteContext,
    rows: readonly RowWrite<RowOf<C>>[],
    order?: readonly string[],
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// The write context
// ---------------------------------------------------------------------------

export class WriteContext {
  /** Every row this commit changed, for StoreChange and for the response. */
  readonly touched = new Map<CollectionName, Set<string>>();
  readonly touchedSingletons = new Set<SingletonName>();

  /**
   * Each unit's status and location as the commit found them, before any
   * write — where its next event starts from. Filled by the commit after it
   * locks the units.
   */
  readonly unitsBefore = new Map<
    string,
    { id: string; status: string; locationId: string }
  >();
  /**
   * Each unit's status and location after the events this commit appended.
   * The commit refuses to finish unless the unit row says the same thing.
   */
  readonly ledgerAfter = new Map<
    string,
    { status: string; locationId: string }
  >();
  /** Units whose row this commit wrote, to be checked against their ledger. */
  readonly unitsWritten = new Set<string>();
  /** Serials archived by this commit; their events' removal is not a ledger edit. */
  readonly archivedSerials = new Set<string>();
  /** The first event time per serial in this changeset — a new unit's intake. */
  readonly firstEventAt = new Map<string, Date>();
  /** Per-commit memo for lookups an adapter repeats. */
  readonly memo = new Map<string, unknown>();
  /**
   * Writes that must wait until every collection has been written: a
   * deposit's allocation names an invoice that the same commit may create, and
   * invoices come after deposits in the collection order.
   */
  readonly later: (() => Promise<void>)[] = [];

  private readonly methodIds = new Map<string, string>();
  private readonly categoryIds = new Map<string, string>();
  private readonly unitIds = new Map<string, string | null>();
  private readonly staffIds = new Map<string, string>();

  constructor(
    readonly tx: Tx,
    /** The session in `live`; the migration's own account in `import`. */
    readonly staffId: string,
    readonly mode: StoreMode,
    readonly now: Date = new Date(),
  ) {}

  touch(collection: CollectionName, key: string): void {
    let keys = this.touched.get(collection);
    if (keys === undefined) {
      keys = new Set();
      this.touched.set(collection, keys);
    }
    keys.add(key);
  }

  touchSingleton(name: SingletonName): void {
    this.touchedSingletons.add(name);
  }

  /**
   * Who a row is attributed to. On a till, always the session — the browser
   * writes a name for the screen's sake and is not believed. In an import,
   * the name the history recorded, when a staff account carries it.
   */
  async staffFor(name: string | undefined): Promise<string> {
    if (this.mode === "live" || name === undefined || name.trim() === "") {
      return this.staffId;
    }
    const wanted = name.trim().toLowerCase();
    const cached = this.staffIds.get(wanted);
    if (cached !== undefined) return cached;
    const found = await this.tx.staff.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    const id = found?.id ?? this.staffId;
    this.staffIds.set(wanted, id);
    return id;
  }

  /** A payment method's id by its code. Unknown codes are refused, not invented. */
  async paymentMethodId(code: string): Promise<string> {
    const cached = this.methodIds.get(code);
    if (cached !== undefined) return cached;
    const row = await this.tx.paymentMethod.findUnique({
      where: { code },
      select: { id: true },
    });
    if (row === null) {
      throw new StoreValidationError(
        `Metode pembayaran "${code}" tidak dikenal.`,
      );
    }
    this.methodIds.set(code, row.id);
    return row.id;
  }

  /**
   * A category's id by the name the browser carries. A category the catalogue
   * has never had is created here, because the browser names categories by
   * typing them on a product and has no other door for one.
   */
  async categoryId(name: string): Promise<string> {
    const clean = name.trim();
    if (clean === "")
      throw new StoreValidationError("Kategori tidak boleh kosong.");
    const cached = this.categoryIds.get(clean);
    if (cached !== undefined) return cached;
    const found = await this.tx.category.findUnique({
      where: { name: clean },
      select: { id: true },
    });
    let id = found?.id;
    if (id === undefined) {
      const max = await this.tx.category.aggregate({
        _max: { sortOrder: true },
      });
      const created = await this.tx.category.create({
        data: {
          name: clean,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          marginMode: "PCT",
          marginMin: 0n,
          marginMax: 0n,
          createdAt: this.now,
        },
        select: { id: true },
      });
      id = created.id;
    }
    this.categoryIds.set(clean, id);
    return id;
  }

  /** The id of the live unit carrying this serial, or undefined. */
  async findUnitId(serial: string): Promise<string | undefined> {
    if (this.unitIds.has(serial)) return this.unitIds.get(serial) ?? undefined;
    const row = await this.tx.unit.findFirst({
      where: { serial, archivedAt: null },
      select: { id: true },
    });
    this.unitIds.set(serial, row?.id ?? null);
    return row?.id;
  }

  async unitId(serial: string): Promise<string> {
    const id = await this.findUnitId(serial);
    if (id === undefined) {
      throw new StoreValidationError(
        `Unit ${serial} tidak ditemukan.`,
        "units",
        serial,
      );
    }
    return id;
  }

  rememberUnit(serial: string, id: string | null): void {
    this.unitIds.set(serial, id);
  }
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/** The tables a commit may lock, spelled out so nothing reaches SQL unchecked. */
const LOCKABLE = new Set([
  "PaymentMethod",
  "Location",
  "Rack",
  "Supplier",
  "Reason",
  "QcDescription",
  "ReservationSource",
  "ReferralSource",
  "Salesperson",
  // A category became a row the browser writes on 2026-09-15 —
  // `Category.tracksSerial`. Without it here `lockRows` refuses the table by
  // name and every commit touching a category fails.
  "Category",
  "CatalogModel",
  "GradingCriterion",
  "GradingRule",
  "Sku",
  "Customer",
  "Discount",
  "AgentKnowledge",
  "Unit",
  "PurchaseOrder",
  "SupplierDeposit",
  "Reservation",
  "Order",
  "UnitReturn",
  "OpnameSession",
  "ServiceVisit",
  "Settlement",
  "UnitEvent",
  "UnitNote",
  "StockIn",
  "StockAdjustment",
  "Expense",
  "ManualIncome",
  "PaymentLog",
  "SettlementLog",
]);

/** `SELECT … FOR UPDATE` on the rows behind these keys, in key order. */
export async function lockRows(
  tx: Tx,
  table: string,
  column: "id" | "serial",
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  if (!LOCKABLE.has(table)) throw new Error(`store: ${table} is not lockable`);
  const sorted = [...new Set(keys)].sort();
  await tx.$queryRawUnsafe(
    `SELECT 1 FROM "${table}" WHERE "${column}" = ANY($1::text[]) ORDER BY "${column}" FOR UPDATE`,
    sorted,
  );
}

/** Every store commit takes this, so change-feed ids commit in the order they were issued. */
export const STORE_COMMIT_LOCK = 7_406_313_001;

export async function takeStoreLock(tx: Tx): Promise<void> {
  // Selected FROM the function: it returns void, which Prisma cannot deserialize.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${STORE_COMMIT_LOCK}::bigint)`;
}

/**
 * Tell polling browsers a row changed. Called by the store commit and by any
 * other writer in this package that changes a row the store projects.
 */
export async function recordStoreChanges(
  tx: Tx,
  entries: Iterable<readonly [string, string]>,
): Promise<void> {
  const data = [...entries].map(([collection, rowKey]) => ({
    collection,
    rowKey,
  }));
  if (data.length === 0) return;
  await tx.storeChange.createMany({ data });
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const JAKARTA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A calendar day in Asia/Jakarta — the schema's convention for days. */
export function dayOf(date: Date): string {
  return JAKARTA_DAY.format(date);
}

/** Midnight in Jakarta on that day, as an instant. */
export function dateOfDay(day: string): Date {
  const d = new Date(`${day}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime()))
    throw new StoreValidationError(`Tanggal tidak valid: ${day}`);
  return d;
}

export function instantOf(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()))
    throw new StoreValidationError(`Waktu tidak valid: ${iso}`);
  return d;
}

export const isoOf = (d: Date): string => d.toISOString();

export const optionalIso = (d: Date | null | undefined): string | undefined =>
  d === null || d === undefined ? undefined : d.toISOString();

// ---------------------------------------------------------------------------
// Vocabulary: the browser's words and the schema's
// ---------------------------------------------------------------------------

export type SaleSource = (typeof SALE_SOURCES)[number];
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PLATFORM_OF_SOURCE: Record<SaleSource, Platform> = {
  OFFLINE: "OFFLINE",
  WHATSAPP: "WA",
  INSTAGRAM: "IG",
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
  LAINNYA: "LAINNYA",
};

export const SOURCE_OF_PLATFORM: Record<Platform, SaleSource> = {
  OFFLINE: "OFFLINE",
  WA: "WHATSAPP",
  IG: "INSTAGRAM",
  SHOPEE: "SHOPEE",
  TOKOPEDIA: "TOKOPEDIA",
  TIKTOK: "TIKTOK",
  LAINNYA: "LAINNYA",
};

export const PAY_STATUS_OF_STATE: Record<PaymentState, PayStatus> = {
  SETTLED: "LUNAS",
  PENDING: "BELUM",
  DUE: "TEMPO",
};

export const STATE_OF_PAY_STATUS: Record<PayStatus, PaymentState> = {
  LUNAS: "SETTLED",
  BELUM: "PENDING",
  TEMPO: "DUE",
  GAGAL: "PENDING",
};

export const PO_STATUS_OF: Record<"DRAFT" | "ORDERED" | "RECEIVED", POStatus> =
  {
    DRAFT: "DRAF",
    ORDERED: "DIPESAN",
    RECEIVED: "DITERIMA",
  };

export const PO_STATUS_FROM: Record<
  POStatus,
  "DRAFT" | "ORDERED" | "RECEIVED"
> = {
  DRAF: "DRAFT",
  DIPESAN: "ORDERED",
  SEBAGIAN: "ORDERED",
  DITERIMA: "RECEIVED",
  BATAL: "DRAFT",
};

export const PAY_TARGET_OF: Record<"ORDER" | "TAX" | "SHIPPING", PayTarget> = {
  ORDER: "BARANG",
  TAX: "PAJAK",
  SHIPPING: "ONGKIR",
};

export const PAY_TARGET_FROM: Record<PayTarget, "ORDER" | "TAX" | "SHIPPING"> =
  {
    BARANG: "ORDER",
    PAJAK: "TAX",
    ONGKIR: "SHIPPING",
  };

export const RESERVATION_STATUS_OF: Record<
  "ACTIVE" | "DONE" | "CANCELLED",
  ReservationStatus
> = {
  ACTIVE: "TERJADWAL",
  DONE: "SELESAI",
  CANCELLED: "BATAL",
};

export const RESERVATION_STATUS_FROM: Record<
  ReservationStatus,
  "ACTIVE" | "DONE" | "CANCELLED"
> = {
  TERJADWAL: "ACTIVE",
  SELESAI: "DONE",
  BATAL: "CANCELLED",
};

export const OPNAME_STATUS_FROM: Record<
  OpnameStatus,
  "DRAFT" | "POSTED" | null
> = {
  BERJALAN: "DRAFT",
  DIPOSTING: "POSTED",
  BATAL: null,
};

// ---------------------------------------------------------------------------
// Small shared rules
// ---------------------------------------------------------------------------

/** A removal of something this system never deletes. */
export function refuseRemoval(
  collection: CollectionName,
  key: string,
): StoreValidationError {
  return new StoreValidationError(
    `Data ini tidak bisa dihapus — nonaktifkan saja (${collection} ${key}).`,
    collection,
    key,
  );
}

/** A change to a row that is written once and never again. */
export function refuseEdit(
  collection: CollectionName,
  key: string,
): StoreValidationError {
  return new StoreValidationError(
    `Catatan ini tidak bisa diubah setelah tersimpan (${collection} ${key}).`,
    collection,
    key,
  );
}

/** Where a key sits in a new order, when there is one. */
export function indexIn(
  order: readonly string[] | undefined,
  key: string,
): number | undefined {
  if (order === undefined) return undefined;
  const i = order.indexOf(key);
  return i === -1 ? undefined : i;
}

/** `undefined` for an empty or blank string, so an optional column stays NULL. */
export const blankToNull = (s: string | undefined | null): string | null =>
  s === undefined || s === null || s.trim() === "" ? null : s;

/** Only the keys whose value is not undefined — for optional browser fields. */
export function defined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
