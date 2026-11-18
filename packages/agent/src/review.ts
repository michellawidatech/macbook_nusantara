/**
 * The chatbot audit's reviewer (2026-11-18,
 * docs/superpowers/specs/2026-11-18-chatbot-audit-design.md): what it is
 * told, the shape it answers in, and how that answer is read. Pure — no
 * database, no clock, no network; apps/worker/src/reviewPass.ts feeds it.
 *
 * The reviewer reads one chat's answered window and flags what is wrong or
 * could be better, in seven categories. It is a second look: every price was
 * already checked by code before it was sent (`checkReply`).
 */

import { SHOP_ADDRESS, SHOP_PHONE } from "@nusantara/domain";
import { CONDUCT } from "./conduct.js";
import { STORE_HOURS } from "./hours.js";

/** The reviewer's model (owner, 2026-11-17). Never swapped for a weaker one. */
export const REVIEW_MODEL = "claude-sonnet-5-5";

/** Room for thinking plus a long list of flags. */
export const REVIEW_MAX_TOKENS = 8_000;

export const REVIEW_CATEGORIES = [
  "WRONG_FACT",
  "UNANSWERED",
  "HANDOVER",
  "RULE_BROKEN",
  "TONE",
  "MISSED_SALE",
  "OTHER",
] as const;
export type ReviewCategoryCode = (typeof REVIEW_CATEGORIES)[number];

export const REVIEW_SEVERITIES = ["BAD", "IMPROVE"] as const;
export type ReviewSeverityCode = (typeof REVIEW_SEVERITIES)[number];

/** What each category means, as the reviewer is told. */
export const CATEGORY_MEANING: Record<ReviewCategoryCode, string> = {
  WRONG_FACT:
    "A price, stock, battery or condition that disagrees with the unit's record below, or a claim with no source at all.",
  UNANSWERED:
    "A question in the customer's messages left unanswered, the wrong question answered, or the bot repeating itself.",
  HANDOVER:
    "Handed to staff when the bot could have answered, or the bot answered what belongs to a person (a bargain or negotiation, payment proof, a complaint).",
  RULE_BROKEN: "Broke one of the shop's rules listed below.",
  TONE: "Robotic, too long, too formal or too casual, pushy, or Indonesian a person at the shop would not write.",
  MISSED_SALE:
    "The customer showed interest (a budget, a use, a model) and the bot did not recommend, follow up or offer a visit; or the chat went quiet after a weak reply.",
  OTHER: "Anything else odd that the list above does not cover.",
};

export const QUOTE_MAX = 500;
export const SUGGESTION_MAX = 300;

/** One line of the chat as the reviewer reads it. */
export interface ReviewLine {
  /** The `WaMessage` row this line belongs to (a reply shares its row). */
  readonly messageId: string;
  readonly at: Date;
  readonly who: "customer" | "bot" | "staff";
  readonly text: string;
}

/** A unit a bot reply named, as its record reads now. */
export interface ReviewUnit {
  readonly serial: string;
  readonly label: string;
  readonly grade: string | null;
  /** Formatted, or null when it has no sell price of its own. */
  readonly price: string | null;
  readonly status: string;
  readonly battery?: string | null;
  readonly condition?: string | null;
}

export interface ReviewInput {
  readonly lines: readonly ReviewLine[];
  readonly units: readonly ReviewUnit[];
  /** The thread's running summary from before this window, if any. */
  readonly earlier?: string | null;
  /** A shop tester's chat, not a real customer. */
  readonly tester?: boolean;
}

export interface ReviewPrompt {
  readonly system: string;
  readonly user: string;
  /** The short handle each message got in the prompt → its real id. */
  readonly handles: ReadonlyMap<string, string>;
}

const jakarta = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " / ").trim();

/** The reviewer's standing instructions — the same for every chat. */
export function reviewSystem(): string {
  const rules = CONDUCT.filter((r) => r.where.includes("prompt")).map(
    (r) => `- ${r.text}`,
  );
  const pad = (h: number) => `${String(h).padStart(2, "0")}.00`;
  return [
    "You review the WhatsApp chatbot of Macbook Nusantara, a shop in Indonesia selling second-hand and new Apple laptops (MacBook) and iPads. You read one conversation between a customer and the shop's bot (and sometimes a staff member) and flag what the BOT did wrong or could do better. You are a careful, fair senior salesperson: flag real problems, not taste. A good conversation gets no flags.",
    "",
    "Judge the bot's lines only. Customer lines are context. Staff lines are context too — never flag a staff line.",
    "",
    "Categories:",
    ...REVIEW_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_MEANING[c]}`),
    "",
    "Severity: BAD when it would mislead, lose or annoy a customer, or break a rule; IMPROVE when it is acceptable but could clearly be better.",
    "",
    "The shop's rules for the bot:",
    ...rules,
    "",
    "Shop facts:",
    `- Opening hours: ${pad(STORE_HOURS.openHour)}–${pad(STORE_HOURS.closeHour)} WIB.`,
    `- Address: ${SHOP_ADDRESS}`,
    `- Phone: ${SHOP_PHONE}`,
    "",
    "Units: the records listed are as they are NOW. A price or status may have changed since the bot spoke; only flag WRONG_FACT when the reply cannot have been right (a unit that does not match what was named, a figure no record supports, a claim like a warranty term or battery hours with no source).",
    "",
    "Each flag: the category, the severity, the handle of the message it is about (like m3), the exact words from that bot line (quote), and ONE short suggestion in English of what the bot should have said or done instead. Flag each problem once. At most 8 flags per chat, the most important first. Answer in the JSON format given.",
  ].join("\n");
}

/** The chat itself, with short handles for its messages. */
export function buildReviewPrompt(input: ReviewInput): ReviewPrompt {
  const handles = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const l of input.lines) {
    if (byId.has(l.messageId)) continue;
    const h = `m${byId.size + 1}`;
    byId.set(l.messageId, h);
    handles.set(h, l.messageId);
  }
  const chat = input.lines.map(
    (l) =>
      `[${byId.get(l.messageId)} ${l.who} ${jakarta.format(l.at)}] ${oneLine(l.text)}`,
  );
  const units = input.units.map((u) =>
    [
      `- ${u.serial}: ${u.label}`,
      u.grade ? `grade ${u.grade}` : null,
      u.price ? `price ${u.price}` : "no sell price",
      u.battery ? `battery ${u.battery}` : null,
      u.condition ? `condition "${u.condition}"` : null,
      `status ${u.status}`,
    ]
      .filter(Boolean)
      .join(", "),
  );
  const user = [
    input.tester
      ? "This is a TESTER's chat (staff trying the bot); judge it the same way."
      : null,
    input.earlier
      ? `Earlier in this chat (summary): ${oneLine(input.earlier)}`
      : null,
    units.length
      ? `Units the bot named, as their records read now (may have changed since):\n${units.join("\n")}`
      : "The bot named no unit in this window.",
    `The conversation:\n${chat.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: reviewSystem(), user, handles };
}

/** The JSON shape the reviewer answers in (`output_config.format`). */
export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["flags"],
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "severity", "message", "quote", "suggestion"],
        properties: {
          category: { type: "string", enum: [...REVIEW_CATEGORIES] },
          severity: { type: "string", enum: [...REVIEW_SEVERITIES] },
          message: { type: "string" },
          quote: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
} as const;

export interface ReviewFlagDraft {
  readonly category: ReviewCategoryCode;
  readonly severity: ReviewSeverityCode;
  /** The real `WaMessage` id. */
  readonly messageId: string;
  readonly quote: string;
  readonly suggestion: string;
}

const clip = (s: unknown, n: number) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "";

/**
 * Read the reviewer's answer. A flag naming a handle outside this window, an
 * unknown category or severity, or no quote is dropped; null when the text is
 * not the JSON asked for at all.
 */
export function readReview(
  text: string,
  handles: ReadonlyMap<string, string>,
): ReviewFlagDraft[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const list = (parsed as { flags?: unknown } | null)?.flags;
  if (!Array.isArray(list)) return null;
  const out: ReviewFlagDraft[] = [];
  for (const f of list) {
    const r = (f ?? {}) as Record<string, unknown>;
    const category = r["category"];
    const severity = r["severity"];
    const handle = typeof r["message"] === "string" ? r["message"].trim() : "";
    const messageId = handles.get(handle);
    if (
      !messageId ||
      !(REVIEW_CATEGORIES as readonly unknown[]).includes(category) ||
      !(REVIEW_SEVERITIES as readonly unknown[]).includes(severity)
    )
      continue;
    const quote = clip(r["quote"], QUOTE_MAX);
    const suggestion = clip(r["suggestion"], SUGGESTION_MAX);
    if (!quote || !suggestion) continue;
    out.push({
      category: category as ReviewCategoryCode,
      severity: severity as ReviewSeverityCode,
      messageId,
      quote,
      suggestion,
    });
  }
  return out;
}
