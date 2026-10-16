-- Financial & Report is for Ersen and Dina only (owner ask 2026-10-16).
--
-- One fact per account: may this person read the shop's money? It gates the
-- Financial & Report screens and the store collections only they read
-- (expenses, incomes, settlements and the two edit logs), and it is checked
-- by the API, not only by the menu.
--
-- Default false, so the release before this one keeps creating accounts
-- without naming the column and nobody gains access by accident.
--
-- No GRANT: "Staff" is granted to nusantara_app at TABLE level
-- (20260815060658), which covers a column added later.
ALTER TABLE "Staff"
  ADD COLUMN "canViewFinance" BOOLEAN NOT NULL DEFAULT false;

-- Who has it on the day it ships: every owner (Ersen — and an owner can
-- switch it off for anybody, themselves included, in Settings → Staff
-- accounts) and Dina, whose login `pnpm … accounts` made from her first name.
-- An account named otherwise is switched on by hand in the same place.
UPDATE "Staff"
   SET "canViewFinance" = true
 WHERE active
   AND (role = 'OWNER' OR lower(username) = 'dina');
