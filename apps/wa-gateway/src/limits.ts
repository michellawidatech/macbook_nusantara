/**
 * The three things that keep the shop's number looking like a person's
 * phone: link attempts are rationed, sends are spaced out, and uploaded
 * photos do not pile up. Each takes its clock as an argument, so a test
 * drives it without waiting.
 */

import type { PacingConfig } from "./config.js";

export interface LinkLimitReport {
  readonly max: number;
  readonly windowMinutes: number;
  readonly remaining: number;
  /** When the oldest attempt in the window stops counting, if any does. */
  readonly resetAt: string | null;
}

/**
 * At most `max` link attempts per sliding window (owner, 2026-10-22: do not
 * link and unlink repeatedly — WhatsApp reads a number that keeps pairing new
 * devices as a number being abused). Counts STARTED attempts, scanned or not:
 * a QR shown is already a pairing request WhatsApp has seen.
 *
 * In memory, so a restart forgives. That is acceptable: the restart is
 * launchd's or an admin's, not a button anybody can press from the POS.
 */
export class LinkLimiter {
  private attempts: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private prune(now: number): void {
    this.attempts = this.attempts.filter((t) => now - t < this.windowMs);
  }

  /** Take one attempt, or say how long until one is free. */
  take(now: number): { ok: true } | { ok: false; retryAfterMs: number } {
    this.prune(now);
    if (this.attempts.length >= this.max) {
      const oldest = this.attempts[0] ?? now;
      return { ok: false, retryAfterMs: oldest + this.windowMs - now };
    }
    this.attempts.push(now);
    return { ok: true };
  }

  report(now: number): LinkLimitReport {
    this.prune(now);
    const oldest = this.attempts[0];
    return {
      max: this.max,
      windowMinutes: Math.round(this.windowMs / 60_000),
      remaining: Math.max(0, this.max - this.attempts.length),
      resetAt:
        oldest === undefined
          ? null
          : new Date(oldest + this.windowMs).toISOString(),
    };
  }
}

/**
 * Spaces sends out: never two to one chat closer than `perChatMs`, never two
 * from the number closer than `globalMs`. A reservation, not a queue — each
 * caller is told how long to wait for ITS slot, and the slot is booked before
 * it waits, so two sends arriving together are put one after the other rather
 * than both waking at the same moment.
 */
export class Pacer {
  private nextGlobal = 0;
  private readonly nextChat = new Map<string, number>();

  constructor(private readonly config: PacingConfig) {}

  /** How long to wait before sending to `chat`; books that slot. */
  reserve(chat: string, now: number): number {
    const at = Math.max(now, this.nextGlobal, this.nextChat.get(chat) ?? 0);
    this.nextGlobal = at + this.config.globalMs;
    this.nextChat.set(chat, at + this.config.perChatMs);
    // A chat nobody has written to for a while is forgotten, so the map does
    // not grow with every customer the shop has ever had.
    if (this.nextChat.size > 2_000) {
      for (const [k, t] of this.nextChat) if (t < now) this.nextChat.delete(k);
    }
    return at - now;
  }

  /** How long "typing…" shows before a reply of this length. */
  typingMs(text: string): number {
    const { typingMinMs, typingMaxMs, typingMsPerChar } = this.config;
    return Math.min(
      typingMaxMs,
      Math.max(typingMinMs, text.length * typingMsPerChar),
    );
  }
}

export interface StoredMedia {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly at: number;
}

/**
 * Bytes the worker uploaded, waiting for the image send that names them —
 * the two halves of `sendPhoto`. Held for ten minutes and capped in number,
 * because an upload whose send failed is never claimed.
 */
export class MediaStore {
  private readonly items = new Map<string, StoredMedia>();
  private seq = 0;

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxItems = 50,
  ) {}

  put(bytes: Buffer, mimeType: string, now: number): string {
    this.sweep(now);
    while (this.items.size >= this.maxItems) {
      const first = this.items.keys().next().value;
      if (first === undefined) break;
      this.items.delete(first);
    }
    const id = `wa-gateway-media-${now}-${++this.seq}`;
    this.items.set(id, { bytes, mimeType, at: now });
    return id;
  }

  /** The bytes, once: a send consumes its upload. */
  take(id: string, now: number): StoredMedia | null {
    this.sweep(now);
    const item = this.items.get(id) ?? null;
    this.items.delete(id);
    return item;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.items)
      if (now - v.at > this.ttlMs) this.items.delete(k);
  }
}
