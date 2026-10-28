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
 *
 * ## Selling, not holding (owner, 2026-10-27)
 *
 * *"The goal of this chatbot is to convert the casual chatter to a lead and
 * even customer."* So the bot asks briefly (usage, then budget, and stops once
 * it can recommend), recommends three — the best fit, a cheaper one and one
 * step up — with the shelf's own "tinggal 1 unit" when it is true, ends every
 * recommendation on one small yes-question (photos → a visit → "mau saya bantu
 * proses?"), books a VISIT rather than holding stock, offers to say when an
 * out-of-stock model is back, and hands a buyer to a person as a CLOSING task.
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
  asksBuyOnline,
  asksToBuy,
  dpKeepLine,
  effectiveCapabilities,
  holdingMessage,
  type AgentCapabilities,
  type DpTerms,
  type HandoffTopic,
  type Route,
} from "../policy.js";
import type { AgentStep, PipelineResult } from "../pipeline.js";
import { isStrongMatch } from "../retrieval.js";
import { sanitiseReply } from "../sanitise.js";
import { dispatchTool, storeOpenAt, type ToolContext } from "../tools.js";
import {
  askedAboutNeeds,
  reply,
  unitLine,
  type Lang,
  type Platform,
  type ShownAccessory,
  type ShownUnit,
} from "./replies.js";
import {
  TASK_REASON,
  closingTask,
  jakartaVisitLabel,
  routeSummary,
  saidColleagueWillReply,
  taskNote,
  unitSubject,
  welcomeTask,
  type WaitingTask,
} from "../tasks.js";
import {
  answersOwnQuestion,
  isQuestion,
  profileFactsOf,
  saysNo,
  saysYes,
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
    /** The budget itself, whole rupiah, when the profile has one. */
    readonly budgetMin?: number | null;
    readonly budgetMax?: number | null;
  };
  /**
   * What the bot's previous reply offered to watch for ("Mau saya kabari
   * kalau sudah ready kak?") — the customer's yes writes it (2026-10-27).
   */
  readonly watchOffer?: WatchOffer | null;
  /** This customer already has a visit booked: no "kapan mau datang?". */
  readonly visitBooked?: boolean;
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
   * The DP rule from the shop's settings (2026-10-27): what a customer who
   * asks to keep a unit is told. The owner's default when absent.
   */
  readonly dp?: DpTerms;
  /**
   * The AI fallback — only for what no rule covers. Absent (no credential,
   * or the owner wants none), that turn goes to a person.
   */
  readonly ai?: () => Promise<{
    readonly result: ConverseResult | null;
    readonly calls: readonly CallUsage[];
  }>;
}

/** What an out-of-stock reply offered to watch for. */
export interface WatchOffer {
  readonly query: string;
  readonly budget?: number;
}

/**
 * A job for a person that is NOT a hand-over — the bot answered, and a
 * colleague still has something to do ("Perlu sambut — …"). `topic` is the
 * task's own word, not a hand-over topic, so the bot is not told to stop
 * answering anything while it is open.
 */
export interface RulesTask {
  readonly topic: "visit" | "restock";
  readonly kind: "RESERVATION" | "STOCK";
  readonly summary: string;
}

export interface RulesResult extends PipelineResult {
  /** Serials this reply showed, for the next message's "yang kedua". */
  readonly shown: readonly string[];
  /** Whether the AI fallback answered this turn. */
  readonly usedAi: boolean;
  /** Set when this reply offered "Mau saya kabari kalau sudah ready?". */
  readonly watch?: WatchOffer;
  readonly task?: RulesTask;
}

/** A visit the worker reminded the customer of, and nothing answered since. */
export interface RemindedVisit {
  readonly code: string;
  readonly scheduledFor: Date;
  /** The unit or model it is about, or null for "unitnya". */
  readonly unit: string | null;
  /** The name the visit was booked under, when it is a name. */
  readonly custName?: string | null;
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
  if (u.buying) s += 60;
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

/** The marketplace a message names, for "bisa checkout di shopee?". */
function platformIn(text: string): Platform | null {
  if (/\bshopee\b/i.test(text)) return "shopee";
  if (/\b(tokped|tokopedia)\b/i.test(text)) return "tokopedia";
  if (/\b(ig|instagram)\b/i.test(text)) return "instagram";
  return null;
}

/**
 * Asking about a unit's condition — minus, dents, scratches, what is in the
 * box, servicing (2026-10-28). The marks QC wrote are said only then.
 */
function asksCondition(text: string): boolean {
  return /\b(minus(nya)?|kondisi(nya)?|lecet|dent|penyok|mulus\s*(gak|ga|nggak|ngga|kah)?\s*\?|kelengkapan(nya)?|lengkap\s*(gak|ga|nggak|kah)|fullset|pernah\s*(servis|service|bongkar|dibongkar)|(udah|sudah)\s*(pernah\s*)?(servis|service))\b/i.test(
    text,
  );
}

const unitsIn = (o: unknown, key = "units"): ShownUnit[] => {
  const list = (o as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? list.filter(isShownUnit) : [];
};

/** The pieces every rules turn shares: the trace, the POS calls, the result. */
function turnKit(opts: {
  readonly db: PrismaClient;
  readonly ctx: ToolContext;
  readonly capabilities: AgentCapabilities;
  readonly dispatch?: ToolDispatch | undefined;
  readonly u: Understanding;
  readonly started: number;
}) {
  const { ctx, capabilities, u } = opts;
  const dispatch: ToolDispatch =
    opts.dispatch ?? ((n, a, c) => dispatchTool(opts.db, n, a, c));
  const trace: AgentStep[] = [];
  const toolsUsed: string[] = [];
  const shown: string[] = [];
  const bookings: BookingWrite[] = [];
  trace.push({
    agent: "ROUTER",
    model: "rules",
    tool: null,
    ok: u.intent !== "other",
    ms: Date.now() - opts.started,
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
  return { trace, toolsUsed, shown, bookings, call };
}

/**
 * The customer's first answer after the worker reminded them of a visit
 * (2026-10-27) — read by code, for the rules bot and the AI agent alike:
 *
 *  - a new time → the visit moves (`reschedule_reservation`);
 *  - a no → the visit closes (`cancel_reservation`, which holds nothing to
 *    release) and they are asked, gently, whether another day suits;
 *  - a yes → the visit stands, and a colleague gets "Perlu sambut — …".
 *
 * Anything else is not about the reminder: null, and the turn is answered as
 * usual.
 */
export async function visitReplyTurn(input: {
  readonly db: PrismaClient;
  readonly ctx: ToolContext;
  readonly text: string;
  readonly capabilities: AgentCapabilities;
  readonly dispatch?: ToolDispatch;
  readonly reminded: RemindedVisit;
  readonly name: string | null;
}): Promise<RulesResult | null> {
  const started = Date.now();
  const u = understand(input.text, input.ctx.now, {
    proposalOpen: false,
    lastShown: [],
  });
  const lang: Lang = u.language;
  const no = saysNo(input.text);
  const yes = !no && saysYes(input.text);
  if (!u.when && !no && !yes) return null;
  const kit = turnKit({
    db: input.db,
    ctx: input.ctx,
    capabilities: input.capabilities,
    dispatch: input.dispatch,
    u,
    started,
  });
  const result = (
    text: string,
    extra: { task?: RulesTask; bookings?: BookingWrite[] } = {},
  ): RulesResult => {
    const message = sanitiseReply(text);
    kit.trace.push({
      agent: "ADVISOR",
      model: "template",
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
      toolsUsed: kit.toolsUsed,
      steps: 1,
      sources: ["rules"],
      ...(extra.bookings?.length ? { bookings: extra.bookings } : {}),
      ...(extra.task ? { task: extra.task } : {}),
      verdict: {
        language: lang,
        tone: "casual",
        intent: yes ? "confirm" : no ? "decline" : "reserve",
        leadScore: leadScoreOf(u),
        needsOperations: kit.toolsUsed.length > 0,
        operationsBrief: "",
        escalate: null,
      },
      trace: kit.trace,
      costMicros: 0,
      latencyMs: Date.now() - started,
      shown: [],
      usedAi: false,
    };
  };
  const code = input.reminded.code;

  if (u.when) {
    const out = await kit.call("reschedule_reservation", {
      when: u.when,
      code,
    });
    if (out["ok"] === true && typeof out["when"] === "string") {
      const at = new Date(`${String(out["when"]).replace(" ", "T")}:00+07:00`);
      return result(reply.visitMoved(jakartaVisitLabel(at), lang), {
        bookings: [
          { tool: "reschedule_reservation", code, when: String(out["when"]) },
        ],
      });
    }
    if (out["closedThen"] || out["pastDate"] || out["tooFarAhead"])
      return result(
        reply.askForVisit({ unit: false, name: false, when: true }, lang),
      );
    return null;
  }
  if (no) {
    const out = await kit.call("cancel_reservation", { code });
    return result(reply.visitCancelled(lang), {
      ...(out["ok"] === true
        ? { bookings: [{ tool: "cancel_reservation", code }] }
        : {}),
    });
  }
  const when = jakartaVisitLabel(input.reminded.scheduledFor);
  return result(reply.visitKept(when, lang), {
    task: {
      topic: "visit",
      kind: "RESERVATION",
      summary: welcomeTask({
        name: input.name ?? input.reminded.custName ?? null,
        when,
        unit: input.reminded.unit,
      }),
    },
  });
}

export async function runRules(input: RulesInput): Promise<RulesResult> {
  const started = Date.now();
  const { ctx, capabilities } = input;
  const caps = effectiveCapabilities(capabilities);
  const open = storeOpenAt(ctx.now);
  let cost = 0;

  const u = understand(input.text, ctx.now, {
    proposalOpen: input.proposalOpen,
    lastShown: input.lastShown,
  });
  const lang: Lang = u.language;
  const { trace, toolsUsed, shown, bookings, call } = turnKit({
    db: input.db,
    ctx,
    capabilities,
    dispatch: input.dispatch,
    u,
    started,
  });

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
      watch?: WatchOffer;
    } = {},
  ): RulesResult => {
    const {
      usedAi = false,
      escalate = null,
      ask = true,
      watch,
      ...rest
    } = extra;
    // A reply that is not a hand-over ends asking what the customer still
    // has not told us — briefly, and only until there is enough to recommend
    // (owner, 2026-10-15, narrowed 2026-10-27). An AI reply that already
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
      ...(watch ? { watch } : {}),
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
  const handOver = (
    topic: HandoffTopic,
    summary: string,
    line?: string,
    serial?: string | null,
  ) =>
    done(
      line ?? (told ? reply.passedOnToo(lang) : holdingMessage(topic, open)),
      {
        handoff: {
          topic,
          summary,
          forcedBy: "route",
          ...(serial ? { serial } : {}),
        },
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

  const pickSerial = (): string | null =>
    u.serial ??
    (u.pick !== null ? (input.lastShown[u.pick] ?? null) : null) ??
    (input.lastShown.length === 1 ? input.lastShown[0]! : null);

  /**
   * File a reservation REQUEST (2026-10-27) — a person approves it in the
   * POS, so the customer hears "noted, the team will confirm", never a
   * booking code and never "held". A keep also hears the DP rule.
   */
  const fileRequest = async (r: {
    readonly serial: string | null;
    readonly name: string;
    readonly when: string;
    readonly keep: boolean;
  }): Promise<RulesResult> => {
    const out = await call("propose_reservation", {
      ...(r.serial ? { serials: r.serial } : {}),
      when: r.when,
      custName: r.name,
      keep: r.keep,
    });
    if (out["requested"] === true) {
      const units = unitsIn(out);
      shown.push(...units.map((x) => x.serial));
      bookings.push({
        tool: "propose_reservation",
        code: String(out["requestId"] ?? ""),
        ...(typeof out["when"] === "string" ? { when: out["when"] } : {}),
      });
      const noted = reply.requestNoted(
        {
          units,
          when: String(out["when"] ?? ""),
          custName: String(out["custName"] ?? r.name),
        },
        lang,
      );
      return done(
        r.keep && units.length > 0
          ? `${noted}\n\n${dpKeepLine(input.dp)}\n${reply.dpAsk(lang)}`
          : noted,
        // The line asks the one thing that matters now: nothing more.
        { ask: false },
      );
    }
    if (out["closedThen"] || out["pastDate"] || out["tooFarAhead"])
      return done(
        reply.askForVisit({ unit: false, name: false, when: true }, lang),
        { ask: false },
      );
    if (out["needName"])
      return done(
        reply.askForVisit({ unit: false, name: true, when: false }, lang),
        { ask: false },
      );
    if (out["unavailable"] && r.serial)
      // The unit they named has gone; the visit can still be to look.
      return fileRequest({ ...r, serial: null, keep: false });
    return handOver(
      "reservation",
      taskNote("booking", TASK_REASON.notAutomatic, input.text),
    );
  };
  /** The bot's last line was the DP rule: a time now completes a keep. */
  const keepAsked =
    (input.lastReply ?? "").includes("amankan unitnya") ||
    (input.lastReply ?? "").includes(
      reply.keepWhen({ name: false, unit: false }, lang),
    ) ||
    (input.lastReply ?? "").includes("rencananya mau ke toko kapan");

  // --- 1. What the code already sends to a person --------------------------
  if (input.route) {
    if (input.route.rule === "keep" && caps.reserve && ctx.reserve) {
      // "Keep it for me" is a reservation REQUEST now (2026-10-27), not a
      // closing hand-over: the bot files it, a person approves it.
      const serial = pickSerial() ?? input.lastShown[0] ?? null;
      const name = u.name ?? input.known.name;
      if (!serial || !name || !u.when) {
        // Carried as "shown", so "besok jam 2" next files it for this unit.
        if (serial) shown.push(serial);
        // The time first (owner, 2026-10-28: keep → when → DP → verify);
        // the DP rule comes once the request is filed.
        return done(
          u.when
            ? reply.askForKeep(
                { unit: !serial, name: !name, when: false },
                lang,
              )
            : reply.keepWhen({ unit: !serial, name: !name }, lang),
          { ask: false },
        );
      }
      return fileRequest({ serial, name, when: u.when, keep: true });
    }
    if (input.route.topic === "closing") {
      // Ready to buy, a keep / DP, how to pay (2026-10-27): a person closes,
      // and the task says who, what, which unit and at what price.
      const serial = pickSerial() ?? input.lastShown[0] ?? null;
      let unit = unitSubject(input.text);
      let price: string | null = null;
      if (serial && caps.stock) {
        const out = await call("check_serial", { serial });
        if (out["found"] === true) {
          const name = [out["model"], out["variant"]]
            .filter((x) => typeof x === "string" && x)
            .join(" ");
          if (name) unit = name;
          if (typeof out["price"] === "string") price = out["price"];
        }
      }
      const how = [
        /\bcod\b/i.test(input.text) ? "mau COD" : null,
        u.when
          ? `datang ${jakartaVisitLabel(new Date(`${u.when}:00+07:00`))}`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      return handOver(
        "closing",
        closingTask({
          name: u.name ?? input.known.name,
          wants: input.route.rule === "keep" ? "keep" : "buy",
          unit,
          price,
          how: how || null,
          text: input.text,
        }),
        told
          ? reply.passedOnToo(lang)
          : holdingMessage("closing", open, input.route.rule, input.dp),
        serial,
      );
    }
    const summary = routeSummary(
      input.route,
      input.text,
      input.known.name ?? u.name,
    );
    return handOver(
      input.route.topic,
      // A DP proof beside a waiting request is that request's DP: say so, so
      // the colleague approves the request with the DP (2026-10-27).
      input.route.rule === "dp_proof" && input.proposalOpen
        ? `${summary} · ${TASK_REASON.requestWaiting}`
        : summary,
      told
        ? reply.passedOnToo(lang)
        : holdingMessage(input.route.topic, open, input.route.rule, input.dp),
    );
  }

  // --- 2. Remember what they said about themselves -------------------------
  if (ctx.profile) {
    const facts = profileFactsOf(u, input.text, input.lastReply ?? null);
    if (Object.keys(facts).length > 0) await call("remember_customer", facts);
  }
  /**
   * Their answer to the bot's own question, in words no table here knows
   * ("buat bisnis online" after "Rencananya buat apa kak?"): a `tell`, never
   * a hand-over (owner report 2026-10-27).
   */
  const selfAnswer =
    u.intent === "other" &&
    answersOwnQuestion(input.text, ctx.now, input.lastReply ?? null);

  /**
   * Have they said what they are after (owner, 2026-10-28)? A model, a
   * budget, a question about stock or price, wanting to buy, or something
   * about themselves. Until then a "hi", "ok" or "hmmm" is offered help,
   * never asked what the laptop is for — that read as demanding.
   */
  const interested =
    u.query !== null ||
    u.budgetMin !== null ||
    u.budgetMax !== null ||
    (
      [
        "ask_stock",
        "browse",
        "ask_price",
        "ask_photo",
        "reserve",
        "tell",
      ] as const
    ).some((i) => i === u.intent) ||
    selfAnswer ||
    asksToBuy(input.text) ||
    input.known.usage ||
    input.known.budget ||
    input.lastShown.length > 0 ||
    askedAboutNeeds(input.lastReply);

  const lacks = {
    usage: !input.known.usage && u.usage.length === 0,
    preferences: !input.known.preferences && u.preferences.length === 0,
    budget: !input.known.budget && u.budgetMin === null && u.budgetMax === null,
    apps: !input.known.apps && u.apps.length === 0,
  };
  /**
   * Enough to recommend (owner, 2026-10-27): what it is for OR what they
   * want to spend, and something they are interested in. Past this the bot
   * stops asking and recommends.
   */
  const enough =
    (!lacks.usage || !lacks.budget) &&
    (u.query !== null || input.lastShown.length > 0);
  // Needs are asked BEFORE the first recommendation and never tacked onto
  // one after it (owner, 2026-10-28: "too forcing").
  const followUp = () =>
    enough || input.lastShown.length > 0 || !interested
      ? null
      : reply.nextQuestion(lacks, lang, input.lastReply ?? null);

  /**
   * The photos of the unit a reply leads with, when the shop has some and
   * the switch allows (owner, 2026-10-28: send them, never ask "mau lihat
   * fotonya?"). Empty when there are none.
   */
  const photosOf = async (u: ShownUnit | null): Promise<string[]> => {
    if (!u || !caps.photos || (u.photos ?? 0) === 0) return [];
    const out = await call("unit_photos", { serial: u.serial });
    return Array.isArray(out["photoIds"])
      ? (out["photoIds"] as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
  };
  const join = (...parts: Array<string | null>) =>
    parts.filter((p): p is string => Boolean(p)).join("\n\n");

  /**
   * A shelf search, answered as three: the best fit, a cheaper one and one
   * step up (2026-10-27). Out of stock, the closest units that are in, and
   * an offer to say when it is back.
   */
  const search = async (
    over: {
      readonly query?: string | null;
      readonly min?: number | null;
      readonly max?: number | null;
    } = {},
  ): Promise<RulesResult> => {
    const query = over.query ?? u.query;
    const min = over.min !== undefined ? over.min : u.budgetMin;
    const max = over.max !== undefined ? over.max : u.budgetMax;
    const hasBudget = min !== null || max !== null;
    if (!query && !hasBudget) return done(reply.whichUnit(lang));
    const out = await call("search_stock", {
      query: query ?? "macbook",
      ...(min !== null && min !== max ? { minPrice: min } : {}),
      // "about 15jt" means up to a little over it.
      ...(max !== null
        ? { maxPrice: min === max ? Math.round(max * 1.1) : max }
        : {}),
      sort: hasBudget ? "priciest" : "newest",
    });
    const units = unitsIn(out);
    // One option above the main pick, when the shelf has one (2026-10-27).
    const stepUp = isShownUnit(out["stepUp"]) ? out["stepUp"] : null;
    if (units.length === 0) {
      // Out of stock: the closest units that are in, never a dead end — and
      // the offer to tell them when what they asked for arrives.
      // One first and one more at most (2026-10-27): a list reads like a
      // catalogue, and the template names only these two.
      const alternatives = unitsIn(out, "alternatives").slice(0, 2);
      const watch: WatchOffer | undefined =
        query && ctx.profile !== undefined
          ? {
              query,
              ...(max !== null ? { budget: max } : {}),
            }
          : undefined;
      const watchLine = watch ? reply.offerWatch(lang) : null;
      if (alternatives.length === 0)
        return done(
          watchLine
            ? join(reply.outOfStock(lang), watchLine)
            : reply.noStock(lang),
          { ask: !watch, ...(watch ? { watch } : {}) },
        );
      shown.push(...alternatives.map((x) => x.serial));
      if (stepUp) shown.push(stepUp.serial);
      const accessory = accessoryIn(out);
      return done(
        join(
          reply.alternatives(alternatives, lang),
          stepUp ? reply.stepUp(stepUp, lang) : null,
          accessory ? reply.accessory(accessory, lang) : null,
          watchLine ?? reply.afterOffer(lang),
        ),
        { sources: ["stock"], ask: false, ...(watch ? { watch } : {}) },
      );
    }
    // units[0] is the cheapest unit of the lowest grade of the variant that
    // fits, and otherGrades the rest of that variant (owner, 2026-10-28).
    const best = units[0]!;
    const otherGrades = unitsIn(out, "otherGrades");
    shown.push(best.serial);
    shown.push(...otherGrades.map((x) => x.serial));
    if (stepUp) shown.push(stepUp.serial);
    const photos = await photosOf(best);
    return done(
      join(
        reply.recommend({ best, otherGrades, stepUp }, lang),
        reply.afterOffer(lang),
      ),
      {
        sources: ["stock"],
        ask: false,
        ...(photos.length > 0 ? { photos } : {}),
      },
    );
  };

  // --- 2b. Their answer to "Mau saya kabari kalau sudah ready?" -------------
  if (input.watchOffer && caps.stock && u.intent !== "ask_stock") {
    if (saysNo(input.text)) return done(reply.declined(lang), { ask: false });
    if (
      saysYes(input.text) &&
      (u.intent === "ack" || u.intent === "confirm" || u.intent === "other")
    ) {
      const out = await call("watch_stock", {
        query: input.watchOffer.query,
        ...(input.watchOffer.budget ? { budget: input.watchOffer.budget } : {}),
      });
      if (out["saved"] === true) return done(reply.watchSaved(lang));
    }
  }

  // --- 3. The intents rules can answer -------------------------------------
  // --- 2c. How to buy / buy online, and the condition asked about ------------
  // (owner, 2026-10-28) The variant's listing, and what QC wrote.
  if (caps.stock && (asksBuyOnline(input.text) || asksCondition(input.text))) {
    const serial = pickSerial() ?? input.lastShown[0] ?? null;
    let unit: ShownUnit | null = null;
    if (serial) {
      const out = await call("check_serial", { serial });
      if (out["found"] === true) unit = out as unknown as ShownUnit;
    } else if (u.query) {
      unit = unitsIn(await call("search_stock", { query: u.query }))[0] ?? null;
    }
    if (unit) shown.push(unit.serial);
    if (asksBuyOnline(input.text))
      return done(reply.buyOnline(unit?.links, platformIn(input.text), lang), {
        ask: false,
        ...(unit ? { sources: ["stock"] } : {}),
      });
    if (unit)
      return done(reply.conditionDetail(unit, lang), {
        ask: false,
        sources: ["stock"],
      });
  }

  switch (u.intent) {
    case "greeting":
      // Mid-conversation with something waiting, "halo kak?" is a nudge,
      // not a new customer: no second welcome.
      if (waiting.length > 0) return done(nudge() ?? reply.ack(lang));
      // A welcome and an offer to help — nothing asked about their needs
      // yet (owner, 2026-10-28). Never a second welcome in one chat.
      return done(
        input.lastReply
          ? reply.helloAgain(lang, input.lastReply)
          : `${reply.greeting(lang)} ${reply.offerHelp(lang)}`,
        { ask: false },
      );

    case "thanks":
      return done(reply.thanks(lang));

    case "ack": {
      const waitingLine = nudge();
      if (waitingLine) return done(waitingLine);
      // A yes to "Mau saya carikan unit yang paling cocok?": do it, from
      // what the profile already says.
      if (
        caps.stock &&
        (input.lastReply ?? "").includes(reply.offerSearch(lang)) &&
        (input.known.budgetMax || input.known.budgetMin)
      )
        return search({
          query: null,
          min: input.known.budgetMin ?? null,
          max: input.known.budgetMax ?? null,
        });
      if (!interested)
        return done(`${reply.ack(lang)} ${reply.offerHelp(lang)}`, {
          ask: false,
        });
      return done(
        followUp()
          ? reply.ack(lang)
          : `${reply.ack(lang)} ${reply.offerSearch(lang)}`,
      );
    }

    case "tell":
    case "other":
      if (u.intent === "other" && !selfAnswer) break;
      return done(
        followUp()
          ? reply.noted(lang)
          : `${reply.noted(lang)} ${reply.offerSearch(lang)}`,
      );

    case "confirm": {
      // A yes while a request waits (2026-10-27): a person confirms it, never
      // the bot — `confirm_reservation` is not called any more.
      if (!caps.reserve || !ctx.reserve || !input.proposalOpen) break;
      return done(reply.requestPending(lang), { ask: false });
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
          : input.lastShown[0]
            ? await call("unit_photos", { serial: input.lastShown[0] })
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
      return done(join(reply.photos(unit, lang), reply.afterOffer(lang)), {
        photos: ids,
        ask: false,
      });
    }

    case "reserve": {
      if (!caps.reserve || !ctx.reserve) break;
      // A REQUEST (2026-10-27): the units are what they want to see — or,
      // right after the DP rule was given, to keep — and a person approves.
      const serial = pickSerial() ?? input.lastShown[0] ?? null;
      const name = u.name ?? input.known.name;
      const missing = { unit: false, name: !name, when: !u.when };
      if (missing.name || missing.when)
        return done(reply.askForVisit(missing, lang), { ask: false });
      return fileRequest({
        serial,
        name: name!,
        when: u.when!,
        keep: keepAsked && serial !== null,
      });
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
            join(
              reply.price(out as unknown as ShownUnit, lang),
              reply.afterOffer(lang),
            ),
            { ask: false },
          );
        }
        return done(reply.noStock(lang));
      }
      if (!u.query) {
        // No model named (owner's chat, 2026-10-28: "rata rata harga brpan
        // si kak"): the shelf's own range, cheapest and dearest, then the
        // one question that narrows it.
        const out = await call("search_stock", {
          query: "macbook",
          sort: "cheapest",
        });
        const priced = [...unitsIn(out), ...unitsIn(out, "otherGrades")].filter(
          (x) => typeof x.price === "string" && x.price !== "",
        );
        const value = (x: ShownUnit) =>
          Number(String(x.price).replace(/\D/g, ""));
        if (priced.length === 0) return done(reply.whichUnit(lang));
        const cheapest = priced.reduce((a, b) => (value(b) < value(a) ? b : a));
        const dearest = unitsIn(
          await call("search_stock", { query: "macbook", sort: "priciest" }),
        )
          .filter((x) => typeof x.price === "string" && x.price !== "")
          .reduce<ShownUnit>((a, b) => (value(b) > value(a) ? b : a), cheapest);
        return done(reply.priceRange(cheapest, dearest, lang), {
          sources: ["stock"],
        });
      }
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
  // Objections — warranty, condition, COD, payment, trade-in — are answered
  // from here and nowhere else (2026-10-27).
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
  // No rule, no approved answer, no AI (2026-10-27, owner: *"it escalates
  // too much"*): a statement or small talk ("wkwk", "oh gitu", "lagi liat2
  // aja") keeps the conversation going with the next discovery question. Only
  // a QUESTION nothing here can answer goes to a person.
  if (!isQuestion(input.text))
    return done(
      nudge() ??
        (followUp()
          ? reply.ack(lang)
          : `${reply.ack(lang)} ${reply.offerSearch(lang)}`),
    );
  return handOver("other", taskNote("reply", TASK_REASON.noAnswer, input.text));
}
