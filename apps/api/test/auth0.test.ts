/**
 * Auth0 wiring — apps/api/src/auth/auth0.ts.
 *
 * No network and no database. Discovery against the tenant happens lazily, on
 * the first request that actually needs it, so everything provable offline is
 * proved here: that an unconfigured API is unchanged, that a half-configured
 * one refuses to mount, and that mounting disturbs nothing (01 §7 — the config
 * is injected, never inherited from the developer's shell).
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { readAuth0Env, type Auth0Config } from "../src/auth/auth0.js";

const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});

/** Shaped like the real thing; the tenant is never contacted. */
const CREDENTIALS: Record<string, string> = {
  AUTH0_DOMAIN: "dev-example.us.auth0.com",
  AUTH0_CLIENT_ID: "test-client-id",
  AUTH0_CLIENT_SECRET: "test-client-secret",
  AUTH0_SECRET: "0".repeat(64),
  AUTH0_BASE_URL: "http://localhost:4000",
};

/**
 * A tenant that cannot be reached, by construction.
 *
 * `.invalid` is reserved by RFC 6761 and never resolves, so the mounting tests
 * below cannot accidentally depend on a network — or, worse, reach a real
 * tenant from CI. Discovery is what fails; the mount is what is being proved.
 */
const UNROUTABLE: Record<string, string> = {
  ...CREDENTIALS,
  AUTH0_DOMAIN: "tenant.invalid",
};

function build(auth0?: Auth0Config): Express {
  return createApp({
    db: {} as PrismaClient,
    config: loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" }),
    logger: createLogger({ app: "api", env: "test", destination: sink }),
    auth0,
  });
}

describe("readAuth0Env", () => {
  it("reads a complete configuration", () => {
    expect(readAuth0Env(CREDENTIALS)).toEqual({
      domain: "dev-example.us.auth0.com",
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      secret: "0".repeat(64),
      baseUrl: "http://localhost:4000",
    });
  });

  it("is all-or-nothing — a missing key yields no config at all", () => {
    for (const key of Object.keys(CREDENTIALS)) {
      const partial = { ...CREDENTIALS };
      delete partial[key];
      expect(readAuth0Env(partial), `without ${key}`).toBeUndefined();
    }
  });

  it("treats an empty or blank value as absent", () => {
    expect(readAuth0Env({ ...CREDENTIALS, AUTH0_SECRET: "" })).toBeUndefined();
    expect(
      readAuth0Env({ ...CREDENTIALS, AUTH0_SECRET: "   " }),
    ).toBeUndefined();
  });

  it("reads nothing from an empty environment", () => {
    expect(readAuth0Env({})).toBeUndefined();
  });

  // The dashboard shows the domain both ways depending on where you look, and
  // a trailing slash turns the issuer into a URL that does not match the `iss`
  // claim Auth0 sends back.
  it("normalises a pasted scheme and trailing slashes", () => {
    const config = readAuth0Env({
      ...CREDENTIALS,
      AUTH0_DOMAIN: "https://dev-example.us.auth0.com/",
      AUTH0_BASE_URL: "http://localhost:4000/",
    });
    expect(config?.domain).toBe("dev-example.us.auth0.com");
    expect(config?.baseUrl).toBe("http://localhost:4000");
  });
});

describe("mounting", () => {
  it("adds no login route when Auth0 is not configured", async () => {
    await request(build()).get("/auth/login").expect(404);
  });

  // Not a successful login: the tenant is unreachable, so discovery fails and
  // this 500s. A 404 would mean the route was never mounted at all, which is
  // the distinction being drawn.
  it("serves /auth/login once configured", async () => {
    const res = await request(build(readAuth0Env(UNROUTABLE))).get(
      "/auth/login",
    );
    expect(res.status).not.toBe(404);
  });

  // The whole point of authRequired: false. If this ever starts redirecting,
  // every SPA call and the health probe have been put behind a login.
  it("leaves existing routes reachable without a session", async () => {
    const res = await request(build(readAuth0Env(CREDENTIALS)))
      .get("/api/health")
      .expect(200);
    expect(res.body).toMatchObject({ ok: true, app: "api" });
  });

  it("still rejects an unauthenticated API call the same way", async () => {
    await request(build(readAuth0Env(CREDENTIALS)))
      .get("/api/katalog/unit")
      .expect(401);
  });
});
