/**
 * Anthropic credential resolution for the agent.
 *
 * The agent runs whenever *any* Anthropic credential is present — not only a
 * static `ANTHROPIC_API_KEY`. The SDK also resolves an OAuth bearer token from
 * `ANTHROPIC_AUTH_TOKEN` (e.g. from `claude setup-token` / `ant auth login` —
 * the same OAuth login Claude Code uses). This lets the store run the bot on a
 * subscription/OAuth login instead of a metered API key.
 *
 * Trade-offs when using an OAuth token instead of an API key: tokens expire and
 * must be refreshed (a static key doesn't), rate limits are geared to
 * interactive use, and a personal Claude subscription is licensed for
 * interactive use — check your plan's terms before pointing an automated
 * customer-facing backend at it. Configure whichever credential fits.
 */

import Anthropic from "@anthropic-ai/sdk";

/** OAuth calls to /v1/messages require this beta header; API-key calls don't. */
const OAUTH_BETA = "oauth-2025-04-20";

/** True when the SDK will find a credential — an API key or an OAuth token. */
export function hasAnthropicCredential(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Are we authenticating with an OAuth token rather than a static API key? */
export function usingOAuth(): boolean {
  return !process.env.ANTHROPIC_API_KEY && Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Build an Anthropic client. The SDK reads the credential from the environment
 * (`ANTHROPIC_API_KEY`, else `ANTHROPIC_AUTH_TOKEN`); when it's an OAuth token
 * we add the required `oauth-2025-04-20` beta header so /v1/messages accepts it.
 */
export function anthropicClient(): Anthropic {
  return new Anthropic(usingOAuth() ? { defaultHeaders: { "anthropic-beta": OAUTH_BETA } } : {});
}
