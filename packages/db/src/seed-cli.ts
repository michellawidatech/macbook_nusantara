/**
 * `pnpm --filter @nusantara/db seed`
 *
 * Seeds, then runs all eight reconciliation checks (08 §6) against what it
 * just wrote and exits non-zero if any of them finds anything. A seed that
 * produces incoherent data is worse than no seed: every screen built on it
 * inherits the incoherence.
 *
 * ## SEED_UNITS
 *
 * `SEED_UNITS=0` seeds the REFERENCE data and stops: locations, categories, the
 * catalogue, SKUs, payment methods, staff and the lookup lists — and no units,
 * no orders, no ledger. That is what a real shop starts from, because its stock
 * arrives through Inbound & QC rather than out of a fixture, and five thousand
 * invented serials in a live database are five thousand things somebody has to
 * know to ignore.
 *
 * It is also the only mode that can be run against a REMOTE database. The unit
 * pass wraps two hundred units per transaction, each costing several round
 * trips, against `TXN_TIMEOUTS`' ten-second limit — comfortable over loopback
 * and impossible over the internet, where it dies with P2028 partway through
 * and leaves units carrying no event. The timeout is not the bug; it is the
 * rule that a checkout which cannot finish in ten seconds must fail loudly. To
 * get the FULL fixture onto a remote database, seed a local one and ship the
 * result with pg_dump.
 */

import { db, disconnect } from "./client.js";
import { seed } from "./seed.js";
import { formatReports, isClean, reconcile } from "./reconcile.js";

/**
 * `SEED_UNITS`, or undefined to leave the seed's own default alone.
 *
 * Deliberately distinguishes "not set" from "set to 0": `Number(undefined)` is
 * NaN and `Number("")` is 0, so a bare `Number(env)` would turn an unset
 * variable into a request for zero units and quietly seed a shop with no stock.
 */
function unitCount(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `SEED_UNITS must be a whole number >= 0 — got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

async function main(): Promise<void> {
  const client = db();
  const units = unitCount(process.env["SEED_UNITS"]);
  if (units === 0) {
    console.log(
      "SEED_UNITS=0 — reference data only, no units, orders or events\n",
    );
  }
  const result = await seed(client, {
    ...(units === undefined ? {} : { units }),
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
