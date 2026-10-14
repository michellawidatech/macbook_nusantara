/**
 * The contract between the worker and `/api/agent/v1` (chatbot v2 step 3).
 *
 * The token is the whole of "a customer can only write to their own data":
 * the API takes the customer from it and from nowhere else. So the claims
 * here are about the token refusing to be forged, stretched or reused, and
 * about the client never putting a customer anywhere but inside it.
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_API_ROUTES,
  REMOTE_TOOLS,
  agentApiDispatch,
  argsFromRequest,
  mintAgentToken,
  verifyAgentToken,
} from "../src/agentApi.js";
import type { ToolContext } from "../src/tools.js";
import type { AgentCapabilities } from "../src/policy.js";

const SECRET = "test-secret-0123456789";
const NOW = new Date("2026-10-15T03:00:00.000Z");
const CAPS: AgentCapabilities = {
  stock: true,
  price: true,
  reserve: true,
  photos: true,
} as AgentCapabilities;

const claims = { waId: "628111000101", turn: "t1", caps: CAPS, writes: true };

describe("the agent token", () => {
  it("round-trips what it was given", () => {
    const token = mintAgentToken(claims, SECRET, NOW);
    expect(verifyAgentToken(token, SECRET, NOW)).toMatchObject(claims);
  });

  it("refuses another secret", () => {
    const token = mintAgentToken(claims, SECRET, NOW);
    expect(verifyAgentToken(token, "another-secret", NOW)).toBeNull();
  });

  it("refuses a token whose customer was changed", () => {
    const token = mintAgentToken(claims, SECRET, NOW);
    const [body, mac] = token.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString());
    forged.waId = "628999999999";
    const swapped = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${mac}`;
    expect(verifyAgentToken(swapped, SECRET, NOW)).toBeNull();
  });

  it("expires", () => {
    const token = mintAgentToken(claims, SECRET, NOW, 60_000);
    expect(
      verifyAgentToken(token, SECRET, new Date(NOW.getTime() + 59_000)),
    ).not.toBeNull();
    expect(
      verifyAgentToken(token, SECRET, new Date(NOW.getTime() + 60_000)),
    ).toBeNull();
  });

  it("refuses garbage and an empty secret", () => {
    expect(verifyAgentToken("nope", SECRET, NOW)).toBeNull();
    expect(verifyAgentToken("a.b.c", SECRET, NOW)).toBeNull();
    const token = mintAgentToken(claims, SECRET, NOW);
    expect(verifyAgentToken(token, "", NOW)).toBeNull();
    expect(() => mintAgentToken(claims, "", NOW)).toThrow();
  });
});

describe("the routes", () => {
  it("never take a phone number", () => {
    for (const r of AGENT_API_ROUTES) {
      expect(r.path).not.toMatch(/phone|wa_?id|from|:customer/i);
    }
  });

  it("are the POS tools and only those", () => {
    expect([...REMOTE_TOOLS].sort()).toEqual([
      "browse_catalog",
      "cancel_reservation",
      "check_order",
      "check_reservation",
      "check_serial",
      "create_reservation",
      "find_unit_photos",
      "lookup_customer",
      "remember_customer",
      "reschedule_reservation",
      "search_stock",
      "unit_photos",
    ]);
  });
});

describe("a request becoming a tool's arguments", () => {
  it("turns a price bound back into a number and leaves a serial of digits alone", () => {
    expect(
      argsFromRequest("search_stock", {
        query: { query: "air m2", maxPrice: "15000000" },
      }),
    ).toEqual({ query: "air m2", maxPrice: 15_000_000 });
    expect(
      argsFromRequest("check_serial", { params: { serial: "012345678901" } }),
    ).toEqual({ serial: "012345678901" });
  });

  it("takes a write's arguments from its body", () => {
    expect(
      argsFromRequest("remember_customer", {
        body: { name: "Ayu", budget: 15_000_000 },
      }),
    ).toEqual({ name: "Ayu", budget: 15_000_000 });
  });
});

/** A fetch that records what it was asked and answers from a script. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  from: "628111000101",
  now: NOW,
  capabilities: CAPS,
  ...over,
});

describe("the worker's client", () => {
  const local = async (name: string) => ({ ranLocally: name });

  it("sends a stock search as a GET with the customer only in the token", async () => {
    const f = fakeFetch(200, { units: [] });
    const dispatch = agentApiDispatch(
      {
        baseUrl: "http://pos/api/agent/v1/",
        secret: SECRET,
        fetchImpl: f.impl,
      },
      local,
      { id: "turn-1", now: NOW },
    );
    await dispatch(
      "search_stock",
      { query: "air m2", maxPrice: 15_000_000 },
      ctx(),
    );

    const { url, init } = f.calls[0]!;
    expect(init.method).toBe("GET");
    expect(url).toBe(
      "http://pos/api/agent/v1/stock?query=air+m2&maxPrice=15000000",
    );
    expect(url).not.toContain("628111000101");
    const auth = (init.headers as Record<string, string>)["authorization"]!;
    const claims = verifyAgentToken(auth.slice("Bearer ".length), SECRET, NOW);
    expect(claims).toMatchObject({ waId: "628111000101", turn: "turn-1" });
  });

  it("puts a serial in the path and a booking in the body", async () => {
    const f = fakeFetch(200, {});
    const dispatch = agentApiDispatch(
      { baseUrl: "http://pos/api/agent/v1", secret: SECRET, fetchImpl: f.impl },
      local,
      { id: "t", now: NOW },
    );
    await dispatch("check_serial", { serial: "C02 X/1" }, ctx());
    await dispatch(
      "create_reservation",
      { serial: "C02X1", when: "2026-10-16 14:00" },
      ctx({
        reserve: { write: {} as never, staffId: "s", graceMs: 3_600_000 },
      }),
    );

    expect(f.calls[0]!.url).toBe("http://pos/api/agent/v1/units/C02%20X%2F1");
    expect(f.calls[1]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({
      serial: "C02X1",
      when: "2026-10-16 14:00",
    });
    const auth = (f.calls[1]!.init.headers as Record<string, string>)[
      "authorization"
    ]!;
    expect(verifyAgentToken(auth.slice(7), SECRET, NOW)).toMatchObject({
      writes: true,
      graceMs: 3_600_000,
    });
  });

  it("runs everything that is not POS data locally", async () => {
    const f = fakeFetch(200, {});
    const dispatch = agentApiDispatch(
      { baseUrl: "http://pos", secret: SECRET, fetchImpl: f.impl },
      local,
      { id: "t", now: NOW },
    );
    expect(
      await dispatch("search_knowledge", { query: "garansi" }, ctx()),
    ).toEqual({ ranLocally: "search_knowledge" });
    expect(f.calls).toHaveLength(0);
  });

  it("hands a 404's own words to the model", async () => {
    const f = fakeFetch(404, {
      found: false,
      note: "No unit with that serial.",
    });
    const dispatch = agentApiDispatch(
      { baseUrl: "http://pos", secret: SECRET, fetchImpl: f.impl },
      local,
      { id: "t", now: NOW },
    );
    expect(await dispatch("check_serial", { serial: "X" }, ctx())).toEqual({
      found: false,
      note: "No unit with that serial.",
    });
  });

  it("fails soft, and loudly, when the API is down", async () => {
    const errors: string[] = [];
    const dispatch = agentApiDispatch(
      {
        baseUrl: "http://pos",
        secret: SECRET,
        fetchImpl: (async () => {
          throw new Error("ECONNREFUSED");
        }) as unknown as typeof fetch,
      },
      local,
      { id: "t", now: NOW },
    );
    const out = await dispatch(
      "search_stock",
      {},
      ctx({ onError: (tool) => errors.push(tool) }),
    );
    expect(out).toMatchObject({ error: expect.stringContaining("hand over") });
    expect(errors).toEqual(["search_stock"]);
  });

  it("refuses to call a path tool without its key", async () => {
    const f = fakeFetch(200, {});
    const dispatch = agentApiDispatch(
      { baseUrl: "http://pos", secret: SECRET, fetchImpl: f.impl },
      local,
      { id: "t", now: NOW },
    );
    expect(await dispatch("unit_photos", {}, ctx())).toEqual({
      error: "No serial given.",
    });
    expect(f.calls).toHaveLength(0);
  });
});
