-- Two owner answers of 2026-09-22 about money that settles a debt.
--
-- 1. `inBalance` on `Payment` and `SupplierDeposit`. False means the money
--    settled a debt WITHOUT passing through the shop's cash or bank — the
--    owner paid a supplier from their own account. The debt is paid; Income &
--    Expense's balance must not move. A payment larger than every invoice
--    leaves its remainder as a deposit, and that remainder carries the same
--    switch, which is why the deposit has one too.
--
--    Default true, and the default is the honest reading of history: until
--    today there was no way to record money that did not go through the shop,
--    so every existing row did.
--
-- 2. `Payment.supplierId` / `Payment.customerId`. A debt from before this app
--    (`Supplier.openingBalance`, `Customer.openingBalance`) has no purchase
--    order or sale to hang a payment off, so the payment names the party. A
--    supplier's is money OUT (KELUAR), a customer's money IN (MASUK).
--
-- Additive, and safe for the release before this one: the new columns are
-- nullable or defaulted, that release never writes the new parents, and every
-- row it writes names exactly one of `orderId` / `poId` — which the widened
-- invariant 7 still accepts.
--
-- No GRANT: "Payment" and "SupplierDeposit" are granted to nusantara_app (and
-- SELECT to nusantara_readonly) at TABLE level, which covers columns added
-- later.
--
-- No StoreChange rows: nothing any till has already projected changes shape —
-- an existing row is `inBalance = true`, which projects as an absent key, and
-- no supplier or customer has an opening payment yet.

ALTER TABLE "Payment"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "inBalance" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SupplierDeposit"
  ADD COLUMN "inBalance" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Payment_supplierId_idx" ON "Payment"("supplierId");

CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_supplierId_fkey" FOREIGN KEY ("supplierId")
  REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId")
  REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariant 7, widened (it was `("orderId" IS NULL) <> ("poId" IS NULL)`,
-- 20260815060658): a payment still belongs to exactly one parent, and the
-- parent may now be the party itself.
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_one_parent_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_parent_check"
  CHECK (num_nonnulls("orderId", "poId", "supplierId", "customerId") = 1);

-- The shop pays a supplier and is paid by a customer. The other way round is
-- a refund, and a refund belongs to the sale or the invoice it undoes.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_supplier_direction_check"
  CHECK ("supplierId" IS NULL OR "direction" = 'KELUAR');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customer_direction_check"
  CHECK ("customerId" IS NULL OR "direction" = 'MASUK');
