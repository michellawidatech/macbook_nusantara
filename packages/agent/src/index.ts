// @nusantara/agent — the shop's chat agent.
//
// Shared rather than app-local because two callers need it: apps/api drafts a
// reply when a staff member presses Draft on the Chat page, and apps/worker
// answers an unattended message. Both want the same grounding tools and the
// same prompt, and a second copy of either would drift.
//
// This package may touch Prisma and the Anthropic SDK. It is packages/domain
// that must stay free of them (CLAUDE.md).

export {
  anthropicClient,
  hasCredential,
  readAnthropicEnv,
  usingOAuth,
  type AnthropicEnv,
} from "./anthropic.js";
export {
  MAX_CORRECTIONS,
  buildAgentPrompt,
  buildSystemPrompt,
  type AgentPrompt,
  type AgentPromptInput,
  type CorrectionExample,
  type KnowledgeEntry,
  type PromptInput,
} from "./prompt.js";
export {
  ANTHROPIC_TOOLS,
  CUSTOMER_TOOLS,
  MAX_BOOKING_DAYS,
  READ_TOOLS,
  TERMINAL_TOOLS,
  STORE_HOURS,
  WRITE_TOOLS,
  dispatchTool,
  jakartaDate,
  jakartaTime,
  jakartaWeekday,
  parseJakarta,
  phoneForms,
  storeOpenAt,
  toE164,
  toolJson,
  toolsFor,
  type ToolContext,
} from "./tools.js";
export {
  BASE_WAIT_MS,
  DEFAULT_WAITS,
  FILLER_FACTOR,
  MAX_WAIT_MS,
  MIN_WAIT_MS,
  classifyWait,
  computeWaitMs,
  type WaitDecision,
  type WaitProfile,
  type WaitReason,
} from "./debounce.js";
export {
  MAX_EMOJI,
  MAX_REPLY_EMOJI,
  detectLanguage,
  hasForbiddenFormatting,
  sanitiseReply,
  stripFormatting,
  type Language,
} from "./sanitise.js";
export {
  AGENT_MODEL,
  MAX_STEPS,
  MAX_TOKENS,
  TEMPERATURE,
  converse,
  type AgentClient,
  type CreateArgs,
  type ConverseHandoff,
  type ConverseInput,
  type ConverseResult,
  type ConverseTurn,
} from "./converse.js";
export {
  MATCHES_WHEN_PARTIAL,
  PROMPT_BUDGET_CHARS,
  knowledgeBase,
  knowledgeBlock,
  loadKnowledgeBase,
  matchesFor,
  matchesNote,
  type ApprovedAnswer,
  type KnowledgeBase,
} from "./knowledge.js";
export {
  STRONG_COVERAGE,
  STRONG_MATCH,
  indexKnowledge,
  isStrongMatch,
  searchWords,
  type KnowledgeDoc,
  type KnowledgeIndex,
  type RankedDoc,
} from "./retrieval.js";
export {
  HANDOFF_TOPICS,
  MAX_REPLY_CHARS,
  checkHoldingMessage,
  checkReply,
  holdingMessage,
  isHandoffTopic,
  mentionsProduct,
  routeMessage,
  type HandoffTopic,
  type ReplyProblem,
  type Route,
} from "./policy.js";
export {
  loadStoreFacts,
  lookupCatalog,
  renderStoreFacts,
  type StoreFacts,
} from "./systemFacts.js";
export { DEFAULT_PERSONA } from "./persona.js";
export {
  emptyThreadMemory,
  loadThreadMemory,
  markSummaryAttempt,
  saveSummary,
  type SummaryUpdate,
  type ThreadMemory,
} from "./memory.js";
export {
  SUMMARY_EVERY_TURNS,
  SUMMARY_INPUT_LIMIT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_MODEL,
  SUMMARY_NOTHING,
  SUMMARY_SYSTEM,
  renderTranscript,
  summarize,
  type SummarizeInput,
  type SummaryTurn,
} from "./summarize.js";
