# Environments

Three of them — `dev`, `stage`, `prod` — and each one is a database, a GitHub
Environment, and a trigger that promotes code into it.

| | dev | stage | prod |
|---|---|---|---|
| Database | `nusantara_pos_rebuild` | `nusantara_pos_stage` | `nusantara_pos_prod` |
| Enters on | any push | a push to `main`, or Run workflow on a branch | a `v*` tag |
| GitHub Environment | `dev` | `stage` | `prod` |
| Refs allowed in | any | any branch | `v*` tags only |
| Lives on | your laptop | the shop's Mac mini, `/opt/nusantara-stage` | the shop's Mac mini, `/opt/nusantara` |

`dev` keeps the name it was built under rather than being renamed for symmetry:
every note in `docs/rebuild` and every developer's shell already points at
`nusantara_pos_rebuild`, and a rename breaks all of them at once for no gain.

## The database that is not here

`nusantara_pos_app` is the **previous build's** database. It is still live and
the old system is still writing to it, so this build never opens it — not in
dev, not in a test, not with an override (CLAUDE.md; `08-data-integrity.md` §8
keeps it readable for a quarter).

That used to be a rule you had to remember. It is now a rule that stops the
process: `resolveDatabaseUrl` in `packages/db/src/environment.ts` refuses it in
every environment, before a connection is opened. The same function refuses a
missing `DATABASE_URL`, a DSN it cannot parse, and — the wrong deploy that is
easiest to make — an `APP_ENV` that disagrees with the database the DSN names.
`APP_ENV=prod` pointed at stage's database throws instead of writing to the
wrong shop.

## Configuring one

`APP_ENV` and `DATABASE_URL` come from the **process environment**, never from a
file the apps parse. `secrets/webhook-credentials.env` carries a `DATABASE_URL`
aimed at the retired database, which is exactly why `API_ENV_KEYS` and
`WORKER_ENV_KEYS` refuse to copy that key out of a file at all.

Copy the example for the environment you want and source it:

```bash
cp secrets/dev.env.example secrets/dev.env && set -a && . secrets/dev.env && set +a
```

`secrets/*.env` is gitignored; `secrets/*.env.example` is not.

## Creating one from nothing

Roles are cluster-wide and only need doing once:

```bash
psql -U postgres -h localhost -d postgres -f packages/db/prisma/roles.sql
```

Then, per environment:

```bash
psql -U nusantara -h localhost -d postgres -c 'CREATE DATABASE "nusantara_pos_stage" OWNER nusantara'
DATABASE_URL=postgresql://nusantara@localhost:5432/nusantara_pos_stage pnpm --filter @nusantara/db exec prisma migrate deploy
```

Do not trust the result. `prisma migrate status` lies in this project — a
recorded-but-unapplied migration reports clean while the table is missing — so
ask the database what it actually holds:

```bash
psql "postgresql://nusantara@localhost:5432/nusantara_pos_stage" -tAc "select count(*) from _prisma_migrations where finished_at is not null"
```

## What CI does with them

`.github/workflows/ci.yml` runs the same two jobs on every push to every
branch — format/lint/types/build, and the suites against a real PostgreSQL 16.
Only `prod` goes further: a `v*` tag builds the release and deploys it to the
Mac mini (`docs/deploy-pipeline.md`), and the deploy job runs in the GitHub
Environment `prod`, which is where its credentials live and which admits only
`v*` tags.

## What is deliberately missing

**Only `monitor` still has no hosting target.** The other four ship to the
shop's Mac mini as one compiled release (`docs/deploy-macmini.md`): the SPA
behind Caddy, `api` under launchd, and `worker` and `whatsapp-webhook` beside
it, switched on when WhatsApp moves there. Render and Netlify hosted them from
2026-09-02 until they were retired on 2026-09-18.
`monitor` is a package with a typecheck and no server to start.

**CI deploys `prod` and `stage`.** `prod` since 2026-09-18; `stage` since
2026-10-06, to `https://staging-pos.macbooknusantara.com` on the same Mac mini,
on a copy of the shop's database (`docs/staging.md`). Until 2026-09-18 it deployed
nothing, for a reason that still stands: `prisma migrate status` lies in this
project, so the step that would report a bad deploy was the one that could not
be trusted. The pipeline never asks it. After `prisma migrate deploy` it asks
the database — every migration the tag carries is applied and finished, none is
half-done, and `nusantara_app`'s grants still read `t|f|t|f|t` — and it
switches no code on until all three hold. The staging deploy asks the same
three questions of `nusantara_pos_stage`. `dev` has no host, so a push to any
other branch is checked and goes no further.

**`prod` has no required-reviewer gate.** That protection rule needs a paid plan
on a private repository, and this one is GitHub Free. What stands in for it is
the deployment branch policy: only a `v*` tag can enter `prod`, and cutting a
tag is already a deliberate act. If the repo moves to Pro or Team, add the
reviewer gate in Settings → Environments → prod.

`prod` and `stage` both live on the shop's Mac mini, as two installs side by
side (`docs/staging.md`). A `nusantara_pos_stage` on your own cluster is still
yours to make for local work, as above; nothing deploys to it.
