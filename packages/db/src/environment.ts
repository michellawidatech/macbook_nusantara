/**
 * Which database this process is allowed to talk to.
 *
 * The shop runs three environments — dev, stage and prod — and they are three
 * databases on the same cluster, one migration history each. Nothing about a
 * connection string says which one you meant, so pointing stage at prod is a
 * single edited character and no error message.
 *
 * ## Why this is code and not a convention
 *
 * CLAUDE.md already carries the rule that matters: `nusantara_pos_app` is the
 * PREVIOUS build's database, it is still live, and it is still being written to
 * by the old system. This build must never open it. A rule written in a
 * markdown file is enforced by whoever remembers it at 2am; the same rule
 * written here fails the process on startup. 08 §7 makes invariant 13
 * structural for the same reason.
 *
 * ## Why DATABASE_URL is not read from a secrets file
 *
 * It comes from the process environment, never from `secrets/*.env`. The
 * shared credentials file carries a `DATABASE_URL` aimed at that retired
 * database, which is exactly why `API_ENV_KEYS` and `WORKER_ENV_KEYS` refuse to
 * copy the key out of a file at all. Keeping the connection in the shell keeps
 * that one contaminated line from ever becoming the answer.
 *
 * As everywhere else in this repo, the environment is passed in rather than
 * read from `process.env` at module scope (01 §7).
 */

/** The three environments, in promotion order. */
export const APP_ENVIRONMENTS = ["dev", "stage", "prod"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * The database each environment owns.
 *
 * dev keeps the name it was built under (`nusantara_pos_rebuild`) rather than
 * being renamed to match the pattern: it is the database every developer's
 * shell, every `.env`, and every note in docs/rebuild already points at, and a
 * rename buys symmetry at the cost of breaking all of them at once.
 */
export const ENVIRONMENT_DATABASE: Readonly<Record<AppEnvironment, string>> = {
  dev: "nusantara_pos_rebuild",
  stage: "nusantara_pos_stage",
  prod: "nusantara_pos_prod",
};

/**
 * The previous build's database. Live, still written to by the old system, and
 * never a legitimate target for this one — not in dev, not in a test, not with
 * an override. 08 §8 keeps it readable for a quarter; nothing here may write.
 */
export const RETIRED_DATABASE = "nusantara_pos_app";

/** Refusal to connect. Thrown at startup, never swallowed. */
export class DatabaseEnvironmentError extends Error {
  override readonly name = "DatabaseEnvironmentError";
}

function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * Which environment this process believes it is.
 *
 * Defaults to `dev`, because the default has to be the one where a mistake is
 * cheapest. An unset APP_ENV on a production box is a deployment bug, and it
 * will surface as dev refusing to open the prod database rather than as prod
 * quietly running with dev's settings.
 */
export function resolveAppEnvironment(
  env: Record<string, string | undefined>,
): AppEnvironment {
  const raw = env["APP_ENV"]?.trim();
  if (raw === undefined || raw === "") return "dev";

  if (!isAppEnvironment(raw)) {
    throw new DatabaseEnvironmentError(
      `APP_ENV must be one of ${APP_ENVIRONMENTS.join(", ")} — got ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

/**
 * The database a PostgreSQL connection string names.
 *
 * Returns undefined when the string cannot be parsed at all, so the caller can
 * decide — and every caller here decides to refuse. A DSN we cannot read is a
 * DSN whose target we cannot check.
 */
export function databaseNameOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const name = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  return name === "" ? undefined : name;
}

export interface ResolvedDatabase {
  readonly environment: AppEnvironment;
  readonly url: string;
  readonly database: string;
}

/**
 * The connection this process may open, or an exception.
 *
 * Four refusals, in the order a mistake tends to happen:
 *
 *   1. no DATABASE_URL — the app cannot guess, and a default here would be a
 *      guess aimed at somebody's live data;
 *   2. a DSN that will not parse — an unreadable target cannot be checked, and
 *      an unchecked target is the one case this function exists to prevent;
 *   3. the retired database, under any environment, always;
 *   4. a known environment database that disagrees with APP_ENV — `APP_ENV=prod`
 *      against stage's database is a deploy that silently writes to the wrong
 *      shop.
 *
 * A DSN naming none of the three is allowed through: that is CI against its
 * throwaway container, and the suites against `nusantara_pos_test`. Rule 3
 * still applies to those, which is the part that matters.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
): ResolvedDatabase {
  const environment = resolveAppEnvironment(env);

  const url = env["DATABASE_URL"]?.trim();
  if (url === undefined || url === "") {
    throw new DatabaseEnvironmentError(
      `DATABASE_URL is not set. ${environment} expects ${ENVIRONMENT_DATABASE[environment]}; ` +
        `export it in the shell — never in secrets/*.env, which points at ${RETIRED_DATABASE}.`,
    );
  }

  const database = databaseNameOf(url);
  if (database === undefined) {
    throw new DatabaseEnvironmentError(
      "DATABASE_URL is not a connection string this can read, so the database it " +
        "names cannot be checked. Expected postgresql://user@host:port/database.",
    );
  }

  if (database === RETIRED_DATABASE) {
    throw new DatabaseEnvironmentError(
      `DATABASE_URL points at ${RETIRED_DATABASE}, the previous build's database. ` +
        `It is still live and still being written to by the old system, so this build ` +
        `never opens it (CLAUDE.md, 08 §8). ${environment} wants ${ENVIRONMENT_DATABASE[environment]}.`,
    );
  }

  const owner = (Object.keys(ENVIRONMENT_DATABASE) as AppEnvironment[]).find(
    (candidate) => ENVIRONMENT_DATABASE[candidate] === database,
  );

  if (owner !== undefined && owner !== environment) {
    throw new DatabaseEnvironmentError(
      `APP_ENV is ${environment} but DATABASE_URL names ${database}, which belongs to ${owner}. ` +
        `Set APP_ENV=${owner}, or point DATABASE_URL at ${ENVIRONMENT_DATABASE[environment]}.`,
    );
  }

  return { environment, url, database };
}
