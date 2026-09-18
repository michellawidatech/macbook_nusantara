-- Constraints for the store on PostgreSQL that name an enum value added by
-- 20260913120000_store_on_postgres, and so could not live in it: PostgreSQL
-- refuses a new enum value inside the transaction that created it.

-- A discount is one of three shapes, and exactly one shape's fields are set
-- (the rule 20260815140541 wrote for two shapes, extended to BUNDLE).
ALTER TABLE "Discount" DROP CONSTRAINT "Discount_type_fields_check";
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_type_fields_check"
  CHECK (
    ("type" = 'PCT'     AND "pct" IS NOT NULL AND "pct" BETWEEN 1 AND 100
                        AND "amountRp" IS NULL
                        AND "bundleQty" IS NULL AND "bundlePriceRp" IS NULL)
 OR ("type" = 'NOMINAL' AND "amountRp" IS NOT NULL AND "amountRp" > 0
                        AND "pct" IS NULL AND "maxRp" IS NULL
                        AND "bundleQty" IS NULL AND "bundlePriceRp" IS NULL)
 OR ("type" = 'BUNDLE'  AND "bundleQty" IS NOT NULL AND "bundleQty" >= 1
                        AND "bundlePriceRp" IS NOT NULL AND "bundlePriceRp" >= 0
                        AND "pct" IS NULL AND "amountRp" IS NULL AND "maxRp" IS NULL)
  );

-- Money that cannot be negative, on the tables this change added.
ALTER TABLE "OrderFee" ADD CONSTRAINT "OrderFee_amount_nonneg_check"
  CHECK ("amount" >= 0);
ALTER TABLE "ServiceFee" ADD CONSTRAINT "ServiceFee_amount_nonneg_check"
  CHECK ("amount" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_nonneg_check"
  CHECK ("amount" >= 0);
ALTER TABLE "ManualIncome" ADD CONSTRAINT "ManualIncome_amount_nonneg_check"
  CHECK ("amount" >= 0);
ALTER TABLE "SupplierDeposit" ADD CONSTRAINT "SupplierDeposit_amount_nonneg_check"
  CHECK ("amount" >= 0);
ALTER TABLE "DepositAllocation" ADD CONSTRAINT "DepositAllocation_amount_nonneg_check"
  CHECK ("amount" >= 0);
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_money_nonneg_check"
  CHECK ("gross" >= 0 AND "received" >= 0);
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_price_nonneg_check"
  CHECK (("price" IS NULL OR "price" >= 0) AND ("marketPrice" IS NULL OR "marketPrice" >= 0));
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_discount_nonneg_check"
  CHECK ("discount" >= 0);
