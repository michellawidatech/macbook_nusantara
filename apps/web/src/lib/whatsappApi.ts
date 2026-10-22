/**
 * The shop's WhatsApp number as a linked device (owner decision 2026-10-22,
 * docs/whatsapp-baileys.md) — `/api/whatsapp/connection`, owner-only.
 */

import { api } from "./api.js";

export type ConnectionState =
  "DISCONNECTED" | "WAITING_FOR_SCAN" | "CONNECTING" | "CONNECTED";

/** Why the last session ended without anybody pressing Disconnect. */
export type SessionEnd = "LOGGED_OUT" | "QR_EXPIRED" | "REPLACED" | "FORBIDDEN";

export interface WhatsAppConnection {
  /** Whether the gateway answered at all. */
  readonly gateway: "OK" | "UNREACHABLE" | "NOT_CONFIGURED";
  readonly state?: ConnectionState;
  /** A data URL, only while WAITING_FOR_SCAN. */
  readonly qr?: string;
  readonly number?: string;
  readonly since?: string;
  readonly lastError?: SessionEnd;
  readonly limit?: {
    readonly max: number;
    readonly windowMinutes: number;
    readonly remaining: number;
    readonly resetAt: string | null;
  };
}

export const getWhatsAppConnection = () =>
  api<WhatsAppConnection>("/api/whatsapp/connection");

export const linkWhatsApp = () =>
  api<WhatsAppConnection>("/api/whatsapp/connection/link", {
    method: "POST",
  });

export const logoutWhatsApp = () =>
  api<WhatsAppConnection>("/api/whatsapp/connection/logout", {
    method: "POST",
  });
