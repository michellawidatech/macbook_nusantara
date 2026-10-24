/**
 * Which database role the worker is logged in as — and, in production,
 * refusing to run as any but its own.
 *
 * Owner ruling 2026-10-15: the worker runs as `nusantara_agent` and the POS
 * as `nusantara_app`, and the two stay separate. Every pass in this app writes
 * only what the agent role is granted (the thread note, the lease, the bot's
 * half of a lead — invariant 13), so under any other role those writes are
 * refused. Until that day the Mac mini's worker inherited common.env's
 * `DATABASE_URL` and ran as nusantara_app, and the summary pass's refusals
 * were swallowed for weeks. A worker that refuses to start says so in the
 * first line of worker.log; one that half-works says nothing.
 *
 * docs/worker-agent-role.md is the runbook for the switch.
 */

import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

export const WORKER_ROLE = "nusantara_agent";

/**
 * True when the worker may run. In production that means logged in as
 * `nusantara_agent`; elsewhere any role runs, with a warning, because a
 * developer's worker logs in as the schema owner.
 */
export async function checkDatabaseRole(
  db: PrismaClient,
  appEnv: string,
  logger: Logger,
): Promise<boolean> {
  const [row] = await db.$queryRaw<{ role: string }[]>`
    SELECT current_user::text AS "role"
  `;
  const role = row?.role ?? "unknown";
  if (role === WORKER_ROLE) {
    logger.info({ evt: "worker.db_role", ctx: { role } }, "database role ok");
    return true;
  }
  if (appEnv === "prod") {
    logger.error(
      { evt: "worker.db_role.wrong", ctx: { role, expected: WORKER_ROLE } },
      `the worker is logged in as ${role}, not ${WORKER_ROLE} — set DATABASE_URL in worker.env (docs/worker-agent-role.md). Not starting.`,
    );
    return false;
  }
  logger.warn(
    { evt: "worker.db_role.other", ctx: { role, expected: WORKER_ROLE } },
    `the worker is logged in as ${role}; production requires ${WORKER_ROLE}`,
  );
  return true;
}
