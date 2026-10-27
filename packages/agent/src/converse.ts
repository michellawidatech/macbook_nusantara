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
 * ## Haiku 5.5 (2026-10-22)
 *
 * The model is `claude-haiku-5-5` unless `CHATBOT_MODEL` says otherwise
 * (`AnthropicEnv.model`). What moving off Haiku 4.5 changed here:
 *
 *  - Forced `tool_choice: any` is KEPT. Haiku 5.5 accepts it; the price is
 *    that a forced call skips thinking. That is the trade wanted: "every turn
 *    ends in reply or handoff_to_staff" is a guarantee the API keeps, where
 *    `auto` would turn it into a prompt instruction plus a plain-text fallback
 *    (the Sonnet path below). The facts come from the sources and the checks
 *    in `checkReply`, not from reasoning, so thinking buys this loop little.
 *  - Thinking is adaptive and on by default, so a response may still START
 *    with `thinking` blocks (an `auto` caller, or a future model): content is
 *    read by `type`, never `content[0]`, and the assistant turn is pushed
 *    back with its blocks unmodified before the tool results.
 *  - Thinking counts toward `max_tokens`, hence 4,096 rather than 1,024, and
 *    `effort: low` on every call — the guide's level for chat.
 *  - No `temperature` (Haiku 5.5 refuses anything but the default), no
 *    prefill, no `budget_tokens`.
 *  - The same text is ~30% more tokens on its tokenizer; `costMicros`
 *    (agents.ts) prices it at $0.10 / $0.50 per MTok, ten times less.
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
  dpKeepLine,
  holdingMessage,
  isHandoffTopic,
  modelTokens,
  PARALLEL_CAPABILITIES,
  type AgentCapabilities,
  type DpTerms,
  type HandoffTopic,
  type ReplyProblem,
  type Route,
  type StockFact,
} from "./policy.js";
import type { AgentPrompt } from "./prompt.js";
import { sanitiseReply } from "./sanitise.js";
import { reply as ruleReply } from "./rules/replies.js";
import {
  dispatchTool,
  storeOpenAt,
  toolsFor,
  type ToolContext,
} from "./tools.js";
import {
  TASK_REASON,
  clipQuote,
  heldReplyTask,
  needOfTopic,
  routeSummary,
  taskNote,
  unitSubject,
} from "./tasks.js";

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
      /** Absent from a test's fake; read as zeros. */
      usage?: Partial<{
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens: number | null;
        cache_creation_input_tokens: number | null;
      }> | null;
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
  /**
   * Chatbot v2: effort for the Sonnet 5.5 agents, and the Router's JSON
   * schema. Absent on every v1 call.
   */
  output_config?: {
    effort?: "low" | "medium" | "high";
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  };
}

/** One model call's cost and time, for the run's trace (`AgentRunStep`). */
export interface CallUsage {
  readonly model: string;
  readonly ms: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

/** Read a response's usage, tolerating a fake with none. */
export function usageOf(
  model: string,
  ms: number,
  usage: Awaited<ReturnType<AgentClient["messages"]["create"]>>["usage"],
): CallUsage {
  return {
    model,
    ms,
    inputTokens: usage?.input_tokens ?? 0,
    cachedTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

/**
 * The model behind the conversation. Haiku: the facts come from the owner's
 * answers and the shop's own records, not from the model's memory, so the job
 * here is choosing the right answer, phrasing it and knowing when to hand
 * over — which the small model does well and cheaply.
 *
 * The default only: `CHATBOT_MODEL` in the environment overrides it without a
 * release (`readAnthropicEnv`), and the worker and the API pass it as `model`.
 */
export const AGENT_MODEL = "claude-haiku-5-5";

/** Lookup round-trips allowed before the turn is handed to a person. */
export const MAX_STEPS = 4;

/**
 * Room for the owner's longest answer (the app list) plus the tool wrapper —
 * and for thinking, which counts toward the cap on Haiku 5.5. A forced tool
 * call skips thinking, but a cap sized for Haiku 4.5 would cut off the same
 * answer: the newer tokenizer spends ~30% more tokens on the same words.
 */
export const MAX_TOKENS = 4_096;

/**
 * How hard the model thinks. `low` is the migration guide's level for chat,
 * and this loop's quality lives in its sources and its checks.
 */
export const EFFORT = "low" as const;

/**
 * `output_config.effort` for a model that takes it, nothing for one that
 * does not. Haiku 4.5 answers the parameter with a 400 ("This model does not
 * support the effort parameter"), and Haiku 4.5 is what an OAuth token runs
 * on (`OAUTH_MODEL`, anthropic.ts) — so sending it unconditionally turned
 * every turn of an OAuth-run bot into a hand-over.
 */
export function effortConfig(model: string): {
  output_config?: { effort: typeof EFFORT };
} {
  return /^claude-(?:(?:opus|sonnet|haiku|fable)-5|opus-4-[5-9]|sonnet-4-6)/.test(
    model,
  )
    ? { output_config: { effort: EFFORT } }
    : {};
}

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
  /**
   * The DP rule from the shop's settings (2026-10-27) — what a keep is told,
   * and the one figure a hand-over line may name without a source.
   */
  readonly dp?: DpTerms;
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
  /**
   * Chatbot v2 — the Sales Advisor is this loop with these set. All absent,
   * the loop is the v1 agent, unchanged.
   */
  /** The model. Defaults to `AGENT_MODEL`. */
  readonly model?: string;
  /**
   * `tool_choice: any` (the default). Sonnet 5.5 refuses a forced tool
   * choice, so the Advisor runs on `auto` with effort low; a turn that ends
   * in plain text is then read as a reply citing only `greeting`, which
   * `checkReply` still holds to — no figure, no stock claim.
   */
  readonly forcedToolUse?: boolean;
  /** Tools this caller may not see, whatever the switches say. */
  readonly excludeTools?: ReadonlySet<string>;
  /** What the Operations agent found, so a reply may cite `stock` and send its photos. */
  readonly preloaded?: {
    readonly stockFacts: readonly StockFact[];
    readonly stockLooked: boolean;
    readonly photoIds: readonly string[];
    readonly bookings: readonly BookingWrite[];
    /** Put beside the customer's message, fenced like every shop note. */
    readonly note: string;
  };
  /** Called after every model call with its tokens and time. */
  readonly onCall?: (usage: CallUsage) => void;
  /**
   * Something of this customer's is already with a colleague and the bot's
   * last reply told them so (2026-10-27). A hand-over in the shop's fixed
   * words is then a short "passed that on too", not the same promise again.
   */
  readonly alreadyTold?: boolean;
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
   * Serials of the units this reply named, in order (2026-10-27) — what
   * "yang kedua", the visit reminder and the lead nudge read back
   * (`lastShownUnits`). A unit counts when its price, or failing that its
   * model, is in the words sent.
   */
  readonly shown?: readonly string[];
  /**
   * The bookings this turn committed, whatever became of the reply. A hold is
   * its own transaction, so it stands even when the words that would have
   * announced it are refused — and the caller must be able to see it.
   */
  readonly bookings?: readonly BookingWrite[];
}

/** A booking write that succeeded this turn. */
export interface BookingWrite {
  /** `book_visit` since 2026-10-27: a visit, which holds nothing. */
  readonly tool: "book_visit" | "reschedule_reservation" | "cancel_reservation";
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
    const left = r["left"];
    return name
      ? [
          {
            label: name,
            available,
            prices: digitsOf(r["price"]),
            // "Tinggal 1 unit" may rest on this and on nothing else.
            ...(typeof left === "number" ? { count: left } : {}),
          },
        ]
      : [];
  };
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  switch (tool) {
    case "search_stock":
      // The closest units in stock when nothing matched, the one step up,
      // and a fitting accessory (2026-10-27) are all on the shelf too: a
      // reply may quote them, and only at the price this lookup gave.
      return [
        ...list(o["units"]),
        ...list(o["alternatives"]),
        ...(o["stepUp"] ? [o["stepUp"]] : []),
        ...(o["accessory"] ? [o["accessory"]] : []),
      ].flatMap((u) => unit(u, true));
    case "check_serial":
      return o["found"] === true ? unit(o, o["available"] === true) : [];
    case "find_unit_photos":
      return str(o["serial"]) ? unit(o, true) : [];
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
    : // A visit holds nothing (2026-10-27): never "unitnya kami tahan".
      `Jadwal datangnya sudah kami catat dengan kode booking ${b.code}${when} ya kak.`;
}

const TERMINAL = new Set(["reply", "handoff_to_staff"]);

/** A unit a stock lookup returned this turn: its serial, name and price digits. */
interface SeenUnit {
  readonly serial: string;
  readonly label: string;
  readonly price: string | null;
}

/** Every unit a stock tool's output names, in the order it names them. */
function unitsSeen(tool: string, output: unknown): SeenUnit[] {
  if (output === null || typeof output !== "object") return [];
  const o = output as Record<string, unknown>;
  const one = (u: unknown): SeenUnit[] => {
    if (u === null || typeof u !== "object") return [];
    const r = u as Record<string, unknown>;
    if (!str(r["serial"])) return [];
    return [
      {
        serial: r["serial"],
        label: [r["model"], r["variant"]].filter(str).join(" "),
        price: digitsOf(r["price"])[0] ?? null,
      },
    ];
  };
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  if (tool === "search_stock")
    return [
      ...list(o["units"]),
      ...list(o["alternatives"]),
      ...(o["stepUp"] ? [o["stepUp"]] : []),
    ].flatMap(one);
  if (tool === "check_serial" || tool === "find_unit_photos") return one(o);
  return [];
}

/** The units a reply actually names, out of those the lookups returned. */
function shownIn(message: string, seen: readonly SeenUnit[]): string[] {
  const digits = amountSpansDigits(message);
  const words = new Set(modelTokens(message));
  const out: string[] = [];
  for (const u of seen) {
    if (out.includes(u.serial)) continue;
    const byPrice = u.price !== null && digits.has(u.price);
    const own = modelTokens(u.label);
    const byName =
      u.price === null && own.length > 0 && own.every((t) => words.has(t));
    if (byPrice || byName) out.push(u.serial);
  }
  return out.slice(0, 6);
}

/** Every run of digits in a text, separators removed — "Rp11.900.000" → 11900000. */
function amountSpansDigits(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]/g, "")),
  );
}

/** The handles a `unit_photos` result offered, read back defensively. */
export function photoIdsIn(output: unknown): string[] {
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
  // The customer's newest words, for the one-line task a hand-over leaves.
  const customerText = turns[last]?.role === "user" ? turns[last]!.text : "";
  const routedNote = route
    ? `This message must go to a colleague (${route.topic.replace("_", " ")}). ` +
      "Do not answer it with reply. Use handoff_to_staff: first answer anything an approved " +
      "answer covers, then say warmly that a colleague will check and reply in this chat." +
      (route.topic === "closing"
        ? ' They are ready to buy: write the summary as "Perlu closing — <name> siap ambil ' +
          '<unit> <price>, <how>".' +
          (route.rule === "keep"
            ? ` To keep a unit they need a DP; tell them exactly: "${dpKeepLine(input.dp)}". Never ` +
              "name any other amount, and never say a unit is held: staff check the transfer first."
            : "")
        : route.rule === "dp_proof"
          ? ' They say they paid a DP: write the summary as "Perlu verifikasi DP — <name> kirim ' +
            'bukti transfer <amount> untuk <unit>", and say a colleague is checking it. Never ' +
            "confirm it was received or that the unit is held."
          : "")
    : "";
  const shopNote = [routedNote, input.preloaded?.note ?? "", input.hint ?? ""]
    .filter(Boolean)
    .join("\n\n");
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
  }).filter((t) => !input.excludeTools?.has(t.name));
  const model = input.model ?? AGENT_MODEL;
  const forcedToolUse = input.forcedToolUse ?? true;
  const catalogResults: string[] = [];
  /*
   * What the shelf said this turn, so a price the bot quotes can be checked
   * against it exactly as a price from an approved answer is. Without this,
   * `checkReply` would refuse every figure the stock tools returned and the
   * capability would be on in name only.
   */
  const stockFacts: StockFact[] = [...(input.preloaded?.stockFacts ?? [])];
  /** Every unit the lookups named this turn, for `shown`. */
  const seen: SeenUnit[] = [];
  let stockLooked = input.preloaded?.stockLooked ?? false;
  const bookings: BookingWrite[] = [...(input.preloaded?.bookings ?? [])];
  /** The photo handles `unit_photos` offered, so `reply` cannot invent one. */
  const offeredPhotos = new Set<string>(input.preloaded?.photoIds ?? []);
  const open = storeOpenAt(ctx.now);
  /** The shop's fixed hand-over line — shorter once the customer was told. */
  const fixedLine = (topic: HandoffTopic) =>
    input.alreadyTold
      ? ruleReply.passedOnToo("id")
      : holdingMessage(
          topic,
          open,
          route?.topic === topic ? route.rule : undefined,
          input.dp,
        );

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
    const line = [...bookings.map(bookingLine), fixedLine(topic)].join("\n");
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
          ? `${summary}\nBot sudah membuat/mengubah booking ${booked}.`
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
    // The model's own note when it reads as an action item ("Perlu …");
    // otherwise the job its topic implies, with its note under it.
    const own = note(args["summary"], "");
    const summary = /^perlu\b/i.test(own)
      ? own
      : own
        ? `${taskNote(needOfTopic(topic), unitSubject(customerText))}\n${clipQuote(own)}`
        : taskNote(needOfTopic(topic), unitSubject(customerText), customerText);
    const serial =
      typeof args["serial"] === "string" && args["serial"].trim() !== ""
        ? args["serial"].trim().slice(0, 40)
        : undefined;
    const raw =
      typeof args["customer_message"] === "string"
        ? args["customer_message"]
        : "";
    const message = sanitiseReply(raw);
    // The DP rule is the shop's own setting: a vouched figure (2026-10-27).
    if (checkHoldingMessage(message, [dpKeepLine(input.dp)]) !== null) {
      // An empty line, or one carrying a figure or a stock promise: the
      // customer gets the shop's fixed words instead of the model's.
      const line = [...bookings.map(bookingLine), fixedLine(topic)].join("\n");
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
      // A figure nothing vouched for is a price somebody has to check, a
      // "ready" nothing vouched for is stock — and the task says so in one
      // line, with the held draft quoted under it (owner, 2026-10-27).
      const task = heldReplyTask(problem, message, customerText);
      return forced(task.topic, task.summary, problem, steps);
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
    const shown = sources.includes("stock") ? shownIn(message, seen) : [];
    return {
      reply: [...told, message].join("\n"),
      rawReply: raw,
      toolsUsed,
      steps,
      sources,
      ...(photos.length > 0 ? { photos } : {}),
      ...(bookings.length ? { bookings } : {}),
      ...(shown.length > 0 ? { shown } : {}),
    };
  };

  try {
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const t0 = Date.now();
      // No `temperature`: Haiku 5.5 and Sonnet 5.5 refuse a non-default one,
      // and variation is what the default gives anyway.
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        messages,
        tool_choice: forcedToolUse
          ? { type: "any" as const }
          : { type: "auto" as const },
        ...effortConfig(model),
      });
      input.onCall?.(usageOf(model, Date.now() - t0, response.usage));
      // A safety classifier declined (HTTP 200, no tool, maybe no text). The
      // customer gets a person, never an empty bubble.
      if (response.stop_reason === "refusal") break;

      const uses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (uses.length === 0) {
        // Only reachable on `auto`: words with no tool. They are a reply that
        // rests on nothing, and `checkReply` treats them so.
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        if (!forcedToolUse && text) {
          toolsUsed.push("reply");
          if (route)
            return forced(
              route.topic,
              routeSummary(route, customerText),
              "route",
              step,
            );
          return answer({ message: text, sources: "greeting" }, step);
        }
        break;
      }

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
            routeSummary(route, customerText),
            "route",
            step,
          );
        return answer(args, step);
      }

      // The whole turn, thinking blocks included and unmodified: Haiku 5.5
      // requires them back beside the tool results it reasoned about.
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
          seen.push(...unitsSeen(use.name, output));
          if (use.name === "unit_photos" || use.name === "find_unit_photos") {
            for (const id of photoIdsIn(output)) offeredPhotos.add(id);
          }
          if (
            (use.name === "book_visit" ||
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
        ? routeSummary(route, customerText)
        : taskNote("reply", TASK_REASON.noAnswer, customerText),
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
