/**
 * The Prisma client, and the transaction settings every write inherits.
 *
 * 08 §3: "maxWait: 5s, timeout: 10s. A checkout that cannot finish in ten
 * seconds must fail loudly, not queue behind a lock while a customer waits."
 *
 * ## Why this file resolves the connection itself
 *
 * `resolveDatabaseUrl` (environment.ts) is the guard that refuses
 * `nusantara_pos_app`, the previous build's still-live database. It was written
 * and tested but never wired in: `db()` was a bare `new PrismaClient()`, so the
 * guard's only caller was its own test and the rule it enforces was, in
 * practice, back to being a line in CLAUDE.md.
 *
 * Wiring it in is not simply "validate `process.env` first", because Prisma
 * Client 6 reads `packages/db/.env` at runtime on its own. Verified here:
 * with `DATABASE_URL` deleted from the environment, a bare client still
 * connects, using the file. Validating the environment while Prisma reads the
 * file would check one string and open another — the exact hole the guard
 * exists to close.
 *
 * So the URL is resolved here, from the same two sources Prisma uses and in
 * the same order (shell wins over file, also verified), and handed back as
 * `datasourceUrl`, which outranks both. What was checked is what is opened.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "../generated/client/index.js";
import { resolveDatabaseUrl, type ResolvedDatabase } from "./environment.js";

export { Prisma, PrismaClient };

/** A transaction handle: the client, minus the things you cannot call inside one. */
export type Tx = Prisma.TransactionClient;

/** 08 §3. Not tunable per call site — a slow checkout must fail, not queue. */
export const TXN_TIMEOUTS = {
  maxWait: 5_000,
  timeout: 10_000,
} as const;

/** `packages/db/.env`, resolved from this module rather than `process.cwd()`. */
function envFilePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
}

/**
 * `DATABASE_URL` as written in `packages/db/.env`, or undefined.
 *
 * A six-line reader rather than a dependency, and deliberately narrow: it
 * answers for one key and never merges a file into the environment. The repo
 * already has two env-file loaders (api/secretsFile.ts, worker/config.ts) and
 * both are key-filtered to REFUSE `DATABASE_URL`, because the shared secrets
 * file aims that key at the retired database. This reads a different file —
 * Prisma's own, the one it would read anyway — and its whole purpose is to put
 * that value in front of the guard instead of behind it.
 */
function urlFromEnvFile(): string | undefined {
  let text: string;
  try {
    text = readFileSync(envFilePath(), "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const raw = (match[1] ?? "").trim();
    // Strip one layer of matching quotes, the way every dotenv loader does.
    const value =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    return value === "" ? undefined : value;
  }
  return undefined;
}

/**
 * The connection this process may open, checked.
 *
 * `env` is a parameter rather than a read of `process.env` at module scope
 * (01 §7), so a test can drive it. The file is consulted only when the shell
 * is silent, which is the precedence Prisma itself applies.
 */
export function resolveConnection(
  env: Record<string, string | undefined> = process.env,
): ResolvedDatabase {
  const fromShell = env["DATABASE_URL"]?.trim();
  if (fromShell !== undefined && fromShell !== "") {
    return resolveDatabaseUrl(env);
  }
  return resolveDatabaseUrl({ ...env, DATABASE_URL: urlFromEnvFile() });
}

let singleton: PrismaClient | undefined;

/**
 * The process-wide client. Lazily constructed so importing this package does
 * not open a connection — the webhook's fail-closed tests depend on that, and
 * so does the guard: the refusal must land when a process actually asks for a
 * database, not when some unrelated module imports a type from here.
 */
export function db(): PrismaClient {
  singleton ??= new PrismaClient({ datasourceUrl: resolveConnection().url });
  return singleton;
}

/** Close the pool. For tests and for a clean process exit. */
export async function disconnect(): Promise<void> {
  if (singleton !== undefined) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}
