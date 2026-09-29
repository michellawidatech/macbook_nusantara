/**
 * The four switches on /chat — Stock, Price, Reservations, Photos — read out
 * of `AppSetting` (owner ask 2026-09-29).
 *
 * They were one environment variable, `AGENT_CAPABILITIES`, which meant a
 * deploy or a shell on the Mac mini to change what the bot may say. They are
 * rows now, pressed by a person on the Chat page and read by the worker at
 * the start of every pass, so a switch takes effect on the next message. The
 * variable is still read, as the answer for a switch nobody has pressed.
 */
import type { PrismaClient } from "@nusantara/db";
import {
  CAPABILITY_SETTING_KEYS,
  capabilitiesFromSettings,
  type AgentCapabilities,
} from "./policy.js";

export async function loadCapabilities(
  db: PrismaClient,
  fallback: AgentCapabilities,
): Promise<AgentCapabilities> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.values(CAPABILITY_SETTING_KEYS) } },
    select: { key: true, value: true },
  });
  return capabilitiesFromSettings(rows, fallback);
}
