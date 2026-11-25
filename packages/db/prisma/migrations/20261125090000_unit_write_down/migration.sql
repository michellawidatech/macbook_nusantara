-- ===========================================================================
-- A unit's value can be written down while the shop holds it (owner ask
-- 2026-11-24: "it might decrease by 500k because it has been broken while
-- they still store it … it will not decrease any bank balance … but it will
-- get into the PnL").
--
-- ADDITIVE: one new table, nothing backfilled. The unit's COGS is read as
-- buy + its share of the invoice's expenses + repairs − these rows; Profit &
-- Loss lists them as "Penurunan harga barang". No money moves, so this is
-- never an Expense and never on Income & Expense.
--
-- Editable and deletable while the unit is held (owner choice A) — the
-- twelfth sanctioned hard delete, scoped to this table: `nusantara_app`
-- gets DELETE here and nowhere else. `nusantara_agent` gets nothing.
-- ===========================================================================

-- CreateTable
CREATE TABLE "UnitWriteDown" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitWriteDown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnitWriteDown_unitId_idx" ON "UnitWriteDown"("unitId");

-- CreateIndex
CREATE INDEX "UnitWriteDown_staffId_idx" ON "UnitWriteDown"("staffId");

-- AddForeignKey
ALTER TABLE "UnitWriteDown" ADD CONSTRAINT "UnitWriteDown_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitWriteDown" ADD CONSTRAINT "UnitWriteDown_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "UnitWriteDown" ADD CONSTRAINT "UnitWriteDown_amount_check" CHECK ("amount" > 0);
ALTER TABLE "UnitWriteDown" ADD CONSTRAINT "UnitWriteDown_reason_check" CHECK (btrim("reason") <> '');
ALTER TABLE "UnitWriteDown" ADD CONSTRAINT "UnitWriteDown_date_check" CHECK ("date" ~ '^\d{4}-\d{2}-\d{2}$');

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_app') THEN
    RAISE EXCEPTION
      'missing database role nusantara_app. Run packages/db/prisma/roles.sql as a superuser first.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nusantara_agent') THEN
    REVOKE ALL ON "UnitWriteDown" FROM nusantara_agent;
  END IF;
END
$grants$;

REVOKE TRUNCATE ON "UnitWriteDown" FROM nusantara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "UnitWriteDown" TO nusantara_app;
