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
  /** What the reply rests on: approved-answer handles (K7), store, catalog, greeting. */
  sources: string[];
  /**
   * Set when the bot would have handed this to a person (2026-09-18). `reply`
   * is then its holding line, not an answer.
   */
  handoff?: { topic: string; summary: string };
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

/** Delete a prompt nobody uses (owner, 2026-10-28). */
export const deletePersona = (id: string) =>
  api<{ deleted: string }>(`/api/chat/personas/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

/** A number on the testers or alert list, with the name beside it. */
export interface NumberEntry {
  waId: string;
  name: string;
}
export type NumberListPath = "/api/chat/testers" | "/api/chat/notify-numbers";
export const getNumberList = (path: NumberListPath) =>
  api<{ numbers: string[]; entries: NumberEntry[] }>(path);
export const setNumberList = (
  path: NumberListPath,
  entries: ReadonlyArray<{ number: string; name: string }>,
) =>
  api<{ numbers: string[]; entries: NumberEntry[] }>(path, {
    method: "PUT",
    body: { entries },
  });

/** The models the bot may run on, and which one it does (2026-10-28). */
export interface ChatbotModelOption {
  id: string;
  label: string;
  worksWithSetupToken: boolean;
}
export interface ChatModelState {
  model: string | null;
  envModel: string | null;
  models: ChatbotModelOption[];
}
export const getChatModel = () => api<ChatModelState>("/api/chat/model");
export const setChatModel = (model: string | null) =>
  api<ChatModelState>("/api/chat/model", { method: "PUT", body: { model } });

/** What the bot did and cost, last 7 and 30 days. */
export interface ChatUsageWindow {
  days: number;
  replies: number;
  byAi: number;
  byTemplates: number;
  handovers: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
}
export const getChatUsage = () =>
  api<{ windows: ChatUsageWindow[] }>("/api/chat/usage");

/** Is the chatbot working? (2026-10-28) */
export interface ChatHealth {
  ok: boolean;
  problems: Array<{
    code: "BOT_STALE" | "OUTBOX_STUCK" | "WA_DISCONNECTED";
    minutes?: number;
  }>;
  checkedAt: string;
}
export const getChatHealth = () => api<ChatHealth>("/api/inbox/health");

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

/**
 * The four switches on /chat (owner ask 2026-09-29): what the bot may answer
 * for itself. `reserve` covers making, checking, moving and cancelling a
 * booking. Each switch that is off sends its kind of question to a person.
 */
export interface BotCapabilities {
  stock: boolean;
  price: boolean;
  reserve: boolean;
  photos: boolean;
}

export interface BotCapabilitiesState {
  /** As pressed. */
  set: BotCapabilities;
  /**
   * What that allows: price, bookings and photos are all about a unit on the
   * shelf, so each is off while Stock is.
   */
  effective: BotCapabilities;
}

export const getCapabilities = () =>
  api<BotCapabilitiesState>("/api/chat/capabilities");

/** The owner's call — the server answers 403 to anybody else. */
export const setCapabilities = (body: Partial<BotCapabilities>) =>
  api<BotCapabilitiesState>("/api/chat/capabilities", {
    method: "PUT",
    body,
  });

/**
 * The numbers that may type `/new` to start their conversation over (owner
 * ask 2026-10-14). For trying the bot out: a reset leaves the earlier turns,
 * the summary and any open hand-over behind. Written as wa_ids.
 */
export const getTesters = () => api<{ numbers: string[] }>("/api/chat/testers");

/**
 * Staff numbers that get a WhatsApp alert when a chat needs a person
 * (2026-10-28). Read by any staff; the owner changes them.
 */
export const getNotifyNumbers = () =>
  api<{ numbers: string[] }>("/api/chat/notify-numbers");
export const setNotifyNumbers = (numbers: string[]) =>
  api<{ numbers: string[] }>("/api/chat/notify-numbers", {
    method: "PUT",
    body: { numbers },
  });

/** How many chats wait for a person, and the one waiting longest. */
export const getWaitingChats = () =>
  api<{ count: number; oldest: string | null }>("/api/inbox/waiting");

/** The owner's call — the server answers 403 to anybody else. */
export const setTesters = (numbers: string[]) =>
  api<{ numbers: string[] }>("/api/chat/testers", {
    method: "PUT",
    body: { numbers },
  });

// ── Chatbot v2 (2026-10-15) ────────────────────────────────────────────────

export type AgentKey = "ROUTER" | "ADVISOR" | "OPERATIONS";

export type EvaluationReason =
  | "WRONG_FACT"
  | "WRONG_TONE"
  | "TOO_LONG"
  | "MISSED_QUESTION"
  | "SHOULD_ESCALATE"
  | "SHOULD_NOT_ESCALATE"
  | "OTHER";

export const EVALUATION_REASONS: readonly EvaluationReason[] = [
  "WRONG_FACT",
  "WRONG_TONE",
  "TOO_LONG",
  "MISSED_QUESTION",
  "SHOULD_ESCALATE",
  "SHOULD_NOT_ESCALATE",
  "OTHER",
];

export const AGENT_KEYS: readonly AgentKey[] = [
  "ROUTER",
  "ADVISOR",
  "OPERATIONS",
];

/** Staff's verdict on one bot reply. */
export interface Evaluation {
  id: string;
  rating: "GOOD" | "BAD";
  reason: EvaluationReason | null;
  agent: AgentKey | null;
  note: string | null;
  /** The better answer, when somebody wrote one. */
  corrected: string | null;
  status: "OPEN" | "APPLIED" | "DISMISSED";
  createdAt: string;
  createdBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  phone: string;
  customerText: string | null;
  reply: string | null;
  messageId: string;
}

export const listEvaluations = (
  query: {
    status?: "OPEN" | "APPLIED" | "DISMISSED" | "ALL";
    rating?: "GOOD" | "BAD";
  } = {},
) => {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.rating) params.set("rating", query.rating);
  const qs = params.toString();
  return api<{ evaluations: Evaluation[] }>(
    `/api/chat/evaluations${qs ? `?${qs}` : ""}`,
  );
};

export const createEvaluation = (body: {
  messageId: string;
  rating: "GOOD" | "BAD";
  reason?: EvaluationReason;
  agent?: AgentKey;
  note?: string;
  corrected?: string;
  /** The rating this one replaces (👍 pressed where 👎 stood), in one go. */
  replaces?: string;
}) =>
  api<{ evaluation: Evaluation }>("/api/chat/evaluations", {
    method: "POST",
    body,
  });

/**
 * Take a rating back — the same thumb pressed again (2026-10-27). Its author
 * or an owner, and only while it is OPEN: 409 once it became a Knowledge
 * Base answer.
 */
export const withdrawEvaluation = (id: string) =>
  api<{ withdrawn: string }>(
    `/api/chat/evaluations/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

/**
 * Delete a row from the Evaluation list, whatever its status — the author or
 * an owner. An applied rating's Knowledge Base answer stays.
 */
export const deleteEvaluation = (id: string) =>
  api<{ withdrawn: string }>(
    `/api/chat/evaluations/${encodeURIComponent(id)}?any=1`,
    { method: "DELETE" },
  );

/** Writes an AgentCorrection the bot reads. 400 without a corrected text. */
export const applyEvaluation = (id: string, corrected?: string) =>
  api<{ evaluation: Evaluation }>(
    `/api/chat/evaluations/${encodeURIComponent(id)}/apply`,
    { method: "POST", body: corrected === undefined ? {} : { corrected } },
  );

export const dismissEvaluation = (id: string) =>
  api<{ evaluation: Evaluation }>(
    `/api/chat/evaluations/${encodeURIComponent(id)}/dismiss`,
    { method: "POST" },
  );

/** One of the three agents and the persona it speaks with. */
export interface AgentPersona {
  agent: AgentKey;
  name: string;
  /** One-line main task (fixed). */
  task: string;
  /** What this seat does when the rules-first pipeline is selected. */
  inRules: string;
  model: string;
  /** The persona prompt in force. */
  prompt: string;
  /** True while nobody has edited it. */
  isDefault: boolean;
  updatedAt: string | null;
}

export const listAgents = () =>
  api<{ agents: AgentPersona[] }>("/api/chat/agents");

/** Owner only. */
export const saveAgentPrompt = (agent: AgentKey, prompt: string) =>
  api<{ agent: AgentPersona }>(
    `/api/chat/agents/${encodeURIComponent(agent)}`,
    { method: "PUT", body: { prompt } },
  );

/** Owner only. Back to the shipped persona. */
export const resetAgentPrompt = (agent: AgentKey) =>
  api<{ agent: AgentPersona }>(
    `/api/chat/agents/${encodeURIComponent(agent)}/reset`,
    { method: "POST" },
  );

/**
 * What answers, read-only since 2026-10-21 (owner: "keep it a single agent …
 * the user cannot choose / determine the lead"): `v1`, the one agent, when the
 * server has a credential; `rules` without one.
 */
export interface ChatSettings {
  pipeline: "rules" | "v1" | "v2";
  /** 0–100, fixed: the bot's score from which a thread is a lead. */
  leadThreshold: number;
}

export const getChatSettings = () => api<ChatSettings>("/api/chat/settings");

export interface SimulationStep {
  agent: AgentKey;
  model: string;
  tool: string | null;
  ok: boolean;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SimulationResult {
  reply: string;
  handoff: null | { topic: string; summary: string };
  /** Photo ids the reply would attach. */
  photos: string[];
  router: {
    language: string;
    tone: string;
    intent: string;
    leadScore: number;
    escalate: string | null;
  };
  steps: SimulationStep[];
  /** USD × 1e6. */
  costMicros: number;
  latencyMs: number;
  pipeline: ChatSettings["pipeline"];
  /** Serials this reply showed — sent back as `lastShown` next turn. */
  shown: string[];
  /** False: answered by rules and templates alone. */
  usedAi: boolean;
}

/**
 * A dry run of the bot on a made-up conversation: reads the POS, books
 * nothing, sends nothing, writes nothing. 503 when no Anthropic credential.
 */
export const simulate = (turns: AgentTurn[], lastShown: string[] = []) =>
  api<SimulationResult>("/api/chat/simulate", {
    method: "POST",
    body: { turns, ...(lastShown.length ? { lastShown } : {}) },
  });

/**
 * The chatbot's funnel for one window (2026-10-27): chats → leads → visits
 * booked → closing tasks → sales. Counts only; any staff may read it.
 */
export interface FunnelWindow {
  days: number;
  since: string;
  chats: number;
  leads: number;
  visits: number;
  closing: number;
  sales: number;
}

export const getFunnel = () =>
  api<{ windows: FunnelWindow[] }>("/api/chat/funnel");

export type FunnelStageKey = "chats" | "leads" | "visits" | "closing" | "sales";

/** One account behind a funnel number (2026-10-28). */
export interface FunnelPerson {
  /** The thread's wa_id — what the Chat tab opens. */
  phone: string;
  name: string | null;
  /** When it reached the stage. */
  at: string;
  lastText: string | null;
}

/** Who is behind one stage of the funnel, newest first. */
export const getFunnelPeople = (stage: FunnelStageKey, days: number) =>
  api<{ people: FunnelPerson[] }>(`/api/chat/funnel/${stage}?days=${days}`);

/**
 * Why the bot handed over in the last 7 days (2026-10-27, owner: *"it
 * escalates too much"*): per topic and per what forced it, with the newest
 * few examples. Any staff may read it.
 */
export interface HandoverReason {
  topic: string;
  /** `route`, a refused draft's code, `no_terminal_tool`, `no_reply` — or `bot`. */
  reason: string;
  count: number;
  examples: Array<{
    phone: string;
    text: string | null;
    summary: string | null;
    at: string;
  }>;
}

export const getHandovers = () =>
  api<{ days: number; total: number; reasons: HandoverReason[] }>(
    "/api/chat/handovers",
  );
