/**
 * Which database a process is allowed to open.
 *
 * The one that has to hold is the refusal to open `nusantara_pos_app`: it is
 * the previous build's database, it is still live, and the old system is still
 * writing to it. Everything else here is about catching a wrong deploy before
 * it writes rather than after.
 *
 * No database is touched by this file — the whole point of the resolver is that
 * it decides before a connection is opened.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  APP_ENVIRONMENTS,
  DatabaseEnvironmentError,
  ENVIRONMENT_DATABASE,
  RETIRED_DATABASE,
  databaseNameOf,
  resolveAppEnvironment,
  resolveDatabaseUrl,
} from "../src/environment.js";
import { resolveConnection } from "../src/client.js";

const dsn = (database: string) =>
  `postgresql://nusantara@localhost:5432/${database}`;

describe("resolveAppEnvironment", () => {
  it("defaults to dev, the environment where a mistake is cheapest", () => {
    expect(resolveAppEnvironment({})).toBe("dev");
    expect(resolveAppEnvironment({ APP_ENV: "" })).toBe("dev");
    expect(resolveAppEnvironment({ APP_ENV: "   " })).toBe("dev");
  });

  it("accepts exactly the three environments", () => {
    for (const name of APP_ENVIRONMENTS) {
      expect(resolveAppEnvironment({ APP_ENV: name })).toBe(name);
    }
  });

  it("refuses a name it does not know rather than falling back", () => {
    // "production" is the plausible wrong guess, and silently treating it as
    // dev would point a production box at the development database.
    expect(() => resolveAppEnvironment({ APP_ENV: "production" })).toThrow(
      DatabaseEnvironmentError,
    );
    expect(() => resolveAppEnvironment({ APP_ENV: "staging" })).toThrow(
      DatabaseEnvironmentError,
    );
  });
});

describe("databaseNameOf", () => {
  it("reads the database out of a connection string", () => {
    expect(databaseNameOf(dsn("nusantara_pos_stage"))).toBe(
      "nusantara_pos_stage",
    );
  });

  it("survives a password and query parameters", () => {
    expect(
      databaseNameOf(
        "postgresql://nusantara:s3cret@db.internal:5432/nusantara_pos_prod?sslmode=require",
      ),
    ).toBe("nusantara_pos_prod");
  });

  it("returns undefined when there is no database to read", () => {
    expect(databaseNameOf("not a url")).toBeUndefined();
    expect(
      databaseNameOf("postgresql://nusantara@localhost:5432"),
    ).toBeUndefined();
  });
});

describe("resolveDatabaseUrl", () => {
  it("returns the environment and its database when they agree", () => {
    for (const environment of APP_ENVIRONMENTS) {
      const database = ENVIRONMENT_DATABASE[environment];
      expect(
        resolveDatabaseUrl({
          APP_ENV: environment,
          DATABASE_URL: dsn(database),
        }),
      ).toEqual({ environment, url: dsn(database), database });
    }
  });

  it("refuses the retired database in every environment", () => {
    // The rule this whole module exists for. `nusantara_pos_app` is the
    // previous build's live database (CLAUDE.md, 08 §8) — there is no
    // environment, and no override, that makes opening it correct.
    for (const environment of APP_ENVIRONMENTS) {
      expect(() =>
        resolveDatabaseUrl({
          APP_ENV: environment,
          DATABASE_URL: dsn(RETIRED_DATABASE),
        }),
      ).toThrow(/previous build/);
    }
  });

  it("refuses when APP_ENV and the database disagree", () => {
    // A deploy that writes prod's traffic into the staging shop.
    expect(() =>
      resolveDatabaseUrl({
        APP_ENV: "prod",
        DATABASE_URL: dsn(ENVIRONMENT_DATABASE.stage),
      }),
    ).toThrow(/belongs to stage/);
  });

  it("refuses a missing DATABASE_URL rather than guessing one", () => {
    expect(() => resolveDatabaseUrl({ APP_ENV: "prod" })).toThrow(
      DatabaseEnvironmentError,
    );
    expect(() =>
      resolveDatabaseUrl({ APP_ENV: "prod", DATABASE_URL: "  " }),
    ).toThrow(DatabaseEnvironmentError);
  });

  it("refuses a DSN it cannot parse, because it cannot check the target", () => {
    expect(() =>
      resolveDatabaseUrl({
        APP_ENV: "dev",
        DATABASE_URL: "localhost/whatever",
      }),
    ).toThrow(DatabaseEnvironmentError);
  });

  it("allows a database outside the three, which is how CI and the suites run", () => {
    // The test suites use nusantara_pos_test and CI a throwaway container. The
    // retired-database refusal still covers those; the ownership check cannot,
    // because they belong to no environment.
    const url = dsn("nusantara_pos_test");
    expect(resolveDatabaseUrl({ DATABASE_URL: url })).toEqual({
      environment: "dev",
      url,
      database: "nusantara_pos_test",
    });
  });
});

/**
 * The guard's wiring, not its rules.
 *
 * `resolveDatabaseUrl` was written, tested and never called — `db()` was a bare
 * `new PrismaClient()`, so the refusal above protected nothing at runtime.
 * `resolveConnection` is the seam that fixes that, and it has one job the
 * resolver cannot do alone: agree with Prisma about WHERE the URL comes from.
 *
 * Prisma Client 6 reads `packages/db/.env` by itself when the shell is silent
 * (verified against the real client, not assumed). A guard that read only the
 * environment would pass a process whose connection then came from the file.
 * So these cases are about precedence and coverage, not about the four
 * refusals — those are already covered above.
 *
 * Each case writes its own file. `packages/db/.env` is gitignored, and when
 * these read the developer's copy they passed on every laptop and failed on
 * CI's clean checkout (2026-09-18).
 */
describe("resolveConnection", () => {
  const dir = mkdtempSync(join(tmpdir(), "nusantara-env-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let files = 0;
  const envFile = (text: string): string => {
    files += 1;
    const path = join(dir, `${files}.env`);
    writeFileSync(path, text);
    return path;
  };

  it("checks the shell's URL when there is one", () => {
    const url = dsn("nusantara_pos_test");
    expect(resolveConnection({ DATABASE_URL: url })).toEqual({
      environment: "dev",
      url,
      database: "nusantara_pos_test",
    });
  });

  it("refuses the retired database from the shell", () => {
    expect(() =>
      resolveConnection({ DATABASE_URL: dsn(RETIRED_DATABASE) }),
    ).toThrow(DatabaseEnvironmentError);
  });

  it("falls back to the file, which is what Prisma would have read", () => {
    const file = envFile(
      `# local\nexport DATABASE_URL="${dsn("nusantara_pos_rebuild")}"\n`,
    );
    expect(resolveConnection({}, file)).toEqual({
      environment: "dev",
      url: dsn("nusantara_pos_rebuild"),
      database: "nusantara_pos_rebuild",
    });
  });

  it("checks the file's URL too — the hole this seam closed", () => {
    // Before it, a silent shell meant Prisma opened the file's database
    // unchecked.
    const file = envFile(`DATABASE_URL=${dsn(RETIRED_DATABASE)}\n`);
    expect(() => resolveConnection({}, file)).toThrow(DatabaseEnvironmentError);
  });

  it("refuses when neither the shell nor the file names a database", () => {
    // CI's clean checkout has no file, and a process must not guess one.
    expect(() => resolveConnection({}, join(dir, "absent.env"))).toThrow(
      DatabaseEnvironmentError,
    );
  });

  it("prefers the shell over the file, the order Prisma itself applies", () => {
    const file = envFile(`DATABASE_URL=${dsn("nusantara_pos_rebuild")}\n`);
    const url = dsn("nusantara_pos_test");
    expect(resolveConnection({ DATABASE_URL: url }, file).url).toBe(url);
    expect(resolveConnection({}, file).url).toBe(dsn("nusantara_pos_rebuild"));
  });

  it("treats a blank shell value as absent rather than as a broken DSN", () => {
    // `DATABASE_URL=` in a shell profile is how a variable gets unset by
    // accident. Reading it literally would fail with "not a connection string"
    // and send somebody hunting a typo in a URL that is not there.
    const file = envFile(`DATABASE_URL='${dsn("nusantara_pos_rebuild")}'\n`);
    const resolved = resolveConnection({ DATABASE_URL: "   " }, file);
    expect(resolved).toEqual(resolveConnection({}, file));
    expect(resolved.database).toBe("nusantara_pos_rebuild");
  });
});
