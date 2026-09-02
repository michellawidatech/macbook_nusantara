-- Price moves from the serial to the variant (owner decision 2026-08-27).
--
-- This reverses the 2026-08-15 decision that put an asking price on every unit.
-- The reasoning then was that second-hand units of one SKU differ; the decision
-- now is that they may differ in condition without differing in price. Grade is
-- still recorded per unit at QC and still shown in Inventory — it just does not
-- change what the shop asks. `Sku.price` is the only sellable price.
--
-- `Unit.buy` and `Unit.landed` stay exactly where they are. What the shop PAID
-- for a particular machine is genuinely per-serial and is what every margin is
-- computed against; only the asking price is a property of the variant.
--
-- Nothing is lost. `Unit.price` was written as a copy of `Sku.price` on both
-- seed paths and by QC, and every one of the 5 000 rows in the rebuild database
-- was verified equal to its SKU's price before this ran. Sale history is
-- unaffected either way: `OrderItem.price` is a snapshot taken at the till, so
-- what a unit actually sold for is recorded on the order and not here.
--
-- The CHECK goes first. It references the column, so dropping the column would
-- take the constraint with it silently; dropping it by name leaves a statement
-- in this file that says the rule is gone, rather than a rule that evaporates.

ALTER TABLE "Unit" DROP CONSTRAINT "Unit_price_set_when_sellable_check";

ALTER TABLE "Unit" DROP COLUMN "price";
