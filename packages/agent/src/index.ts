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
  buildSystemPrompt,
  type CorrectionExample,
  type KnowledgeEntry,
  type PromptInput,
} from "./prompt.js";
export { ANTHROPIC_TOOLS, dispatchTool } from "./tools.js";
export {
  AGENT_MODEL,
  MAX_STEPS,
  MAX_TOKENS,
  converse,
  type ConverseInput,
  type ConverseResult,
  type ConverseTurn,
} from "./converse.js";
export { DEFAULT_PERSONA } from "./persona.js";
