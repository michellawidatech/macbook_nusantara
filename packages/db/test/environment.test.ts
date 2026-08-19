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

import { describe, expect, it } from "vitest";
import {
  APP_ENVIRONMENTS,
  DatabaseEnvironmentError,
  ENVIRONMENT_DATABASE,
  RETIRED_DATABASE,
  databaseNameOf,
  resolveAppEnvironment,
  resolveDatabaseUrl,
} from "../src/environment.js";

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
