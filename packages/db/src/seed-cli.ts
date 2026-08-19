/**
 * `pnpm --filter @nusantara/db seed`
 *
 * Seeds, then runs all eight reconciliation checks (08 §6) against what it
 * just wrote and exits non-zero if any of them finds anything. A seed that
 * produces incoherent data is worse than no seed: every screen built on it
 * inherits the incoherence.
 */

import { db, disconnect } from "./client.js";
import { seed } from "./seed.js";
import { formatReports, isClean, reconcile } from "./reconcile.js";

async function main(): Promise<void> {
  const client = db();
  const result = await seed(client, {
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
