-- AlterTable
ALTER TABLE "UnitEvent" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "WarrantyClaim" ALTER COLUMN "code" SET DEFAULT next_doc_code('KG'::text);

-- CreateIndex
CREATE UNIQUE INDEX "UnitEvent_code_key" ON "UnitEvent"("code");


-- No new table, so no new grants: the app role's privileges on UnitEvent are
-- unchanged and remain INSERT + SELECT only (08 §2 invariant 14). A transfer
-- number is written once, with the event, and never edited.
