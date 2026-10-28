/**
 * The WhatsApp line a staff member gets when a chat needs a person (owner,
 * 2026-10-28: *"notify the staff through WA if there are any chat they need
 * to answer"*). Sent from the shop's own number to each number in
 * `chatbot.notifyNumbers`, once per hand-over. Pure.
 */

/** Where the POS is, for the link in the alert. */
export const POS_PUBLIC_URL = "https://pos.macbooknusantara.com";

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function staffAlertText(input: {
  readonly phone: string;
  readonly name: string | null;
  readonly customerText: string;
  readonly summary: string;
  readonly baseUrl?: string;
}): string {
  const who = input.name ? `${input.name} (${input.phone})` : input.phone;
  const said = clip(input.customerText, 160);
  const task = clip(input.summary.split("\n")[0] ?? "", 120);
  const url = `${input.baseUrl ?? POS_PUBLIC_URL}/chat?phone=${input.phone}`;
  return [
    `🔔 Perlu dibalas — ${who}`,
    said ? `"${said}"` : null,
    task ? task : null,
    `Buka: ${url}`,
  ]
    .filter(Boolean)
    .join("\n");
}
