/**
 * `pnpm --filter @nusantara/db import:b2soft <folder>`
 *
 * Loads what `tools/b2soft/extract.py` wrote — `manifest.json` and one
 * changeset per month — into the database named by DATABASE_URL, through
 * `commitStore` in import mode: the same validation, ledger check and change
 * feed a till's commit gets, with B2Soft's own document numbers and dates.
 *
 * Safe to run again. A chunk whose probe row already exists is skipped, so an
 * import that stopped halfway carries on where it stopped.
 *
 * It refuses the previous build's live database (`nusantara_pos_app`), and a
 * database holding sales the import did not write: it fills an empty shop, it
 * does not merge into a running one.
 *
 * Afterwards it moves this month's document numbering past the migrated codes
 * (or the first sale of the month collides with a migrated SI), says when the
 * Income & Expense balance starts counting (B2Soft's takings are not money in
 * the drawer), and runs reconcile().
 *
 * ## `--master-only` (owner, 2026-09-18)
 *
 *     pnpm --filter @nusantara/db import:b2soft build/b2soft --master-only
 *
 * The shop runs this app IN PARALLEL with B2Soft for now, and "what is going
 * to be migrated to production is only the master product data, store,
 * warehouse, staff". So this imports the reference chunk alone — the
 * catalogue, the warehouses, the suppliers, the customers and the salespeople
 * — and none of the monthly chunks: no stock, no sales, no purchases, no
 * returns. The customers' and suppliers' OPENING BALANCES are stripped too:
 * B2Soft stays the book of record for who owes what while both run, and a
 * debt copied across today is wrong by tomorrow. The balance start
 * (`finance.openingBalanceAt`) is not set either — there is no history in the
 * drawer to exclude. Logins are a separate step (`pnpm --filter @nusantara/api
 * accounts --owner ersen`), from the salespeople this brings.
 *
 * ## `--with-balances` (owner, 2026-09-21)
 *
 *     python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft --balances-only
 *     pnpm --filter @nusantara/db import:b2soft build/b2soft --master-only --with-balances
 *
 * The cutover the owner described: *"the data that I will migrate is probably
 * only the master product and piutang & utang (payable and receivable) ...
 * pls do not create a long list of migration data from 2020"*.
 *
 * It is `--master-only` with the opening balances KEPT, and it is meant to be
 * fed the extractor's `--balances-only` output, where every customer's and
 * every supplier's whole outstanding position has been rolled into one opening
 * balance from B2Soft's own aged reports. Three years of documents become two
 * numbers per party, which is exactly what was asked for — and what the
 * `openingBalance` columns were added for (2026-09-08, 2026-09-13): *debt from
 * before this app, stated once*.
 *
 * It also sets `finance.openingBalanceAt`, which `--master-only` alone does
 * not: with balances in the shop there IS a before, and without that setting
 * Income & Expense counts three years of B2Soft takings as money in the
 * drawer.
 *
 * Run it with the OWNER connection, the one migrations use: the numbering
 * sequences it creates must belong to the role `next_doc_code` runs as.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, disconnect, type PrismaClient } from "./client.js";
import { formatReports, isClean, reconcile } from "./reconcile.js";
import {
  commitStore,
  recordStoreChanges,
  StoreConflictError,
  StoreValidationError,
} from "./store/index.js";
import { UNUSABLE_PASSWORD_HASH } from "./staffAccounts.js";

/** A syntactically valid hash of nothing anyone knows — the seed's convention. */
const UNUSABLE_HASH = UNUSABLE_PASSWORD_HASH;
const IMPORT_USERNAME = "migrasi-b2soft";

interface Probe {
  readonly collection: "warehouses" | "events" | "orders" | "pos";
  readonly key: string;
}

interface Manifest {
  readonly source: string;
  readonly generatedAt: string;
  readonly cutoff: string;
  readonly staffName: string;
  readonly chunks: readonly {
    readonly file: string;
    readonly label: string;
    readonly probe: Probe | null;
    readonly rows: Record<string, number>;
  }[];
}

async function imported(
  client: PrismaClient,
  probe: Probe | null,
): Promise<boolean> {
  if (probe === null) return false;
  const where = { where: { id: probe.key }, select: { id: true } };
  switch (probe.collection) {
    case "warehouses":
      return (await client.location.findUnique(where)) !== null;
    case "events":
      return (await client.unitEvent.findUnique(where)) !== null;
    case "orders":
      return (await client.order.findUnique(where)) !== null;
    case "pos":
      return (await client.purchaseOrder.findUnique(where)) !== null;
  }
}

async function refuseForeignDatabase(client: PrismaClient): Promise<void> {
  const [row] = await client.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  if (row?.name === "nusantara_pos_app") {
    throw new Error(
      "nusantara_pos_app is the previous build's live database — not importing into it.",
    );
  }
  const foreign = await client.order.count({
    where: { NOT: { id: { startsWith: "b2s-" } } },
  });
  if (foreign > 0) {
    throw new Error(
      `${row?.name} already holds ${foreign} sales the import did not write — it only fills an empty shop.`,
    );
  }
}

/** The account the history is attributed to. Inactive, and nobody can sign in as it. */
async function importStaff(
  client: PrismaClient,
  name: string,
): Promise<string> {
  const row = await client.staff.upsert({
    where: { username: IMPORT_USERNAME },
    update: {},
    create: {
      username: IMPORT_USERNAME,
      name,
      role: "STAFF",
      canApprove: false,
      active: false,
      passwordHash: UNUSABLE_HASH,
      createdAt: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

const JAKARTA_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
});

/** Move `doccode_si_YYYY_MM` / `doccode_pi_YYYY_MM` past every migrated code of this month or later. */
async function advanceNumbering(client: PrismaClient): Promise<string[]> {
  const parts = Object.fromEntries(
    JAKARTA_MONTH.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const thisMonth = `${parts["year"]}/${parts["month"]}`;
  const rows = await client.$queryRaw<
    { prefix: string; month: string; n: number }[]
  >`
    SELECT substring(code from 1 for 2) AS prefix,
           substring(code from 4 for 7) AS month,
           max(substring(code from 12 for 6)::int) AS n
      FROM (SELECT code FROM "Order" UNION ALL SELECT code FROM "PurchaseOrder") AS c
     WHERE code ~ '^(SI|PI)-[0-9]{4}/[0-9]{2}-[0-9]{6}$'
     GROUP BY 1, 2`;
  const moved: string[] = [];
  for (const r of rows) {
    if (r.month < thisMonth) continue;
    const seq = `doccode_${r.prefix.toLowerCase()}_${r.month.replace("/", "_")}`;
    if (!/^doccode_(si|pi)_\d{4}_\d{2}$/.test(seq)) continue;
    const n = Number(r.n);
    await client.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${seq}`);
    await client.$queryRawUnsafe(
      `SELECT setval('${seq}', GREATEST(${n}, (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${seq})), true)`,
    );
    moved.push(`${seq} → ${n}`);
  }
  return moved;
}

/** The balance on Income & Expense counts from here; staff state what was in hand. */
async function startBalanceAt(
  client: PrismaClient,
  cutoff: string,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    const had = await tx.appSetting.findUnique({
      where: { key: "finance.openingBalanceAt" },
    });
    if (had !== null) return false;
    await tx.appSetting.create({
      data: {
        key: "finance.openingBalanceAt",
        value: cutoff,
        updatedAt: new Date(),
      },
    });
    await recordStoreChanges(tx, [["settings", "*"]]);
    return true;
  });
}

/** The chunk that is master data; every other chunk is a month of history. */
const isReference = (chunk: { file: string; label: string }) =>
  chunk.label === "reference" || /-reference\.json$/.test(chunk.file);

/**
 * `--master-only`: the reference chunk without the opening balances. The
 * changeset is the extractor's JSON (collections → rows → next), and only the
 * two collections that carry a balance are touched.
 */
function withoutBalances(changes: unknown): unknown {
  const collections = (
    changes as { collections?: Record<string, { rows?: unknown[] }> }
  ).collections;
  for (const name of ["customers", "suppliers"]) {
    for (const row of collections?.[name]?.rows ?? []) {
      const next = (row as { next?: Record<string, unknown> }).next;
      if (next) {
        delete next["openingBalance"];
        delete next["openingBalanceAt"];
      }
    }
  }
  return changes;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const masterOnly = args.includes("--master-only");
  const withBalances = args.includes("--with-balances");
  const folder = args.find((a) => !a.startsWith("--"));
  const known = ["--master-only", "--with-balances"];
  if (
    folder === undefined ||
    args.some((a) => a.startsWith("--") && !known.includes(a))
  ) {
    console.error(
      "usage: pnpm --filter @nusantara/db import:b2soft <folder written by tools/b2soft/extract.py> [--master-only] [--with-balances]",
    );
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(process.env["INIT_CWD"] ?? process.cwd(), folder);
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  ) as Manifest;
  const client = db();
  await refuseForeignDatabase(client);
  const staffId = await importStaff(client, manifest.staffName);
  console.log(
    `B2Soft export ${manifest.source}, extracted ${manifest.generatedAt}: ${manifest.chunks.length} chunks`,
  );
  if (masterOnly) {
    console.log(
      "master data only: catalogue, warehouses, suppliers, customers and salespeople — " +
        "no stock, no sales, no purchases" +
        (withBalances
          ? ", and every party's outstanding balance as an opening balance"
          : ", and no opening balances"),
    );
  }

  const began = Date.now();
  for (const [i, chunk] of manifest.chunks.entries()) {
    const label = `${String(i).padStart(3, "0")} ${chunk.label.padEnd(9)}`;
    if (masterOnly && !isReference(chunk)) continue;
    if (await imported(client, chunk.probe)) {
      console.log(`  ${label} already imported`);
      continue;
    }
    const started = Date.now();
    const body = JSON.parse(
      await readFile(path.join(root, chunk.file), "utf8"),
    ) as { changes: unknown };
    const changes =
      masterOnly && !withBalances
        ? withoutBalances(body.changes)
        : body.changes;
    try {
      await commitStore(client, {
        staffId,
        changes,
        mode: "import",
        timeoutMs: 1_800_000,
      });
    } catch (e) {
      if (
        e instanceof StoreValidationError ||
        e instanceof StoreConflictError
      ) {
        const where =
          e instanceof StoreValidationError
            ? ` [${e.collection ?? "-"} ${e.key ?? "-"}]`
            : "";
        throw new Error(`${chunk.label}: ${e.message}${where}`, { cause: e });
      }
      throw e;
    }
    const rows = Object.entries(chunk.rows)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    console.log(
      `  ${label} ${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s  ${rows}`,
    );
  }
  console.log(`imported in ${((Date.now() - began) / 1000).toFixed(0)} s`);

  for (const line of await advanceNumbering(client))
    console.log(`numbering: ${line}`);
  // With balances in the shop there IS a before, so the balance has to start
  // somewhere — otherwise Income & Expense counts three years of B2Soft
  // takings as money in the drawer.
  if (
    (!masterOnly || withBalances) &&
    (await startBalanceAt(client, manifest.cutoff))
  ) {
    console.log(`Income & Expense counts from ${manifest.cutoff}`);
  }

  const reports = await reconcile(client);
  console.log(`\n${formatReports(reports)}`);
  if (!isClean(reports)) {
    console.error("\nthe imported data is not consistent");
    process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void disconnect());
