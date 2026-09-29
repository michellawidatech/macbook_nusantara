/**
 * `pnpm --filter @nusantara/db seed`
 *
 * Seeds, then runs all eight reconciliation checks (08 §6) against what it
 * just wrote and exits non-zero if any of them finds anything. A seed that
 * produces incoherent data is worse than no seed: every screen built on it
 * inherits the incoherence.
 *
 * ## What it writes
 *
 * The shop in `@nusantara/fixture` — the same one `apps/web`'s browser mock
 * renders. That is the point of the package: S/N Tracking reads this database
 * and Inventory reads the mock, so if the two are not the same shop then the
 * deployed app cannot agree with itself, which is exactly the bug this
 * replaced (2026-09-07).
 *
 * ## SEED_REFERENCE_ONLY
 *
 * `SEED_REFERENCE_ONLY=1` seeds the REFERENCE data and stops: locations,
 * categories, the catalogue, SKUs, payment methods, staff and the lookup lists
 * — and no units, no orders, no ledger. That is what a real shop starts from,
 * because its stock arrives through Inbound & QC rather than out of a fixture.
 *
 * ## Seeding a remote database
 *
 * This is now safe to do. The old fixture wrapped two hundred units per
 * transaction, each costing several round trips, against `TXN_TIMEOUTS`' ten
 * second limit — comfortable over loopback and impossible over the internet,
 * where it died with P2028 partway through and left units carrying no event.
 * The shop is three dozen machines written two at a time, so the largest
 * transaction is a handful of round trips:
 *
 *     DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db seed
 *
 * ⚠️ It TRUNCATES every table first. Never point it at a database holding a
 * shop's real ledger.
 */

import { db, disconnect } from "./client.js";
import { seed } from "./seed.js";
import { formatReports, isClean, reconcile } from "./reconcile.js";

/**
 * Whether `SEED_REFERENCE_ONLY` asks for the catalogue and nothing else.
 *
 * Anything but an unset or empty value counts, EXCEPT the three spellings of
 * no — `0`, `false` and `no`. A variable set to "0" meaning "yes please" is
 * the kind of switch somebody flips once and never trusts again.
 */
function referenceOnly(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no";
}

async function main(): Promise<void> {
  const client = db();
  const bare = referenceOnly(process.env["SEED_REFERENCE_ONLY"]);
  if (bare) {
    console.log(
      "SEED_REFERENCE_ONLY — catalogue only, no units, orders or events\n",
    );
  }
  const result = await seed(client, {
    referenceOnly: bare,
    onProgress: (m) => console.log(`  ${m}`),
  });

  console.log(
    `\nseed: ${result.units} unit, ${result.events} event, ${result.orders} order in ${result.ms} ms`,
  );

  const reports = await reconcile(client);
  console.log(`\n${formatReports(reports)}`);

  if (!isClean(reports)) {
    console.error("\nseed menghasilkan data yang tidak konsisten");
    process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void disconnect());
