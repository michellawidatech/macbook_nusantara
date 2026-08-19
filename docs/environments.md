# Environments

Three of them — `dev`, `stage`, `prod` — and each one is a database, a GitHub
Environment, and a trigger that promotes code into it.

| | dev | stage | prod |
|---|---|---|---|
| Database | `nusantara_pos_rebuild` | `nusantara_pos_stage` | `nusantara_pos_prod` |
| Enters on | a pull request | merge to `main` | a `v*` tag |
| GitHub Environment | `dev` | `stage` | `prod` |
| Refs allowed in | any | `main` only | `v*` tags only |

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

`.github/workflows/ci.yml` gates every environment behind the same two jobs —
format/lint/types/build, and the suites against a real PostgreSQL 16 — and then
records a deployment against the matching GitHub Environment. The gates are the
promotion; the environments are where per-environment secrets live.

## What is deliberately missing

**There are no deploy steps.** The four apps (`api` :4000, `web` :3000,
`whatsapp-webhook` :3001, `worker`) have no hosting target yet — no Dockerfile,
no compose file, no PaaS config, no server. Rather than a placeholder job that
reports green without shipping anything, the environments exist and the deploy
step is absent until there is somewhere to deploy to.

**`prod` has no required-reviewer gate.** That protection rule needs a paid plan
on a private repository, and this one is GitHub Free. What stands in for it is
the deployment branch policy: only a `v*` tag can enter `prod`, and cutting a
tag is already a deliberate act. If the repo moves to Pro or Team, add the
reviewer gate in Settings → Environments → prod.

Stage and prod both live on the developer cluster today, because there is no
second host. When one exists, only the host and the password in
`secrets/<env>.env` change.
