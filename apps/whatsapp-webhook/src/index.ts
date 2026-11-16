// @nusantara/whatsapp-webhook — Meta webhook receiver (:3001).
//
// The library surface. `server.ts` is the runnable entry point; keeping the two
// apart is what lets supertest drive the routes in-process without binding a
// port or reading the environment.

export { createApp, handleInbound, type CreateAppDeps } from "./app.js";
export {
  loadConfig,
  loadEnvFile,
  canSendWhatsApp,
  WEBHOOK_ENV_KEYS,
  type WebhookConfig,
} from "./config.js";
export {
  expectedSignature,
  verifySignature,
  tokenMatches,
} from "./signature.js";
export {
  extractMessages,
  persistInbound,
  type InboundMessage,
  type WebhookPayload,
} from "./persist.js";
export {
  extractIgComments,
  extractIgMessages,
  persistInboundIg,
  IG_SETTINGS_ID,
  type IgPayload,
} from "./instagram.js";
export { mediaHandler, MEDIA_URL_TTL_MS } from "./media.js";
