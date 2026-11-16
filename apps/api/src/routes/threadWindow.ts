/**
 * When a free reply can still reach a thread (2026-11-16) — WhatsApp's
 * 24-hour window, unchanged, or Instagram's: 24 hours for anybody, then up to
 * 7 days for a STAFF reply tagged HUMAN_AGENT, which Meta allows only to an
 * app approved for the Human Agent feature (`IG_HUMAN_AGENT=1`).
 */
import { isWithinWindow, windowClosesAt } from "@nusantara/whatsapp";
import {
  igReplyMode,
  igReplyModeClosesAt,
  isIgThread,
  isThreadKey,
} from "@nusantara/domain";
import { z } from "zod";

export interface ThreadWindow {
  /** A staff reply may be queued now. */
  readonly open: boolean;
  /** When that stops being true; null once it has. */
  readonly closesAt: Date | null;
  /** Instagram past 24 h: the reply must carry this tag. */
  readonly tag?: "HUMAN_AGENT";
}

export function threadWindow(
  key: string,
  lastInboundAt: Date | null,
  now: Date,
  igHumanAgent: boolean,
): ThreadWindow {
  if (!isIgThread(key)) {
    const open = isWithinWindow(lastInboundAt, now);
    return {
      open,
      closesAt: open && lastInboundAt ? windowClosesAt(lastInboundAt) : null,
    };
  }
  const mode = igReplyMode(lastInboundAt, now);
  if (mode === "RESPONSE")
    return { open: true, closesAt: igReplyModeClosesAt(lastInboundAt, mode) };
  if (mode === "HUMAN_AGENT" && igHumanAgent)
    return {
      open: true,
      closesAt: igReplyModeClosesAt(lastInboundAt, mode),
      tag: "HUMAN_AGENT",
    };
  return { open: false, closesAt: null };
}

/** The window-closed refusal, in the channel's own words. */
export function windowClosedMessage(key: string): string {
  return isIgThread(key)
    ? "Lebih dari 24 jam sejak pesan terakhir pelanggan. Instagram tidak mengizinkan balasan sampai pelanggan menulis lagi."
    : "Jendela 24 jam sudah tutup. Balasan bebas tidak akan terkirim — gunakan template yang sudah disetujui.";
}

/** A thread in a URL: a wa_id, or `ig:` + an IGSID. */
export const threadParam = z
  .string()
  .trim()
  .refine(isThreadKey, "a wa_id or an Instagram thread key");
