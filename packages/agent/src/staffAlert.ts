/**
 * The WhatsApp line a staff member gets when a chat needs a person (owner,
 * 2026-10-28: *"notify the staff through WA if there are any chat they need
 * to answer"*). Sent from the shop's own number to each number in
 * `chatbot.notifyNumbers`, once per hand-over. Pure.
 */

import { isIgThread } from "@nusantara/domain";

/** Where the POS is, for the link in the alert. */
export const POS_PUBLIC_URL = "https://pos.macbooknusantara.com";

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function staffAlertText(input: {
  /** The thread key: a wa_id, or `ig:<IGSID>` for Instagram (2026-11-16). */
  readonly phone: string;
  readonly name: string | null;
  readonly customerText: string;
  readonly summary: string;
  readonly baseUrl?: string;
  /** An Instagram sender's @username, when the sync pass has it. */
  readonly username?: string | null;
  /** A comment rather than a DM: the link opens the Comments tab. */
  readonly comment?: boolean;
}): string {
  const instagram = isIgThread(input.phone) || input.comment === true;
  const handle = input.username ? `@${input.username}` : null;
  const who = instagram
    ? [handle, input.name].filter(Boolean).join(" · ") || "Instagram"
    : input.name
      ? `${input.name} (${input.phone})`
      : input.phone;
  const said = clip(input.customerText, 160);
  const task = clip(input.summary.split("\n")[0] ?? "", 120);
  const base = input.baseUrl ?? POS_PUBLIC_URL;
  const url = input.comment
    ? `${base}/chat?tab=comments`
    : `${base}/chat?phone=${encodeURIComponent(input.phone)}`;
  return [
    instagram
      ? `🔔 Perlu dibalas (${input.comment ? "komentar Instagram" : "Instagram"}) — ${who}`
      : `🔔 Perlu dibalas — ${who}`,
    said ? `"${said}"` : null,
    task ? task : null,
    `Buka: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
}
