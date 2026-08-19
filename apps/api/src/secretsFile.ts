/**
 * Reading the agent credential out of the shared secrets file.
 *
 * The shop configures one Anthropic token, in one place. Before this, the
 * worker read it from `secrets/webhook-credentials.env` and the API read only
 * `process.env` — so a correctly configured shop saw the bot answer customers
 * on its own while the Chat page insisted "the bot is switched off" and left
 * "Write it for me" greyed out. One token, two processes, two different answers
 * about whether it exists.
 *
 * ## Why the allow-list is two keys and not eleven
 *
 * The same rule the webhook and the worker follow: an env file may only
 * contribute the keys the process reading it actually needs. That file also
 * carries a `DATABASE_URL` pointing at the PREVIOUS build's live database,
 * which this build must never write to (CLAUDE.md), and it carries `APP_SECRET`
 * — the HMAC key for verifying inbound webhooks, which the API has no business
 * holding. Neither can be smuggled in by editing the file, which is the point.
 *
 * The API drafts replies, and since Auth0 it is also the confidential OIDC
 * client. It needs those two credentials and nothing else. `DATABASE_URL` and
 * `APP_SECRET` stay excluded whatever that file happens to contain.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH0_ENV_KEYS } from "./auth/auth0.js";

/** The only keys the API will accept from a secrets file. */
export const API_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  ...AUTH0_ENV_KEYS,
] as const;

/**
 * Where the credentials live when nobody says otherwise.
 *
 * Resolved from this file, never from `process.cwd()`: `pnpm --filter` runs
 * with the cwd set to the app directory, so a relative path silently resolves
 * to `apps/api/secrets/...`, finds nothing, and the server comes up reporting
 * that the agent is switched off. That mistake has already cost an afternoon
 * in this repo; resolving from `import.meta.url` makes it unrepeatable.
 */
export function defaultSecretsFile(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // apps/api/src
  return join(here, "..", "..", "..", "secrets", "webhook-credentials.env");
}

/**
 * Read the allowed keys out of an env file.
 *
 * A missing or unreadable file is not an error — the shell is a complete source
 * of configuration on its own, and the fail-closed tests depend on being able
 * to run where no secrets file exists.
 */
export function loadApiSecrets(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const allowed = new Set<string>(API_ENV_KEYS);
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!allowed.has(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, the way every dotenv loader does.
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      if (value.at(-1) === value[0]) value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
