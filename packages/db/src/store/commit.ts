/**
 * Writing a browser's changeset into PostgreSQL — the one door every POS
 * screen's writes go through (docs/store-on-postgres.md).
 *
 * In ONE transaction, in this order:
 *
 *  1. take the store lock, so change-feed ids commit in the order they were
 *     issued and two commits never interleave;
 *  2. number the documents: every provisional code (`SI-2026/09-Tk3x9q2a`)
 *     gets the next real one from `next_doc_code`, everywhere it was written;
 *  3. lock the rows the changeset touches, and every unit an event names;
 *  4. on a till, refuse the commit if any row is no longer what the browser
 *     based its change on (409) — skipped for the B2Soft import, which only
 *     inserts;
 *  5. write, collection by collection, reference data first and the ledger
 *     last;
 *  6. refuse the commit unless every unit it touched says what its ledger
 *     says (CLAUDE.md: the projection is written with the event, never alone);
 *  7. record what changed for polling browsers, and answer with the canonical
 *     version of every row written.
 */
import { z } from "zod";
import {
  COLLECTION_NAMES,
  COLLECTIONS,
  PROVISIONAL_CODE,
  SINGLETONS,
  comparable,
  isCollectionName,
  isSingletonName,
  keyOf,
  provisionalCodesIn,
  replaceStrings,
  serverSchemas,
  type CollectionName,
  type Row,
  type SingletonName,
} from "@nusantara/store";
import { Prisma, type PrismaClient, type Tx } from "../client.js";
import { adapterOf } from "./adapters/index.js";
import {
  writeAppleDbHidden,
  writeMyWarehouse,
  writeSettings,
} from "./adapters/singletons.js";
import { lastEvents } from "./adapters/units.js";
import {
  type RowWrite,
  type SingletonOf,
  type StoreMode,
  WriteContext,
  recordStoreChanges,
  takeStoreLock,
} from "./context.js";
import { StoreConflictError, StoreValidationError } from "./errors.js";
import {
  currentCursor,
  encodeRow,
  projectDelta,
  projectSingleton,
  type StoreDelta,
} from "./project.js";

/** Collections whose rows are only ever inserted. */
const APPEND_ONLY: ReadonlySet<CollectionName> = new Set<CollectionName>([
  "events",
  "stockIns",
  "paymentLog",
  "settlementLog",
]);

/**
 * Collections whose rows are inserted and may be CORRECTED afterwards, never
 * removed (owner ask 2026-09-24: the stock movement history is editable).
 * Which fields a correction may touch is each adapter's rule — never the
 * quantity of a stock move, never the unit or the direction of an adjustment
 * — and the database's: `nusantara_app`'s UPDATE on both tables is granted
 * per column (`20260924090000_stock_movement_history_editable`), so a
 * rewrite of the rest is refused twice.
 */
const CORRECTABLE: ReadonlySet<CollectionName> = new Set<CollectionName>([
  "adjustments",
  "stockMoves",
]);

export interface CommitInput {
  /** The signed-in person on a till; the migration's own account in an import. */
  readonly staffId: string;
  /** The changeset as it arrived — untrusted. */
  readonly changes: unknown;
  readonly mode?: StoreMode;
  readonly now?: Date;
  /** Transaction timeout. A till's default is 20 s; an import sets its own. */
  readonly timeoutMs?: number;
}

export interface CommitResult extends StoreDelta {
  /** Provisional document code → the number it was given. */
  readonly codes: Record<string, string>;
}

const envelope = z.object({
  collections: z
    .record(
      z.string(),
      z.object({
        rows: z.array(
          z.object({
            key: z.string().min(1),
            base: z.unknown().optional(),
            next: z.unknown().optional(),
            index: z.number().optional(),
          }),
        ),
        order: z.array(z.string()).optional(),
      }),
    )
    .default({}),
  singletons: z
    .record(z.string(), z.object({ base: z.unknown(), next: z.unknown() }))
    .default({}),
});

function explain(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(baris)"}: ${i.message}`)
      .join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

function decode<T>(schema: z.ZodType, value: unknown, where: string): T {
  try {
    return z.decode(schema, value as never) as T;
  } catch (e) {
    throw new StoreValidationError(`Data ${where} tidak valid — ${explain(e)}`);
  }
}

interface Plan {
  readonly name: CollectionName;
  readonly rows: (RowWrite<unknown> & {
    next?: unknown;
    readonly wireBase?: unknown;
  })[];
  readonly order?: readonly string[];
}

interface SingletonPlan {
  readonly name: SingletonName;
  readonly base: unknown;
  readonly next: unknown;
  readonly wireBase: unknown;
}

function plan(changes: unknown): {
  plans: Plan[];
  singletons: SingletonPlan[];
} {
  const parsed = envelope.safeParse(changes);
  if (!parsed.success) {
    throw new StoreValidationError(
      `Perubahan tidak terbaca — ${explain(parsed.error)}`,
    );
  }
  const env = parsed.data;
  for (const name of Object.keys(env.collections)) {
    if (!isCollectionName(name)) {
      throw new StoreValidationError(`Koleksi "${name}" tidak dikenal.`);
    }
    if (!COLLECTIONS[name].writable) {
      throw new StoreValidationError(
        `${name} tidak bisa diubah lewat sini.`,
        name,
      );
    }
  }
  const plans: Plan[] = [];
  for (const name of COLLECTION_NAMES) {
    const c = env.collections[name];
    if (c === undefined) continue;
    const schema = serverSchemas.rows[name] as unknown as z.ZodType;
    const rows = c.rows.map((r) => {
      const next =
        r.next === undefined
          ? undefined
          : decode(schema, r.next, `${name} ${r.key}`);
      const base =
        r.base === undefined
          ? undefined
          : decode(schema, r.base, `${name} ${r.key}`);
      const shown = (next ?? base) as Row | undefined;
      if (shown === undefined) {
        throw new StoreValidationError(
          `Baris ${name} ${r.key} kosong.`,
          name,
          r.key,
        );
      }
      if (keyOf(name, shown) !== r.key) {
        throw new StoreValidationError(
          `Kunci baris ${name} tidak cocok.`,
          name,
          r.key,
        );
      }
      return { key: r.key, base, next, wireBase: r.base };
    });
    plans.push(
      c.order === undefined ? { name, rows } : { name, rows, order: c.order },
    );
  }
  const singletons: SingletonPlan[] = [];
  for (const [name, s] of Object.entries(env.singletons)) {
    if (!isSingletonName(name) || !SINGLETONS[name].writable) {
      throw new StoreValidationError(`"${name}" tidak bisa diubah lewat sini.`);
    }
    const schema = serverSchemas.singletons[name] as unknown as z.ZodType;
    singletons.push({
      name,
      base: decode(schema, s.base, name),
      next: decode(schema, s.next, name),
      wireBase: s.base,
    });
  }
  return { plans, singletons };
}

/** A database refusal, in the words the till shows. */
function translate(e: unknown): unknown {
  if (e instanceof StoreValidationError || e instanceof StoreConflictError)
    return e;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      return new StoreValidationError(
        `Data dengan nilai yang sama sudah ada (${String(e.meta?.["target"] ?? "")}).`,
      );
    }
    if (e.code === "P2003") {
      return new StoreValidationError(
        `Data yang dirujuk tidak ada (${String(e.meta?.["field_name"] ?? e.meta?.["constraint"] ?? e.message.trim().split("\n").slice(-1)[0] ?? "")}).`,
      );
    }
    if (e.code === "P2025" || e.code === "P2034") {
      return new StoreConflictError(
        "store",
        String(e.meta?.["cause"] ?? e.code),
      );
    }
  }
  if (e instanceof Error) {
    const check = /violates check constraint "([^"]+)"/.exec(e.message);
    if (check !== null) {
      return new StoreValidationError(`Aturan data dilanggar: ${check[1]}.`);
    }
  }
  return e;
}

async function verifyLedger(ctx: WriteContext): Promise<void> {
  const serials = new Set([...ctx.unitsWritten, ...ctx.ledgerAfter.keys()]);
  for (const s of ctx.archivedSerials) serials.delete(s);
  if (serials.size === 0) return;
  const units = await ctx.tx.unit.findMany({
    where: { serial: { in: [...serials] }, archivedAt: null },
    select: { id: true, serial: true, status: true, locationId: true },
  });
  const lasts = await lastEvents(
    ctx.tx,
    units.map((u) => u.id),
  );
  for (const u of units) {
    const last = lasts.get(u.id);
    if (last === undefined) {
      throw new StoreValidationError(
        `Unit ${u.serial} tidak punya riwayat — setiap unit dimulai dengan satu kejadian.`,
        "units",
        u.serial,
      );
    }
    if (last.toStatus !== u.status) {
      throw new StoreValidationError(
        `Status unit ${u.serial} (${u.status}) tidak sama dengan riwayatnya (${last.toStatus}).`,
        "units",
        u.serial,
      );
    }
    const expected =
      ctx.ledgerAfter.get(u.serial)?.locationId ??
      ctx.unitsBefore.get(u.serial)?.locationId;
    if (expected !== undefined && expected !== u.locationId) {
      throw new StoreValidationError(
        `Lokasi unit ${u.serial} tidak sama dengan riwayatnya.`,
        "units",
        u.serial,
      );
    }
  }
}

async function pruneStoreChanges(tx: Tx): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM "StoreChange"
     WHERE "at" < (CURRENT_TIMESTAMP - interval '14 days')::timestamp`;
}

export async function commitStore(
  db: PrismaClient,
  input: CommitInput,
): Promise<CommitResult> {
  const mode = input.mode ?? "live";
  const { plans, singletons } = plan(input.changes);
  const provisional = provisionalCodesIn(
    plans.map((p) => p.rows.map((r) => r.next)),
  );
  // Some rows are written once and never again, whatever they were based on —
  // say so before asking whether the base is stale. The one removal allowed is
  // a unit's events leaving with the unit archived in the same commit; the one
  // edit allowed is a correction to the stock movement history, whose fields
  // the adapter judges (`CORRECTABLE`).
  const removedUnits = new Set(
    (plans.find((p) => p.name === "units")?.rows ?? [])
      .filter((r) => r.next === undefined)
      .map((r) => r.key),
  );
  for (const p of plans) {
    const correctable = CORRECTABLE.has(p.name);
    if (!APPEND_ONLY.has(p.name) && !correctable) continue;
    for (const r of p.rows) {
      if (r.base === undefined) continue;
      if (correctable && r.next !== undefined) continue;
      const serial = (r.base as { serial?: string }).serial;
      const archiving =
        p.name === "events" &&
        r.next === undefined &&
        serial !== undefined &&
        removedUnits.has(serial);
      if (!archiving) {
        throw new StoreValidationError(
          p.name === "events"
            ? "Riwayat unit tidak bisa diubah atau dihapus."
            : correctable
              ? `Catatan ${p.name} tidak bisa dihapus.`
              : `Catatan ${p.name} tidak bisa diubah setelah tersimpan.`,
          p.name,
          r.key,
        );
      }
    }
  }
  if (mode === "import" && provisional.size > 0) {
    throw new StoreValidationError(
      "Impor harus membawa nomor dokumen yang sebenarnya.",
    );
  }

  try {
    return await db.$transaction(
      async (tx) => {
        await takeStoreLock(tx);
        const ctx = new WriteContext(
          tx,
          input.staffId,
          mode,
          input.now ?? new Date(),
        );

        // 2. Numbers.
        const codes: Record<string, string> = {};
        for (const code of provisional) {
          const prefix = PROVISIONAL_CODE.exec(code)?.[1];
          if (prefix === undefined) continue;
          const [row] = await tx.$queryRaw<{ code: string }[]>`
            SELECT next_doc_code(${prefix}) AS code`;
          if (row !== undefined) codes[code] = row.code;
        }
        if (Object.keys(codes).length > 0) {
          for (const p of plans) {
            for (const r of p.rows) {
              if (r.next !== undefined) r.next = replaceStrings(r.next, codes);
            }
          }
        }

        // 3. Locks. The ledger's units are locked with the units.
        const eventRows = plans.find((p) => p.name === "events")?.rows ?? [];
        // Both sides: a removed event names its unit through `base` alone, and
        // that unit still has to be locked and still has its projection
        // checked against whatever is now its last row (2026-09-23).
        const eventSerials = new Set(
          eventRows.flatMap((r) => {
            const row = (r.next ?? r.base) as { serial: string } | undefined;
            return row === undefined ? [] : [row.serial];
          }),
        );
        const unitPlan = plans.find((p) => p.name === "units");
        for (const p of plans) {
          const keys = p.rows.map((r) => r.key);
          await adapterOf(p.name).lock(
            tx,
            p.name === "units"
              ? [...new Set([...keys, ...eventSerials])]
              : keys,
          );
        }
        if (unitPlan === undefined && eventSerials.size > 0) {
          await adapterOf("units").lock(tx, [...eventSerials]);
        }
        const touchedSerials = new Set([
          ...(unitPlan?.rows.map((r) => r.key) ?? []),
          ...eventSerials,
        ]);
        if (touchedSerials.size > 0) {
          const before = await tx.unit.findMany({
            where: { serial: { in: [...touchedSerials] }, archivedAt: null },
            select: { id: true, serial: true, status: true, locationId: true },
          });
          for (const u of before) {
            ctx.unitsBefore.set(u.serial, {
              id: u.id,
              status: u.status,
              locationId: u.locationId,
            });
          }
        }
        for (const r of eventRows) {
          if (r.next === undefined) continue;
          const e = r.next as { serial: string; at: string };
          const at = new Date(e.at);
          const had = ctx.firstEventAt.get(e.serial);
          if (had === undefined || at < had) ctx.firstEventAt.set(e.serial, at);
        }

        // 4. Has anybody changed what this was based on?
        if (mode === "live") {
          for (const p of plans) {
            const found = await adapterOf(p.name).project(
              tx,
              ctx,
              p.rows.map((r) => r.key),
            );
            const current = new Map(
              found.map((row) => [keyOf(p.name, row as unknown as Row), row]),
            );
            for (const r of p.rows) {
              const now = current.get(r.key);
              if (r.base === undefined) {
                if (now !== undefined)
                  throw new StoreConflictError(p.name, r.key);
                continue;
              }
              if (now === undefined)
                throw new StoreConflictError(p.name, r.key);
              if (
                comparable(encodeRow(p.name, now)) !== comparable(r.wireBase)
              ) {
                throw new StoreConflictError(p.name, r.key);
              }
            }
          }
          for (const s of singletons) {
            if (s.name !== "settings") continue;
            const now = await projectSingleton(tx, ctx, "settings");
            if (comparable(now) !== comparable(s.wireBase)) {
              throw new StoreConflictError("settings", "*");
            }
          }
        }

        // 5. Write.
        for (const p of plans) {
          await adapterOf(p.name).write(
            ctx,
            p.rows as RowWrite<never>[],
            p.order,
          );
        }
        for (const s of singletons) {
          if (s.name === "settings") {
            await writeSettings(
              ctx,
              s.base as SingletonOf<"settings">,
              s.next as SingletonOf<"settings">,
            );
          } else if (s.name === "appleDbHidden") {
            await writeAppleDbHidden(ctx, s.next as string[]);
          } else if (s.name === "myWarehouseId") {
            await writeMyWarehouse(ctx, s.next as string);
          }
        }

        for (const task of ctx.later) await task();

        // 6. The projection says what the ledger says.
        await verifyLedger(ctx);

        // 7. Tell the other tills, and answer.
        const entries: [string, string][] = [];
        for (const [collection, keys] of ctx.touched) {
          for (const key of keys) entries.push([collection, key]);
        }
        for (const name of ctx.touchedSingletons) {
          entries.push([name, name === "myWarehouseId" ? ctx.staffId : "*"]);
        }
        await recordStoreChanges(tx, entries);
        if (mode === "live" && Math.random() < 0.02)
          await pruneStoreChanges(tx);

        const delta = await projectDelta(
          tx,
          ctx,
          ctx.touched,
          ctx.touchedSingletons,
        );
        return { ...delta, cursor: await currentCursor(tx), codes };
      },
      {
        maxWait: 10_000,
        timeout: input.timeoutMs ?? (mode === "import" ? 1_800_000 : 20_000),
      },
    );
  } catch (e) {
    throw translate(e);
  }
}
