/**
 * The Prisma client, and the transaction settings every write inherits.
 *
 * 08 §3: "maxWait: 5s, timeout: 10s. A checkout that cannot finish in ten
 * seconds must fail loudly, not queue behind a lock while a customer waits."
 */

import { Prisma, PrismaClient } from "../generated/client/index.js";

export { Prisma, PrismaClient };

/** A transaction handle: the client, minus the things you cannot call inside one. */
export type Tx = Prisma.TransactionClient;

/** 08 §3. Not tunable per call site — a slow checkout must fail, not queue. */
export const TXN_TIMEOUTS = {
  maxWait: 5_000,
  timeout: 10_000,
} as const;

let singleton: PrismaClient | undefined;

/**
 * The process-wide client. Lazily constructed so importing this package does
 * not open a connection — the webhook's fail-closed tests depend on that.
 */
export function db(): PrismaClient {
  singleton ??= new PrismaClient();
  return singleton;
}

/** Close the pool. For tests and for a clean process exit. */
export async function disconnect(): Promise<void> {
  if (singleton !== undefined) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}
