-- A discount on ONE line of a purchase invoice (owner ask 2026-09-20).
--
-- > *"Input product name > QTY > price > discount > display total (+ COGS
-- > based on the tax + shipping fee displayed before)."*
--
-- `PurchaseOrder.discount` has always been the discount negotiated off the
-- WHOLE order, and it stays that. This is the other one a supplier's invoice
-- carries: "Rp500.000 off the five Airs", which is a fact about those five and
-- about nothing else on the paper. Folding it into `unitCost` would lose what
-- was negotiated the moment the page was reopened; rolling it up into the
-- order's discount would lose which goods it was given against, and with it
-- the only way to say what those units cost.
--
-- Off the LINE, not off a piece: a line of qty 3 with a Rp500.000 discount is
-- Rp500.000 off the three. What each unit cost is the line total divided over
-- its pieces, which is where `Unit.buy` comes from — see
-- `apps/web/src/lib/invoiceLines.ts`.
--
-- Additive and defaulted, so the release before this one reads every row as
-- "no discount", which is what every existing row is.
--
-- No GRANT: "PurchaseOrderItem" is granted to nusantara_app at TABLE level,
-- which covers columns added later.
ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "discount" BIGINT NOT NULL DEFAULT 0;

-- A discount is money off, never money added, and never more than the line is
-- worth: `poTotals` clamps at zero and a negative line total would read as
-- credit the shop does not have.
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_discount_check"
  CHECK ("discount" >= 0 AND "discount" <= "qty" * "unitCost");

-- Tills already open learn the new shape on their next poll rather than at
-- their next reload (docs/store-on-postgres.md, Concurrency).
INSERT INTO "StoreChange" ("collection", "rowKey")
SELECT 'pos', "id" FROM "PurchaseOrder" WHERE "status" <> 'BATAL';
