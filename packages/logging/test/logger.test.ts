/**
 * The record shape and correlation — docs/rebuild/05-logging.md §2 and §3.
 *
 * The logger is driven through a capture stream rather than stdout, so these
 * assert the exact NDJSON that would be written.
 */

import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createLogger,
  currentContext,
  currentRequestId,
  requestLogger,
  runWithContext,
  setStaffId,
} from "../src/index.js";

/** Collect every NDJSON line the logger writes. */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n")) {
        if (line.trim() !== "") lines.push(JSON.parse(line));
      }
      cb();
    },
  });
  return { lines, stream };
}

describe("§2 — the record shape", () => {
  it("writes one NDJSON object per line with t, lvl, app and env", () => {
    const { lines, stream } = capture();
    const log = createLogger({
      app: "api",
      env: "production",
      destination: stream,
    });

    log.info(
      { evt: "order.checkout", dur: 412, ctx: { units: 2 } },
      "checkout completed",
    );

    expect(lines).toHaveLength(1);
    const r = lines[0]!;
    expect(r["lvl"]).toBe("info");
    expect(r["app"]).toBe("api");
    expect(r["env"]).toBe("production");
    expect(r["msg"]).toBe("checkout completed");
    expect(r["evt"]).toBe("order.checkout");
    expect(r["dur"]).toBe(412);
    expect(r["ctx"]).toEqual({ units: 2 });
    expect(String(r["t"])).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("carries no pid or hostname — app already says who wrote it", () => {
    const { lines, stream } = capture();
    createLogger({ app: "worker", destination: stream }).info("tick");
    expect(lines[0]).not.toHaveProperty("pid");
    expect(lines[0]).not.toHaveProperty("hostname");
    expect(lines[0]).not.toHaveProperty("level");
  });

  it("serializes an error as type / msg / stack", () => {
    const { lines, stream } = capture();
    const log = createLogger({ app: "api", destination: stream });

    log.error({ err: new TypeError("kaput"), evt: "order.failed" }, "gagal");

    const err = lines[0]!["err"] as Record<string, unknown>;
    expect(err["type"]).toBe("TypeError");
    expect(err["msg"]).toBe("kaput");
    expect(String(err["stack"])).toContain("TypeError: kaput");
  });

  it("serializes a thrown non-Error without losing it", () => {
    const { lines, stream } = capture();
    createLogger({ app: "api", destination: stream }).error(
      { err: "just a string" },
      "gagal",
    );
    expect(lines[0]!["err"]).toEqual({
      type: "NonError",
      msg: "just a string",
    });
  });

  it("writes money as a string — BigInt does not survive JSON.stringify", () => {
    const { lines, stream } = capture();
    const log = createLogger({ app: "api", destination: stream });

    log.info({ evt: "order.checkout", ctx: { total: 12_400_000n } }, "ok");

    expect((lines[0]!["ctx"] as Record<string, unknown>)["total"]).toBe(
      "12400000",
    );
  });

  it("redacts on the way out, so a careless call site cannot leak", () => {
    const { lines, stream } = capture();
    const log = createLogger({ app: "api", destination: stream });

    log.info(
      {
        evt: "auth.login",
        ctx: { password: "hunter2", phone: "+6281234564321" },
      },
      "masuk",
    );

    const out = JSON.stringify(lines[0]);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("6281234564321");
    expect(out).toContain("+6281****4321");
  });

  it("honours the level", () => {
    const { lines, stream } = capture();
    const log = createLogger({
      app: "api",
      level: "warn",
      destination: stream,
    });
    log.info("ignored");
    log.warn("kept");
    expect(lines).toHaveLength(1);
    expect(lines[0]!["msg"]).toBe("kept");
  });

  it("defaults to stdout when given no destination", () => {
    // Constructing it is the assertion: no stream, no throw, no file opened.
    expect(() => createLogger({ app: "monitor" })).not.toThrow();
  });
});

describe("§3 — correlation", () => {
  it("has no context outside a request", () => {
    expect(currentRequestId()).toBeUndefined();
    expect(currentContext()).toBeUndefined();
  });

  it("carries rid into a line five calls deep, without threading it", () => {
    const { lines, stream } = capture();
    const log = createLogger({ app: "api", destination: stream });

    const deep = () => log.info({ evt: "unit.moved" }, "pindah");
    const level3 = () => deep();
    const level2 = () => level3();

    runWithContext({ rid: "01J8F9Q2K3M4N5P6" }, () => level2());

    expect(lines[0]!["rid"]).toBe("01J8F9Q2K3M4N5P6");
    expect(lines[0]).not.toHaveProperty("sid");
  });

  it("adds sid once authentication resolves it", () => {
    const { lines, stream } = capture();
    const log = createLogger({ app: "api", destination: stream });

    runWithContext({ rid: "R1" }, () => {
      setStaffId("staff_1");
      log.info("after auth");
    });

    expect(lines[0]!["sid"]).toBe("staff_1");
  });

  it("ignores setStaffId outside a request rather than throwing", () => {
    expect(() => setStaffId("staff_1")).not.toThrow();
  });
});

// --- a minimal Express-shaped request/response ------------------------------

function fakeReq(
  over: Partial<Parameters<ReturnType<typeof requestLogger>>[0]> = {},
) {
  return {
    method: "GET",
    url: "/api/health",
    headers: {} as Record<string, string | string[] | undefined>,
    ...over,
  } as Parameters<ReturnType<typeof requestLogger>>[0];
}

function fakeRes(statusCode = 200) {
  const headers: Record<string, string> = {};
  let finish: (() => void) | undefined;
  return {
    res: {
      statusCode,
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      on(event: string, listener: () => void) {
        if (event === "finish") finish = listener;
      },
    },
    headers,
    finish: () => finish?.(),
  };
}

describe("§3 — requestLogger", () => {
  it("assigns a request id and returns it on the response", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
      newId: () => "01ULIDULIDULIDULID",
      now: () => 0,
    });

    const { res, headers, finish } = fakeRes(200);
    mw(fakeReq(), res, () => {});
    finish();

    expect(headers["x-request-id"]).toBe("01ULIDULIDULIDULID");
    expect(lines[0]!["rid"]).toBe("01ULIDULIDULIDULID");
    expect(lines[0]!["evt"]).toBe("http.request");
  });

  it("honours a caller-supplied x-request-id", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
    });

    const { res, headers, finish } = fakeRes();
    mw(fakeReq({ headers: { "x-request-id": "CALLER-1" } }), res, () => {});
    finish();

    expect(headers["x-request-id"]).toBe("CALLER-1");
    expect(lines[0]!["rid"]).toBe("CALLER-1");
  });

  it("refuses a hostile or oversized supplied id and mints its own", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
      newId: () => "MINE",
    });

    for (const bad of [
      'evil"\ninjected',
      "x".repeat(100),
      "",
      42 as unknown as string,
    ]) {
      const { res, finish } = fakeRes();
      mw(fakeReq({ headers: { "x-request-id": bad } }), res, () => {});
      finish();
    }

    expect(lines.map((l) => l["rid"])).toEqual([
      "MINE",
      "MINE",
      "MINE",
      "MINE",
    ]);
  });

  it("records the correlation id the SPA sent back", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
    });

    const { res, finish } = fakeRes();
    mw(fakeReq({ headers: { "x-correlation-id": "PREV-1" } }), res, () => {});
    finish();

    expect((lines[0]!["ctx"] as Record<string, unknown>)["cid"]).toBe("PREV-1");
  });

  it("logs the route pattern, not the filled path", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
    });

    const { res, finish } = fakeRes();
    mw(
      fakeReq({
        method: "GET",
        url: "/SER-001",
        originalUrl: "/api/unit/SER-001?full=1",
        baseUrl: "/api/unit",
        route: { path: "/:serial" },
      }),
      res,
      () => {},
    );
    finish();

    expect((lines[0]!["ctx"] as Record<string, unknown>)["route"]).toBe(
      "/api/unit/:serial",
    );
    expect(JSON.stringify(lines[0])).not.toContain("SER-001");
  });

  it("falls back to the query-stripped path when no route matched", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
    });

    const { res, finish } = fakeRes(404);
    mw(fakeReq({ originalUrl: "/api/tidak-ada?x=1" }), res, () => {});
    finish();

    expect((lines[0]!["ctx"] as Record<string, unknown>)["route"]).toBe(
      "/api/tidak-ada",
    );
    expect(JSON.stringify(lines[0])).not.toContain("x=1");
  });

  it("measures the request", () => {
    const { lines, stream } = capture();
    let clock = 1_000;
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
      now: () => clock,
    });

    const { res, finish } = fakeRes();
    mw(fakeReq(), res, () => {
      clock = 1_412;
    });
    finish();

    expect(lines[0]!["dur"]).toBe(412);
  });

  it("warns on a failed request and includes the redacted body", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
    });

    const { res, finish } = fakeRes(422);
    mw(
      fakeReq({
        method: "POST",
        body: { username: "kasir", password: "hunter2" },
      }),
      res,
      () => {},
    );
    finish();

    expect(lines[0]!["lvl"]).toBe("warn");
    const out = JSON.stringify(lines[0]);
    expect(out).not.toContain("hunter2");
    expect(out).toContain("kasir");
  });

  it("keeps a healthy request's body out of the log", () => {
    const { lines, stream } = capture();
    const mw = requestLogger({
      logger: createLogger({ app: "api", destination: stream }),
    });

    const { res, finish } = fakeRes(200);
    mw(fakeReq({ method: "POST", body: { username: "kasir" } }), res, () => {});
    finish();

    expect(lines[0]!["lvl"]).toBe("info");
    expect(JSON.stringify(lines[0])).not.toContain("kasir");
  });

  it("respects an explicit body policy", () => {
    const { lines, stream } = capture();
    const logger = createLogger({ app: "api", destination: stream });

    const always = requestLogger({ logger, bodyPolicy: "always" });
    const a = fakeRes(200);
    always(fakeReq({ body: { serial: "SER-9" } }), a.res, () => {});
    a.finish();
    expect(JSON.stringify(lines[0])).toContain("SER-9");

    const never = requestLogger({ logger, bodyPolicy: "never" });
    const n = fakeRes(500);
    never(fakeReq({ body: { serial: "SER-9" } }), n.res, () => {});
    n.finish();
    expect(JSON.stringify(lines[1])).not.toContain("SER-9");
  });

  it("never throws into the request path", () => {
    const { stream } = capture();
    const logger = createLogger({ app: "api", destination: stream });

    // A response that throws when a header is set: the request must still run.
    const hostile = {
      statusCode: 200,
      setHeader() {
        throw new Error("headers already sent");
      },
      on() {},
    };
    let reached = false;
    expect(() =>
      requestLogger({ logger })(fakeReq(), hostile, () => {
        reached = true;
      }),
    ).not.toThrow();
    expect(reached).toBe(true);
  });

  it("survives a logger that throws when the response finishes", () => {
    const exploding = {
      info() {
        throw new Error("sink gone");
      },
      warn() {
        throw new Error("sink gone");
      },
    } as unknown as ReturnType<typeof createLogger>;

    const { res, finish } = fakeRes(200);
    requestLogger({ logger: exploding })(fakeReq(), res, () => {});
    expect(() => finish()).not.toThrow();
  });
});
