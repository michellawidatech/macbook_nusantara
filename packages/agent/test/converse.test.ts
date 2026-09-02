/**
 * What the conversation loop does with a reply it has already been given.
 *
 * The loop reads the model's text out of the LAST response, which is right
 * whenever there is one. There is not always one. The model routinely writes a
 * line to the customer in the same message as a tool call, and then, having
 * seen the tool result, answers with `content: []` and `stop_reason: end_turn`
 * because as far as it is concerned it has spoken. Roughly two turns in five
 * did that against the live API when asked to recommend something inside a
 * budget.
 *
 * The old loop turned that into `null`, which the worker reads as "the agent
 * failed" and stamps PERLU_STAF: a customer with a perfectly good sentence
 * waiting for them was queued for a human instead, silently, and the sentence
 * was thrown away. These are the tests for not doing that.
 */

import { describe, expect, it } from "vitest";
import { converse } from "../src/converse.js";
import {
  noDb,
  says,
  saysAndCalls,
  scriptedClient,
  silent,
} from "./fixtures.js";
import type { PrismaClient } from "@nusantara/db";

const ctx = { from: "628123", now: new Date("2026-08-21T07:15:00.000Z") };
const turns = [{ role: "user" as const, text: "17jtan buat kerja" }];

/** A database that answers `store_info` without any of the tool suites' setup. */
const db = {
  location: { findMany: async () => [] },
} as unknown as PrismaClient;

describe("a model that stops talking after a tool result", () => {
  it("sends what it already said rather than handing the thread to a person", async () => {
    const { client } = scriptedClient([
      saysAndCalls("bentar ya kak, aku cek stoknya", "store_info", {
        topic: "hours",
      }),
      silent(),
    ]);

    const result = await converse({
      client,
      db,
      ctx,
      systemPrompt: "p",
      turns,
    });

    expect(result).not.toBeNull();
    expect(result?.reply).toBe("bentar ya kak, aku cek stoknya");
  });

  it("still prefers the last step whenever the model does answer", async () => {
    // The fallback is a fallback. The final step is where the model writes
    // having actually seen the tool results, so it wins on every normal turn.
    const { client } = scriptedClient([
      saysAndCalls("bentar ya kak", "store_info", { topic: "hours" }),
      says("buka sampai jam 8 malam kak"),
    ]);

    const result = await converse({
      client,
      db,
      ctx,
      systemPrompt: "p",
      turns,
    });

    expect(result?.reply).toBe("buka sampai jam 8 malam kak");
  });

  it("is still null when the model said nothing at any point", async () => {
    // An empty reply remains a failure. There is a difference between keeping
    // a sentence the model wrote and inventing one it did not.
    const { client } = scriptedClient([
      {
        kind: "tools",
        uses: [{ name: "store_info", input: { topic: "hours" } }],
      },
      silent(),
    ]);

    let failure: unknown = "not called";
    const result = await converse({
      client,
      db,
      ctx,
      systemPrompt: "p",
      turns,
      onError: (e) => (failure = e),
    });

    expect(result).toBeNull();
    // Null because there was nothing to send, not because anything threw.
    expect(failure).toBe("not called");
  });

  it("reports the kept text as the raw reply, so the log shows what was sent", async () => {
    const { client } = scriptedClient([
      saysAndCalls("oke kak, aku cekin dulu", "store_info", { topic: "hours" }),
      silent(),
    ]);

    const result = await converse({
      client,
      db,
      ctx,
      systemPrompt: "p",
      turns,
    });

    expect(result?.rawReply).toBe("oke kak, aku cekin dulu");
    expect(result?.toolsUsed).toEqual(["store_info"]);
  });

  it("never reaches the database when no tool is called", async () => {
    const { client } = scriptedClient([
      says("halo kak, ada yang bisa dibantu?"),
    ]);

    const result = await converse({
      client,
      db: noDb as unknown as PrismaClient,
      ctx,
      systemPrompt: "p",
      turns,
    });

    expect(result?.reply).toBe("halo kak, ada yang bisa dibantu?");
  });
});
