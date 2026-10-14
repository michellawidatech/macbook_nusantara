/**
 * The conversation loop: a few Claude tool-use round trips per customer turn,
 * ending in exactly one of two ways — an answer with its sources, or a person.
 *
 * ## The shape of a turn (2026-09-18)
 *
 * The shop runs this app in parallel with B2Soft, and production does not
 * hold the real stock or prices (policy.ts says why and what follows). So the
 * bot answers only from the owner's approved answers, the shop's own facts and
 * the catalogue, and every turn must END with a tool:
 *
 *  - `reply` — the words, and the sources they rest on (`K7`, `store`,
 *    `catalog`, or `greeting` for a hello with no facts in it);
 *  - `handoff_to_staff` — a topic, a note for the colleague, and a short line
 *    for the customer.
 *
 * `tool_choice: any` makes the model pick one of the tools every step, so a
 * free-text answer with nothing behind it cannot happen by accident. The
 * lookups (`search_knowledge`, `lookup_catalog`) run in between.
 *
 * Two checks sit outside the model, and neither trusts it:
 *
 *  - A message `routeMessage` already sent to a person (the stock or price of
 *    a named machine, a battery-health question, a booking…) is offered no
 *    `reply` tool at all: the only way to end that turn is a hand-over.
 *  - A reply is checked against what it cites (`checkReply`): no source, a
 *    source that does not exist, a rupiah figure or an availability claim the
 *    source does not contain — and the reply becomes a hand-over instead,
 *    with a fixed holding line rather than the model's words.
 *
 * The loop is dormant without a credential and fail-soft on any error: it
 * returns `null`, the caller reports why, and the inbox keeps working with a
 * human answering. A chat page that shows a stack trace when the API key
 * expires is worse than one that says "the bot is off, reply yourself".
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@nusantara/db";
import type { KnowledgeBase } from "./knowledge.js";
import type { ToolDispatch } from "./agentApi.js";
import {
  checkHoldingMessage,
  checkReply,
  holdingMessage,
  isHandoffTopic,
  PARALLEL_CAPABILITIES,
  type AgentCapabilities,
  type HandoffTopic,
  type ReplyProblem,
  type Route,
  type StockFact,
} from "./policy.js";
import type { AgentPrompt } from "./prompt.js";
import { sanitiseReply } from "./sanitise.js";
import {
  dispatchTool,
  storeOpenAt,
  toolsFor,
  type ToolContext,
} from "./tools.js";

/**
 * The client, structurally.
 *
 * `apps/worker` has no `@anthropic-ai/sdk` dependency and should not grow one
 * just to name a type in a test. This is the whole surface `converse` uses, so
 * a fake is a bare object literal — the same shape the fetch stubs elsewhere
 * take, and the reason none of these tests need a module mock.
 */
export interface AgentClient {
  readonly messages: {
    create(args: CreateArgs): Promise<{
      content: Anthropic.ContentBlock[];
      stop_reason?: string | null;
    }>;
  };
}

/** What every call to the model looks like. Recorded verbatim by the tests. */
export interface CreateArgs {
  model: string;
  max_tokens: number;
  system: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  tool_choice?: Anthropic.ToolChoice;
  temperature?: number;
}

/**
 * The model behind the conversation. Haiku: the facts come from the owner's
 * answers and the shop's own records, not from the model's memory, so the job
 * here is choosing the right answer, phrasing it and knowing when to hand
 * over — which the small model does well and cheaply.
 */
export const AGENT_MODEL = "claude-haiku-4-5-20251001";

/** Lookup round-trips allowed before the turn is handed to a person. */
export const MAX_STEPS = 4;

/** Room for the owner's longest answer (the app list) plus the tool wrapper. */
export const MAX_TOKENS = 1_024;

/**
 * Left at the SDK default, and named here so it stays there.
 *
 * It exists so that a later "let us make replies deterministic" edit has to
 * argue with a constant that says why not: a shop whose bot opens every
 * message identically reads as a recording, and variation is the cheapest
 * thing that stops it. The facts do not vary — they come from the sources.
 */
export const TEMPERATURE = 1.0;

export interface ConverseTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface ConverseInput {
  readonly client: AgentClient;
  readonly db: PrismaClient;
  /**
   * Who is talking and what this caller may do. The sender's identity lives
   * here rather than in any tool's arguments, so nothing a customer writes can
   * retarget a lookup.
   */
  readonly ctx: ToolContext;
  /** `buildAgentPrompt`'s two parts: the cached one, then the per-turn one. */
  readonly prompt: AgentPrompt;
  /** The thread so far, oldest first. The last turn is the customer's. */
  readonly turns: readonly ConverseTurn[];
  /** The pass's approved answers, so a cited `K7` resolves and is checked. */
  readonly knowledge: KnowledgeBase;
  /** The shop facts text the prompt carries, so a `store` citation is checked. */
  readonly storeFacts: string;
  /** Set when policy.ts routed this message to a person before the model saw it. */
  readonly route?: Route | null;
  /** A note for the model beside the customer's latest message — the likeliest answers. */
  readonly hint?: string;
  /**
   * What the bot may do for itself (policy.ts). Defaults to the 2026-09-18
   * design, so a caller that has not thought about it gets the cautious one.
   */
  readonly capabilities?: AgentCapabilities;
  /**
   * Called with whatever the SDK threw before this loop gives up.
   *
   * The loop still fails soft — the caller gets `null` and the inbox keeps
   * working — but "fail soft" and "fail silently" are not the same thing. A
   * 401 from an expired token and a 429 from a rate limit would otherwise
   * produce the identical blank screen.
   */
  readonly onError?: (err: unknown) => void;
  /**
   * Where a tool call goes. Absent, `dispatchTool` runs it here against `db`.
   * The worker passes `agentApiDispatch` (agentApi.ts) when the agent API is
   * configured, so the POS tools run behind `/api/agent/v1` under a token
   * that names this thread's customer and nobody else (chatbot v2 step 3).
   */
  readonly dispatch?: ToolDispatch;
}

export interface ConverseHandoff {
  readonly topic: HandoffTopic;
  /** For the colleague, from the model or from the refusal that forced it. */
  readonly summary: string;
  /** The unit it is about, when the model named one (a stock lookup's serial). */
  readonly serial?: string;
  /** Why the code, not the model, handed it over — for the log. */
  readonly forcedBy?: "route" | ReplyProblem | "no_terminal_tool";
}

export interface ConverseResult {
  /** Sanitised — exactly what will be sent. */
  readonly reply: string;
  /** What the model wrote before sanitising, or the fixed line that replaced it. */
  readonly rawReply: string;
  /** Which tools ran, in order. Surfaced in the UI so staff can see the grounding. */
  readonly toolsUsed: string[];
  readonly steps: number;
  /** What the answer rests on: approved-answer handles, `store`, `catalog`, `stock`, `greeting`. */
  readonly sources: string[];
  /**
   * Photo handles the answer asked to send (`UnitNotePhoto.id`), in order.
   *
   * The worker turns each into its own outbox row after the text. They are
   * never fetched here: an image in this loop would be an image in the prompt
   * cache, and the model has no business seeing one it is only forwarding.
   */
  readonly photos?: string[];
  /** Set when the turn ended with a person. The caller stamps PERLU_STAF. */
  readonly handoff?: ConverseHandoff;
  /**
   * The bookings this turn committed, whatever became of the reply. A hold is
   * its own transaction, so it stands even when the words that would have
   * announced it are refused — and the caller must be able to see it.
   */
  readonly bookings?: readonly BookingWrite[];
}

/** A booking write that succeeded this turn. */
export interface BookingWrite {
  readonly tool:
    "create_reservation" | "reschedule_reservation" | "cancel_reservation";
  readonly code: string;
  readonly when?: string;
}

const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const digitsOf = (price: unknown): string[] =>
  str(price) ? [price.replace(/\D/g, "")].filter(Boolean) : [];

/**
 * What a stock lookup said, as facts (policy.ts `StockFact`) rather than as
 * text. `checkReply` used to search the JSON for the word "available", which
 * `{"available": false}` contains (audit 2026-09-29).
 */
export function stockFactsOf(tool: string, output: unknown): StockFact[] {
  if (output === null || typeof output !== "object") return [];
  const o = output as Record<string, unknown>;
  const unit = (u: unknown, available: boolean): StockFact[] => {
    if (u === null || typeof u !== "object") return [];
    const r = u as Record<string, unknown>;
    const name = [r["model"], r["variant"]].filter(str).join(" ");
    return name
      ? [{ label: name, available, prices: digitsOf(r["price"]) }]
      : [];
  };
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  switch (tool) {
    case "search_stock":
      return list(o["units"]).flatMap((u) => unit(u, true));
    case "check_serial":
      return o["found"] === true ? unit(o, o["available"] === true) : [];
    case "find_unit_photos":
      return str(o["serial"]) ? unit(o, true) : [];
    case "create_reservation":
      return list(o["alternatives"]).flatMap((u) => unit(u, true));
    case "browse_catalog":
      return list(o["categories"]).flatMap((c) => {
        const cat = (c ?? {}) as Record<string, unknown>;
        return list(cat["models"]).flatMap((m) => {
          const r = (m ?? {}) as Record<string, unknown>;
          if (!str(r["model"])) return [];
          return [
            {
              label:
                `${str(cat["category"]) ? cat["category"] : ""} ${r["model"]}`.trim(),
              available:
                typeof r["available"] === "number" && r["available"] > 0,
              prices: [...digitsOf(r["priceFrom"]), ...digitsOf(r["priceTo"])],
            },
          ];
        });
      });
    default:
      return [];
  }
}

/** The fixed line that tells a customer about a booking the bot made. */
function bookingLine(b: BookingWrite): string {
  if (b.tool === "cancel_reservation")
    return `Booking ${b.code} sudah kami batalkan ya kak.`;
  const when = b.when ? ` untuk ${b.when} WIB` : "";
  return b.tool === "reschedule_reservation"
    ? `Booking ${b.code} sudah kami pindahkan${when} ya kak.`
    : `Unitnya sudah kami tahan dengan kode booking ${b.code}${when} ya kak.`;
}

const TERMINAL = new Set(["reply", "handoff_to_staff"]);

/** The handles a `unit_photos` result offered, read back defensively. */
function photoIdsIn(output: unknown): string[] {
  if (output === null || typeof output !== "object") return [];
  const ids = (output as { photoIds?: unknown }).photoIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((x): x is string => typeof x === "string" && x !== "");
}

/** One short line, trimmed, for the colleague's note. */
const note = (v: unknown, fallback: string): string => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, 240);
};

export async function converse(
  input: ConverseInput,
): Promise<ConverseResult | null> {
  const { client, db, ctx, prompt, turns, knowledge, route, onError } = input;
  const dispatch: ToolDispatch =
    input.dispatch ?? ((name, args, c) => dispatchTool(db, name, args, c));
  if (turns.length === 0) return null;

  const system: Anthropic.TextBlockParam[] = [
    // The cache breakpoint: tools, then this block, are read back at a tenth
    // of the price on every turn after the first — the persona, the rules and
    // all of the owner's answers. The volatile part comes after it.
    { type: "text", text: prompt.stable, cache_control: { type: "ephemeral" } },
    ...(prompt.volatile
      ? [{ type: "text" as const, text: prompt.volatile }]
      : []),
  ];

  const last = turns.length - 1;
  const routedNote = route
    ? `This message must go to a colleague (${route.topic.replace("_", " ")}). ` +
      "Do not answer it with reply. Use handoff_to_staff: first answer anything an approved " +
      "answer covers, then say warmly that a colleague will check and reply in this chat."
    : "";
  const shopNote = [routedNote, input.hint ?? ""].filter(Boolean).join("\n\n");
  const messages: Anthropic.MessageParam[] = turns.map((t, i) =>
    i === last && t.role === "user" && shopNote
      ? {
          role: "user",
          content: [
            { type: "text", text: t.text },
            // A separate block, fenced: the customer's words and the shop's
            // note must never read as one voice.
            { type: "text", text: `<shop_note>\n${shopNote}\n</shop_note>` },
          ],
        }
      : { role: t.role, content: t.text },
  );

  const toolsUsed: string[] = [];
  const capabilities = input.capabilities ?? PARALLEL_CAPABILITIES;
  const tools = toolsFor(ctx, {
    handoffOnly: route != null,
    capabilities,
  });
  const catalogResults: string[] = [];
  /*
   * What the shelf said this turn, so a price the bot quotes can be checked
   * against it exactly as a price from an approved answer is. Without this,
   * `checkReply` would refuse every figure the stock tools returned and the
   * capability would be on in name only.
   */
  const stockFacts: StockFact[] = [];
  let stockLooked = false;
  const bookings: BookingWrite[] = [];
  /** The photo handles `unit_photos` offered, so `reply` cannot invent one. */
  const offeredPhotos = new Set<string>();
  const open = storeOpenAt(ctx.now);

  /** The code handing over, in the shop's fixed words. */
  const forced = (
    topic: HandoffTopic,
    summary: string,
    forcedBy: ConverseHandoff["forcedBy"],
    steps: number,
  ): ConverseResult => {
    // A booking made this turn is announced whatever else happened: the
    // unit is held either way, and a customer who is not told is a customer
    // who does not come (audit 2026-09-29).
    const line = [
      ...bookings.map(bookingLine),
      holdingMessage(topic, open),
    ].join("\n");
    const booked = bookings.map((b) => b.code).join(", ");
    return {
      reply: line,
      rawReply: line,
      toolsUsed,
      steps,
      sources: [],
      handoff: {
        topic,
        summary: booked
          ? `${summary} Bot sudah membuat/mengubah booking ${booked}.`
          : summary,
        forcedBy,
      },
      ...(bookings.length ? { bookings } : {}),
    };
  };

  const handOver = (
    args: Record<string, unknown>,
    steps: number,
  ): ConverseResult => {
    const topic = isHandoffTopic(args["topic"])
      ? args["topic"]
      : (route?.topic ?? "other");
    const summary = note(args["summary"], "Pelanggan perlu dibantu staf.");
    const serial =
      typeof args["serial"] === "string" && args["serial"].trim() !== ""
        ? args["serial"].trim().slice(0, 40)
        : undefined;
    const raw =
      typeof args["customer_message"] === "string"
        ? args["customer_message"]
        : "";
    const message = sanitiseReply(raw);
    if (checkHoldingMessage(message) !== null) {
      // An empty line, or one carrying a figure or a stock promise: the
      // customer gets the shop's fixed words instead of the model's.
      const line = [
        ...bookings.map(bookingLine),
        holdingMessage(topic, open),
      ].join("\n");
      return {
        reply: line,
        rawReply: raw || line,
        toolsUsed,
        steps,
        sources: [],
        handoff: { topic, summary, ...(serial ? { serial } : {}) },
        ...(bookings.length ? { bookings } : {}),
      };
    }
    // The model's own hand-over line may not mention the booking it made, so
    // the fixed booking line goes first unless it already carries the code.
    const told = bookings
      .filter((b) => !message.includes(b.code))
      .map(bookingLine);
    return {
      reply: [...told, message].join("\n"),
      rawReply: raw,
      toolsUsed,
      steps,
      sources: [],
      handoff: { topic, summary, ...(serial ? { serial } : {}) },
      ...(bookings.length ? { bookings } : {}),
    };
  };

  const answer = (
    args: Record<string, unknown>,
    steps: number,
  ): ConverseResult => {
    const raw = typeof args["message"] === "string" ? args["message"] : "";
    const message = sanitiseReply(raw);
    const cited = String(args["sources"] ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const texts: string[] = [];
    let unknown = 0;
    const sources: string[] = [];
    for (const c of cited) {
      const handle = c.toUpperCase();
      const entry = knowledge.byHandle.get(handle);
      if (entry) {
        texts.push(`${entry.question}\n${entry.answer}`);
        sources.push(handle);
      } else if (c.toLowerCase() === "store") {
        texts.push(input.storeFacts);
        sources.push("store");
      } else if (c.toLowerCase() === "catalog" && catalogResults.length > 0) {
        texts.push(...catalogResults);
        sources.push("catalog");
      } else if (c.toLowerCase() === "stock" && stockLooked) {
        // Facts, not text: see `stockFactsOf`.
        sources.push("stock");
      } else if (c.toLowerCase() === "greeting") {
        sources.push("greeting");
      } else {
        unknown += 1;
      }
    }
    const problem = checkReply({
      message,
      sourceCount: sources.length,
      unknownSources: unknown,
      sourceTexts: texts,
      ...(sources.includes("stock") ? { stockFacts } : {}),
    });
    if (problem !== null) {
      return forced(
        // A figure nothing vouched for is a price question somebody has to
        // answer, and the action item should say so.
        problem === "AMOUNT_NOT_IN_SOURCE" ? "price" : "other",
        `Balasan bot ditahan (${problem}): "${message.slice(0, 160)}"`,
        problem,
        steps,
      );
    }
    /*
     * Only handles `unit_photos` actually offered this turn. A model asked for
     * a list of ids will sometimes produce a plausible-looking one, and the
     * cost of an invented handle is the shop sending a stranger a photograph
     * of a machine nobody asked about.
     */
    const photos = String(args["photos"] ?? "")
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter((x) => offeredPhotos.has(x));
    const told = bookings
      .filter((b) => !message.includes(b.code))
      .map(bookingLine);
    return {
      reply: [...told, message].join("\n"),
      rawReply: raw,
      toolsUsed,
      steps,
      sources,
      ...(photos.length > 0 ? { photos } : {}),
      ...(bookings.length ? { bookings } : {}),
    };
  };

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const response = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system,
        tools,
        tool_choice: { type: "any" },
        messages,
      });

      const uses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (uses.length === 0) break;

      // A hand-over wins over a reply sent in the same breath: when the model
      // is of two minds, the person is the safe one.
      const terminal =
        uses.find((u) => u.name === "handoff_to_staff") ??
        uses.find((u) => u.name === "reply");
      if (terminal) {
        toolsUsed.push(terminal.name);
        const args =
          terminal.input && typeof terminal.input === "object"
            ? (terminal.input as Record<string, unknown>)
            : {};
        if (terminal.name === "handoff_to_staff") return handOver(args, step);
        // A routed turn was never offered `reply`. The API would not produce
        // one, but the rule is not allowed to rest on that.
        if (route)
          return forced(
            route.topic,
            `Dialihkan ke staf (${route.rule}).`,
            "route",
            step,
          );
        return answer(args, step);
      }

      messages.push({ role: "assistant", content: response.content });
      // Independent reads, run together.
      const results = await Promise.all(
        uses.map(async (use) => {
          toolsUsed.push(use.name);
          const output = TERMINAL.has(use.name)
            ? { error: "not available" }
            : await dispatch(use.name, use.input, {
                ...ctx,
                knowledge,
                capabilities,
              });
          const content = JSON.stringify(output, (_k, v) =>
            typeof v === "bigint" ? v.toString() : v,
          );
          if (use.name === "lookup_catalog") catalogResults.push(content);
          if (
            use.name === "search_stock" ||
            use.name === "check_serial" ||
            use.name === "browse_catalog" ||
            use.name === "find_unit_photos"
          ) {
            stockLooked = true;
          }
          stockFacts.push(...stockFactsOf(use.name, output));
          if (use.name === "unit_photos" || use.name === "find_unit_photos") {
            for (const id of photoIdsIn(output)) offeredPhotos.add(id);
          }
          if (
            (use.name === "create_reservation" ||
              use.name === "reschedule_reservation" ||
              use.name === "cancel_reservation") &&
            output !== null &&
            typeof output === "object" &&
            (output as { ok?: unknown }).ok === true &&
            typeof (output as { code?: unknown }).code === "string"
          ) {
            const o = output as { code: string; when?: unknown };
            bookings.push({
              tool: use.name,
              code: o.code,
              ...(typeof o.when === "string" ? { when: o.when } : {}),
            });
          }
          return {
            type: "tool_result" as const,
            tool_use_id: use.id,
            content,
          };
        }),
      );
      messages.push({ role: "user", content: results });
    }

    // Out of steps, or the model ended without choosing: a person it is.
    return forced(
      route?.topic ?? "other",
      route
        ? `Dialihkan ke staf (${route.rule}).`
        : "Bot tidak menemukan jawaban yang disetujui.",
      "no_terminal_tool",
      MAX_STEPS,
    );
  } catch (err) {
    // Swallowed as far as the CUSTOMER is concerned — they get a human reply,
    // not a stack trace. The detail goes to the caller's logger, which is the
    // only place anybody can find out that the token expired.
    onError?.(err);
    return null;
  }
}
