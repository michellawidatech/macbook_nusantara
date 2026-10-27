/**
 * What chatbot v2 reads about a thread before a turn, and the two settings
 * that steer it — shared by the worker and the API's simulator so they
 * cannot disagree.
 */

import type { PrismaClient } from "@nusantara/db";
import { formatRupiah } from "@nusantara/domain";
import type { AgentRole } from "./agents.js";
import { jakartaDate, jakartaTime } from "./tools.js";

/**
 * Which bot answers. `rules` — rules and templates first, AI only for what
 * they cannot answer (owner, 2026-10-15) — `v1`, the single AI agent, and
 * `v2`, the three AI agents.
 *
 * ## One agent, and nobody chooses (owner, 2026-10-21)
 *
 * *"Keep it a single agent on the chatbot and the user cannot choose /
 * determine the lead."* The pipeline is no longer a setting: the single agent
 * answers whenever there is a credential, and the rules answer without one —
 * so a missing key degrades the bot instead of switching it off. The lead
 * threshold is fixed for the same reason: a lead is what the bot's score
 * says, not a number somebody tunes. `chatbot.pipeline` and
 * `chatbot.leadThreshold` rows left by an earlier build are ignored. `v2`
 * (pipeline.ts) is dormant and still tested.
 */
export const PIPELINE_SETTING_KEY = "chatbot.pipeline";
/** From this score the bot offers a visit and the thread is a 🔥 lead. */
export const LEAD_THRESHOLD_SETTING_KEY = "chatbot.leadThreshold";
export const DEFAULT_LEAD_THRESHOLD = 60;

export type PipelineName = "rules" | "v1" | "v2";
export const PIPELINES: readonly PipelineName[] = ["rules", "v1", "v2"];

export interface ChatbotSettings {
  readonly pipeline: PipelineName;
  readonly leadThreshold: number;
}

/** What answers: the single agent with a credential, the rules without. */
export function chatbotSettings(hasCredential: boolean): ChatbotSettings {
  return {
    pipeline: hasCredential ? "v1" : "rules",
    leadThreshold: DEFAULT_LEAD_THRESHOLD,
  };
}

/**
 * Is the thread a 🔥 lead? The bot marked it (`leadAt`) after the last clear —
 * a sale (migration 20261014120000).
 *
 * The bot's mark alone since 2026-10-21 (owner: "the user cannot choose /
 * determine the lead"). `leadStaffAt` is what a staff switch used to write; a
 * mark left by it no longer makes a lead, and nothing writes it now.
 */
export function isLead(
  m: {
    readonly leadAt: Date | null;
    readonly leadStaffAt: Date | null;
    readonly leadClearedAt: Date | null;
  } | null,
): boolean {
  if (!m) return false;
  const set = m.leadAt?.getTime() ?? 0;
  return set > 0 && set > (m.leadClearedAt?.getTime() ?? 0);
}

/** The persona rows that belong to an agent. */
export async function loadAgentPersonas(
  db: PrismaClient,
): Promise<Array<{ agent: AgentRole | null; prompt: string }>> {
  return db.persona.findMany({
    where: { agent: { not: null } },
    select: { agent: true, prompt: true },
  });
}

/**
 * What the shop knows about this customer, as one line for the agents — so
 * the bot never asks twice what the profile already says.
 */
export async function profileLine(
  db: PrismaClient,
  from: string,
): Promise<string | null> {
  const p = await db.customerProfile.findUnique({
    where: { from },
    select: {
      name: true,
      useCase: true,
      currentDevice: true,
      preference: true,
      ageEstimate: true,
      occupation: true,
      budgetMin: true,
      budgetMax: true,
      facts: {
        where: { removedAt: null },
        select: { kind: true, value: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!p) return null;
  const budget =
    p.budgetMin !== null && p.budgetMax !== null && p.budgetMin !== p.budgetMax
      ? `${formatRupiah(p.budgetMin)}–${formatRupiah(p.budgetMax)}`
      : p.budgetMax !== null
        ? formatRupiah(p.budgetMax)
        : p.budgetMin !== null
          ? `from ${formatRupiah(p.budgetMin)}`
          : null;
  const of = (k: string) =>
    p.facts.filter((f) => f.kind === k).map((f) => f.value);
  const parts = [
    p.name ? `name ${p.name}` : "",
    p.occupation ? `occupation (estimate) ${p.occupation}` : "",
    p.ageEstimate ? `age (estimate) ${p.ageEstimate}` : "",
    budget ? `budget ${budget}` : "",
    of("USAGE").length ? `uses it for ${of("USAGE").join(", ")}` : "",
    p.useCase ? `use ${p.useCase}` : "",
    of("APP").length ? `apps ${of("APP").join(", ")}` : "",
    of("PREFERENCE").length ? `prefers ${of("PREFERENCE").join(", ")}` : "",
    p.preference ? `preference ${p.preference}` : "",
    p.currentDevice ? `has now ${p.currentDevice}` : "",
    ...of("ABOUT"),
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

/** The customer's open proposal, described, or null. */
export async function openProposalLine(
  db: PrismaClient,
  from: string,
  now: Date,
): Promise<string | null> {
  const p = await db.reservationProposal.findFirst({
    where: {
      from,
      confirmedAt: null,
      cancelledAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      custName: true,
      scheduledFor: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          unit: {
            select: {
              serial: true,
              grade: true,
              sku: {
                select: { name: true, variantLabel: true },
              },
            },
          },
        },
      },
    },
  });
  if (!p) return null;
  const units = p.items
    .map(
      (i) =>
        `${i.unit.sku.name}${i.unit.sku.variantLabel ? ` ${i.unit.sku.variantLabel}` : ""}` +
        `${i.unit.grade ? ` grade ${i.unit.grade}` : ""} (${i.unit.serial})`,
    )
    .join(", ");
  return `${units} on ${jakartaDate(p.scheduledFor)} ${jakartaTime(p.scheduledFor)} for ${p.custName}`;
}

/** What the profile already says, so the rules bot does not ask twice. */
export async function profileKnown(
  db: PrismaClient,
  from: string,
): Promise<{
  name: string | null;
  usage: boolean;
  preferences: boolean;
  budget: boolean;
  apps: boolean;
  budgetMin: number | null;
  budgetMax: number | null;
}> {
  const p = await db.customerProfile.findUnique({
    where: { from },
    select: {
      name: true,
      useCase: true,
      preference: true,
      budget: true,
      budgetMin: true,
      budgetMax: true,
      facts: { where: { removedAt: null }, select: { kind: true } },
    },
  });
  if (!p)
    return {
      name: null,
      usage: false,
      preferences: false,
      budget: false,
      apps: false,
      budgetMin: null,
      budgetMax: null,
    };
  const money = (v: bigint | null) =>
    v !== null && v > 0n && v < BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v)
      : null;
  return {
    name: p.name?.trim() || null,
    usage: Boolean(p.useCase) || p.facts.some((f) => f.kind === "USAGE"),
    preferences:
      Boolean(p.preference) || p.facts.some((f) => f.kind === "PREFERENCE"),
    budget: p.budget !== null || p.budgetMin !== null || p.budgetMax !== null,
    apps: p.facts.some((f) => f.kind === "APP"),
    budgetMin: money(p.budgetMin),
    budgetMax: money(p.budgetMax ?? p.budget),
  };
}

/**
 * What the bot's last reply offered to watch for — "Mau saya kabari kalau
 * sudah ready kak?" (`entities.watch` on the answered row, 2026-10-27) — so
 * the customer's yes can write it. Null when the last reply offered nothing.
 */
export async function lastWatchOffer(
  db: PrismaClient,
  from: string,
  after: Date | null,
): Promise<{ query: string; budget?: number } | null> {
  const row = await db.waMessage.findFirst({
    where: {
      from,
      direction: "IN",
      replyText: { not: null },
      ...(after ? { answeredAt: { gt: after } } : {}),
    },
    orderBy: [{ answeredAt: "desc" }, { ts: "desc" }],
    select: { entities: true, answeredByAgent: true },
  });
  if (!row?.answeredByAgent) return null;
  const w = (row.entities as { watch?: unknown } | null)?.watch as
    { query?: unknown; budget?: unknown } | undefined;
  if (!w || typeof w.query !== "string" || !w.query.trim()) return null;
  return {
    query: w.query.slice(0, 120),
    ...(typeof w.budget === "number" && w.budget > 0
      ? { budget: w.budget }
      : {}),
  };
}

/**
 * The serials the bot's last reply showed (`entities.units` on the answered
 * row), so "yang kedua" and "minta fotonya" know which unit is meant. Read
 * after a tester's `/new` only.
 */
export async function lastShownUnits(
  db: PrismaClient,
  from: string,
  after: Date | null,
): Promise<string[]> {
  const row = await db.waMessage.findFirst({
    where: {
      from,
      direction: "IN",
      replyText: { not: null },
      answeredByAgent: true,
      ...(after ? { answeredAt: { gt: after } } : {}),
    },
    orderBy: [{ answeredAt: "desc" }, { ts: "desc" }],
    select: { entities: true },
  });
  const units = (row?.entities as { units?: unknown } | null)?.units;
  return Array.isArray(units)
    ? units.filter((u): u is string => typeof u === "string").slice(0, 12)
    : [];
}
