# Nusantara POS

Point-of-sale for a second-hand Apple device shop in Indonesia, with a WhatsApp +
Instagram chatbot. Rebuild of an earlier Next.js build. Staff-facing, ~3 users,
Indonesian UI.

## The one rule

The **serial number** is the subject of this database. Every state change of a
unit is an append-only `UnitEvent` row. `Unit.status` and `Unit.locationId` are
projections written in the SAME transaction as the event. Nothing is ever
hard-deleted.

## The plan is the contract

`docs/rebuild/` is authoritative. Read the section a task names before starting:

- `README.md` — scope and the increment ladder
- `01-conventions.md` — stack, layout, naming, API contract
- `02-interaction.md` — the interaction standard every screen must pass (§16 is the checklist)
- `03-pages-and-features.md` — every screen, its tables, its endpoints
- `04-increments.md` — build order and Definition of Done per increment
- `05-logging.md` — logging layers, sink, correlation
- `06-webhook-integration.md` — chatbot webhook setup and contract
- `07-credentials.md` — every key; §0 has this project's concrete values
- `08-data-integrity.md` — ACID, invariants, transactions, migration, security
- `09-bootstrap-prompts.md` — build order for the skeleton

The ERD (`docs/erd-pos-chatbot.drawio`) was deleted 2026-08-15 by owner
decision — **`packages/db/prisma/schema.prisma` is now the source of truth.**
Same date, superseding the docs where they disagree: UI is antd 6 styled after
`~/claudeproject/xinchuan-cms/frontend` (packages/ui kit shelved), copy is
English-first, and the nav is Stock / Return / Product / Finance / Chatbot /
Customer / Settings.

## Reference code — read only, never imported

`reference/` holds source from the previous build, carried over because it is
worth copying deliberately rather than reinventing. It is NOT part of this
build: never import from it, never add it to a workspace, never let a path
resolve into it.

- `reference/whatsapp-webhook/` — the webhook receiver. `app.ts` is the
  fail-closed contract (503 with no APP_SECRET, 401 on bad signature, ack before
  processing), `signature.ts` is raw-bytes HMAC with constant-time compare,
  `persist.ts` dedups via a unique constraint rather than a pre-check.
- `reference/redact.ts` — the log redaction rules to carry forward.

## Non-negotiables

- **Never invent schema.** Column names come from the ERD. If something is
  missing, stop and ask — do not add a field.
- **No JSON columns** except: `WaRawEvent.payload`, `IgRawEvent.payload`,
  `WaMessage.entities`, `AgentCache.value`, `AppleDbCache.models`,
  `Outbox.payload` (a send intent's shape varies by `OutboxKind`). Everything
  else gets a table.
- **No loose string links.** Every relation is a declared FK with an explicit
  `onDelete`.
- **Money is `BigInt` whole rupiah**, serialized as a JSON string. Never `number`,
  never `parseFloat`.
- **Every unit state change is a transaction** that writes the event and the
  projection together. See `08-data-integrity.md` §3.
- **No network I/O inside a database transaction.** Write an `Outbox` row; the
  worker sends.
- `packages/domain` imports neither Prisma, Express nor React.

## Commands

- `pnpm dev` — all apps
- `pnpm -r test` — everything
- `pnpm -r typecheck` — types
- `pnpm --filter @nusantara/db migrate` — apply migrations
- `printf '%s' '<password>' | pnpm --filter @nusantara/api staff --username <u> --name '<n>' --role OWNER`
  — create a staff login, or reset one. The seed writes an unusable hash for
  every account, so this is the only way into a fresh database. Password on
  stdin, never argv.
- Ports: web 3000, api 4000, webhook 3001, monitor 4100
- Database: `nusantara_pos_rebuild` on `localhost:5432`, role `nusantara`
- Meta: App ID `2157052578394015`, WABA `1701973881546032`,
  `PHONE_NUMBER_ID` `1200651716467039`, Graph **v25.0** (one constant, both
  channels — never two env fallbacks)

## Gotchas that have already cost time

- `prisma migrate status` **lies** in this project — a recorded-but-unapplied
  migration reports clean while the table is missing. Verify with a real query.
- `nusantara_pos_app` is the **previous build's** database and is still live and
  being written to. Never migrate, reset or drop it — the rebuild targets
  `nusantara_pos_rebuild` (08 §8 keeps the old one read-only for a quarter).
- Neighbouring projects squat on :3000 and :4000. A "missing route" is usually
  the wrong server answering. Probe the port before debugging the router.
- Never call a toast inside a React state updater or during render.
- `BigInt` does not survive `JSON.stringify` — serialize money as a string.
- In raw SQL, Prisma stores `DateTime` as `timestamp` **without** time zone
  (holding UTC) but binds a JS `Date` as `timestamptz`. A bare `::timestamp`
  cast renders it as Asia/Jakarta wall clock — a silent 7-hour shift. Write
  `(${d}::timestamptz AT TIME ZONE 'UTC')`; convert the parameter, never the
  column, so the index still applies.
- Fail-closed webhook tests must NOT read a developer `.env`. Inject config.
- Secrets live in `secrets/webhook-credentials.env` (gitignored, 600). Never
  print one, never commit one, never put one in a doc.