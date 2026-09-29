/**
 * Security headers and CORS — docs/rebuild/08-data-integrity.md §9.
 *
 * No database: every case here is answered by middleware that runs before the
 * router, so a stub `PrismaClient` is honest rather than lazy. The config is
 * injected, never inherited (01 §7).
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});

const SPA = "http://localhost:3000";
const EVIL = "https://attacker.example";

function build(env: Record<string, string | undefined> = {}): Express {
  return createApp({
    // Nothing reached in these tests touches the database.
    db: {} as PrismaClient,
    config: loadConfig({
      NODE_ENV: "test",
      SESSION_COOKIE_INSECURE: "1",
      ...env,
    }),
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
}

describe("security headers", () => {
  it("are on a normal response", async () => {
    const res = await request(build()).get("/api/health").expect(200);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(res.headers["origin-agent-cluster"]).toBe("?1");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  // A header that only covers the happy path is not a control, so both
  // rejection paths are checked: the 404 from notFoundHandler and the 401
  // requireAuth raises before any route under /api is resolved.
  it("are on a 404 from the fall-through handler", async () => {
    const res = await request(build()).get("/tidak-ada").expect(404);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("are on the 401 an unauthenticated caller gets", async () => {
    // Also worth recording: an unknown path under /api answers 401 and not
    // 404, so an unauthenticated caller cannot map the router.
    const res = await request(build()).get("/api/tidak-ada").expect(401);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("still hides the Express fingerprint", async () => {
    const res = await request(build()).get("/api/health").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  describe("HSTS", () => {
    it("is absent on plain-HTTP development", async () => {
      const res = await request(build()).get("/api/health").expect(200);
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    });

    it("is present when the deployment is HTTPS", async () => {
      // Secure cookies and HSTS answer the same question: are we on TLS?
      const app = build({ SESSION_COOKIE_INSECURE: undefined });
      const res = await request(app).get("/api/health").expect(200);
      expect(res.headers["strict-transport-security"]).toBe(
        "max-age=63072000; includeSubDomains",
      );
    });
  });
});

describe("CORS", () => {
  it("allows the configured SPA origin, with credentials", async () => {
    const res = await request(build())
      .get("/api/health")
      .set("origin", SPA)
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe(SPA);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toContain("origin");
  });

  it("sends nothing for an origin that is not on the list", async () => {
    const res = await request(build())
      .get("/api/health")
      .set("origin", EVIL)
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("never answers with a wildcard, whatever the caller asks", async () => {
    for (const origin of [SPA, EVIL, "null"]) {
      const res = await request(build())
        .get("/api/health")
        .set("origin", origin);
      expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    }
  });

  it("Varies on origin even when it refuses, so a cache cannot cross the wires", async () => {
    const res = await request(build())
      .get("/api/health")
      .set("origin", EVIL)
      .expect(200);
    expect(res.headers["vary"]).toContain("origin");
  });

  it("answers a preflight from the SPA", async () => {
    const res = await request(build())
      .options("/api/auth/login")
      .set("origin", SPA)
      .set("access-control-request-method", "POST")
      .expect(204);

    expect(res.headers["access-control-allow-origin"]).toBe(SPA);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain(
      "idempotency-key",
    );
  });

  it("refuses a preflight from anyone else without leaking a 404", async () => {
    const res = await request(build())
      .options("/api/auth/login")
      .set("origin", EVIL)
      .set("access-control-request-method", "POST")
      .expect(204);

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-methods"]).toBeUndefined();
  });

  it("honours a comma-separated allowlist", async () => {
    const app = build({ CORS_ORIGIN: `${SPA},https://pos.nusantara.id` });
    for (const ok of [SPA, "https://pos.nusantara.id"]) {
      const res = await request(app).get("/api/health").set("origin", ok);
      expect(res.headers["access-control-allow-origin"]).toBe(ok);
    }
    const no = await request(app).get("/api/health").set("origin", EVIL);
    expect(no.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("treats a literal `*` in config as no entry, not as everyone", async () => {
    const res = await request(build({ CORS_ORIGIN: "*" }))
      .get("/api/health")
      .set("origin", EVIL)
      .expect(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("leaves same-origin requests — every real one — untouched", async () => {
    const res = await request(build()).get("/api/health").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
