/**
 * The one WhatsApp session: linking, staying linked, unlinking, and the
 * traffic in both directions while linked.
 *
 * ## One session, and only on request
 *
 * Owner decision 2026-10-22: ONE linked device at a time, linked from the POS
 * by the owner. So nothing here links by itself. At start a session that was
 * linked before is resumed; with none, the gateway waits in DISCONNECTED until
 * `link()` — and `link()` refuses while a session is connected or connecting,
 * and is rationed (`LinkLimiter`), because a number that keeps pairing new
 * devices is what WhatsApp bans.
 *
 * ## The states
 *
 *     DISCONNECTED ──link()──▶ CONNECTING ──qr──▶ WAITING_FOR_SCAN
 *          ▲                       │  ▲                 │ scanned (515: restart)
 *          │ logged out / QR       │  └─────────────────┘
 *          │ expired / replaced    ▼
 *          └──────────────────  CONNECTED ──dropped──▶ CONNECTING (backoff)
 *
 * A dropped connection with a linked session is retried with backoff for as
 * long as it takes. Three closes are NOT retried, each for its own reason:
 * logged out (the phone removed the device — the session is dead and its
 * files are deleted), replaced (the same session opened somewhere else, and
 * two processes taking it in turns is how a number gets flagged), and
 * forbidden (WhatsApp refused the number).
 *
 * The QR is a data URL for the POS screen and is NEVER logged: anybody who
 * reads it within its minute becomes the shop.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Logger } from "@nusantara/logging";
import type { GatewayConfig } from "./config.js";
import {
  chatKind,
  deliveryFor,
  digits,
  inboundId,
  shapeOf,
  signatureOf,
  userOf,
  type InboundMessage,
} from "./delivery.js";
import { LinkLimiter, Pacer, type LinkLimitReport } from "./limits.js";

export type GatewayState =
  "DISCONNECTED" | "WAITING_FOR_SCAN" | "CONNECTING" | "CONNECTED";

export type SessionEnd = "LOGGED_OUT" | "QR_EXPIRED" | "REPLACED" | "FORBIDDEN";

/** For the log only; the POS has its own words for each. */
const SESSION_END_TEXT: Record<SessionEnd, string> = {
  LOGGED_OUT: "the device was unlinked from the phone",
  QR_EXPIRED: "the QR code was not scanned in time",
  REPLACED:
    "the session was opened somewhere else — make sure only one gateway runs",
  FORBIDDEN: "WhatsApp refused this number",
};

export interface GatewayStatus {
  readonly state: GatewayState;
  /** A data URL, only while WAITING_FOR_SCAN. */
  readonly qr?: string;
  /** The linked number, `+62…`, once known. */
  readonly number?: string;
  /** When the current connection opened. */
  readonly since?: string;
  /**
   * Why the last session ended, when it did not end by request. A code, so
   * the POS words it in the reader's language.
   */
  readonly lastError?: SessionEnd;
  readonly limit: LinkLimitReport;
}

export interface ConnectionUpdate {
  readonly qr?: string;
  readonly connection?: "open" | "close" | "connecting";
  /** Baileys' `DisconnectReason`, from the close's error. */
  readonly statusCode?: number;
}

/**
 * What the session needs of a socket. `baileysSocket.ts` builds one from
 * Baileys; a test builds a fake. Kept this narrow so neither has to imitate
 * Baileys' whole event emitter.
 */
export interface GatewaySocket {
  onConnection(listener: (u: ConnectionUpdate) => void): void;
  /** Messages ARRIVING (Baileys' "notify"), never history being filled in. */
  onMessages(listener: (messages: InboundMessage[]) => void): void;
  /** The linked account's number, digits only. */
  ownNumber(): string | null;
  /** A LID's phone-number JID, if WhatsApp has told us. */
  pnForLid(lid: string): Promise<string | null>;
  presence(jid: string, kind: "composing" | "paused"): Promise<void>;
  sendText(jid: string, text: string): Promise<string | null>;
  sendImage(
    jid: string,
    bytes: Buffer,
    mimeType: string,
    caption?: string,
  ): Promise<string | null>;
  /**
   * Delete a message this account sent, for everyone (2026-10-23). WhatsApp
   * honours it for about two days after the send.
   */
  revoke(jid: string, id: string): Promise<void>;
  /** Replace the text of a message this account sent; ~15 minutes after it. */
  editText(jid: string, id: string, text: string): Promise<void>;
  /** Unlink this device from the account. */
  logout(): Promise<void>;
  /** Close the connection and nothing else. */
  end(): void;
}

export type SocketFactory = (authDir: string) => Promise<GatewaySocket>;

/** Baileys' `DisconnectReason` values this reads (baileys Types/index). */
export const CLOSE = {
  loggedOut: 401,
  forbidden: 403,
  connectionReplaced: 440,
  restartRequired: 515,
} as const;

/** Waits between reconnects of a linked session; the last one repeats. */
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
/** Waits between attempts to hand an inbound message to the webhook. */
const FORWARD_RETRY_MS = [0, 2_000, 5_000, 15_000, 60_000];

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export type LinkResult =
  | { readonly ok: true; readonly status: GatewayStatus }
  | {
      readonly ok: false;
      readonly httpStatus: 409 | 429;
      readonly code: "CONNECTED" | "BUSY" | "RATE_LIMITED";
      readonly retryAfterMs?: number;
      readonly status: GatewayStatus;
    };

export type OutboundMessage =
  | { readonly kind: "text"; readonly to: string; readonly body: string }
  | {
      readonly kind: "image";
      readonly to: string;
      readonly bytes: Buffer;
      readonly mimeType: string;
      readonly caption?: string;
    };

/** What the HTTP server asks of a session; the server's tests fake this. */
export interface SessionApi {
  status(): GatewayStatus;
  link(): Promise<LinkResult>;
  logout(): Promise<GatewayStatus>;
  send(message: OutboundMessage): Promise<string>;
  /** Unsend a message this number sent to `to` (digits), by its id. */
  revoke(to: string, id: string): Promise<void>;
  /** Correct the text of a message this number sent to `to`. */
  editText(to: string, id: string, text: string): Promise<void>;
}

export interface SessionDeps {
  readonly config: GatewayConfig;
  readonly logger: Logger;
  readonly makeSocket: SocketFactory;
  /** For the webhook POST. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly qrToDataUrl: (qr: string) => Promise<string>;
  readonly forwardRetryMs?: readonly number[];
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WhatsAppSession implements SessionApi {
  private state: GatewayState = "DISCONNECTED";
  private qr: string | null = null;
  private number: string | null = null;
  private since: string | null = null;
  private lastError: SessionEnd | null = null;
  private sock: GatewaySocket | null = null;
  /** Bumped by every new socket and every deliberate end: stale events drop. */
  private gen = 0;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private readonly limiter: LinkLimiter;
  private readonly pacer: Pacer;
  private readonly authDir: string;
  private readonly jidsFile: string;
  private jids: Record<string, string>;

  constructor(private readonly deps: SessionDeps) {
    const { config } = deps;
    this.limiter = new LinkLimiter(config.linkMax, config.linkWindowMs);
    this.pacer = new Pacer(config.pacing);
    mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
    this.authDir = join(config.stateDir, "auth");
    this.jidsFile = join(config.stateDir, "jids.json");
    this.jids = this.readJids();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? (this.deps.sleep ?? realSleep)(ms) : Promise.resolve();
  }

  /** Resume a session linked before. With none, wait for `link()`. */
  async start(): Promise<void> {
    if (this.hasSession()) await this.connect();
  }

  /** Close the connection without unlinking — a restart or a deploy. */
  stop(): void {
    this.stopping = true;
    this.gen += 1;
    this.clearTimer();
    this.sock?.end();
    this.sock = null;
  }

  status(): GatewayStatus {
    return {
      state: this.state,
      ...(this.state === "WAITING_FOR_SCAN" && this.qr ? { qr: this.qr } : {}),
      ...(this.number ? { number: `+${this.number}` } : {}),
      ...(this.since && this.state === "CONNECTED"
        ? { since: this.since }
        : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      limit: this.limiter.report(this.now()),
    };
  }

  async link(): Promise<LinkResult> {
    if (this.state === "CONNECTED") {
      return {
        ok: false,
        httpStatus: 409,
        code: "CONNECTED",
        status: this.status(),
      };
    }
    // Already showing a QR: the same attempt, not a new one.
    if (this.state === "WAITING_FOR_SCAN")
      return { ok: true, status: this.status() };
    if (this.state === "CONNECTING") {
      return {
        ok: false,
        httpStatus: 409,
        code: "BUSY",
        status: this.status(),
      };
    }
    const taken = this.limiter.take(this.now());
    if (!taken.ok) {
      return {
        ok: false,
        httpStatus: 429,
        code: "RATE_LIMITED",
        retryAfterMs: taken.retryAfterMs,
        status: this.status(),
      };
    }
    this.lastError = null;
    // Half-written files from a QR nobody scanned would be resumed as if they
    // were a session; a fresh link starts from an empty folder.
    if (!this.hasSession()) this.clearAuth();
    this.deps.logger.info({ evt: "wa-gateway.link" }, "link requested");
    await this.connect();
    return { ok: true, status: this.status() };
  }

  async logout(): Promise<GatewayStatus> {
    const sock = this.sock;
    const wasConnected = this.state === "CONNECTED";
    // First, so the close the logout causes is not read as a dropped
    // connection and retried.
    this.gen += 1;
    this.clearTimer();
    this.sock = null;
    if (sock && wasConnected) {
      await sock.logout().catch((err: unknown) => {
        this.deps.logger.warn(
          { evt: "wa-gateway.logout.failed", err: errInfo(err) },
          "WhatsApp did not confirm the unlink; the device may still be listed on the phone",
        );
      });
    }
    sock?.end();
    this.clearAuth();
    this.jids = {};
    this.writeJids();
    this.state = "DISCONNECTED";
    this.qr = null;
    this.number = null;
    this.since = null;
    this.lastError = null;
    this.attempt = 0;
    this.deps.logger.info({ evt: "wa-gateway.logout" }, "session logged out");
    return this.status();
  }

  async send(message: OutboundMessage): Promise<string> {
    if (this.state !== "CONNECTED" || !this.sock) {
      throw new GatewayError(503, "the WhatsApp number is not linked");
    }
    const jid = this.jidFor(message.to);
    await this.sleep(this.pacer.reserve(jid, this.now()));
    const words =
      message.kind === "text" ? message.body : (message.caption ?? "");
    await this.sock?.presence(jid, "composing").catch(() => {});
    await this.sleep(this.pacer.typingMs(words));
    const sock = this.sock;
    if (this.state !== "CONNECTED" || !sock) {
      throw new GatewayError(
        503,
        "the WhatsApp connection dropped before sending",
      );
    }
    await sock.presence(jid, "paused").catch(() => {});
    const id =
      message.kind === "text"
        ? await sock.sendText(jid, message.body)
        : await sock.sendImage(
            jid,
            message.bytes,
            message.mimeType,
            message.caption,
          );
    return id ?? `wa-gateway-${this.now()}`;
  }

  /**
   * Unsend and edit (2026-10-23). Addressed to the SAME jid a send to `to`
   * goes to (`jidFor`): a message sent to a customer's LID lives in the LID's
   * chat, and a delete aimed at the phone-number chat would find nothing.
   * No pacing and no typing — neither is a new message.
   */
  async revoke(to: string, id: string): Promise<void> {
    const sock = this.connectedSocket();
    await sock.revoke(this.jidFor(to), id);
  }

  async editText(to: string, id: string, text: string): Promise<void> {
    const sock = this.connectedSocket();
    await sock.editText(this.jidFor(to), id, text);
  }

  /** Where a message to this wa_id goes: the chat it last wrote from. */
  private jidFor(to: string): string {
    return this.jids[to] ?? `${to}@s.whatsapp.net`;
  }

  private connectedSocket(): GatewaySocket {
    if (this.state !== "CONNECTED" || !this.sock) {
      throw new GatewayError(503, "the WhatsApp number is not linked");
    }
    return this.sock;
  }

  // --- the connection ------------------------------------------------------

  private async connect(): Promise<void> {
    const gen = ++this.gen;
    this.clearTimer();
    this.state = "CONNECTING";
    this.qr = null;
    let sock: GatewaySocket;
    try {
      sock = await this.deps.makeSocket(this.authDir);
    } catch (err) {
      if (gen !== this.gen) return;
      this.deps.logger.error(
        { evt: "wa-gateway.socket.failed", err: errInfo(err) },
        "could not open a WhatsApp socket",
      );
      this.afterDrop();
      return;
    }
    if (gen !== this.gen) {
      sock.end();
      return;
    }
    this.sock = sock;
    sock.onConnection((u) => void this.onUpdate(gen, sock, u));
    sock.onMessages((messages) => {
      if (gen !== this.gen) return;
      for (const m of messages) void this.onInbound(sock, m);
    });
  }

  private async onUpdate(
    gen: number,
    sock: GatewaySocket,
    u: ConnectionUpdate,
  ): Promise<void> {
    if (gen !== this.gen) return;
    if (u.qr) {
      this.state = "WAITING_FOR_SCAN";
      // Never logged — see the docblock.
      this.deps.logger.info({ evt: "wa-gateway.qr" }, "waiting for a scan");
      const url = await this.deps.qrToDataUrl(u.qr).catch(() => null);
      if (gen === this.gen && this.state === "WAITING_FOR_SCAN") this.qr = url;
    }
    if (u.connection === "open") {
      this.state = "CONNECTED";
      this.qr = null;
      this.number = sock.ownNumber();
      this.since = new Date(this.now()).toISOString();
      this.lastError = null;
      this.attempt = 0;
      this.deps.logger.info(
        { evt: "wa-gateway.connected" },
        "WhatsApp connected",
      );
    }
    if (u.connection === "close") this.onClose(u.statusCode);
  }

  private onClose(code: number | undefined): void {
    const wasWaiting = this.state === "WAITING_FOR_SCAN";
    this.sock = null;
    if (this.stopping) return;
    this.deps.logger.warn(
      { evt: "wa-gateway.closed", ctx: { code: code ?? null } },
      "WhatsApp connection closed",
    );
    if (code === CLOSE.restartRequired) {
      // What WhatsApp asks for straight after a scan, and now and then on a
      // linked session: reopen at once, on the same files.
      void this.connect();
      return;
    }
    if (code === CLOSE.loggedOut) {
      this.endSession("LOGGED_OUT", true);
      return;
    }
    if (code === CLOSE.connectionReplaced) {
      this.endSession("REPLACED", false);
      return;
    }
    if (code === CLOSE.forbidden) {
      this.endSession("FORBIDDEN", false);
      return;
    }
    if (wasWaiting || !this.hasSession()) {
      this.endSession("QR_EXPIRED", true);
      return;
    }
    this.afterDrop();
  }

  /** A linked session reconnects with backoff; an unlinked one stops. */
  private afterDrop(): void {
    if (!this.hasSession()) {
      this.state = "DISCONNECTED";
      this.qr = null;
      return;
    }
    this.state = "CONNECTING";
    this.qr = null;
    const wait =
      BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 300_000;
    this.attempt += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, wait);
    this.timer.unref?.();
  }

  private endSession(reason: SessionEnd, deleteFiles: boolean): void {
    this.gen += 1;
    this.clearTimer();
    if (deleteFiles) this.clearAuth();
    this.state = "DISCONNECTED";
    this.qr = null;
    this.since = null;
    if (deleteFiles) this.number = null;
    this.lastError = reason;
    this.deps.logger.warn(
      { evt: "wa-gateway.session_ended", ctx: { reason } },
      SESSION_END_TEXT[reason],
    );
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // --- inbound -------------------------------------------------------------

  private async onInbound(
    sock: GatewaySocket,
    m: InboundMessage,
  ): Promise<void> {
    if (m.fromMe) return;
    const kind = chatKind(m.jid);
    if (kind === "ignore") return;
    const shape = shapeOf(m.content);
    if (!shape) return;

    let waId: string | null = null;
    if (kind === "person") {
      waId = digits(userOf(m.jid));
    } else if (m.jidAlt && chatKind(m.jidAlt) === "person") {
      waId = digits(userOf(m.jidAlt));
    } else {
      const pn = await sock.pnForLid(m.jid).catch(() => null);
      waId = pn ? digits(userOf(pn)) : null;
    }
    if (!waId) {
      this.deps.logger.warn(
        { evt: "wa-gateway.inbound.unresolved", ctx: { id: m.id } },
        "a message from a LID with no known phone number was not forwarded",
      );
      return;
    }
    this.rememberJid(waId, m.jid);

    const body = deliveryFor({
      waId,
      name: m.pushName ?? null,
      id: m.id,
      seconds: m.seconds,
      shape,
      displayNumber: this.number ?? "",
    });
    await this.forward(body, m.id);
  }

  /**
   * Hand a delivery to the webhook, retrying a few times — Meta retries for
   * a day and a half; the webhook dedups by message id, so a retry that
   * crosses a slow success is harmless. A 4xx is not retried: it is a wrong
   * APP_SECRET, and the same bytes will be refused identically.
   */
  private async forward(body: string, id: string): Promise<void> {
    const { config, logger } = this.deps;
    const doFetch = this.deps.fetchImpl ?? fetch;
    const signature = signatureOf(body, config.appSecret);
    const ctx = { id: inboundId(id) };
    for (const delay of this.deps.forwardRetryMs ?? FORWARD_RETRY_MS) {
      await this.sleep(delay);
      if (this.stopping) return;
      try {
        const res = await doFetch(config.webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          logger.info({ evt: "wa-gateway.inbound", ctx }, "message forwarded");
          return;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          logger.error(
            {
              evt: "wa-gateway.inbound.refused",
              ctx: { ...ctx, status: res.status },
            },
            "the webhook refused a delivery — is APP_SECRET the webhook's?",
          );
          return;
        }
      } catch {
        // unreachable: retried below
      }
    }
    logger.error(
      { evt: "wa-gateway.inbound.dropped", ctx },
      "the webhook could not be reached; the message is on the phone but not in the POS",
    );
  }

  // --- files ---------------------------------------------------------------

  /** A session was linked: Baileys wrote who we are into creds.json. */
  private hasSession(): boolean {
    try {
      const creds = JSON.parse(
        readFileSync(join(this.authDir, "creds.json"), "utf8"),
      ) as { me?: { id?: string } };
      return Boolean(creds.me?.id);
    } catch {
      return false;
    }
  }

  private clearAuth(): void {
    rmSync(this.authDir, { recursive: true, force: true });
  }

  /**
   * WhatsApp addresses many chats by a LID, and a reply must go back to the
   * address the message came from, while the bot only knows the wa_id.
   */
  private rememberJid(waId: string, jid: string): void {
    if (this.jids[waId] === jid) return;
    this.jids[waId] = jid;
    this.writeJids();
  }

  private readJids(): Record<string, string> {
    if (!existsSync(this.jidsFile)) return {};
    try {
      return JSON.parse(readFileSync(this.jidsFile, "utf8")) as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  }

  private writeJids(): void {
    writeFileSync(this.jidsFile, JSON.stringify(this.jids), { mode: 0o600 });
  }
}

/** An Error, which is what the logger's `err` serializer reads (and redacts). */
export function errInfo(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
