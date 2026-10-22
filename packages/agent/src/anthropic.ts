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
 * ## A Console login (`ant auth login`), 2026-10-22
 *
 * The owner's choice for production: no key to copy, billed to the Console
 * organisation like a key, and the SDK refreshes the token by itself. `ant
 * auth login`, run once as the service's user, writes a PROFILE under
 * `$ANTHROPIC_CONFIG_DIR` (else `$XDG_CONFIG_HOME/anthropic`, else
 * `$HOME/.config/anthropic`); the client is then built with `{ profile }`,
 * which the SDK keeps from being shadowed by a stray `ANTHROPIC_API_KEY`.
 * A key or token in the environment still wins when one is set — the order
 * the SDK itself uses.
 *
 * A `claude setup-token` token (`ANTHROPIC_AUTH_TOKEN`) is still read, and is
 * what the owner runs on (2026-10-22). It answers on Haiku 4.5 and not on
 * Haiku 5.5, so it defaults to `OAUTH_MODEL`.
 *
 * Ported deliberately from `reference/whatsapp-webhook/agent/anthropic.ts`
 * rather than imported: `reference/` is the previous build and is never a
 * dependency of this one (see CLAUDE.md).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/** OAuth calls to /v1/messages require this beta header; API-key calls don't. */
const OAUTH_BETA = "oauth-2025-04-20";

export interface AnthropicEnv {
  readonly apiKey?: string | undefined;
  readonly authToken?: string | undefined;
  /**
   * `CHATBOT_MODEL` — the chat agent's model, when it is not `AGENT_MODEL`
   * (converse.ts). An environment override so the owner can move the bot to
   * another model, or back, without a release. Unset is the default.
   */
  readonly model?: string | undefined;
  /** `CHATBOT_SUMMARY_MODEL` — the summariser's, likewise (`SUMMARY_MODEL`). */
  readonly summaryModel?: string | undefined;
  /**
   * An `ant auth login` profile found on disk, used only when no key or
   * token is set. See "A Console login" above.
   */
  readonly profile?: string | undefined;
}

/**
 * The model an OAuth token (`ANTHROPIC_AUTH_TOKEN`, `claude setup-token`) runs
 * on unless `CHATBOT_MODEL` / `CHATBOT_SUMMARY_MODEL` say otherwise. Probed
 * 2026-10-22 with the shop's token: `claude-haiku-4-5` answers, and
 * `claude-haiku-5-5` — `AGENT_MODEL` since that morning — is a 429 on every
 * call, a one-word "halo" included. The owner runs the bot on that token only.
 */
export const OAUTH_MODEL = "claude-haiku-4-5";

/** What the env templates ship with; never a credential. */
const PLACEHOLDER = "CHANGE_ME";

const credential = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t && t !== PLACEHOLDER ? t : undefined;
};

/**
 * The `ant auth login` profile this environment would use, if one exists —
 * the SDK's own resolution, read from the PASSED environment (never
 * `process.env`), so a test without `HOME` never finds a developer's login.
 */
export function antProfileOf(
  env: Record<string, string | undefined>,
): string | undefined {
  const dir =
    env["ANTHROPIC_CONFIG_DIR"]?.trim() ||
    (env["XDG_CONFIG_HOME"]?.trim()
      ? join(env["XDG_CONFIG_HOME"].trim(), "anthropic")
      : env["HOME"]?.trim()
        ? join(env["HOME"].trim(), ".config", "anthropic")
        : undefined);
  if (dir === undefined) return undefined;
  let name = env["ANTHROPIC_PROFILE"]?.trim();
  if (!name) {
    try {
      name = readFileSync(join(dir, "active_config"), "utf8").trim();
    } catch {
      name = "";
    }
  }
  if (!name) name = "default";
  // The SDK refuses anything else as a profile name; so do we.
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return undefined;
  return existsSync(join(dir, "configs", `${name}.json`)) ? name : undefined;
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
  const apiKey = credential(env["ANTHROPIC_API_KEY"]);
  const authToken = credential(env["ANTHROPIC_AUTH_TOKEN"]);
  const oauthDefault = !apiKey && authToken ? OAUTH_MODEL : undefined;
  return {
    apiKey,
    authToken,
    model: env["CHATBOT_MODEL"]?.trim() || oauthDefault,
    summaryModel: env["CHATBOT_SUMMARY_MODEL"]?.trim() || oauthDefault,
    profile: apiKey || authToken ? undefined : antProfileOf(env),
  };
}

/** True when there is something to authenticate with. */
export function hasCredential(env: AnthropicEnv): boolean {
  return Boolean(env.apiKey || env.authToken || env.profile);
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
  // A Console login: the SDK reads the profile and refreshes its token.
  if (!env.apiKey && !env.authToken && env.profile) {
    return new Anthropic({ profile: env.profile });
  }
  return new Anthropic({
    ...(env.apiKey ? { apiKey: env.apiKey } : { authToken: env.authToken }),
    ...(usingOAuth(env)
      ? { defaultHeaders: { "anthropic-beta": OAUTH_BETA } }
      : {}),
  });
}
