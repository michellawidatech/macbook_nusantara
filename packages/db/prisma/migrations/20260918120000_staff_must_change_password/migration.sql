-- The app's own login replaces Auth0 (owner ask 2026-09-18): "seed the account
-- and the password, initially all will be 'password', then in the first time
-- login need to change their password and Ersen can manage all the password
-- account".
--
-- One fact per account: is it still on a password somebody else chose? The
-- initial password and an owner's reset both set it; the person choosing their
-- own clears it. Until then the API answers that session's business routes
-- with 403 GANTI_SANDI.
--
-- Default false, so every account that exists before this migration keeps
-- working exactly as it did: the previous release writes Staff rows without
-- naming the column, and nothing it creates is forced through a change.
--
-- No GRANT: "Staff" is granted to nusantara_app at TABLE level
-- (20260815060658), which covers a column added later.
ALTER TABLE "Staff"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
