# Bootstrap — what to build first, and how to prompt for it

You are starting in an empty folder with an AI coding agent. This document is the
order of operations and the actual prompts.

---

## 1. Library, back end or front end first?

**None of those.** That framing is the trap, because all three are downstream of
something else.

The build order is:

```
tooling  →  SCHEMA  →  domain logic  →  db helpers  →  logging
         →  API + auth  →  one real screen  →  THEN the component library
```

The reasoning, which is specific to working with an AI agent:

- **Schema first, always.** An agent generates plausible code against whatever
  contract is in front of it. If the schema is still moving, every session
  invents slightly different column names, and by session five you are
  reconciling four versions of `Unit` that no single file agrees on. A frozen
  schema turns every later prompt from "design this" into "implement this
  against that", which is the difference between review and rewrite.
- **Domain logic second.** `packages/domain` is pure — no Prisma, no Express, no
  React. It is the highest-value code to get right and the cheapest to test, so
  it is where you spend your careful review attention while the agent is still
  learning the project's shape.
- **The component library comes *after* the first real screen, not before.** This
  is the one that surprises people. Building `DataTable` in a vacuum produces a
  generic table with the wrong affordances — exactly how the current build ended
  up with single-select filters and three-line row wrapping. Build one honest
  screen first (Inventori, read-only), feel what it actually needs, *then*
  extract the kit in Increment 1 with real requirements in hand.
- **Front end last in the skeleton, first in the increments.** Once the kit
  exists, screens are cheap and the ratio flips.

**One thing runs in parallel from day one:** start Instagram App Review. It takes
days of calendar time and gates Increment 7. It is not a coding task, so it costs
you nothing to have it pending.

---

## 2. The bootstrap ladder

Ten agent sessions to a walking skeleton. Each is one prompt, one commit, one
verification. **Do not chain two sessions into one prompt** — the failure mode is
an agent that reports success on step 4 having quietly broken step 2.

| # | Session | Produces | Verify by |
|---|---|---|---|
| S0 | Repo skeleton | pnpm workspace, TS config, lint, Vitest, empty apps/packages | `pnpm -r test` runs and passes with zero tests |
| S1 | **Schema** | `schema.prisma`, 62 tables, 34 enums, all FKs | `prisma migrate deploy` on an empty DB, then a real query |
| S2 | Constraints | Hand-written SQL migration: CHECKs, partial uniques, grants | A test per invariant that provokes it |
| S3 | Domain | `unitState.ts`, money, fee allocation, reconciliation checks | `pnpm --filter @nusantara/domain test`, 100% branches |
| S4 | DB helpers | `withRetry`, `withUnitLocks`, outbox claim | Deadlock + retry tests against real Postgres |
| S5 | Logging | pino → NDJSON, redaction, request id | Redaction tests; a request produces one valid record |
| S6 | API + auth | Express, Zod, Argon2, `StaffSession`, idempotency, authz | Login/logout/revoke; replayed idempotency key |
| S7 | Seed | Locations, categories, models, SKUs, 5 000 units + events | Reconciliation checks pass on seeded data |
| S8 | Web shell | Vite, router, tokens, nav, login, error boundary | Login → shell renders, keyboard reachable |
| S9 | First screen | Inventori read-only, server-side filters | 5 000 units inside the latency budget |

S1–S2 together are Increment 0's core. After S9 you have a walking skeleton and
you switch to [04-increments.md](04-increments.md), starting at Increment 1.

---

## 3. Before the first prompt (already done)

The two paths, fixed for this project:

| | |
|---|---|
| **New project** | `/Users/michellaradika/claudeproject/macbook_nusantara` |
| **Old repo** (reference only) | `/Users/michellaradika/claudeproject/macnus_redo` |

This was completed on 2026-08-13. It is recorded here so it can be repeated on
another machine, and so you can re-verify it at any time.

**Order matters: the `.gitignore` must exist before the credential vault is
copied in.** The repo was already `git init`-ed with no `.gitignore`, which is
exactly the window in which a secret gets committed.

```bash
NEW=~/claudeproject/macbook_nusantara; OLD=~/claudeproject/macnus_redo
mkdir -p "$NEW/docs" "$NEW/secrets" "$NEW/reference"
cp -R "$OLD/docs/rebuild" "$NEW/docs/"
cp "$OLD/docs/erd-pos-chatbot.drawio" "$NEW/docs/"
cp "$OLD/secrets/webhook-credentials.env" "$OLD/secrets/webhook-credentials.env.example" "$NEW/secrets/"
chmod 600 "$NEW/secrets/webhook-credentials.env"
cp -R "$OLD/apps/whatsapp-webhook/src" "$NEW/reference/whatsapp-webhook"
cp "$OLD/packages/logging/src/redact.ts" "$NEW/reference/redact.ts"
```

`reference/` holds the two pieces of the old build worth carrying over intact:
the webhook's fail-closed contract and the redaction rules. **The agent reads
them; it never imports them.** Nothing in `reference/` is part of the build.

### Verify before writing a line of code

```bash
cd ~/claudeproject/macbook_nusantara && git check-ignore -v secrets/webhook-credentials.env && git add -An --dry-run . | grep -c 'webhook-credentials.env$'
```

The first command must print a `.gitignore` match. The second must print `0` —
that is git telling you the vault is not stageable. If it prints `1`, stop and
fix `.gitignore` before doing anything else.

The `.gitignore` in place (note the `!*.env.example` negation, so the documented
template stays committable while every real `.env` does not):

```gitignore
*.env
.env*.local
!*.env.example
node_modules/
.pnpm-store/
dist/ build/ out/ .turbo/ coverage/
*.tsbuildinfo
packages/db/generated/
.DS_Store
```

### Resulting layout

```
macbook_nusantara/
  .gitignore
  CLAUDE.md                          created — see §4
  docs/
    erd-pos-chatbot.drawio           the schema contract
    rebuild/                         README + 01…09
  reference/                         READ ONLY, never imported
    whatsapp-webhook/                the old webhook src
    redact.ts                        the old redaction rules
  secrets/
    webhook-credentials.env          gitignored, chmod 600
    webhook-credentials.env.example  committed template
```

---

## 4. `CLAUDE.md` (already created)

At `~/claudeproject/macbook_nusantara/CLAUDE.md`. It is what makes every later
prompt short: the agent reads it automatically each session, so you stop
re-explaining the project. Reproduced here so the two stay in sync — **if you
change one, change the other.**

```markdown
# Macbook Nusantara

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

`docs/erd-pos-chatbot.drawio` is the ERD. If code and ERD disagree, the ERD wins
until a human changes it.

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
```

---

## 5. Prompt anatomy

Every prompt below has the same six parts. Copy the shape when you write your
own.

| Part | Why it matters |
|---|---|
| **1. Scope, in one sentence** | "Implement X and nothing else." Bounds the diff |
| **2. The authoritative section** | Name a *section*, not a document. "Read `08-data-integrity.md` §2" beats "read the plan" — it keeps context small and the reference unambiguous |
| **3. The exact deliverable** | List the files. "Add a table component" invites invention; "create `packages/ui/src/DataTable.tsx` exporting `DataTable`" does not |
| **4. Hard constraints** | What it must not decide alone. This is where you pre-empt the failure you already know about |
| **5. Definition of done** | The command that must pass. Not "make it work" — `pnpm --filter @nusantara/domain test` |
| **6. Stop condition** | "Do not build the API, the UI, or the seed script in this session." Agents are eager; scope creep is the default |

Two habits that matter more than the wording:

- **Ask for the test first** on anything with rules — domain logic, constraints,
  transactions. "Write the failing test, show me, then implement" catches a
  misunderstood requirement before it is buried in an implementation.
- **Never accept a claim you can check.** If it says migrations applied, run the
  query. If it says tests pass, run them. This project has already been burned by
  a status command that reported success.

---

## 6. The prompts

Start every session from the project root:

```bash
cd ~/claudeproject/macbook_nusantara
```

All paths in these prompts are relative to that directory. Copy each prompt
verbatim — the stop conditions at the end are load-bearing.

### S0 — Repo skeleton

> Set up an empty pnpm + Turborepo monorepo for this project and nothing else.
>
> Read `CLAUDE.md` and `docs/rebuild/01-conventions.md` §1–§2 first.
>
> `.gitignore`, `CLAUDE.md`, `docs/`, `reference/` and `secrets/` already exist
> and are correct. **Do not modify or delete any of them**, and do not add
> `reference/` to the pnpm workspace — it is read-only source from the previous
> build.
>
> Create: root `package.json` (pnpm workspaces, Turbo), `pnpm-workspace.yaml`,
> `tsconfig.base.json` (strict, ESM, Node 20 target), `turbo.json`, ESLint +
> Prettier, and Vitest configured at the root. Create empty placeholder packages
> for `apps/{api,web,whatsapp-webhook,worker,monitor}` and
> `packages/{db,domain,logging,whatsapp,instagram}` — each with a `package.json`
> and an `src/index.ts` that exports nothing.
>
> Constraints: ESM only, no CommonJS. Node ≥ 20. Scope the workspace to `apps/*`
> and `packages/*` only. Do not add any dependency that is not needed to run
> tests and typecheck.
>
> Done when `pnpm install`, `pnpm -r typecheck` and `pnpm -r test` all succeed,
> and `git status --short` shows no change to any pre-existing file.
>
> Do not implement any feature, schema or route in this session.

### S1 — Schema

> Write the complete Prisma schema for this project.
>
> The authority is `docs/erd-pos-chatbot.drawio` — 62 tables, 34 enums. Read it
> together with `docs/rebuild/08-data-integrity.md` §1 and §4, and
> `01-conventions.md` §6.
>
> Create `packages/db/prisma/schema.prisma`. Every relation is a real foreign key
> with an explicit `onDelete`. Use `BigInt` for money, `String` cuid for ids,
> `String` `YYYY-MM-DD` for calendar days. Add the `@@unique` and `@@index`
> declarations the ERD shows.
>
> Constraints: do not invent, rename or omit a single column. If the ERD is
> ambiguous, list the ambiguity and stop — do not guess. JSON is permitted only
> for the five columns named in `CLAUDE.md`.
>
> Done when `prisma migrate dev --name init` applies to an empty database AND a
> `SELECT` against `UnitEvent`, `Payment` and `Location` returns zero rows without
> error. Show me the output of that query, not of `migrate status`.
>
> Do not write constraints beyond what Prisma expresses, seed data, or any
> application code in this session.

### S2 — Constraints and grants

> Add the database constraints Prisma cannot express.
>
> Read `docs/rebuild/08-data-integrity.md` §2 — that table is the specification,
> all fifteen rows.
>
> Create a `--create-only` migration and hand-write the SQL: every `CHECK`, the
> partial unique index on `OrderItem` (one un-returned row per unit), and the
> role grants that give the application role `INSERT` but not `UPDATE`/`DELETE`
> on `AuditLog` and `UnitEvent`.
>
> Then write `packages/db/test/invariants.test.ts` with one test per invariant
> that **attempts the violation** against a real Postgres and asserts the
> Postgres error code.
>
> Constraints: tests run against a real database, never a mock. Do not weaken a
> constraint to make a test pass — if a constraint is wrong, tell me.
>
> Done when every one of the fifteen tests fails the write and passes the
> assertion, and a test proves the app role cannot `DELETE` from `AuditLog`.
>
> Do not implement domain logic or endpoints in this session.

### S3 — Domain

> Implement the pure domain layer.
>
> Read `docs/rebuild/08-data-integrity.md` §4 (the unit state machine) and §6 (the
> eight reconciliation checks), and `02-interaction.md` §9 (money rules).
>
> Create in `packages/domain/src/`: `unitState.ts` (legal transitions + a
> rejection that names the serial and its current status), `money.ts` (BigInt
> rupiah, parse `4200000` / `4.200.000` / `4,2jt` / `4200rb`, format
> `Rp 4.200.000`), `fees.ts` (allocate PO fees across lines with no rounding
> drift — the allocations must sum exactly to the fee total), and `checks.ts`
> (the eight reconciliation checks as pure functions over plain data).
>
> Write the tests first and show them to me before implementing.
>
> Constraints: no imports of Prisma, Express or React. No I/O. Every function
> total and deterministic.
>
> Done when `pnpm --filter @nusantara/domain test` passes with 100% branch
> coverage, including a fee-allocation case where the naive split leaves a
> remainder.
>
> Do not touch the database or the API in this session.

### S4 — Transaction helpers

> Implement the transaction primitives every write will use.
>
> Read `docs/rebuild/08-data-integrity.md` §3 and §5.
>
> Create in `packages/db/src/`: `withRetry` (serializable isolation, retry on
> Postgres 40001 with capped exponential backoff), `withUnitLocks` (takes serials,
> locks the rows `FOR UPDATE` **in ascending serial order**, returns the units),
> `appendUnitEvent` (assigns `seq` as `MAX(seq)+1` under the unit's lock and
> writes the projection in the same transaction), and the outbox claim
> (`UPDATE … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`).
>
> Constraints: `maxWait 5s, timeout 10s`. No network I/O inside any transaction.
> Ordered locking is the deadlock fix — do not substitute a retry loop for it.
>
> Done when a test running two concurrent transactions that lock the same two
> serials in opposite order completes without deadlock, and a test proves `seq` is
> gapless under concurrent appends to one unit.
>
> Do not build the worker process or any endpoint in this session.

### S5 — Logging

> Implement the logging package.
>
> Read `docs/rebuild/05-logging.md` §2, §3 and §6 in full.
>
> Create in `packages/logging/src/`: pino configured to emit the exact NDJSON
> record shape in §2, `requestLogger()` middleware that assigns a ULID request id
> and logs route **patterns** not filled paths, `redact.ts` implementing §6, and
> `AsyncLocalStorage` propagation of the request id.
>
> `reference/redact.ts` is the old build's implementation — carry its rules over
> and add phone-number masking. Read it; do not import it.
>
> Constraints: NDJSON to stdout only. Nothing writes a log to Postgres. Logging
> must never throw into the request path.
>
> Done when the redaction tests cover every header rule, every body key and phone
> masking, and a fixture of a real Meta webhook payload emerges with no
> `x-hub-signature-256` and no message text.
>
> Do not wire this into an app in this session.

### S6 — API and auth

> Build the API skeleton with authentication and authorisation.
>
> Read `docs/rebuild/01-conventions.md` §4 and `08-data-integrity.md` §9.
>
> Create in `apps/api/src/`: Express with the logging middleware, Zod validation,
> `/api/health`, `/api/auth/{login,logout,me,sessions}`, `requireAuth` and
> `requireOwner`, Argon2id hashing, `StaffSession` with the token stored **hashed**
> and the raw value only in an HttpOnly SameSite=Lax Secure cookie, and
> `Idempotency-Key` middleware that stores and replays responses.
>
> Constraints: authorisation is checked server-side per endpoint. Errors return
> `{ error: { code, message, field? } }` with `message` in Indonesian. Money
> serializes as a string. Rate-limit login per username and per IP; every failure
> writes `AuditLog(action = LOGIN_GAGAL)`.
>
> Done when Supertest covers: login success, wrong password, rate limit, logout,
> revoke-one, revoke-all, an owner-only route rejecting a STAFF token, and a
> replayed `Idempotency-Key` returning the stored response without a second write.
>
> Do not build business endpoints or any UI in this session.

### S7 — Seed

> Write a seed script producing realistic data.
>
> Create `packages/db/src/seed.ts`: 3 locations, 5 categories with their
> attributes and variant axes, ~40 catalog models, ~300 SKUs, **5 000 units each
> with a coherent `UnitEvent` history** (arrival, some transfers, some sold with
> orders and payments, a few claims), 2 staff (one OWNER, one STAFF), and a
> `system` staff row for backfilled events.
>
> Constraints: every unit's `status` and `locationId` must equal its latest
> event's `toStatus`/`toLocationId`. Use the S4 helpers — do not write events
> directly. Idempotent: re-running resets cleanly.
>
> Done when the seed runs in under 60 seconds and all eight reconciliation checks
> from `packages/domain/src/checks.ts` pass against the seeded database.
>
> Do not build UI in this session.

### S8 — Web shell

> Build the SPA shell and login.
>
> Read `docs/rebuild/01-conventions.md` §5 and `02-interaction.md` §3 and §12.
>
> Create `apps/web`: Vite + React 19 + TypeScript, React Router, TanStack Query,
> `tokens.css` (colour, spacing, radius, type scale, elevation), the app shell
> (section nav, account menu, ID/EN toggle, error boundary), and the login screen.
>
> Constraints: no component library — headless only. No component hardcodes a hex
> value; everything reads a token. Every interactive element has a visible focus
> ring. The shell renders before data arrives. A failed login names the reason and
> keeps the username.
>
> Done when login → shell works, the whole shell is keyboard reachable in visual
> order, and a route change never blanks the shell.
>
> Do not build the interaction kit or any data screen in this session.

### S9 — First screen

> Build Inventori as a read-only screen — the walking skeleton's proof.
>
> Read `docs/rebuild/03-pages-and-features.md` (Inventori) and
> `02-interaction.md` §8.
>
> Create the route, `GET /api/katalog/inventori` with server-side filtering,
> sorting and pagination, and the table. Columns come from `CategoryAttribute` —
> **nothing hardcoded**. Filters are multi-select, rendered as removable chips,
> mirrored in the URL.
>
> Constraints: write this screen plainly, without extracting shared components.
> The kit is Increment 1 and it will be extracted from what this screen actually
> needs. Do not generalise early.
>
> Done when 5 000 seeded units render and filter within the budgets in
> `02-interaction.md` §1, a shared URL reproduces the exact view, and empty vs
> no-match states are distinguishable.
>
> Then stop. Increment 1 is the next session.

---

## 7. Rules for driving the agent

1. **One session, one prompt, one commit.** If you find yourself typing "and
   also", start a new session instead.
2. **Point at sections, not documents.** "Read `08` §3" keeps the agent's context
   on the relevant 400 words. "Read the plan" fills its context with 90 KB and
   makes it worse at the task.
3. **Test first for anything with rules.** Ask to see the failing test before the
   implementation.
4. **Verify every checkable claim yourself.** Especially migrations — run a real
   query, never trust `migrate status` in this project.
5. **Reject invented schema immediately.** If a column appears that is not in the
   ERD, stop the session and correct it. Do not let it survive one commit; every
   later file will copy it.
6. **When it says "I also fixed…", read that diff first.** Unrequested changes
   are where regressions live.
7. **Keep the ERD open.** You are the one who knows what the shop actually does.
   The agent is fast, not informed.
8. **Update `CLAUDE.md` when you correct the same thing twice.** A repeated
   correction is a missing instruction.

---

## 8. When it goes wrong

| Symptom | What it usually means | Move |
|---|---|---|
| Invented column names | Schema wasn't loaded, or the prompt named a document instead of a section | Restart the session pointing at the ERD and the exact table list |
| "Tests pass" but they don't | It ran a subset, or edited the test to match the code | Run the command yourself; ask which assertion changed and why |
| Enormous diff for a small ask | Missing stop condition | Revert, re-prompt with an explicit "do not touch" list |
| Same bug reappears next session | It's not in `CLAUDE.md` | Add it to the gotchas list |
| Confidently wrong about the DB | It read `migrate status` | Make it show a real query's output |
| Drifting toward a component library | Generalising before requirements exist | Point at S9's constraint: plainly first, extract in Increment 1 |

**The reset that works:** revert to the last good commit, then re-prompt with the
scope narrowed by half. Arguing with a session that has gone sideways costs more
than restarting it.

---

## 9. After the skeleton

Switch to [04-increments.md](04-increments.md), starting at Increment 1. Each
increment becomes 3–8 sessions using the same prompt shape; its Definition of
Done is your acceptance list, and its "Interaction requirements" paragraph is
what you paste into the prompt's constraints.

Before calling any screen finished, run it against
[02 §16](02-interaction.md#16-per-screen-checklist) yourself. The agent will tell
you a screen is done; that checklist is how you find out.
