-- Índices da deduplicação (mesmo site) e da anonimização (linhas de importação de um lead).

-- CreateIndex
CREATE INDEX "import_rows_result_lead_id_idx" ON "import_rows"("result_lead_id");

-- CreateIndex
CREATE INDEX "import_rows_matched_lead_id_idx" ON "import_rows"("matched_lead_id");

-- CreateIndex
CREATE INDEX "leads_website_domain_idx" ON "leads"("website_domain");
