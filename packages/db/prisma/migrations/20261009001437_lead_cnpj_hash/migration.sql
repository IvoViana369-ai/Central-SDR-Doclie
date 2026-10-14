-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "cnpj_hash" TEXT;

-- CreateIndex
CREATE INDEX "leads_cnpj_hash_idx" ON "leads"("cnpj_hash");
