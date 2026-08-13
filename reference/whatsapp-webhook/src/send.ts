/**
 * Outbound send for the webhook service.
 *
 * The Graph call itself lives in @nusantara/whatsapp so apps/api can reuse it
 * for staff-authored replies from the POS inbox. This stays as the webhook's
 * entry point: it pins the HttpLog `app` tag and keeps the void-returning
 * signature the agent pipeline calls.
 *
 * The `./config.js` import is load-bearing — importing it runs the .env load,
 * so the shared client's lazy getters see the credentials.
 */

import { sendText as sendTextVia } from "@nusantara/whatsapp";
import "./config.js";

export async function sendText(to: string, body: string): Promise<void> {
  await sendTextVia(to, body, "whatsapp-webhook");
}
