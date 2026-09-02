/**
 * Test fixtures for the agent package. Not a test file — Vitest collects only
 * `*.test.ts`, so this is a plain module the suites import.
 *
 * ## Why a scripted client and not a mock
 *
 * `vi.mock` and `vi.doMock` appear nowhere in this repository, on purpose. The
 * previous build's agent tests are built on `vi.doMock("./anthropic.js")` and
 * are excluded from Vitest entirely (`exclude: ["reference/**"]`), which is a
 * fair summary of how well that went: a module mock couples the test to the
 * import graph, so moving a file breaks a test that has nothing to do with the
 * move.
 *
 * Everything here is constructor injection instead. `converse` already takes
 * its client as a parameter, so a fake is a bare object literal — the same
 * shape as `stubFetch` in the whatsapp and worker suites.
 *
 * ## The recorder is the point
 *
 * Most of what these tests assert is not the reply, it is *what was asked*:
 * that the grounding rules ride on every step, that the whole burst arrived as
 * one turn, that the summary refresh happened after the reply and not before.
 * So `scriptedClient` hands back the exact arguments of every call.
 */

import type { PrismaClient } from "@nusantara/db";
import type { AgentClient, CreateArgs } from "../src/converse.js";

// --- the scripted model ----------------------------------------------------

export type ScriptStep =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "tools";
      readonly uses: ReadonlyArray<{
        readonly name: string;
        readonly input: unknown;
      }>;
      /** A line to the customer sent in the same message as the tool call. */
      readonly text?: string;
    }
  | { readonly kind: "silent" }
  | { readonly kind: "fail"; readonly error: unknown };

/** The model answers in words and ends the turn. */
export const says = (text: string): ScriptStep => ({ kind: "text", text });

/** The model asks for one tool. */
export const calls = (name: string, input: unknown = {}): ScriptStep => ({
  kind: "tools",
  uses: [{ name, input }],
});

/** The model asks for several tools in one step, which the loop runs together. */
export const callsAll = (
  ...uses: Array<{ name: string; input?: unknown }>
): ScriptStep => ({
  kind: "tools",
  uses: uses.map((u) => ({ name: u.name, input: u.input ?? {} })),
});

/**
 * The model speaks to the customer AND asks for a tool in one message.
 *
 * Its ordinary behaviour, and the shape that used to lose a reply: the loop
 * read text from the last response only, so this line was discarded.
 */
export const saysAndCalls = (
  text: string,
  name: string,
  input: unknown = {},
): ScriptStep => ({ kind: "tools", uses: [{ name, input }], text });

/**
 * The model answers with no content blocks at all.
 *
 * Not hypothetical and not an error: the API really does return `content: []`
 * with `stop_reason: end_turn` when the model considers itself already to have
 * spoken, which it does after answering a tool result it had introduced.
 */
export const silent = (): ScriptStep => ({ kind: "silent" });

/** The SDK throws — an expired token, a rate limit, a network fault. */
export const fails = (error: unknown): ScriptStep => ({ kind: "fail", error });

export interface ScriptedClient {
  readonly client: AgentClient;
  /** Every `messages.create` argument object, in order. */
  readonly calls: CreateArgs[];
  /** Runs before the Nth response resolves — used to race a real row in. */
  onCall(n: number, fn: () => Promise<void>): void;
}

/**
 * A client that answers from a script.
 *
 * Running past the end of the script throws rather than returning undefined:
 * an unscripted call is a test failure — usually a loop that did not stop — and
 * it should say so by name instead of failing later as a null reply.
 */
export function scriptedClient(script: readonly ScriptStep[]): ScriptedClient {
  const recorded: CreateArgs[] = [];
  const hooks = new Map<number, () => Promise<void>>();
  let step = 0;

  const create = async (args: CreateArgs) => {
    recorded.push(args);
    const n = step;
    step += 1;

    const hook = hooks.get(n);
    if (hook) await hook();

    const next = script[n];
    if (!next) {
      throw new Error(
        `the model was called ${step} times but the script has ${script.length} steps — ` +
          `the loop did not stop when it should have`,
      );
    }

    if (next.kind === "fail") throw next.error;

    if (next.kind === "text") {
      return {
        content: [{ type: "text" as const, text: next.text }],
        stop_reason: "end_turn" as const,
      };
    }

    if (next.kind === "silent") {
      return { content: [], stop_reason: "end_turn" as const };
    }

    return {
      content: [
        ...(next.text ? [{ type: "text" as const, text: next.text }] : []),
        ...next.uses.map((u, i) => ({
          type: "tool_use" as const,
          id: `toolu_${n}_${i}`,
          name: u.name,
          input: u.input,
        })),
      ],
      stop_reason: "tool_use" as const,
    };
  };

  return {
    client: { messages: { create } } as unknown as AgentClient,
    calls: recorded,
    onCall(n, fn) {
      hooks.set(n, fn);
    },
  };
}

// --- the database that must not be touched ---------------------------------

/**
 * Any property access is a test failure: nothing may reach the database.
 *
 * Lifted from the webhook's fail-closed suite, which uses it to prove a request
 * is rejected before persistence. Here it proves that a forbidden tool is
 * refused before a query, which is the same claim about a different boundary.
 */
export const noDb = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `the database was touched (${String(prop)}) on a path that must refuse first`,
      );
    },
  },
) as PrismaClient;

// --- time ------------------------------------------------------------------

/** 20 August 2026, 10:00 in Jakarta — the shop has just opened. */
export const ANCHOR = new Date("2026-08-20T03:00:00.000Z");

/** A clock that does not move, so a test never races the wall. */
export const frozen =
  (at: Date = ANCHOR) =>
  (): Date =>
    at;

/** `at` shifted by whole milliseconds, for backdating a row. */
export const ago = (ms: number, at: Date = ANCHOR): Date =>
  new Date(at.getTime() - ms);
