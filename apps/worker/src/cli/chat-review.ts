/**
 * The chatbot audit, run by hand (2026-11-18): one review now, whatever the
 * hour, instead of waiting for the 01:00–05:00 WIB window.
 *
 *   sudo -u _nusantara /opt/nusantara/current/ops/run chat-review
 *   sudo -u _nusantara /opt/nusantara/current/ops/run chat-review --days 7
 *
 * Reads worker.env (the agent role and the shop's Anthropic token) through
 * ops/run, keeps going until every unreviewed chat is read, the nightly limit
 * is reached, or the model refuses — and says which. The live worker keeps
 * answering customers meanwhile; this run steps aside the same way the night
 * pass does (a customer waiting, a thread being answered).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db as prisma, disconnect } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { loadEnvFile, loadWorkerConfig } from "../config.js";
import { checkDatabaseRole } from "../role.js";
import { reviewPass } from "../reviewPass.js";

function defaultEnvFile(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // apps/worker/src/cli
  return join(
    here,
    "..",
    "..",
    "..",
    "..",
    "secrets",
    "webhook-credentials.env",
  );
}

function daysArg(argv: readonly string[]): number | undefined {
  const i = argv.indexOf("--days");
  if (i < 0) return undefined;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1 || n > 90) {
    process.stderr.write("--days takes a whole number from 1 to 90\n");
    process.exit(64);
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const days = daysArg(process.argv.slice(2));
  const env = {
    ...loadEnvFile(process.env["WORKER_ENV_FILE"] ?? defaultEnvFile()),
    ...process.env,
  };
  const config = loadWorkerConfig(env);
  const logger = createLogger({
    app: "worker",
    env: process.env["NODE_ENV"] ?? "development",
    level: "warn",
  });
  const db = prisma();
  try {
    if (
      !(await checkDatabaseRole(db, process.env["APP_ENV"] ?? "dev", logger))
    ) {
      process.exitCode = 78;
      return;
    }
    let reviewed = 0;
    let flags = 0;
    for (;;) {
      const r = await reviewPass({
        db,
        logger,
        anthropic: config.anthropic,
        ignoreWindow: true,
        maxChats: 5,
        ...(days ? { backfillDays: days } : {}),
      });
      reviewed += r.reviewed;
      flags += r.flags;
      if (r.reviewed > 0)
        process.stdout.write(
          `read ${reviewed} chat(s), ${flags} flag(s) so far\n`,
        );
      if (r.status === "busy") {
        process.stdout.write(
          "a customer is waiting — giving the bot a moment\n",
        );
        await sleep(15_000);
        continue;
      }
      if (r.status === "working") continue;
      const run = r.runId
        ? await db.chatReviewRun.findUnique({ where: { id: r.runId } })
        : null;
      process.stdout.write(
        `${r.status.toUpperCase()}: ${reviewed} chat(s) read, ${flags} flag(s)` +
          (run?.reason ? ` — ${run.reason}` : "") +
          "\n",
      );
      if (r.status === "failed") process.exitCode = 1;
      return;
    }
  } finally {
    await disconnect();
  }
}

void main();
