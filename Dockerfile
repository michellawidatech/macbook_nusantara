# The three server-side apps as ONE container — the first hosting target this
# repo has had. `CMD` starts the API; the worker and the webhook are the same
# image with the start command overridden, which is how they are deployed as
# separate Railway services (docs/deploy.md).
#
# ## Why one image and not three
#
# They share `@nusantara/db`, `@nusantara/agent`, `@nusantara/logging` and
# `@nusantara/whatsapp`, and the interesting thing about the worker is that it
# writes the ledger the API reads. Three images means three chances for one of
# them to be running a different `packages/domain` than the other two — a
# `statusAfter` arrow the worker knows and the API does not is a unit whose
# status the two disagree about. One image makes that impossible to express.
#
# ## Why the whole workspace is copied and nothing is compiled
#
# Every package in this repo exports raw TypeScript (`packages/db` is
# `"exports": "./src/index.ts"`), so there is no build artifact to copy and no
# `dist` to run. `tsx` is the runtime, exactly as it is in `pnpm dev`. That is a
# deliberate trade: a slower cold start in exchange for production running the
# same module graph the tests do, with no second compiler configuration to keep
# in step with `tsconfig.base.json`.
#
# ## Why pnpm's filter is on the install and not on a prune
#
# The three filters install those apps, the workspace packages they depend on,
# and the root — and nothing of `apps/web`, whose devDependencies (vite, antd,
# jsdom, testing-library) are the bulk of this repo's node_modules. Pruning
# afterwards is not an option: `tsx` and `typescript` are root devDependencies
# and this image runs on them.

FROM node:22-bookworm-slim

# Prisma 6's query engine links against OpenSSL 3; bookworm-slim ships libssl3
# but not the certificates a TLS connection to a managed PostgreSQL needs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# The version is pinned in package.json's `packageManager` field; corepack reads
# it from there, so this cannot drift from what the lockfile was written by.
RUN corepack enable

WORKDIR /app

# The manifests first, so `pnpm install` is only re-run when a dependency
# actually changes rather than on every source edit.
#
# EVERY workspace manifest, not only the six the API imports: `--frozen-lockfile`
# compares the lockfile against every importer `pnpm-workspace.yaml` declares,
# and one that is missing from the build context reads as an outdated lockfile
# rather than as a project to skip. The filter on the install below is what
# decides which of them actually get their dependencies fetched.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/monitor/package.json apps/monitor/
COPY apps/web/package.json apps/web/
COPY apps/whatsapp-webhook/package.json apps/whatsapp-webhook/
COPY apps/worker/package.json apps/worker/
COPY packages/agent/package.json packages/agent/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/instagram/package.json packages/instagram/
COPY packages/logging/package.json packages/logging/
COPY packages/ui/package.json packages/ui/
COPY packages/whatsapp/package.json packages/whatsapp/

RUN pnpm install --frozen-lockfile \
  --filter @nusantara/api... \
  --filter @nusantara/worker... \
  --filter @nusantara/whatsapp-webhook...

# The schema before the source: `prisma generate` depends on this one file, and
# nothing else in the tree invalidates it.
COPY packages/db/prisma packages/db/prisma
RUN pnpm --filter @nusantara/db exec prisma generate

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/whatsapp-webhook apps/whatsapp-webhook
COPY packages packages

# After the install, so pnpm does not skip the devDependencies this image runs
# on. `securityHeaders` reads it through `config.env`.
ENV NODE_ENV=production

# Node's default heap cap is 1,216 MB on a 2 GB box, which is most of the host
# for a process measured at 99 MB RSS under load. 384 leaves room for the
# platform and turns a leak into a restart instead of an OOM-killed box.
ENV NODE_OPTIONS=--max-old-space-size=384

# Documentation only — the platform assigns the real port and injects it as
# PORT, which both HTTP apps read when their own port variable is unset
# (`API_PORT` for the API, `WEBHOOK_PORT` for the webhook). The worker listens
# on nothing at all.
EXPOSE 4000

# The API. The other two override this in their Railway service settings:
#
#   worker   pnpm exec tsx apps/worker/src/main.ts
#   webhook  pnpm exec tsx apps/whatsapp-webhook/src/server.ts
#
# `pnpm exec` rather than a bare `tsx`, so the binary resolves through the
# workspace's own node_modules and not a PATH that may not have it.
CMD ["pnpm", "exec", "tsx", "apps/api/src/server.ts"]
