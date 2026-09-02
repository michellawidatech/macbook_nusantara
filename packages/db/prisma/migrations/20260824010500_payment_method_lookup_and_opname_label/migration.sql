-- Payment methods become a lookup table.
--
-- Same reasoning as ReferralSource: the shop must be able to add a way of
-- paying without waiting for a migration. The enum values are carried over as
-- built-in rows rather than dropped, so nothing that already happened loses
-- the name it happened under.
--
-- Written by hand rather than generated: `prisma migrate dev` sees this as a
-- destructive column drop and offers to reset, which would take the 1 795
-- seeded orders with it. The UPDATE below is the whole point of the file.

CREATE TABLE "PaymentMethod" (
    "id"        TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "builtIn"   BOOLEAN NOT NULL,
    "forPo"     BOOLEAN NOT NULL,
    "forSale"   BOOLEAN NOT NULL,
    "active"    BOOLEAN NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");

-- Every historical enum value, so no existing Payment is orphaned. `forPo` is
-- true only for the three the owner named for supplier payments (2026-08-24);
-- the rest are sale-side. Staff can move any of them in Settings.
INSERT INTO "PaymentMethod"
  ("id", "code", "label", "builtIn", "forPo", "forSale", "active", "sortOrder", "createdAt")
VALUES
  ('pm_tunai',        'TUNAI',        'Cash',              true,  true,  true,  true, 1,  now()),
  ('pm_kartu_kredit', 'KARTU_KREDIT', 'Credit card',       true,  true,  true,  true, 2,  now()),
  ('pm_deposit',      'DEPOSIT',      'Deposit',           true,  true,  false, true, 3,  now()),
  ('pm_qris',         'QRIS',         'QRIS',              true,  false, true,  true, 4,  now()),
  ('pm_transfer',     'TRANSFER',     'Bank transfer',     true,  false, true,  true, 5,  now()),
  ('pm_debit',        'DEBIT',        'Debit card',        true,  false, true,  true, 6,  now()),
  ('pm_cicilan',      'CICILAN',      'Instalment',        true,  false, true,  true, 7,  now()),
  ('pm_cod',          'COD',          'Cash on delivery',  true,  false, true,  true, 8,  now()),
  ('pm_bayar_toko',   'BAYAR_TOKO',   'Pay in store',      true,  false, true,  true, 9,  now()),
  ('pm_tempo',        'TEMPO',        'Terms',             true,  false, true,  true, 10, now()),
  -- Escrow. The app reads this one by code, which is what builtIn protects.
  ('pm_marketplace',  'MARKETPLACE',  'Marketplace escrow', true, false, true,  true, 11, now());

ALTER TABLE "Payment" ADD COLUMN "methodId" TEXT;

UPDATE "Payment" p
   SET "methodId" = pm."id"
  FROM "PaymentMethod" pm
 WHERE pm."code" = p."method"::text;

-- Fail loudly rather than silently NULL-ing a payment we failed to map.
DO $$
DECLARE unmapped bigint;
BEGIN
  SELECT count(*) INTO unmapped FROM "Payment" WHERE "methodId" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'PaymentMethod backfill missed % row(s)', unmapped;
  END IF;
END $$;

ALTER TABLE "Payment" ALTER COLUMN "methodId" SET NOT NULL;
ALTER TABLE "Payment" DROP COLUMN "method";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_methodId_fkey"
  FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_methodId_idx" ON "Payment"("methodId");

DROP TYPE "PayMethod";

-- Stock opname: the staff-typed batch label. `code` stays the identifier.
ALTER TABLE "OpnameSession" ADD COLUMN "label" TEXT;

-- Grants, matching the pattern in 20260820002832.
GRANT SELECT, INSERT, UPDATE ON "PaymentMethod" TO nusantara_app;
GRANT SELECT ON "PaymentMethod" TO nusantara_agent;
GRANT SELECT ON "PaymentMethod" TO nusantara_readonly;
