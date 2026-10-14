/**
 * What chatbot v2 reads about a thread before a turn, and the two settings
 * that steer it — shared by the worker and the API's simulator so they
 * cannot disagree.
 */

import type { PrismaClient } from "@nusantara/db";
import { formatRupiah } from "@nusantara/domain";
import type { AgentRole } from "./agents.js";
import { jakartaDate, jakartaTime } from "./tools.js";

/** `v1` the single agent (the default until the owner switches), `v2` the three. */
export const PIPELINE_SETTING_KEY = "chatbot.pipeline";
/** From this router score the Advisor offers a visit and the thread is a 🔥 lead. */
export const LEAD_THRESHOLD_SETTING_KEY = "chatbot.leadThreshold";
export const DEFAULT_LEAD_THRESHOLD = 60;

export type PipelineName = "v1" | "v2";

export interface ChatbotSettings {
  readonly pipeline: PipelineName;
  readonly leadThreshold: number;
}

export async function loadChatbotSettings(
  db: PrismaClient,
): Promise<ChatbotSettings> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: [PIPELINE_SETTING_KEY, LEAD_THRESHOLD_SETTING_KEY] } },
    select: { key: true, value: true },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim();
  const threshold = Number(get(LEAD_THRESHOLD_SETTING_KEY));
  return {
    pipeline: get(PIPELINE_SETTING_KEY) === "v2" ? "v2" : "v1",
    leadThreshold:
      Number.isFinite(threshold) && threshold >= 0 && threshold <= 100
        ? Math.round(threshold)
        : DEFAULT_LEAD_THRESHOLD,
  };
}

/**
 * Is the thread a 🔥 lead? The bot's half (`leadAt`) or the staff's
 * (`leadStaffAt`), whichever is newer, set after the last clear — a sale or a
 * person taking it off (migration 20261014120000).
 */
export function isLead(m: {
  readonly leadAt: Date | null;
  readonly leadStaffAt: Date | null;
  readonly leadClearedAt: Date | null;
} | null): boolean {
  if (!m) return false;
  const set = Math.max(m.leadAt?.getTime() ?? 0, m.leadStaffAt?.getTime() ?? 0);
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
