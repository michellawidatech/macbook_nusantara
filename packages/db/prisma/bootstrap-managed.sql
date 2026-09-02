-- Roles and the database, on a MANAGED PostgreSQL (Railway, RDS, Neon…).
--
-- `roles.sql` is the local-cluster version of this and stays the one to read
-- first: it explains why the three roles exist and why creating them is not a
-- Prisma migration. This file is the same idea where two things differ.
--
--   1. **Passwords are compulsory.** roles.sql creates the roles LOGIN with no
--      password because a local cluster authenticates by trust/peer. A managed
--      one is reachable from the internet and authenticates by password, so a
--      passwordless LOGIN role is either unusable or — worse, on a cluster set
--      to `trust` — usable by anyone who can reach the port.
--   2. **The owner role has to be created too.** roles.sql assumes `nusantara`
--      already exists, because on the developer's cluster it is the role the
--      database was created under years of `migrate dev` ago. On a fresh
--      managed instance there is one superuser and nothing else.
--
-- Run ONCE per instance, as the superuser, against the maintenance database:
--
--     psql "$SUPERUSER_URL" \
--       -v owner_password="$OWNER_PW" \
--       -v app_password="$APP_PW" \
--       -v agent_password="$AGENT_PW" \
--       -v readonly_password="$READONLY_PW" \
--       -f packages/db/prisma/bootstrap-managed.sql
--
-- Passwords go in the shell that invokes psql and then into the platform's
-- secret store — never into this file, and never into secrets/*.env, which is
-- for a shell and is not read by the apps (docs/environments.md).

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- The roles.
-- ---------------------------------------------------------------------------
-- `format(%L)` rather than string concatenation: the password is a literal
-- chosen by a generator, and a generator that emits a quote would otherwise
-- end the statement early and set a password that is not the one recorded.
-- \gexec runs what the SELECT returns, and returns no row when the role is
-- already there — so this is re-runnable and never resets a live password.

-- Owns the schema and runs the migrations. Deliberately NOT superuser and NOT
-- createrole: "migrations run as a different role" (08 §9) only means something
-- if the application role cannot mint itself new privileges.
SELECT format('CREATE ROLE nusantara LOGIN PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara')
\gexec

-- The API. Reads and writes business tables; append-only on the ledger.
SELECT format('CREATE ROLE nusantara_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app')
\gexec

-- The webhook summarizer / agent. Disjoint column ownership on WaThreadMemory
-- is what makes invariant 13 structural (08 §7).
SELECT format('CREATE ROLE nusantara_agent LOGIN PASSWORD %L', :'agent_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent')
\gexec

-- Reporting and the Monitor app. SELECT only, forever.
SELECT format('CREATE ROLE nusantara_readonly LOGIN PASSWORD %L', :'readonly_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_readonly')
\gexec

-- ---------------------------------------------------------------------------
-- The database.
-- ---------------------------------------------------------------------------
-- `nusantara_pos_prod` is the name `resolveDatabaseUrl` requires when APP_ENV
-- is prod (packages/db/src/environment.ts). A managed instance arrives with a
-- database of the platform's own choosing — Railway's is `railway` — and that
-- name would be accepted by the guard as "some throwaway", which is exactly the
-- reading it must not have on the shop's real data.
--
-- CREATE DATABASE cannot run inside a transaction or a DO block, so \gexec
-- again. No row when it already exists, so this is re-runnable too.
SELECT 'CREATE DATABASE "nusantara_pos_prod" OWNER nusantara'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nusantara_pos_prod')
\gexec

-- The superuser can always connect; nobody else needs to reach it through the
-- maintenance database, and the three app roles get their table grants from the
-- migrations themselves once they run against nusantara_pos_prod.
REVOKE ALL ON DATABASE "nusantara_pos_prod" FROM PUBLIC;
GRANT CONNECT ON DATABASE "nusantara_pos_prod"
  TO nusantara, nusantara_app, nusantara_agent, nusantara_readonly;

-- What was actually created. `prisma migrate status` lies in this project
-- (CLAUDE.md); the habit of asking the database rather than the tool starts here.
\echo ''
\echo 'roles now present:'
SELECT rolname, rolcanlogin, rolsuper
FROM pg_roles
WHERE rolname LIKE 'nusantara%'
ORDER BY rolname;

\echo 'databases now present:'
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname LIKE 'nusantara%'
ORDER BY datname;
