/** The chat agent's endpoints. See apps/api/src/routes/chat.ts. */
import { api } from "./api.js";

export interface AgentStatus {
  /** False when no Anthropic credential is configured on the server. */
  enabled: boolean;
  mode: "none" | "oauth" | "api-key";
}

export interface AgentTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AgentCorrection {
  original: string;
  corrected: string;
  note?: string;
}

export interface AgentReply {
  reply: string;
  /** Which grounding tools ran, so staff can see what the answer is based on. */
  toolsUsed: string[];
  steps: number;
}

export const agentStatus = () => api<AgentStatus>("/api/chat/status");

/**
 * `persona` and `corrections` are optional now that both are persisted.
 *
 * Send a persona only to preview an edit a staff member has not saved yet.
 * Omit it and the server uses the active one, which is the same voice the
 * unattended worker speaks in. That equivalence is the point of the endpoints
 * below: before them, editing the voice here changed what staff drafted and not
 * one word of what the bot said at 2am.
 */
export const draftReply = (body: {
  persona?: string;
  turns: AgentTurn[];
  corrections?: AgentCorrection[];
  /** Which thread, so the grounding tools can look the customer up. */
  waId?: string;
}) => api<AgentReply>("/api/chat/reply", { method: "POST", body });

/** A voice the bot can wear. Exactly one row is `active` at a time. */
export interface Persona {
  id: string;
  name: string;
  blurb: string | null;
  prompt: string;
  active: boolean;
  /** A built-in is the shop's default voice and cannot be deleted. */
  builtIn: boolean;
  updatedAt: string;
}

export interface StoredCorrection {
  id: string;
  messageId: string | null;
  original: string;
  corrected: string;
  note: string | null;
  createdAt: string;
  createdBy: { name: string };
}

export const listPersonas = () =>
  api<{ personas: Persona[] }>("/api/chat/personas");

export const createPersona = (body: {
  name: string;
  blurb?: string;
  prompt: string;
}) =>
  api<{ persona: { id: string; name: string; active: boolean } }>(
    "/api/chat/personas",
    { method: "POST", body },
  );

export const updatePersona = (
  id: string,
  body: { name: string; blurb?: string; prompt: string },
) =>
  api<{ persona: { id: string; name: string; active: boolean } }>(
    `/api/chat/personas/${encodeURIComponent(id)}`,
    { method: "PUT", body },
  );

/** Make one persona the live voice. Changes what the worker says, immediately. */
export const activatePersona = (id: string) =>
  api<{ status: string; id: string }>(
    `/api/chat/personas/${encodeURIComponent(id)}/activate`,
    { method: "POST", body: {} },
  );

export const listCorrections = () =>
  api<{ corrections: StoredCorrection[] }>("/api/chat/corrections");

/** File a staff rewrite. The agent reads these back as house style. */
export const saveCorrection = (body: {
  messageId?: string;
  original: string;
  corrected: string;
  note?: string;
}) =>
  api<{ correction: { id: string } }>("/api/chat/corrections", {
    method: "POST",
    body,
  });
