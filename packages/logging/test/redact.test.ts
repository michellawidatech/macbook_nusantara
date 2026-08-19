/**
 * Redaction — docs/rebuild/05-logging.md §6.
 *
 * §6 requires "a case per rule, and a fixture that asserts a real Meta webhook
 * payload emerges with no x-hub-signature-256 and no message text".
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_MAX_BYTES,
  NEVER_LOGGED_KEYS,
  REDACTED,
  SENSITIVE_BODY_KEYS,
  SENSITIVE_HEADERS,
  isNeverLogged,
  isSensitiveKey,
  maskPhone,
  maskPhones,
  redactBody,
  redactHeaders,
  redactValue,
  resolveBodyMaxBytes,
  serializeBody,
  stripQuery,
  truncateToBytes,
} from "../src/redact.js";

describe("§6 — headers dropped entirely", () => {
  it("masks every header on the list, one case each", () => {
    for (const header of SENSITIVE_HEADERS) {
      const out = redactHeaders({ [header]: "super-secret-value" });
      expect(out[header], `${header} must be masked`).toBe(REDACTED);
      expect(JSON.stringify(out)).not.toContain("super-secret-value");
    }
  });

  it("masks regardless of the casing the client sent", () => {
    expect(
      redactHeaders({ AUTHORIZATION: "Bearer abc" })["authorization"],
    ).toBe(REDACTED);
    expect(
      redactHeaders({ "X-Hub-Signature-256": "sha256=deadbeef" })[
        "x-hub-signature-256"
      ],
    ).toBe(REDACTED);
  });

  it("masks a repeated header before joining, so no fragment leaks", () => {
    const out = redactHeaders({
      "set-cookie": ["a=1; HttpOnly", "b=2; HttpOnly"],
    });
    expect(out["set-cookie"]).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain("a=1");
  });

  it("keeps ordinary headers, drops undefined, and masks phones inside them", () => {
    const out = redactHeaders({
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.1",
      "x-caller": "+6281234564321",
      "x-absent": undefined,
      "x-count": 3,
    });
    expect(out["content-type"]).toBe("application/json");
    expect(out["x-count"]).toBe("3");
    expect(out["x-caller"]).toBe("+6281****4321");
    expect(out).not.toHaveProperty("x-absent");
  });

  it("survives no headers at all", () => {
    expect(redactHeaders(null)).toEqual({});
    expect(redactHeaders(undefined)).toEqual({});
  });
});

describe("§6 — body keys masked at any depth", () => {
  it("masks every key on the list, one case each", () => {
    for (const key of SENSITIVE_BODY_KEYS) {
      expect(isSensitiveKey(key), key).toBe(true);
      const out = redactValue({ [key]: "leak" }) as Record<string, unknown>;
      expect(out[key], key).toBe(REDACTED);
    }
  });

  it("matches as a substring, in any casing or separator style", () => {
    expect(isSensitiveKey("newPassword")).toBe(true);
    expect(isSensitiveKey("password_hash")).toBe(true);
    expect(isSensitiveKey("X-API-Key")).toBe(true);
    expect(isSensitiveKey("refresh_token")).toBe(true);
    expect(isSensitiveKey("serial")).toBe(false);
  });

  it("masks at depth, inside arrays too", () => {
    const out = redactValue({
      staff: [{ username: "kasir", credentials: { token: "abc" } }],
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("abc");
    expect(JSON.stringify(out)).toContain("kasir");
  });

  it("degrades rather than throwing on a cycle or a very deep object", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    expect(JSON.stringify(redactValue(cyclic))).toContain("[circular]");

    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 12; i += 1) deep = { deep };
    expect(JSON.stringify(redactValue(deep))).toContain("[deep]");
  });

  it("passes Buffers, Dates and primitives through, and stringifies BigInt", () => {
    const d = new Date(0);
    expect(redactValue(d)).toBe(d);
    const b = Buffer.from("x");
    expect(redactValue(b)).toBe(b);
    expect(redactValue(null)).toBeNull();
    expect(redactValue(7)).toBe(7);
    expect(redactValue(12_400_000n)).toBe("12400000");
  });
});

describe("§6 — customer identity and message content are never logged", () => {
  it("drops every never-logged key, one case each", () => {
    for (const key of NEVER_LOGGED_KEYS) {
      expect(isNeverLogged(key), key).toBe(true);
      const out = redactValue({
        [key]: "Budi Santoso, Jl. Merdeka 10",
      }) as Record<string, unknown>;
      expect(out[key], key).toBe(REDACTED);
    }
  });

  it("matches the whole key, not a substring", () => {
    // `username` and `filename` contain "name" but are not a customer's name.
    expect(isNeverLogged("username")).toBe(false);
    expect(isNeverLogged("filename")).toBe(false);
    // The documented escape hatch for non-personal names.
    expect(isNeverLogged("skuName")).toBe(false);
    expect(isNeverLogged("locationName")).toBe(false);
  });
});

describe("§6 — phone numbers are masked", () => {
  it("masks to +6281****4321", () => {
    expect(maskPhone("+6281234564321")).toBe("+6281****4321");
  });

  it("masks every form Meta and staff actually produce", () => {
    expect(maskPhones("+6281234564321")).toBe("+6281****4321");
    expect(maskPhones("6281234564321")).toBe("62812****4321");
    expect(maskPhones("081234564321")).toBe("08123****4321");
    expect(maskPhones("hubungi 081234564321 ya")).toBe(
      "hubungi 08123****4321 ya",
    );
  });

  it("masks a non-Indonesian E.164 number too", () => {
    expect(maskPhones("+442071234567")).toBe("+4420****4567");
  });

  it("masks a short number completely rather than leaking most of it", () => {
    expect(maskPhone("12345")).toBe("****");
  });

  it("leaves text with no phone number alone", () => {
    expect(maskPhones("MacBook Air M1 8/256")).toBe("MacBook Air M1 8/256");
  });

  it("masks phones nested anywhere in a body", () => {
    const out = JSON.stringify(
      redactValue({ contact: { wa: "6281234564321" } }),
    );
    expect(out).not.toContain("6281234564321");
    expect(out).toContain("62812****4321");
  });
});

describe("§6 — bodies are truncated and query strings dropped", () => {
  it("truncates to the byte budget and says how much it dropped", () => {
    const out = truncateToBytes("x".repeat(100), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("[+90 bytes]");
  });

  it("leaves a body inside the budget untouched", () => {
    expect(truncateToBytes("short", 10)).toBe("short");
  });

  it("respects the configured cap", () => {
    expect(resolveBodyMaxBytes("64")).toBe(64);
    expect(resolveBodyMaxBytes(undefined)).toBe(DEFAULT_BODY_MAX_BYTES);
    expect(resolveBodyMaxBytes("nonsense")).toBe(DEFAULT_BODY_MAX_BYTES);
    expect(resolveBodyMaxBytes("-1")).toBe(DEFAULT_BODY_MAX_BYTES);

    const big = redactBody({ pad: "y".repeat(500) }, 50);
    expect(Buffer.from(big ?? "", "utf8").length).toBeLessThan(120);
  });

  it("drops the query string from a path", () => {
    expect(stripQuery("/api/katalog/inventori?lokasi=toko&page=2")).toBe(
      "/api/katalog/inventori",
    );
    expect(stripQuery("/api/health")).toBe("/api/health");
  });
});

describe("serializeBody and redactBody", () => {
  it("returns undefined when there is nothing to log", () => {
    expect(serializeBody(undefined)).toBeUndefined();
    expect(serializeBody(null)).toBeUndefined();
    expect(serializeBody("")).toBeUndefined();
    expect(serializeBody(Buffer.alloc(0))).toBeUndefined();
    expect(redactBody(undefined)).toBeUndefined();
  });

  it("serializes money as a string, never a number", () => {
    expect(serializeBody({ total: 12_400_000n })).toBe('{"total":"12400000"}');
  });

  it("never throws on an unserializable body", () => {
    const bad = {
      toJSON: () => {
        throw new Error("nope");
      },
    };
    expect(serializeBody(bad)).toBe("[unserializable body]");
  });

  it("catches a secret whether the body arrives as an object or as JSON text", () => {
    expect(redactBody({ password: "hunter2" })).toBe(
      `{"password":"${REDACTED}"}`,
    );
    expect(redactBody('{"password":"hunter2"}')).toBe(
      `{"password":"${REDACTED}"}`,
    );
  });

  it("keeps non-JSON text as text, with phones masked", () => {
    expect(redactBody("telepon 081234564321")).toBe("telepon 08123****4321");
    expect(redactBody("{not json after all")).toBe("{not json after all");
  });

  it("reads a Buffer body", () => {
    expect(redactBody(Buffer.from("hello"))).toBe("hello");
  });
});

describe("§6 — the Meta webhook fixture", () => {
  const raw = readFileSync(
    fileURLToPath(new URL("./fixtures/meta-webhook.json", import.meta.url)),
    "utf8",
  );
  const payload: unknown = JSON.parse(raw);

  const headers = {
    "content-type": "application/json",
    "x-hub-signature-256":
      "sha256=7d38cdd689735b008b3c702edd92eea23791c5f6f9f3f9f0d4a0b3d1f3f9c0a1",
    "user-agent": "facebookplatform/1.0 (+http://developers.facebook.com)",
  };

  it("emerges with no x-hub-signature-256", () => {
    const out = JSON.stringify(redactHeaders(headers));
    expect(out).not.toContain("7d38cdd689735b008b3c702edd92eea2");
    expect(JSON.parse(out)["x-hub-signature-256"]).toBe(REDACTED);
    // The harmless headers survive, so the record is still useful.
    expect(JSON.parse(out)["content-type"]).toBe("application/json");
  });

  it("emerges with no message text", () => {
    const out = redactBody(payload, 8192) ?? "";
    expect(out).not.toContain("MacBook Air M1 8/256 masih ada");
    expect(out).not.toContain("Jl. Merdeka");
    expect(out).not.toContain("Budi Santoso");
  });

  it("emerges with no readable customer phone number", () => {
    const out = redactBody(payload, 8192) ?? "";
    expect(out).not.toContain("6281234564321");
    expect(out).not.toContain("081234564321");
    expect(out).toContain("62812****4321");
  });

  it("still carries what makes the record useful", () => {
    const out = redactBody(payload, 8192) ?? "";
    // The message id is the dedup key (08 §2 invariant 12) and is not a secret.
    expect(out).toContain("wamid.");
    expect(out).toContain("whatsapp_business_account");
    expect(out).toContain("1200651716467039");
  });
});
