# Deploying

Two hosts. The SPA is static and lives on **Netlify**; the API and PostgreSQL
live on **Railway**. `docs/environments.md` describes the three environments and
the guard that keeps them apart; this describes where they run.

| | host | what runs | config |
|---|---|---|---|
| `apps/web` | Netlify | the built SPA, plus a proxy for `/api` and `/auth` | `netlify.toml` |
| `apps/api` | Railway | `tsx apps/api/src/server.ts` | `Dockerfile`, `railway.json` |
| `apps/worker` | Railway | `tsx apps/worker/src/main.ts`, no port | `railway.worker.json` |
| `apps/whatsapp-webhook` | Railway | `tsx apps/whatsapp-webhook/src/server.ts` | `railway.webhook.json` |
| database | Railway | PostgreSQL 16 | `packages/db/prisma/bootstrap-managed.sql` |

The three Railway services run the **same image** — see the Dockerfile's
docblock for why that is deliberate rather than convenient. Each service points
at its own config file (Settings → Config as code), and the two that are not the
API override the start command from there.

## Why Netlify and not GitHub Pages

The session is a cookie the API sets, and the OIDC sign-in is a chain of
top-level redirects out to Auth0 and back. Both need `/api` and `/auth` to
answer on the **SPA's own origin** — which is exactly what Vite's dev proxy
arranges locally (`apps/web/vite.config.ts`), and what `netlify.toml` arranges
in production.

GitHub Pages serves static files and cannot rewrite a path to another host, so
there the SPA would have to call Railway cross-origin. That costs
`SameSite=None` on the session cookie, a CORS allowance, and a cookie attached
to every third-party request the browser makes to that hostname. Netlify's
rewrite is one line and none of that.

## The image

One stage, no compilation: every package in this repo exports raw TypeScript, so
production runs `tsx` over the same module graph the tests do. The `Dockerfile`
explains the decisions worth knowing about — why one image carries all three
apps, why the install is filtered, and why every workspace manifest is copied
even so.

Two things it is worth checking never regress:

- **`secrets/` is the first line of `.dockerignore`.** That directory is
  gitignored, so a clean checkout says nothing about whether it is on the disk
  the build context is read from. Without the ignore, `docker build .` bakes
  `webhook-credentials.env` into a layer and `docker history` reads it back.
- **`PORT` is a fallback for `API_PORT`** in `apps/api/src/config.ts`. Railway
  assigns the port at runtime and injects it under that name; without the
  fallback the container binds 4000, Railway health-checks the port it assigned,
  and the deploy fails as "no response" with a perfectly healthy process inside.
  The webhook already read `WEBHOOK_PORT ?? PORT`; the API now matches it. The
  worker listens on nothing, so it has no health check and Railway should not be
  given a port for it.

## The `railway*.json` files are on a deadline

Railway's CLI warns that Config as Code — `railway.json` / `railway.toml` — is
deprecated in favour of Infrastructure as Code, a `.railway/railway.ts` the CLI
reads instead, and that **existing files keep working until 2026-12-01**.

They are still what this repo carries, for one reason: the three services are
described accurately by them today, and the replacement could not be written
against a real project to check, because the account's trial had expired before
one could be created. Guessing at an API and committing it unrun is how a deploy
file becomes a thing nobody trusts.

When the project exists, `railway config migrate` translates all three, and
`railway config plan` shows what it would change before anything is applied.
Until then these files work and the date is the reminder.

## Creating the database

Railway's PostgreSQL arrives as one superuser and a database called `railway`.
Neither is what this app wants: the three roles the migrations `GRANT` to must
already exist (they are not created by a migration, deliberately — see
`packages/db/prisma/roles.sql`), and `resolveDatabaseUrl` reads the database
*name* to decide which environment it is talking to.

Generate four passwords, keep them, and run the bootstrap **once per instance**
as the superuser, against the maintenance database:

```bash
psql "$RAILWAY_SUPERUSER_URL" -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -v agent_password="$AGENT_PW" -v readonly_password="$READONLY_PW" -f packages/db/prisma/bootstrap-managed.sql
```

It is re-runnable and never resets a password that is already set. Then apply
the migrations **as the owner role**, against the database it just created:

```bash
DATABASE_URL="postgresql://nusantara:$OWNER_PW@$PGHOST:$PGPORT/nusantara_pos_prod" pnpm --filter @nusantara/db exec prisma migrate deploy
```

Then do not believe it. `prisma migrate status` lies in this project — a
recorded-but-unapplied migration reports clean while the table is missing — so
ask the database what it actually holds:

```bash
psql "postgresql://nusantara:$OWNER_PW@$PGHOST:$PGPORT/nusantara_pos_prod" -c "select count(*) as migrations from _prisma_migrations where finished_at is not null" -c "select count(*) as tables from information_schema.tables where table_schema='public'"
```

Twenty migrations and seventy-two tables, as of `20260902090100`.

The check worth doing once, because it is the whole point of the three roles —
the API's role must be able to read a unit, unable to delete one, unable to
edit the ledger, and able to delete a QC photo, which is the single sanctioned
exception in this codebase:

```bash
psql "$RAILWAY_SUPERUSER_URL/nusantara_pos_prod" -tAc "select has_table_privilege('nusantara_app','\"Unit\"','SELECT'), has_table_privilege('nusantara_app','\"Unit\"','DELETE'), has_table_privilege('nusantara_app','\"UnitEvent\"','UPDATE'), has_table_privilege('nusantara_app','\"UnitNotePhoto\"','DELETE')"
```

`t|f|f|t`. Anything else means the grants in the migrations did not land, and
the append-only ledger is a convention again rather than a permission.

## Migrations are not run by the deploy

`railway.json` has no pre-deploy command, and that is deliberate. A migration in
this project can add a `GRANT` that a half-applied deploy leaves the API unable
to read through, and the tool that would report the failure is the one that
lies about it. Applying them is a command somebody runs and checks, in the order
above, before the deploy that needs them.

The cost is remembering. If that turns out to be the wrong trade, the change is
one field — `"preDeployCommand": ["pnpm --filter @nusantara/db exec prisma migrate deploy"]` —
and the verification above becomes a thing nobody does.

## Railway environment variables — the API service

`APP_ENV` and `DATABASE_URL` must agree about which environment they name, or
the process refuses to start.

| variable | value |
|---|---|
| `APP_ENV` | `prod` |
| `DATABASE_URL` | `postgresql://nusantara_app:$APP_PW@$PGHOST:$PGPORT/nusantara_pos_prod?connection_limit=5` |
| `CORS_ORIGIN` | the Netlify site's origin, e.g. `https://macbook-nusantara.netlify.app` |
| `NODE_ENV` | `production` (already set in the image; Railway may override) |
| `AUTH0_DOMAIN` | tenant domain, no scheme |
| `AUTH0_CLIENT_ID` | from the Auth0 application |
| `AUTH0_CLIENT_SECRET` | from the Auth0 application |
| `AUTH0_SECRET` | `openssl rand -hex 32` |
| `AUTH0_BASE_URL` | **the Netlify origin, not Railway's** — see below |
| `ANTHROPIC_API_KEY` | optional; without it the chat agent stays switched off |

`connection_limit` is pinned because Prisma's default is cores × 2 + 1 *per
process*, which on a shared instance is a pool sized for a machine the container
does not have.

The API connects as `nusantara_app`, never as the owner and never as the
superuser. Migrations are the only thing that runs as `nusantara`.

### AUTH0_BASE_URL is the Netlify origin

The one setting most likely to be wrong, and it fails at the redirect — after
the staff member has already been sent to Auth0 — rather than at startup.

`express-openid-connect` builds `redirect_uri` from `AUTH0_BASE_URL`. The
browser only ever sees the Netlify origin: Netlify proxies `/auth/*` to Railway,
so the callback must come back to Netlify and be proxied in, exactly as Vite
proxies it to `:4000` in development. Pointing it at the Railway hostname sends
the browser somewhere the session cookie is not.

In the Auth0 application, set:

- **Allowed Callback URLs** — `https://<netlify-site>/auth/callback`
- **Allowed Logout URLs** — `https://<netlify-site>`
- **Allowed Web Origins** — `https://<netlify-site>`

## Railway environment variables — the worker and the webhook

All three services need `APP_ENV` and `DATABASE_URL`, and all three connect as
`nusantara_app`. Railway's shared variables are the place for those, so one
edit moves all three rather than three edits that can disagree.

The chatbot credentials are the ones the API deliberately cannot hold.
`apps/api/src/secretsFile.ts` allows itself two keys and refuses `APP_SECRET`
and `DATABASE_URL` on purpose — the API drafts replies and is the OIDC client;
verifying an inbound Meta webhook is not its job. Keep that split here: set
`APP_SECRET` and `VERIFY_TOKEN` on the **webhook service only**.

**Worker** (`railway.worker.json`) — every one of these has a default, so the
worker starts without them and reports in its first log line that it cannot
send. Values are in `secrets/webhook-credentials.env` locally.

| variable | value |
|---|---|
| `WHATSAPP_TOKEN` | the Meta system-user token |
| `PHONE_NUMBER_ID` | `1200651716467039` |
| `ANTHROPIC_API_KEY` | without it the worker drafts nothing |
| `WORKER_AGENT_STAFF_ID` | leave unset unless the seeded `staff_agent` row was renamed |

`GRAPH_API_VERSION` is deliberately absent: `v25.0` is a constant in the code
for both channels, and CLAUDE.md's rule is one constant and never two env
fallbacks. Setting it here is how the two channels start to drift.

**Webhook** (`railway.webhook.json`)

| variable | value |
|---|---|
| `APP_SECRET` | Meta app secret. **Empty means reject every event** — fail-closed, by design |
| `VERIFY_TOKEN` | the handshake token. Empty means refuse to verify |
| `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` | as above |
| `IG_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID` | Instagram, if that channel is live |

The webhook's public Railway URL is what Meta must be pointed at, at
`https://<webhook-service>/webhook`. **That is a change to the shop's live
WhatsApp integration**: the moment it is switched, inbound messages stop
arriving wherever they arrive today. Deploy the service, confirm `/health`
answers and that the verify handshake succeeds, and change the subscription as
a separate deliberate act.

## Netlify environment variables

| variable | value |
|---|---|
| `API_ORIGIN` | the Railway API's public origin, e.g. `https://nusantara-api-production.up.railway.app` |

That is the whole list. It is read at build time by
`apps/web/scripts/netlify-redirects.mjs`, which writes `dist/_redirects` and
**fails the build if it is unset** — because the failure it prevents is silent:
with the catch-all rewrite but no proxy, `GET /api/auth/me` returns the SPA's
own HTML with a 200, and the site loads and can never sign anybody in.

## Getting in the first time

The seed writes an unusable password hash for every account, so a fresh database
has no way in. Create one:

```bash
printf '%s' '<password>' | pnpm --filter @nusantara/api staff --username <u> --name '<n>' --role OWNER
```

with `DATABASE_URL` pointing at the deployed database. Password on stdin, never
argv. With Auth0 configured, that row is what `resolveStaff` binds the Auth0
user to — Auth0 answers "which person is this", the `Staff` row answers "which
role, and who gets attributed on every `UnitEvent`".

## What is deployed, and what the app still keeps in the browser

The API serves the session, the catalogue, the S/N timeline, reservations, the
chat inbox and the control endpoints. **Most POS screens still read a
browser-memory mock** (`apps/web/src/mock/store.ts`) — 26 files do, against 5
that call the API — which is the migration `docs/environments.md` and the
`pos-backend-migration` notes describe as in progress. On the deployed site
those screens work, and their data resets on reload. Deploying does not change
that; only the remaining slices do.

## Not deployed

`apps/monitor` has no runtime at all yet — it is a package with a typecheck and
a test script and no server to start.

Nothing here deploys itself. `.github/workflows/ci.yml` gates and records a
deployment against the matching GitHub Environment and stops; pushing an image
and applying a migration are commands somebody runs and checks.
