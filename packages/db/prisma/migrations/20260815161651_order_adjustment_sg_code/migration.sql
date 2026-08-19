-- AlterTable
ALTER TABLE "OrderAdjustment" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrderAdjustment_code_key" ON "OrderAdjustment"("code");

