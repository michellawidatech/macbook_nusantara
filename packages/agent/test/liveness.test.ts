/**
 * The bot never goes silent (2026-10-27): every model call has a deadline and
 * bounded retries, and only a reply a person typed holds the bot off a chat.
 */

import { describe, expect, it } from "vitest";
import {
  ModelDeadlineError,
  ModelTimeoutError,
  guardClient,
  isRetryableModelError,
  modelErrorReason,
  staffTypedReply,
} from "../src/liveness.js";
import type { AgentClient, CreateArgs } from "../src/converse.js";

const ARGS = {
  model: "m",
  max_tokens: 10,
  system: "s",
  messages: [],
} as CreateArgs;
const OK = { content: [], stop_reason: "end_turn" };

/** A client answering from a script: each entry is a result, an error, or "hang". */
function scripted(steps: Array<unknown>) {
  const seen: Array<{ signal?: AbortSignal; timeout?: number }> = [];
  const client = {
    messages: {
      create: (
        _a: CreateArgs,
        opts?: { signal?: AbortSignal; timeout?: number },
      ) => {
        seen.push(opts ?? {});
        const step = steps.shift();
        if (step === "hang") return new Promise(() => {});
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(step ?? OK);
      },
    },
  } as unknown as AgentClient;
  return { client, seen };
}

const err = (status: number, headers?: Record<string, string>) =>
  Object.assign(new Error(`http ${status}`), {
    status,
    ...(headers ? { headers: new Headers(headers) } : {}),
  });

const noSleep = { sleep: async () => {}, random: () => 0.5 };

describe("guardClient", () => {
  it("times a hung call out, aborts it, and tries again", async () => {
    const { client, seen } = scripted(["hang", OK]);
    const guarded = guardClient(client, {
      timeoutMs: 20,
      retries: 1,
      ...noSleep,
    });
    await expect(guarded.messages.create(ARGS)).resolves.toBe(OK);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.signal!.aborted).toBe(true);
    expect(seen[0]!.timeout).toBe(20);
  });

  it("gives up after its retries with the timeout", async () => {
    const { client } = scripted(["hang", "hang"]);
    const guarded = guardClient(client, {
      timeoutMs: 10,
      retries: 1,
      ...noSleep,
    });
    await expect(guarded.messages.create(ARGS)).rejects.toBeInstanceOf(
      ModelTimeoutError,
    );
  });

  it("retries 429, 5xx and 529 with growing, jittered waits", async () => {
    const waits: number[] = [];
    const { client } = scripted([err(429), err(529), err(503), OK]);
    const guarded = guardClient(client, {
      retries: 3,
      baseDelayMs: 100,
      random: () => 0,
      sleep: async (ms) => void waits.push(ms),
    });
    await expect(guarded.messages.create(ARGS)).resolves.toBe(OK);
    // Half the step at the lowest jitter: 100, 200, 400 → 50, 100, 200.
    expect(waits).toEqual([50, 100, 200]);
  });

  it("honours retry-after, capped", async () => {
    const waits: number[] = [];
    const { client } = scripted([
      err(429, { "retry-after": "2" }),
      err(429, { "retry-after": "600" }),
      OK,
    ]);
    const guarded = guardClient(client, {
      retries: 2,
      maxDelayMs: 5_000,
      sleep: async (ms) => void waits.push(ms),
    });
    await guarded.messages.create(ARGS);
    expect(waits).toEqual([2_000, 5_000]);
  });

  it("does not retry what will fail the same way", async () => {
    const { client, seen } = scripted([err(400), OK]);
    const guarded = guardClient(client, { retries: 2, ...noSleep });
    await expect(guarded.messages.create(ARGS)).rejects.toMatchObject({
      status: 400,
    });
    expect(seen).toHaveLength(1);
  });

  it("starts nothing past the turn's deadline, and never sleeps into it", async () => {
    let clock = 1_000;
    const { client, seen } = scripted([err(429), OK]);
    const late = guardClient(client, {
      deadline: 1_000,
      now: () => clock,
      ...noSleep,
    });
    await expect(late.messages.create(ARGS)).rejects.toBeInstanceOf(
      ModelDeadlineError,
    );
    expect(seen).toHaveLength(0);

    clock = 0;
    const tight = guardClient(client, {
      deadline: 500,
      now: () => clock,
      baseDelayMs: 1_000,
      ...noSleep,
    });
    // The 429's wait would end past the deadline: the 429 stands.
    await expect(tight.messages.create(ARGS)).rejects.toMatchObject({
      status: 429,
    });
    expect(seen).toHaveLength(1);
    // And a call never gets more time than the deadline leaves.
    const { client: c2, seen: s2 } = scripted([OK]);
    await guardClient(c2, {
      deadline: 300,
      now: () => 0,
      timeoutMs: 25_000,
    }).messages.create(ARGS);
    expect(s2[0]!.timeout).toBe(300);
  });

  it("names what went wrong", () => {
    expect(modelErrorReason(new ModelTimeoutError(5))).toBe("timeout");
    expect(modelErrorReason(new ModelDeadlineError())).toBe("deadline");
    expect(modelErrorReason(err(429))).toBe("429");
    expect(modelErrorReason({ name: "APIConnectionError" })).toBe("connection");
    expect(modelErrorReason(undefined)).toBe("error");
    expect(isRetryableModelError({ name: "APIConnectionTimeoutError" })).toBe(
      true,
    );
    expect(isRetryableModelError({ type: "overloaded_error" })).toBe(true);
    expect(isRetryableModelError(new Error("x"))).toBe(false);
  });
});

describe("staffTypedReply — what holds the bot off a chat", () => {
  const row = (over: Record<string, unknown>) => ({
    replyText: "Bisa kak, 14jt ya",
    answeredByAgent: false,
    answeredById: "staff_1",
    entities: {},
    ...over,
  });

  it("is a reply a colleague typed", () => {
    expect(staffTypedReply(row({}))).toBe(true);
  });

  it("is not Mark handled, Clear chat or the bot's own line under a staff id", () => {
    expect(staffTypedReply(row({ replyText: null }))).toBe(false);
    expect(staffTypedReply(row({ answeredById: null }))).toBe(false);
    expect(staffTypedReply(row({ answeredByAgent: true }))).toBe(false);
    expect(
      staffTypedReply(row({ replyText: "Bentar ya kak, aku cek dulu 🙏" })),
    ).toBe(false);
    expect(
      staffTypedReply(
        row({
          replyText: "Untuk itu aku tanyain owner ya kak",
          entities: {
            handoff: { reply: "Untuk itu aku tanyain owner ya kak" },
          },
        }),
      ),
    ).toBe(false);
  });
});
