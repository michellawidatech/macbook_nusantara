/**
 * Anthropic credential resolution for the shop's chat agent.
 *
 * The agent runs on *any* Anthropic credential, not only a metered API key.
 * The SDK also picks up an OAuth bearer token from `ANTHROPIC_AUTH_TOKEN` —
 * the same login Claude Code uses, produced by `claude setup-token`. That lets
 * the shop run the bot on a Claude subscription instead of pay-per-token.
 *
 * The trade-offs of the OAuth route, so nobody is surprised later: those tokens
 * expire and have to be refreshed (a static key does not), the rate limits are
 * shaped for interactive use rather than a server, and a personal subscription
 * is licensed for interactive use — check the plan's terms before pointing a
 * customer-facing backend at it. For anything beyond testing, an API key is the
 * supported configuration.
 *
 * Ported deliberately from `reference/whatsapp-webhook/agent/anthropic.ts`
 * rather than imported: `reference/` is the previous build and is never a
 * dependency of this one (see CLAUDE.md).
 */

import Anthropic from "@anthropic-ai/sdk";

/** OAuth calls to /v1/messages require this beta header; API-key calls don't. */
const OAUTH_BETA = "oauth-2025-04-20";

export interface AnthropicEnv {
  readonly apiKey?: string | undefined;
  readonly authToken?: string | undefined;
}

/**
 * Read the credential out of an explicitly passed environment.
 *
 * Never `process.env` at module scope — 01 §7. A fail-closed test has to be
 * able to prove the agent stays dormant without a credential, and it cannot do
 * that if the module has already read the developer's shell.
 */
export function readAnthropicEnv(
  env: Record<string, string | undefined>,
): AnthropicEnv {
  return {
    apiKey: env["ANTHROPIC_API_KEY"]?.trim() || undefined,
    authToken: env["ANTHROPIC_AUTH_TOKEN"]?.trim() || undefined,
  };
}

/** True when there is something to authenticate with. */
export function hasCredential(env: AnthropicEnv): boolean {
  return Boolean(env.apiKey || env.authToken);
}

/** Are we on an OAuth token rather than a static API key? */
export function usingOAuth(env: AnthropicEnv): boolean {
  return !env.apiKey && Boolean(env.authToken);
}

/**
 * Build a client for the given credential, or `null` when there is none.
 *
 * Returning null rather than throwing is the whole fail-soft contract: a shop
 * with no key still gets a working inbox where staff answer by hand, and the
 * chat page says why the bot is quiet instead of showing an error.
 */
export function anthropicClient(env: AnthropicEnv): Anthropic | null {
  if (!hasCredential(env)) return null;
  return new Anthropic({
    ...(env.apiKey ? { apiKey: env.apiKey } : { authToken: env.authToken }),
    ...(usingOAuth(env)
      ? { defaultHeaders: { "anthropic-beta": OAUTH_BETA } }
      : {}),
  });
}
