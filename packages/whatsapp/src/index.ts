// @nusantara/whatsapp — Graph API client for WhatsApp (06 §11).
//
// The send half of the integration. Inbound lives in apps/whatsapp-webhook;
// this is what the outbox worker calls once an intent has been committed.

export {
  canSend,
  sendImage,
  sendText,
  uploadMedia,
  type SendImageInput,
  type SendTextInput,
  type SendTextResult,
  type UploadMediaInput,
  type WhatsAppCredentials,
} from "./client.js";
export {
  WINDOW_MS,
  isWithinWindow,
  windowClosesAt,
  windowRemainingMs,
} from "./window.js";
