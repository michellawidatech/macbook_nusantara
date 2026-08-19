-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "auth0Sub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Staff_auth0Sub_key" ON "Staff"("auth0Sub");

