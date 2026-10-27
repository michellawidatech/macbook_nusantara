/**
 * Chatbot v2: one customer turn through three agents
 * (docs/chatbot-v2-design.md §2; owner answers of 2026-10-14).
 *
 *   Router ──► (code: confirm a proposal the customer said yes to)
 *          ──► Operations (POS tools over the agent API, facts only)
 *          ──► Sales Advisor (the one reply, the profile, the next question)
 *          ──► the v1 checks (checkReply, sanitiseReply) on what it wrote
 *
 * The Advisor IS `converse` — the same loop, the same fact-check, the same
 * hand-over and booking announcements — given Sonnet, no POS tools, and what
 * Operations found. Nothing that made v1 safe is re-implemented here, so
 * nothing about it can drift.
 *
 * Two decisions are code, not model:
 *  - **A booking is confirmed by code.** Operations may only PROPOSE one
 *    (`propose_reservation`, which holds nothing); the hold is made when the
 *    router reads the customer's NEXT message as a yes and a proposal is open.
 *    No sentence the model writes can book anything.
 *  - **A hand-over the router asks for is a route**, exactly like one
 *    `routeMessage` found: the Advisor is then offered no `reply` at all.
 *
 * Fail-soft as v1: any model error returns null and the caller hands the
 * thread to a person; a router that answers nonsense falls back to a neutral
 * verdict rather than stopping the turn.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@nusantara/db";
import {
  AGENT_DEFINITIONS,
  ADVISOR_MODEL,
  INTENTS,
  OPERATIONS_MODEL,
  ROUTER_MODEL,
  costMicros,
  type AgentRole,
  type Intent,
  type RouterVerdict,
} from "./agents.js";
import { REMOTE_TOOLS, type ToolDispatch } from "./agentApi.js";
import {
  converse,
  photoIdsIn,
  stockFactsOf,
  usageOf,
  type AgentClient,
  type BookingWrite,
  type CallUsage,
  type ConverseResult,
  type ConverseTurn,
} from "./converse.js";
import type { KnowledgeBase } from "./knowledge.js";
import {
  HANDOFF_TOPICS,
  effectiveCapabilities,
  isHandoffTopic,
  type AgentCapabilities,
  type Route,
  type StockFact,
} from "./policy.js";
import type { AgentPrompt } from "./prompt.js";
import {
  dispatchTool,
  jakartaDate,
  jakartaTime,
  jakartaWeekday,
  toolsFor,
  type ToolContext,
} from "./tools.js";

/** One line of the run's trace — a model call or a tool call. */
export interface AgentStep {
  readonly agent: AgentRole;
  readonly model: string;
  readonly tool: string | null;
  readonly ok: boolean;
  readonly ms: number;
  /** Every input token, cached ones included. */
  readonly inputTokens: number;
  /** Of those, the ones read from the prompt cache. */
  readonly cachedTokens: number;
  readonly outputTokens: number;
}

export interface PipelineInput {
  readonly client: AgentClient;
  readonly db: PrismaClient;
  readonly ctx: ToolContext;
  /** The Advisor's prompt — `buildAgentPrompt` with the Advisor's persona. */
  readonly prompt: AgentPrompt;
  readonly turns: readonly ConverseTurn[];
  readonly knowledge: KnowledgeBase;
  readonly storeFacts: string;
  /** `routeMessage`'s verdict, which outranks the router's. */
  readonly route?: Route | null;
  readonly hint?: string;
  readonly capabilities: AgentCapabilities;
  readonly dispatch?: ToolDispatch;
  /** The Router's and Operations' persona text (Persona table or default). */
  readonly personas: { readonly router: string; readonly operations: string };
  /** The thread's rolling note and what the profile already says. */
  readonly summary?: string | null;
  readonly profile?: string | null;
  /** An open proposal awaiting the customer's yes, described for the router. */
  readonly openProposal?: string | null;
  /** From this score the Advisor offers a visit (Settings, default 60). */
  readonly leadThreshold: number;
  readonly onError?: (err: unknown) => void;
}

export interface PipelineResult extends ConverseResult {
  readonly verdict: RouterVerdict;
  readonly trace: readonly AgentStep[];
  readonly costMicros: number;
  readonly latencyMs: number;
  /** Set when Operations proposed a visit this turn. */
  readonly proposed?: boolean;
}

/** Turns the router reads. Older ones live in the summary. */
const ROUTER_TURNS = 6;
/** Operations' tool round trips before it must report. */
const OPS_MAX_STEPS = 3;
/** A tool result longer than this is cut before the Advisor reads it. */
const RESULT_CHARS = 4_000;

const ESCALATE_TOPICS = [
  "negotiation",
  "order_payment",
  "complaint",
  "trade_in",
  "sell_to_shop",
  "warranty_claim",
  "human",
] as const;

const ROUTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    language: { type: "string", enum: ["id", "en", "other"] },
    tone: { type: "string", enum: ["casual", "formal"] },
    intent: { type: "string", enum: [...INTENTS] },
    lead_score: { type: "integer" },
    needs_operations: { type: "boolean" },
    operations_brief: { type: "string" },
    escalate: { type: "string", enum: [...ESCALATE_TOPICS, "none"] },
  },
  required: [
    "language",
    "tone",
    "intent",
    "lead_score",
    "needs_operations",
    "operations_brief",
    "escalate",
  ],
} as const;

const ROUTER_RULES = [
  "Answer with the JSON the schema asks for and nothing else.",
  "- language: the language of the customer's latest message.",
  "- tone: casual for chat spelling (kak, gan, yg, ga), formal otherwise.",
  "- intent: greeting; browse (wants advice, no unit named); ask_stock; ask_price; ask_photo;",
  "  reserve (wants to come and see a unit, or to book); confirm (says yes to the open booking",
  "  proposal — ONLY when one is open and they clearly agree); decline (says no to it);",
  "  negotiate (asks for a lower price or makes an offer); complaint; payment; other.",
  "- lead_score 0-100: how likely they are to buy soon.",
  "- needs_operations: true when answering needs the shop's system — a named model or",
  "  budget to search, a serial, photos, their own booking or order, or preparing a visit.",
  "- operations_brief: one sentence telling the operations desk exactly what to look up or",
  "  prepare, e.g. 'Find MacBook Pro 16 M3 units in stock with photos'. Empty when not needed.",
  "  For a visit include the units, the date and time and the name, if the customer gave them.",
  "- escalate: a topic when a colleague must handle it (an offer or haggling is negotiation;",
  "  paying, transfers or invoices are order_payment), otherwise none.",
].join("\n");

const OPS_RULES = [
  "You receive a brief and the customer's message. Use the tools to find exactly what the",
  "brief asks, then call done with a one-line summary. At most three rounds of lookups.",
  "- Search before you name anything. Pass budgets as rupiah integers (15 juta = 15000000).",
  "- For photos, use unit_photos with a serial from a search, or find_unit_photos.",
  "- propose_reservation ONLY when the brief says the customer wants to visit AND gives the",
  "  date, the time and the name. Use serials a search returned, if any. It books and holds",
  "  nothing.",
  "- You never write to the customer.",
].join("\n");

const DONE_TOOL: Anthropic.Tool = {
  name: "done",
  description: "Finish: say in one line what you found.",
  input_schema: {
    type: "object",
    properties: { summary: { type: "string", maxLength: 400 } },
    required: ["summary"],
    additionalProperties: false,
  },
};

/** The tools Operations may call: the POS's, minus writes that are not its own. */
const OPS_EXCLUDED = new Set([
  "remember_customer",
  "book_visit",
  "watch_stock",
  "confirm_reservation",
]);

/** The Advisor's tools: everything but the POS, except the profile it keeps. */
const ADVISOR_EXCLUDED = new Set(
  [...REMOTE_TOOLS].filter((t) => t !== "remember_customer"),
);

function neutralVerdict(text: string, caps: AgentCapabilities): RouterVerdict {
  return {
    language: "id",
    tone: "casual",
    intent: "other",
    leadScore: 0,
    needsOperations: effectiveCapabilities(caps).stock,
    operationsBrief: text.slice(0, 300),
    escalate: null,
  };
}

/** Read the router's JSON defensively: a missing field is a neutral one. */
export function readVerdict(
  raw: string,
  fallbackText: string,
  caps: AgentCapabilities,
): RouterVerdict | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const base = neutralVerdict(fallbackText, caps);
  const intent = INTENTS.includes(o["intent"] as Intent)
    ? (o["intent"] as Intent)
    : base.intent;
  const score = Number(o["lead_score"]);
  const escalate =
    typeof o["escalate"] === "string" &&
    o["escalate"] !== "none" &&
    isHandoffTopic(o["escalate"])
      ? o["escalate"]
      : null;
  return {
    language:
      o["language"] === "en" || o["language"] === "other"
        ? o["language"]
        : "id",
    tone: o["tone"] === "formal" ? "formal" : "casual",
    intent,
    leadScore: Number.isFinite(score)
      ? Math.max(0, Math.min(100, Math.round(score)))
      : 0,
    needsOperations: o["needs_operations"] === true,
    operationsBrief:
      typeof o["operations_brief"] === "string"
        ? o["operations_brief"].slice(0, 400)
        : "",
    escalate,
  };
}

const textOf = (content: Anthropic.ContentBlock[]): string =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

const clock = (now: Date) =>
  `Now: ${jakartaWeekday(now)} ${jakartaDate(now)} ${jakartaTime(now)} Jakarta time.`;

export async function runPipeline(
  input: PipelineInput,
): Promise<PipelineResult | null> {
  const { client, db, ctx, capabilities } = input;
  const started = Date.now();
  const trace: AgentStep[] = [];
  const caps = effectiveCapabilities(capabilities);
  const dispatch: ToolDispatch =
    input.dispatch ?? ((name, args, c) => dispatchTool(db, name, args, c));
  const record = (agent: AgentRole, u: CallUsage, ok = true) =>
    trace.push({
      agent,
      model: u.model,
      tool: null,
      ok,
      ms: u.ms,
      inputTokens: u.inputTokens + u.cachedTokens + u.cacheWriteTokens,
      cachedTokens: u.cachedTokens,
      outputTokens: u.outputTokens,
    });
  let cost = 0;
  const spend = (u: CallUsage) => {
    cost += costMicros(u);
  };
  const customerText = input.turns[input.turns.length - 1]?.text ?? "";

  try {
    // --- 1. Router ---------------------------------------------------------
    const context = [
      input.summary ? `Conversation so far: ${input.summary}` : "",
      input.profile ? `What we know about them: ${input.profile}` : "",
      input.openProposal
        ? `An open booking proposal is waiting for their yes: ${input.openProposal}`
        : "There is no open booking proposal.",
      caps.stock
        ? ""
        : "The shop's stock is not available to the bot; stock and price questions go to a colleague.",
    ]
      .filter(Boolean)
      .join("\n");
    const routerTurns = input.turns.slice(-ROUTER_TURNS);
    const routerMessages: Anthropic.MessageParam[] = routerTurns.map((t, i) =>
      i === routerTurns.length - 1
        ? {
            role: "user",
            content: [
              { type: "text", text: t.text },
              {
                type: "text",
                text: `<shop_note>\n${clock(ctx.now)}\n${context}\n</shop_note>`,
              },
            ],
          }
        : { role: t.role, content: t.text },
    );
    if (routerMessages[0]?.role !== "user") routerMessages.shift();
    const r0 = Date.now();
    const routed = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 600,
      system: [
        {
          type: "text",
          text: `${input.personas.router}\n\n${ROUTER_RULES}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: routerMessages,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: ROUTER_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });
    const ru = usageOf(ROUTER_MODEL, Date.now() - r0, routed.usage);
    const parsed = readVerdict(
      textOf(routed.content),
      customerText,
      capabilities,
    );
    record("ROUTER", ru, parsed !== null);
    spend(ru);
    const verdict = parsed ?? neutralVerdict(customerText, capabilities);

    // The code's route outranks the router's; the router's is the second net.
    const route: Route | null =
      input.route ??
      (verdict.escalate && isHandoffTopic(verdict.escalate)
        ? { topic: verdict.escalate, rule: "router" }
        : null);

    // --- 2. The confirm — code, on the router's reading of a yes ------------
    const bookings: BookingWrite[] = [];
    const notes: string[] = [];
    if (
      !route &&
      verdict.intent === "confirm" &&
      caps.reserve &&
      ctx.reserve !== undefined
    ) {
      const t = Date.now();
      const out = (await dispatch(
        "confirm_reservation",
        {},
        {
          ...ctx,
          capabilities,
        },
      )) as Record<string, unknown>;
      trace.push({
        agent: "OPERATIONS",
        model: "",
        tool: "confirm_reservation",
        ok: out["ok"] === true,
        ms: Date.now() - t,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
      });
      if (out["ok"] === true && typeof out["code"] === "string") {
        bookings.push({
          tool: "book_visit",
          code: out["code"],
          ...(typeof out["when"] === "string" ? { when: out["when"] } : {}),
        });
        notes.push(
          `The customer confirmed and the visit is now BOOKED: ${JSON.stringify(out)}. ` +
            "Thank them, give the booking code, the date and time, and what to bring.",
        );
      } else if (out["noProposal"] !== true) {
        notes.push(
          `Booking the confirmed visit FAILED: ${JSON.stringify(out)}. Do not say it is booked; ` +
            "say a colleague will check and confirm.",
        );
      }
    }

    // --- 3. Operations -----------------------------------------------------
    const stockFacts: StockFact[] = [];
    let stockLooked = false;
    const photoIds: string[] = [];
    const results: Array<{ tool: string; output: unknown }> = [];
    let opsSummary = "";
    let proposed = false;
    const opsTools = toolsFor(ctx, { capabilities, proposals: true }).filter(
      (t) => REMOTE_TOOLS.has(t.name) && !OPS_EXCLUDED.has(t.name),
    );
    if (
      !route &&
      verdict.needsOperations &&
      opsTools.length > 0 &&
      bookings.length === 0
    ) {
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content: [
            "<brief>",
            verdict.operationsBrief || customerText,
            "</brief>",
            "<customer_message>",
            customerText,
            "</customer_message>",
            input.profile ? `<profile>${input.profile}</profile>` : "",
            input.openProposal
              ? `<open_proposal>${input.openProposal}</open_proposal>`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];
      const system: Anthropic.TextBlockParam[] = [
        {
          type: "text",
          text: `${input.personas.operations}\n\n${OPS_RULES}`,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: clock(ctx.now) },
      ];
      for (let step = 1; step <= OPS_MAX_STEPS; step += 1) {
        const t = Date.now();
        const res = await client.messages.create({
          model: OPERATIONS_MODEL,
          max_tokens: 800,
          system,
          tools: [...opsTools, DONE_TOOL],
          tool_choice: { type: "any" },
          messages,
        });
        const u = usageOf(OPERATIONS_MODEL, Date.now() - t, res.usage);
        record("OPERATIONS", u);
        spend(u);
        const uses = res.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        const done = uses.find((x) => x.name === "done");
        if (done || uses.length === 0) {
          const s = (done?.input as { summary?: unknown } | undefined)?.summary;
          opsSummary = typeof s === "string" ? s : "";
          break;
        }
        messages.push({ role: "assistant", content: res.content });
        const toolResults = await Promise.all(
          uses.map(async (use) => {
            const ts = Date.now();
            const output = await dispatch(use.name, use.input, {
              ...ctx,
              knowledge: input.knowledge,
              capabilities,
            });
            const failed =
              output !== null &&
              typeof output === "object" &&
              "error" in (output as object);
            trace.push({
              agent: "OPERATIONS",
              model: "",
              tool: use.name,
              ok: !failed,
              ms: Date.now() - ts,
              inputTokens: 0,
              cachedTokens: 0,
              outputTokens: 0,
            });
            results.push({ tool: use.name, output });
            stockFacts.push(...stockFactsOf(use.name, output));
            if (
              [
                "search_stock",
                "check_serial",
                "browse_catalog",
                "find_unit_photos",
              ].includes(use.name)
            )
              stockLooked = true;
            if (use.name === "unit_photos" || use.name === "find_unit_photos")
              photoIds.push(...photoIdsIn(output));
            if (
              use.name === "propose_reservation" &&
              (output as { ok?: unknown } | null)?.ok === true
            )
              proposed = true;
            if (
              (use.name === "reschedule_reservation" ||
                use.name === "cancel_reservation") &&
              (output as { ok?: unknown } | null)?.ok === true &&
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
              content: JSON.stringify(output).slice(0, RESULT_CHARS),
            };
          }),
        );
        messages.push({ role: "user", content: toolResults });
      }
    }

    // --- 4. Sales Advisor ----------------------------------------------------
    const lang =
      verdict.language === "en"
        ? "English"
        : verdict.language === "id"
          ? "Indonesian"
          : "the customer's language";
    const guidance = [
      `Router: language ${verdict.language}, tone ${verdict.tone}, intent ${verdict.intent}, ` +
        `lead score ${verdict.leadScore}. Reply in ${lang}, ${verdict.tone === "formal" ? "politely and formally" : "warmly and casually"}.`,
      results.length > 0
        ? "Operations already looked these up in the shop's system — answer from them, cite " +
          "`stock` for anything about a unit, and never describe a unit that is not here. " +
          "Recommend specifically: model, grade, price when given. When photos are listed, " +
          "send up to three with `photos` and say you are sending them."
        : "",
      proposed
        ? "Operations prepared a visit that is NOT booked yet. Read every unit (name, grade, " +
          "price) and the date and time back to the customer and ask them to confirm. Do not " +
          "say it is booked or held."
        : "",
      !proposed &&
      bookings.length === 0 &&
      !input.openProposal &&
      verdict.leadScore >= input.leadThreshold &&
      caps.reserve
        ? "This customer looks ready. After answering, offer to arrange a visit to see the " +
          "unit at the shop, and ask for their name and a day and time."
        : "",
      "Be curious: ask one question that tells the shop more about what they need — what " +
        "they will use it for, which apps, their budget range, size or condition they prefer — " +
        "and save what they tell you with remember_customer (estimates for age and occupation " +
        "only when something they said points to it).",
      ...notes,
    ]
      .filter(Boolean)
      .join("\n");
    const report =
      results.length > 0
        ? `<operations_report>\n${opsSummary ? `${opsSummary}\n` : ""}${results
            .map(
              (r) =>
                `${r.tool}: ${JSON.stringify(r.output).slice(0, RESULT_CHARS)}`,
            )
            .join(
              "\n",
            )}${photoIds.length ? `\nphotos: ${photoIds.join(", ")}` : ""}\n</operations_report>`
        : "";

    let advisorFailed: unknown;
    const result = await converse({
      client,
      db,
      ctx,
      prompt: input.prompt,
      turns: input.turns,
      knowledge: input.knowledge,
      storeFacts: input.storeFacts,
      route,
      ...(input.hint ? { hint: input.hint } : {}),
      capabilities,
      dispatch,
      model: ADVISOR_MODEL,
      forcedToolUse: false,
      excludeTools: ADVISOR_EXCLUDED,
      preloaded: {
        stockFacts,
        stockLooked,
        photoIds,
        bookings,
        note: [report, guidance].filter(Boolean).join("\n\n"),
      },
      onCall: (u) => {
        record("ADVISOR", u);
        spend(u);
      },
      onError: (err) => {
        advisorFailed = err;
      },
    });
    if (!result) {
      input.onError?.(advisorFailed);
      return null;
    }
    return {
      ...result,
      verdict,
      trace,
      costMicros: cost,
      latencyMs: Date.now() - started,
      ...(proposed ? { proposed } : {}),
    };
  } catch (err) {
    input.onError?.(err);
    return null;
  }
}

/** The text a persona row lacks for an agent: its default. */
export function personaFor(
  agent: AgentRole,
  stored: ReadonlyArray<{ agent: AgentRole | null; prompt: string }>,
  advisorFallback: string,
): string {
  const row = stored.find((p) => p.agent === agent);
  if (row) return row.prompt;
  return agent === "ADVISOR"
    ? advisorFallback
    : AGENT_DEFINITIONS[agent].defaultPrompt;
}

export { HANDOFF_TOPICS };
