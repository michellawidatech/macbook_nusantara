/**
 * Config — loads apps/whatsapp-webhook/.env into process.env (Node's built-in
 * env-file loader), then exposes typed values. Missing .env is non-fatal:
 * values can also come from the parent process / shell.
 */

import { join } from "node:path";

try {
  // Node >= 20.12 / 21.7
  process.loadEnvFile(join(import.meta.dirname, "..", ".env"));
} catch {
  // no .env present — fall back to already-set process.env
}

export interface Config {
  port: number;
  verifyToken: string;
  whatsappToken: string;
  phoneNumberId: string;
  appSecret: string;
  graphVersion: string;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  verifyToken: process.env.VERIFY_TOKEN ?? "",
  whatsappToken: process.env.WHATSAPP_TOKEN ?? "",
  phoneNumberId: process.env.PHONE_NUMBER_ID ?? "",
  appSecret: process.env.APP_SECRET ?? "",
  graphVersion: process.env.GRAPH_API_VERSION ?? "v21.0",
};

export const canSend = () =>
  Boolean(config.whatsappToken && config.phoneNumberId);
