/**
 * The WhatsApp Cloud API send client — 06 §11.
 *
 *     POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
 *     Authorization: Bearer {WHATSAPP_TOKEN}
 *     { messaging_product, to, type: "text", text: { body } }
 *
 * Three things this file is careful about.
 *
 * **It never reads `process.env`.** Every credential arrives as an argument
 * (01 §7). The worker's entry point is the only place that touches the shell.
 *
 * **A missing credential is a simulation, not a crash.** 06 §11 is explicit:
 * both clients no-op-and-log when `canSend()` is false, so the whole feature
 * runs locally without live credentials — and the caller is handed
 * `simulated: true` so the UI can say "saved but not sent" rather than
 * implying a delivery that never happened.
 *
 * **Graph reports failures with a 200.** A send can come back success-shaped
 * and still not have delivered — the classic case being a free-form message
 * outside the 24-hour window. So the response is parsed and the presence of
 * `error`, or the absence of a message id, is treated as a failure even when
 * the HTTP status was fine.
 */

/** Everything a send needs. One constant Graph version, both channels (CLAUDE.md). */
export interface WhatsAppCredentials {
  readonly whatsappToken: string;
  readonly phoneNumberId: string;
  readonly graphVersion: string;
}

/** True when a real send is possible. False means simulate and say so. */
export function canSend(c: WhatsAppCredentials): boolean {
  return Boolean(c.whatsappToken && c.phoneNumberId);
}

export interface SendTextInput {
  readonly credentials: WhatsAppCredentials;
  /** The customer's wa_id, digits only — `628…`, never `+62…` or `08…`. */
  readonly to: string;
  readonly body: string;
  /** Injectable so tests never touch the network. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface SendTextResult {
  /** Graph's `wamid.…` for the outbound message, or null when simulated. */
  readonly waMessageId: string | null;
  /** True when no credential was configured and nothing left this machine. */
  readonly simulated: boolean;
}

/**
 * Graph's error envelope, as much of it as is worth logging.
 *
 * `code` is the part that matters operationally: 131030 is "recipient not in
 * the allowed list" (app still in development mode) and 131047 is the 24-hour
 * window, and telling those apart from a log line saves an afternoon (06 §12).
 */
interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { details?: string };
}

interface GraphSendResponse {
  messages?: Array<{ id?: string }>;
  error?: GraphError;
}

/** Flatten Graph's error into one line worth storing in `Outbox.lastError`. */
function describe(error: GraphError): string {
  const parts = [
    error.code !== undefined ? `#${error.code}` : null,
    error.error_subcode !== undefined
      ? `(subcode ${error.error_subcode})`
      : null,
    error.message ?? error.type ?? "unknown Graph error",
    error.error_data?.details ?? null,
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * The default request timeout.
 *
 * Without one a hung socket parks a worker slot until the OS gives up, which
 * on macOS is minutes. The outbox retries, so failing fast is free.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Send one free-form text message.
 *
 * Throws on failure, deliberately: the caller is the outbox worker, and the
 * throw is what drives `markOutboxFailed` into its backoff. A silent failure
 * here would mark the row SENT and lose the reply.
 */
export async function sendText(input: SendTextInput): Promise<SendTextResult> {
  const { credentials, to, body } = input;

  if (!canSend(credentials)) {
    // Not an error. 06 §11: no credential means simulation mode, and the
    // caller is told so it can label the message honestly.
    return { waMessageId: null, simulated: true };
  }

  const doFetch = input.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${credentials.graphVersion}/${credentials.phoneNumberId}/messages`;

  // AbortSignal.timeout rather than a manual controller + setTimeout: no timer
  // is left behind to keep the process alive after a fast response.
  const signal = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const response = await doFetch(url, {
    method: "POST",
    headers: {
      // The token is a header and never a query parameter — a URL ends up in
      // access logs and in ngrok's request inspector.
      Authorization: `Bearer ${credentials.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      // Link previews off: the shop sends prices and pickup addresses, and an
      // unfurled preview of a customer's own link is noise.
      text: { preview_url: false, body },
    }),
    signal,
  });

  const text = await response.text();
  let parsed: GraphSendResponse = {};
  try {
    parsed = text ? (JSON.parse(text) as GraphSendResponse) : {};
  } catch {
    // A non-JSON body from Graph means a proxy or an outage page answered.
    throw new Error(
      `WhatsApp send failed: HTTP ${response.status}, non-JSON body`,
    );
  }

  if (parsed.error) {
    throw new Error(`WhatsApp send failed: ${describe(parsed.error)}`);
  }
  if (!response.ok) {
    throw new Error(`WhatsApp send failed: HTTP ${response.status}`);
  }

  const waMessageId = parsed.messages?.[0]?.id;
  if (!waMessageId) {
    // 200 with no message id. Success-shaped and undelivered — exactly the
    // case 06 §11 warns is easy to miss.
    throw new Error("WhatsApp send failed: Graph returned no message id");
  }

  return { waMessageId, simulated: false };
}
