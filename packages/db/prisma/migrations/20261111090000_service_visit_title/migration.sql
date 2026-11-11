-- A service batch can be named (owner ask 2026-11-11: "add title /
-- description per service so it's more identifiable").
--
-- One send writes every visit of the batch with the same title; the page
-- groups visits into batches and prints it. `note` stays the unit's own
-- description. Additive and nullable: nothing backfilled, and the table-level
-- grants nusantara_app already holds on "ServiceVisit" cover the new column.
ALTER TABLE "ServiceVisit" ADD COLUMN "title" TEXT;
