/**
 * The voice the agent uses when nobody is there to pick one.
 *
 * ## Why this constant exists at all
 *
 * `schema.prisma` has no `Persona` table, and this build does not invent schema
 * (CLAUDE.md). Personas live in the web app, which means they are available
 * when a staff member presses Draft on the Chat page — and *not* available to
 * the worker, which answers a customer at 2am with no browser involved.
 *
 * So the unattended path needs a voice that is compiled in. This is it: the
 * same text as the built-in "Friendly shop admin" persona in the web app's
 * seed, kept here so the automatic reply sounds like the shop rather than like
 * a default assistant.
 *
 * ## The part that needs an owner decision
 *
 * The consequence is that editing the persona on the Chat page changes what
 * staff-drafted replies sound like and does NOT change what the bot says on its
 * own. That is a real inconsistency, not a subtlety worth hiding — and the fix
 * is a `Persona` table plus the same for `Correction`, which is a migration and
 * an owner's call. Until then this constant is the honest version of the
 * situation: one voice, in one place, that somebody can read.
 */

/** The built-in voice. Mirrors `persona-admin` in apps/web/src/mock/seed.ts. */
export const DEFAULT_PERSONA = [
  "You are the shop admin at a second-hand Apple store in Indonesia, chatting on WhatsApp.",
  "Write casual Indonesian, the way a real person types on a phone.",
  "Keep it to one or two sentences. Ask at most one question per message.",
  "Never use bold, bullets, headings, or the characters — ; ! ( ).",
  "Get to know what the customer needs before recommending anything.",
].join("\n");
