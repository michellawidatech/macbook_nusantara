-- Accessories are counted, not tracked one by one (owner ask 2026-09-15:
-- "Accessories do not have serial number, and in stock opname, they will only
-- be counted and validated by qty, not serial").
--
-- Per CATEGORY rather than per model, so a shop that later starts counting
-- cables or chargers says so once, in Settings. A `Unit` row still exists for
-- every item — it is what carries what the item cost and what became of it —
-- and the serial column stays non-null, because it is this database's subject.
-- What changes is that nothing asks a person for one.
--
-- Default true: every category that existed before this column is one the shop
-- was already tracking by serial, and a default of false would silently stop
-- Inbound & QC asking for the serial of a MacBook.
ALTER TABLE "Category"
  ADD COLUMN "tracksSerial" BOOLEAN NOT NULL DEFAULT true;

-- The one the owner named. Matched case-insensitively on the name because the
-- browser creates a category by somebody typing it on a product, so "accessory"
-- and "Accessory" are both in the wild.
UPDATE "Category"
   SET "tracksSerial" = false
 WHERE lower("name") IN ('accessory', 'aksesoris', 'aksesori');

-- Tills already open learn it on their next poll rather than at their next
-- reload (docs/store-on-postgres.md, Concurrency).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'categories', "id" FROM "Category";
