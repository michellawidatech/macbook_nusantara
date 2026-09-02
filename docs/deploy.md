# Deploying

Two hosts. The SPA is static and lives on **Netlify**; the API, the worker, the
webhook and PostgreSQL live on **Render**. `docs/environments.md` describes the
three environments and the guard that keeps them apart; this describes where
they run.

| | host | what runs | config |
|---|---|---|---|
| `apps/web` | Netlify | the built SPA, plus a proxy for `/api` and `/auth` | `netlify.toml` |
| `apps/api` | Render | `tsx apps/api/src/server.ts` | `render.yaml`, `Dockerfile` |
| `apps/worker` | Render | `tsx apps/worker/src/main.ts`, no port | `render.yaml` |
| `apps/whatsapp-webhook` | Render | `tsx apps/whatsapp-webhook/src/server.ts` | `render.yaml` |
| database | Render | PostgreSQL 16, `nusantara_pos_prod` | `packages/db/prisma/bootstrap-managed.sql` |

`render.yaml` is a Blueprint: the four resources are declared in one file, and
Render creates them from it. The three services run the **same image** — see the
Dockerfile's docblock for why that is deliberate rather than convenient — and
differ only in `dockerCommand`.

Everything is in **`singapore`**, not Render's default `oregon`. Jakarta to
Oregon is a ~200 ms round trip and to Singapore ~30 ms; a page in this app is
7–8 ms of PostgreSQL, so the default region would put twenty-five times the
query into the network, on every serial lookup with a customer standing there.

## What it costs, and the date to remember

Everything is on Render's **free** tier (owner decision 2026-09-02), so this
deploy costs nothing. Two consequences, and the second one has a date on it.

**Free services sleep.** A free web service spins down after 15 minutes of
inactivity and takes 30–60 s to wake. On a quiet afternoon the first sale after
the lull waits at the till, and Meta gets a timeout rather than a 200 on the
first message after a quiet spell — it retries, so nothing is lost, but the
first reply is late.

**⚠️ Render deletes a free PostgreSQL database 30 days after it is created.**

Free was the right plan on the day it was created, because the database held
nothing then: a fresh schema and a seed. It is the wrong plan the moment the
shop's real ledger is in it. This application's first rule is that nothing is
ever hard-deleted and that `UnitEvent` is the record of every machine the shop
has handled; a host that erases it on a timer contradicts the premise of the
schema.

**Created 2026-09-02, so the deletion date is 2026-10-02.** Before that date,
either move the database to a paid plan — a dropdown on the Render dashboard,
no change to `render.yaml` — or accept losing it and recreate.

If it ever goes paid, the sizes below are the ones to pick. They are small
because this app is small: 99 MB RSS for the API under load, 52–59 MB for the
worker, 7–8 ms per page query.

| resource | paid plan | |
|---|---|---|
| API | `0.5c-512mb` | $7/mo |
| worker | `0.5c-512mb` | $7/mo |
| webhook | `0.5c-512mb` | $7/mo |
| PostgreSQL | `0.1c-256mb` | ~$7/mo |
| Netlify | free tier | $0 |

Render bills per instance rather than by usage, so the count is what costs, not
the sizes — a larger plan for any of these would buy nothing.

## Why Netlify and not GitHub Pages

The session is a cookie the API sets, and the OIDC sign-in is a chain of
top-level redirects out to Auth0 and back. Both need `/api` and `/auth` to
answer on the **SPA's own origin** — which is exactly what Vite's dev proxy
arranges locally (`apps/web/vite.config.ts`), and what `netlify.toml` arranges
in production.

GitHub Pages serves static files and cannot rewrite a path to another host, so
there the SPA would have to call Render cross-origin. That costs
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
- **`PORT` is a fallback for `API_PORT`** in `apps/api/src/config.ts`. Render
  assigns the port at runtime and injects it under that name; without the
  fallback the container binds 4000, Render health-checks the port it assigned,
  and the deploy fails as "no response" with a perfectly healthy process inside.
  The webhook already read `WEBHOOK_PORT ?? PORT`; the API now matches it. The
  worker listens on nothing, which is why it is `type: worker` and has no
  `healthCheckPath`.

## Creating the database

Render's Blueprint declares it, so unlike most managed hosts the database
arrives already called `nusantara_pos_prod`, already owned by a role called
`nusantara`, and `resolveDatabaseUrl` recognises the name without anything being
renamed. What Render does **not** create is the three roles the migrations
`GRANT` to — they are not created by a migration, deliberately, and
`packages/db/prisma/roles.sql` explains why.

Generate three passwords, then run the bootstrap **once**, connected as
`nusantara` (Render's Info page has the connection string) against the database
itself. There is no maintenance database to reach on Render, and none is needed:

```bash
psql "$OWNER_URL" -v owner_password=unused -v app_password="$APP_PW" -v agent_password="$AGENT_PW" -v readonly_password="$READONLY_PW" -f packages/db/prisma/bootstrap-managed.sql
```

`owner_password=unused` is honest rather than a placeholder: `nusantara` already
exists, so the statement that would set it is skipped, and psql still requires
the variable to be bound.

It opens with a preflight, and that preflight is the one thing about Render
worth knowing in advance. **Owning a database does not confer `CREATEROLE`.** If
Render's user cannot create roles, the script stops with a sentence saying so
rather than failing three statements later with a bare "permission denied to
create role" that reads like a bug in the file. The fix it names is Render's
own **Create PostgreSQL User** control — dashboard or API — which makes the
three roles as Render-managed users; re-run the script afterwards and it skips
straight to the `GRANT`s.

Then apply the migrations, as the owner:

```bash
DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db exec prisma migrate deploy
```

Then do not believe it. `prisma migrate status` lies in this project — a
recorded-but-unapplied migration reports clean while the table is missing — so
ask the database what it actually holds:

```bash
psql "$OWNER_URL" -c "select count(*) as migrations from _prisma_migrations where finished_at is not null" -c "select count(*) as tables from information_schema.tables where table_schema='public'"
```

Twenty migrations and seventy-two tables, as of `20260902090100`.

The check worth doing once, because it is the whole point of the three roles —
the API's role must be able to read a unit, unable to delete one, able to append
to the ledger, unable to edit it, and able to delete a QC photo, which is the
single sanctioned exception in this codebase:

```bash
psql "$OWNER_URL" -tAc "select has_table_privilege('nusantara_app','\"Unit\"','SELECT'), has_table_privilege('nusantara_app','\"Unit\"','DELETE'), has_table_privilege('nusantara_app','\"UnitEvent\"','INSERT'), has_table_privilege('nusantara_app','\"UnitEvent\"','UPDATE'), has_table_privilege('nusantara_app','\"UnitNotePhoto\"','DELETE')"
```

`t|f|t|f|t`. Anything else means the grants in the migrations did not land, and
the append-only ledger is a convention again rather than a permission.

## Migrations are not run by the deploy

`render.yaml` declares no `preDeployCommand`, and that is deliberate. A
migration in this project can add a `GRANT` that a half-applied deploy leaves
the API unable to read through, and the tool that would report the failure is
the one that lies about it. Applying them is a command somebody runs and checks,
in the order above, before the deploy that needs them.

The cost is remembering. If that turns out to be the wrong trade, Render's
`preDeployCommand` on the API service is where it goes — and the verification
above becomes a thing nobody does.

## Environment variables — the API service

Most are already in `render.yaml`. The table is what `sync: false` means there:
values Render prompts for at Blueprint creation, or that you set afterwards on
the service, because they are secret and do not belong in git.

`APP_ENV` and `DATABASE_URL` must agree about which environment they name, or
the process refuses to start.

| variable | value | in `render.yaml`? |
|---|---|---|
| `APP_ENV` | `prod` | declared |
| `CORS_ORIGIN` | `https://macbook-nusantara.netlify.app` | declared |
| `AUTH0_BASE_URL` | the same Netlify origin — see below | declared |
| `AUTH0_SECRET` | | `generateValue: true` |
| `DATABASE_URL` | `postgresql://nusantara_app:$APP_PW@$PGHOST/nusantara_pos_prod?connection_limit=5` | secret |
| `AUTH0_DOMAIN` | tenant domain, no scheme | secret |
| `AUTH0_CLIENT_ID` | from the Auth0 application | secret |
| `AUTH0_CLIENT_SECRET` | from the Auth0 application | secret |
| `ANTHROPIC_API_KEY` | optional; without it the chat agent stays switched off | secret |

`DATABASE_URL` is **not** declared with Render's `fromDatabase` property, and
that is the one deviation from the obvious Blueprint. `fromDatabase` hands over
the *owner's* connection string, and the entire purpose of the three roles is
that the API is not the owner: `nusantara_app` may append to `UnitEvent` and may
never update or delete it, which is what makes "every unit state change is an
append-only row" a permission instead of a habit. So it is set by hand, to
`nusantara_app`'s own DSN, after the bootstrap has created that role.

`connection_limit` is pinned because Prisma's default is cores × 2 + 1 *per
process*, which on a 0.5-CPU instance is a pool sized for a machine the
container does not have.

Migrations are the only thing that ever runs as `nusantara`.

### AUTH0_BASE_URL is the Netlify origin

The one setting most likely to be wrong, and it fails at the redirect — after
the staff member has already been sent to Auth0 — rather than at startup.

`express-openid-connect` builds `redirect_uri` from `AUTH0_BASE_URL`. The
browser only ever sees the Netlify origin: Netlify proxies `/auth/*` to Render,
so the callback must come back to Netlify and be proxied in, exactly as Vite
proxies it to `:4000` in development. Pointing it at the Render hostname sends
the browser somewhere the session cookie is not.

In the Auth0 application, set:

- **Allowed Callback URLs** — `https://<netlify-site>/auth/callback`
- **Allowed Logout URLs** — `https://<netlify-site>`
- **Allowed Web Origins** — `https://<netlify-site>`

## Environment variables — the worker and the webhook

All three services need `APP_ENV` and `DATABASE_URL`, and all three connect as
`nusantara_app`. Render's environment groups are the place for those, so one
edit moves all three rather than three edits that can disagree.

The chatbot credentials are the ones the API deliberately cannot hold.
`apps/api/src/secretsFile.ts` allows itself two keys and refuses `APP_SECRET`
and `DATABASE_URL` on purpose — the API drafts replies and is the OIDC client;
verifying an inbound Meta webhook is not its job. Keep that split here: set
`APP_SECRET` and `VERIFY_TOKEN` on the **webhook service only**.

**Worker** — every one of these has a default, so it starts without them and
reports in its first log line that it cannot draft or cannot send. Values are in
`secrets/webhook-credentials.env` locally.

| variable | value |
|---|---|
| `WHATSAPP_TOKEN` | the Meta system-user token |
| `PHONE_NUMBER_ID` | `1200651716467039` |
| `ANTHROPIC_API_KEY` | without it the worker drafts nothing |
| `WORKER_AGENT_STAFF_ID` | leave unset unless the seeded `staff_agent` row was renamed |

`GRAPH_API_VERSION` is deliberately absent from `render.yaml`: `v25.0` is a
constant in the code for both channels, and CLAUDE.md's rule is one constant and
never two env fallbacks. Setting it here is how the two channels start to drift.

**Webhook**

| variable | value |
|---|---|
| `APP_SECRET` | Meta app secret. **Empty means reject every event** — fail-closed, by design |
| `VERIFY_TOKEN` | the handshake token. Empty means refuse to verify |
| `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID` | as above |
| `IG_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID` | Instagram, if that channel is live |

The webhook's public Render URL is what Meta must be pointed at, at
`https://<webhook-service>.onrender.com/webhook`. **That is a change to the
shop's live WhatsApp integration**: the moment it is switched, inbound messages
stop arriving wherever they arrive today. Deploy the service, confirm `/health`
answers and that the verify handshake succeeds, and change the subscription as a
separate deliberate act.

⚠️ Do not put the webhook on Render's `free` plan. A free service sleeps after
15 minutes, and Meta's delivery gets a timeout rather than a 200 while it wakes.

## Netlify environment variables

| variable | value |
|---|---|
| `API_ORIGIN` | the API service's public origin, e.g. `https://nusantara-api.onrender.com` |

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
