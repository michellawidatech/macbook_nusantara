/**
 * Which model the chatbot runs on, chosen in Chatbot → Settings (owner,
 * 2026-10-28) rather than by a line in worker.env. Read by the worker each
 * pass and by the Chat tab's "Write it for me", so a change applies to the
 * next message with no restart. Absent (or not on the list) means the
 * environment's answer, as before.
 */
import type { PrismaClient } from "@nusantara/db";

export const MODEL_SETTING_KEY = "chatbot.model";

export interface ChatbotModel {
  readonly id: string;
  readonly label: string;
  /**
   * Answers a `claude setup-token` login. Haiku 5.5 is a 429 on one
   * (2026-10-22), which is why the bot runs on Haiku 4.5 there.
   */
  readonly worksWithSetupToken: boolean;
}

export const CHATBOT_MODELS: readonly ChatbotModel[] = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", worksWithSetupToken: true },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", worksWithSetupToken: false },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", worksWithSetupToken: false },
];

/** A stored value, kept only when it names a model on the list. */
export function chatbotModelOf(
  value: string | null | undefined,
): string | null {
  const v = (value ?? "").trim();
  return CHATBOT_MODELS.some((m) => m.id === v) ? v : null;
}

export async function loadChatbotModel(
  db: Pick<PrismaClient, "appSetting">,
): Promise<string | null> {
  const row = await db.appSetting.findUnique({
    where: { key: MODEL_SETTING_KEY },
    select: { value: true },
  });
  return chatbotModelOf(row?.value);
}
