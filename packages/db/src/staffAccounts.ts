/**
 * Staff login accounts — the conventions every writer of a `Staff` row shares.
 *
 * Since 2026-09-18 the app signs people in itself (Auth0 is gone). What a
 * password may be, and the shop's initial one, are pure rules and live in
 * `@nusantara/domain` (`credentials.ts`), where the SPA's form reads them too.
 * What lives here is what only a database writer needs to know.
 */

/**
 * A syntactically valid Argon2id hash of nothing anyone knows.
 *
 * Written on accounts nobody may sign in as: the chat agent's principal, the
 * history's system row, the B2Soft import's author. Before 2026-09-18 the seed
 * wrote it on every human account too, so a human account still carrying it
 * has never had a password at all — which is how `apps/api`'s account seeder
 * tells "give this one the initial password" from "somebody already chose".
 */
export const UNUSABLE_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c2VlZGVkbm9sb2dpbnNhbHQ$Zm9yY2VkdG9mYWlsdmVyaWZpY2F0aW9u";

/**
 * Accounts that are principals, not people. `UnitEvent.staffId` is NOT NULL,
 * so the bot and the migrated history each need a row — but nobody signs in as
 * one, and the owner's account screen must never offer to reset one: a
 * password on the agent's row would be a login carrying the agent's authority.
 */
export const SERVICE_ACCOUNT_USERNAMES: readonly string[] = [
  "agent",
  "system",
  "migrasi-b2soft",
];

export function isServiceAccount(username: string): boolean {
  return SERVICE_ACCOUNT_USERNAMES.includes(username);
}
