/** The chat agent's two endpoints. See apps/api/src/routes/chat.ts. */
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

export const draftReply = (body: {
  persona: string;
  turns: AgentTurn[];
  corrections: AgentCorrection[];
}) => api<AgentReply>("/api/chat/reply", { method: "POST", body });
