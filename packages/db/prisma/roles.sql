-- Database roles for Macbook Nusantara (08 §9).
--
-- Run ONCE per cluster, as a superuser:
--     psql -U <superuser> -h localhost -d postgres -f packages/db/prisma/roles.sql
--
-- This is deliberately NOT part of a Prisma migration. Migrations run as the
-- owner role (`nusantara`), which by design has neither SUPERUSER nor
-- CREATEROLE — "migrations run as a different role" (08 §9) only means
-- something if the application role cannot mint new roles.
--
-- No passwords are set here. Local development authenticates via trust/peer.
-- Before this cluster is ever reachable off-localhost, set them yourself:
--     ALTER ROLE nusantara_app PASSWORD '...';
-- and put the value in secrets/, never in this file.

DO $$
BEGIN
  -- The API. Reads and writes business tables; append-only on the ledger.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    CREATE ROLE nusantara_app LOGIN;
  END IF;

  -- The webhook summarizer / agent. Disjoint column ownership on
  -- WaThreadMemory is what makes invariant 13 structural (08 §7).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent') THEN
    CREATE ROLE nusantara_agent LOGIN;
  END IF;

  -- Reporting and the Monitor app. SELECT only, forever.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_readonly') THEN
    CREATE ROLE nusantara_readonly LOGIN;
  END IF;
END
$$;
