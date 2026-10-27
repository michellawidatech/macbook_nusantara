/**
 * The rules-first bot (owner, 2026-10-15): "1. receive — no AI; 2. read &
 * classify — AI; 3. hit the API — no AI; 4. respond — AI … if the process can
 * be rule based or automated, do not use AI. Use AI only to do something
 * that the rule base cannot do."
 *
 *   policy routing (code)       negotiation, payment, complaints, a photo the
 *                               customer sent → a person, as in v1
 *   understand() (rules)        intent, product, budget, serial, name, time,
 *                               what they do and use
 *   the POS (no AI)             the same /api/agent/v1 tools, called directly
 *   replies (templates)         say only what the lookup returned
 *   the knowledge base          an owner's answer that matches strongly is
 *                               sent verbatim
 *   AI — only what is left      `ai`, when the caller configured one; without
 *                               it, a person
 *
 * Returns a `PipelineResult`, so the worker commits it, traces it and reads
 * the lead off it exactly as it does the three-agent pipeline's.
 */

import type { PrismaClient } from "@nusantara/db";
import type { RouterVerdict, Intent } from "../agents.js";
import type { ToolDispatch } from "../agentApi.js";
import {
  type BookingWrite,
  type CallUsage,
  type ConverseResult,
} from "../converse.js";
import { costMicros } from "../agents.js";
import { matchesFor, type KnowledgeBase } from "../knowledge.js";
import {
  effectiveCapabilities,
  holdingMessage,
  type AgentCapabilities,
  type HandoffTopic,
  type Route,
} from "../policy.js";
import type { AgentStep, PipelineResult } from "../pipeline.js";
import { isStrongMatch } from "../retrieval.js";
import { sanitiseReply } from "../sanitise.js";
import { dispatchTool, storeOpenAt, type ToolContext } from "../tools.js";
import {
  reply,
  unitLine,
  type Lang,
  type ShownAccessory,
  type ShownUnit,
} from "./replies.js";
import {
  TASK_REASON,
  routedTask,
  saidColleagueWillReply,
  taskNote,
  unitSubject,
  type WaitingTask,
} from "../tasks.js";
import {
  understand,
  type RuleIntent,
  type Understanding,
} from "./understand.js";

export interface RulesInput {
  readonly db: PrismaClient;
  readonly ctx: ToolContext;
  /** The customer's burst, joined (draft.ts `combineBatch`). */
  readonly text: string;
  readonly knowledge: KnowledgeBase;
  readonly capabilities: AgentCapabilities;
  readonly dispatch?: ToolDispatch;
  /** `routeMessage`'s verdict: a hand-over the code decided. */
  readonly route?: Route | null;
  /** What the profile already holds, so the bot does not ask twice. */
  readonly known: {
    readonly name: string | null;
    readonly usage: boolean;
    readonly preferences: boolean;
    readonly budget: boolean;
    readonly apps: boolean;
  };
  /** The bot's previous reply, so its follow-up question is not repeated word for word. */
  readonly lastReply?: string | null;
  readonly proposalOpen: boolean;
  /** Serials the bot showed in its last reply, in the order it showed them. */
  readonly lastShown: readonly string[];
  /**
   * Questions already with a colleague (2026-10-27). The bot answers what is
   * new, and a nudge is told once that the team is on the rest.
   */
  readonly waiting?: readonly WaitingTask[];
  readonly leadThreshold: number;
  /**
   * The AI fallback — only for what no rule covers. Absent (no credential,
   * or the owner wants none), that turn goes to a person.
   */
  readonly ai?: () => Promise<{
    readonly result: ConverseResult | null;
    readonly calls: readonly CallUsage[];
  }>;
}

export interface RulesResult extends PipelineResult {
  /** Serials this reply showed, for the next message's "yang kedua". */
  readonly shown: readonly string[];
  /** Whether the AI fallback answered this turn. */
  readonly usedAi: boolean;
}

const INTENT_OF: Record<RuleIntent, Intent> = {
  greeting: "greeting",
  thanks: "other",
  confirm: "confirm",
  decline: "decline",
  ask_photo: "ask_photo",
  reserve: "reserve",
  ask_price: "ask_price",
  ask_stock: "ask_stock",
  browse: "browse",
  ack: "other",
  tell: "browse",
  other: "other",
};

/** How likely a buyer, from what they said — rules, not a model. */
export function leadScoreOf(u: Understanding): number {
  let s = 0;
  if (u.query) s += 25;
  if (u.budgetMin !== null || u.budgetMax !== null) s += 20;
  if (u.intent === "ask_price") s += 15;
  if (u.intent === "ask_photo") s += 15;
  if (u.intent === "reserve") s += 45;
  if (u.intent === "confirm") s += 60;
  if (u.usage.length || u.apps.length) s += 10;
  if (u.when) s += 15;
  return Math.min(100, s);
}

const isShownUnit = (u: unknown): u is ShownUnit =>
  typeof u === "object" &&
  u !== null &&
  typeof (u as ShownUnit).serial === "string";

const accessoryIn = (o: Record<string, unknown>): ShownAccessory | null => {
  const a = o["accessory"] as ShownAccessory | undefined;
  return a && typeof a.model === "string" ? a : null;
};

const unitsIn = (o: unknown, key = "units"): ShownUnit[] => {
  const list = (o as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? list.filter(isShownUnit) : [];
};

export async function runRules(input: RulesInput): Promise<RulesResult> {
  const started = Date.now();
  const { ctx, capabilities } = input;
  const caps = effectiveCapabilities(capabilities);
  const dispatch: ToolDispatch =
    input.dispatch ?? ((n, a, c) => dispatchTool(input.db, n, a, c));
  const open = storeOpenAt(ctx.now);
  const trace: AgentStep[] = [];
  const toolsUsed: string[] = [];
  const shown: string[] = [];
  const bookings: BookingWrite[] = [];
  let cost = 0;

  const u = understand(input.text, ctx.now, {
    proposalOpen: input.proposalOpen,
    lastShown: input.lastShown,
  });
  const lang: Lang = u.language;
  trace.push({
    agent: "ROUTER",
    model: "rules",
    tool: null,
    ok: u.intent !== "other",
    ms: Date.now() - started,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const t = Date.now();
    toolsUsed.push(name);
    const out = (await dispatch(name, args, {
      ...ctx,
      capabilities,
    })) as Record<string, unknown> | null;
    trace.push({
      agent: "OPERATIONS",
      model: "",
      tool: name,
      ok: !(out && "error" in out),
      ms: Date.now() - t,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    });
    return out ?? {};
  };

  const verdict = (escalate: string | null, ops: boolean): RouterVerdict => ({
    language: lang,
    tone: "casual",
    intent: INTENT_OF[u.intent],
    leadScore: leadScoreOf(u),
    needsOperations: ops,
    operationsBrief: u.query ?? "",
    escalate,
  });

  const done = (
    text: string,
    extra: Partial<ConverseResult> & {
      usedAi?: boolean;
      escalate?: string | null;
      /** False for a reply that already asks the one thing that matters now. */
      ask?: boolean;
    } = {},
  ): RulesResult => {
    const { usedAi = false, escalate = null, ask = true, ...rest } = extra;
    // Every reply that is not a hand-over ends asking what the customer
    // still has not told us (owner, 2026-10-15). An AI reply that already
    // asks something is left alone: two questions in a row reads as a form.
    let body = text;
    if (ask && !rest.handoff && !(usedAi && text.includes("?"))) {
      const q = followUp();
      if (q && !text.includes(q)) body = `${text}\n\n${q}`;
    }
    const message = sanitiseReply(body);
    trace.push({
      agent: "ADVISOR",
      model: usedAi ? "ai" : "template",
      tool: null,
      ok: true,
      ms: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    });
    return {
      reply: message,
      rawReply: text,
      toolsUsed,
      steps: 1,
      sources: rest.sources ?? (rest.handoff ? [] : ["rules"]),
      ...rest,
      ...(bookings.length ? { bookings } : {}),
      verdict: verdict(escalate, toolsUsed.length > 0),
      trace,
      costMicros: cost,
      latencyMs: Date.now() - started,
      shown,
      usedAi,
    };
  };

  const waiting = input.waiting ?? [];
  /** The customer has already been told a colleague will reply. */
  const told = waiting.length > 0 && saidColleagueWillReply(input.lastReply);

  /**
   * A person takes it: the shop's fixed line, the topic, a note for them.
   * When something is already with a colleague and the customer has just
   * been told so, a short "passed that on too" instead of the same promise.
   */
  const handOver = (topic: HandoffTopic, summary: string, line?: string) =>
    done(
      line ?? (told ? reply.passedOnToo(lang) : holdingMessage(topic, open)),
      {
        handoff: { topic, summary, forcedBy: "route" },
        escalate: topic,
        sources: [],
      },
    );

  /** "Kak?" while a question is with a colleague: say once they are on it. */
  const nudge = (): string | null =>
    waiting.length > 0 && !told
      ? reply.stillWaiting(
          waiting.map((w) => w.topic),
          lang,
        )
      : null;

  // --- 1. What the code already sends to a person --------------------------
  if (input.route)
    return handOver(
      input.route.topic,
      routedTask(input.route.topic, input.text),
    );

  // --- 2. Remember what they said about themselves -------------------------
  if (ctx.profile) {
    const facts: Record<string, unknown> = {};
    if (u.name) facts["name"] = u.name;
    if (u.budgetMin !== null) facts["budget_min"] = u.budgetMin;
    if (u.budgetMax !== null) facts["budget_max"] = u.budgetMax;
    if (u.usage.length) facts["usage"] = u.usage.join(", ");
    if (u.apps.length) facts["apps"] = u.apps.join(", ");
    if (u.preferences.length) facts["preferences"] = u.preferences.join(", ");
    if (u.occupation) {
      facts["occupation"] = u.occupation;
      // An estimate, and labelled one on the screen: a student is a student.
      if (u.occupation === "student (university)")
        facts["age_estimate"] = "18-24";
      if (u.occupation === "student (school)") facts["age_estimate"] = "15-18";
    }
    if (Object.keys(facts).length > 0) await call("remember_customer", facts);
  }

  const lacks = {
    usage: !input.known.usage && u.usage.length === 0,
    preferences: !input.known.preferences && u.preferences.length === 0,
    budget: !input.known.budget && u.budgetMin === null && u.budgetMax === null,
    apps: !input.known.apps && u.apps.length === 0,
  };
  const followUp = () =>
    reply.nextQuestion(lacks, lang, input.lastReply ?? null);
  const visitOffer = () =>
    caps.reserve && !input.proposalOpen && leadScoreOf(u) >= input.leadThreshold
      ? reply.offerVisit(lang)
      : null;
  const join = (...parts: Array<string | null>) =>
    parts.filter((p): p is string => Boolean(p)).join("\n\n");

  const pickSerial = (): string | null =>
    u.serial ??
    (u.pick !== null ? (input.lastShown[u.pick] ?? null) : null) ??
    (input.lastShown.length === 1 ? input.lastShown[0]! : null);

  /** A shelf search and its list — stock, browse, and a price by model. */
  const search = async (): Promise<RulesResult> => {
    const hasBudget = u.budgetMin !== null || u.budgetMax !== null;
    if (!u.query && !hasBudget) return done(reply.whichUnit(lang));
    const out = await call("search_stock", {
      query: u.query ?? "macbook",
      ...(u.budgetMin !== null && u.budgetMin !== u.budgetMax
        ? { minPrice: u.budgetMin }
        : {}),
      // "about 15jt" means up to a little over it.
      ...(u.budgetMax !== null
        ? {
            maxPrice:
              u.budgetMin === u.budgetMax
                ? Math.round(u.budgetMax * 1.1)
                : u.budgetMax,
          }
        : {}),
      sort: hasBudget ? "priciest" : "newest",
    });
    const units = unitsIn(out).slice(0, 3);
    // One option above the main pick, when the shelf has one (2026-10-27).
    const stepUp = isShownUnit(out["stepUp"]) ? out["stepUp"] : null;
    if (units.length === 0) {
      // Out of stock: the closest units that are in, never a dead end.
      const alternatives = unitsIn(out, "alternatives").slice(0, 3);
      if (alternatives.length === 0) return done(reply.noStock(lang));
      shown.push(...alternatives.map((x) => x.serial));
      if (stepUp) shown.push(stepUp.serial);
      const accessory = accessoryIn(out);
      return done(
        join(
          reply.alternatives(alternatives, lang),
          stepUp ? reply.stepUp(stepUp, lang) : null,
          accessory ? reply.accessory(accessory, lang) : null,
        ),
        { sources: ["stock"] },
      );
    }
    shown.push(...units.map((x) => x.serial));
    if (stepUp) shown.push(stepUp.serial);
    const matched =
      typeof out["matched"] === "number" ? out["matched"] : units.length;
    return done(
      // The follow-up question comes from done(); the visit is offered only
      // once there is nothing left to ask.
      join(
        reply.stockList(units, matched, lang),
        stepUp ? reply.stepUp(stepUp, lang) : null,
        followUp() ? null : visitOffer(),
      ),
      {
        sources: ["stock"],
      },
    );
  };

  // --- 3. The intents rules can answer -------------------------------------
  switch (u.intent) {
    case "greeting":
      // Mid-conversation with something waiting, "halo kak?" is a nudge,
      // not a new customer: no second welcome.
      if (waiting.length > 0) return done(nudge() ?? reply.ack(lang));
      return done(reply.greeting(lang));

    case "thanks":
      return done(reply.thanks(lang));

    case "ack": {
      const waitingLine = nudge();
      if (waitingLine) return done(waitingLine);
      return done(
        followUp()
          ? reply.ack(lang)
          : `${reply.ack(lang)} ${reply.offerSearch(lang)}`,
      );
    }

    case "tell":
      return done(
        followUp()
          ? reply.noted(lang)
          : `${reply.noted(lang)} ${reply.offerSearch(lang)}`,
      );

    case "confirm": {
      if (!caps.reserve || !ctx.reserve) break;
      const out = await call("confirm_reservation", {});
      if (out["ok"] === true && typeof out["code"] === "string") {
        bookings.push({
          tool: "create_reservation",
          code: out["code"],
          ...(typeof out["when"] === "string" ? { when: out["when"] } : {}),
        });
        return done(
          reply.booked(
            {
              code: out["code"],
              ...(typeof out["when"] === "string" ? { when: out["when"] } : {}),
            },
            lang,
          ),
        );
      }
      if (out["noProposal"] === true) break;
      return handOver(
        "reservation",
        taskNote("booking", TASK_REASON.confirmFailed, input.text),
        reply.bookingFailed(lang),
      );
    }

    case "decline":
      return done(reply.declined(lang));

    case "ask_photo": {
      if (!caps.photos) break;
      const serial = pickSerial();
      const out = serial
        ? await call("unit_photos", { serial })
        : u.query
          ? await call("find_unit_photos", { query: u.query })
          : null;
      if (!out) return done(reply.whichUnit(lang));
      const ids = Array.isArray(out["photoIds"])
        ? (out["photoIds"] as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      if (ids.length === 0)
        return handOver(
          "photos",
          taskNote(
            "photos",
            [serial ?? unitSubject(input.text), TASK_REASON.noPhotos]
              .filter(Boolean)
              .join(", "),
            input.text,
          ),
          reply.noPhotos(lang),
        );
      const unit: ShownUnit | null =
        typeof out["serial"] === "string"
          ? (out as unknown as ShownUnit)
          : null;
      if (unit) shown.push(unit.serial);
      return done(join(reply.photos(unit, lang), visitOffer()), {
        photos: ids,
      });
    }

    case "reserve": {
      if (!caps.reserve || !ctx.reserve) break;
      const serial = pickSerial();
      const name = u.name ?? input.known.name;
      const missing = { unit: !serial, name: !name, when: !u.when };
      if (missing.unit || missing.name || missing.when)
        return done(reply.askForVisit(missing, lang), { ask: false });
      const out = await call("propose_reservation", {
        serials: serial!,
        when: u.when!,
        custName: name!,
      });
      if (out["ok"] === true) {
        const units = unitsIn(out);
        shown.push(...units.map((x) => x.serial));
        return done(
          reply.proposal(
            {
              units,
              when: String(out["when"] ?? ""),
              custName: String(out["custName"] ?? name),
            },
            lang,
          ),
          // The read-back asks for a yes; another question would bury it.
          { ask: false },
        );
      }
      if (out["closedThen"] || out["pastDate"] || out["tooFarAhead"])
        return done(
          reply.askForVisit({ unit: false, name: false, when: true }, lang),
        );
      if (out["unavailable"]) return done(reply.noStock(lang));
      return handOver(
        "reservation",
        taskNote("booking", TASK_REASON.notAutomatic, input.text),
      );
    }

    case "ask_price": {
      if (!caps.stock) break;
      const serial = pickSerial();
      if (serial) {
        const out = await call("check_serial", { serial });
        if (out["found"] === true && out["available"] === true) {
          shown.push(serial);
          if (typeof out["price"] !== "string")
            return handOver(
              "price",
              taskNote(
                "price",
                `${unitLine(out as unknown as ShownUnit, "id") || serial} (${serial}), ${TASK_REASON.noPrice}`,
                input.text,
              ),
            );
          return done(
            join(reply.price(out as unknown as ShownUnit, lang), visitOffer()),
          );
        }
        return done(reply.noStock(lang));
      }
      if (!u.query) return done(reply.whichUnit(lang));
      return search();
    }

    case "ask_stock":
    case "browse":
      if (!caps.stock) break;
      return search();

    default:
      break;
  }

  // --- 4. The owner's own answer, word for word -----------------------------
  const [best] = matchesFor(input.knowledge, input.text);
  if (best && isStrongMatch(best))
    return done(best.doc.answer, { sources: [best.doc.handle] });

  // --- 5. What no rule covers: AI if configured, else a person --------------
  if (input.ai) {
    const { result, calls } = await input.ai();
    for (const c of calls) {
      cost += costMicros(c);
      trace.push({
        agent: "ADVISOR",
        model: c.model,
        tool: null,
        ok: result !== null,
        ms: c.ms,
        inputTokens: c.inputTokens + c.cachedTokens + c.cacheWriteTokens,
        cachedTokens: c.cachedTokens,
        outputTokens: c.outputTokens,
      });
    }
    if (result) {
      const { reply: text, ...rest } = result;
      return done(text, {
        ...rest,
        usedAi: true,
        escalate: result.handoff?.topic ?? null,
      });
    }
  }
  return handOver("other", taskNote("reply", TASK_REASON.noAnswer, input.text));
}
