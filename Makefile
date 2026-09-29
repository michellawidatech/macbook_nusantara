# Macbook Nusantara — the four everyday chores.
#
#   make setup      install, generate the Prisma client, apply migrations
#   make dev        every app in watch mode (web :3000, api :4000, …)
#   make build      typecheck, then build
#   make db-empty   empty every table, keep the schema (asks first)
#
# The database is packages/db/.env's DATABASE_URL unless one is passed:
#   make db-empty DATABASE_URL=postgresql://nusantara@localhost:5432/other

SHELL := /bin/bash

DATABASE_URL ?= $(shell sed -n 's/^DATABASE_URL="\{0,1\}\([^"]*\)"\{0,1\}$$/\1/p' packages/db/.env 2>/dev/null)
export DATABASE_URL

DB_NAME = $(lastword $(subst /, ,$(firstword $(subst ?, ,$(DATABASE_URL)))))

.PHONY: help setup dev build db-migrate db-seed db-empty db-reset check-db

help:
	@echo "make setup      install, generate the Prisma client, apply migrations"
	@echo "make dev        run every app in watch mode"
	@echo "make build      typecheck, then build"
	@echo "make db-empty   empty every table in $(DB_NAME), keep the schema"
	@echo "make db-reset   db-empty, then the demo seed"
	@echo "make db-migrate apply pending migrations"
	@echo "make db-seed    the demo shop (truncates first)"

setup:
	pnpm install
	pnpm --filter @nusantara/db generate
	@$(MAKE) --no-print-directory db-migrate
	@echo "Next: 'make db-seed' for the demo shop, then"
	@echo "      'pnpm --filter @nusantara/api accounts --owner ersen' for logins."

dev:
	pnpm dev

build:
	pnpm typecheck
	pnpm build

db-migrate: check-db
	pnpm --filter @nusantara/db exec prisma migrate deploy

db-seed: check-db
	pnpm --filter @nusantara/db seed

# TRUNCATE, not DELETE: every FK is onDelete Restrict, so Postgres must work
# out the order. _prisma_migrations is kept, so the schema stays applied.
# Same statement as truncateAll() in packages/db/src/seed.ts.
db-empty: check-db
	@if [ -z "$(YES)" ]; then \
	  read -p "Empty EVERY table in '$(DB_NAME)'? Type the database name to confirm: " ans; \
	  [ "$$ans" = "$(DB_NAME)" ] || { echo "Aborted."; exit 1; }; \
	fi
	@psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -qAt -c "DO \$$\$$ DECLARE t text; BEGIN \
	  SELECT string_agg(quote_ident(tablename), ', ') INTO t FROM pg_tables \
	   WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'; \
	  IF t IS NOT NULL THEN EXECUTE 'TRUNCATE TABLE ' || t || ' RESTART IDENTITY CASCADE'; END IF; \
	END \$$\$$;"
	@echo "Emptied $(DB_NAME)."

db-reset: db-empty db-seed

# Refuses the previous build's live database and anything not on this machine.
check-db:
	@[ -n "$(DATABASE_URL)" ] || { echo "No DATABASE_URL (packages/db/.env)."; exit 1; }
	@[ "$(DB_NAME)" != "nusantara_pos_app" ] || { echo "Refusing: nusantara_pos_app is the previous build's LIVE database."; exit 1; }
	@case "$(DATABASE_URL)" in *@localhost[:/]*|*@127.0.0.1[:/]*) ;; \
	  *) [ -n "$(REMOTE)" ] || { echo "Refusing a non-local database; pass REMOTE=1 if you mean it."; exit 1; } ;; esac
	@pg_isready -d "$(DATABASE_URL)" -q || { echo "Postgres is not answering for $(DB_NAME)."; exit 1; }
