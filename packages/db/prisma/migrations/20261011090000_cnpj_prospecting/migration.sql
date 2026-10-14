-- Fase 9: dados abertos do CNPJ e prospecção (docs/INTEGRATIONS.md §9.1,
-- docs/DATABASE.md §4.11): recorte dos estabelecimentos ativos de contabilidade
-- da base aberta da Receita Federal (separado de leads), registro das cargas
-- mensais (uma de cada vez) e as buscas da Prospecção com a decisão de uma
-- pessoa para cada resultado.
-- CreateEnum
CREATE TYPE "registry_ingestion_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "prospecting_decision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "registry_ingestions" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" CHAR(7) NOT NULL,
    "status" "registry_ingestion_status" NOT NULL DEFAULT 'RUNNING',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "requested_by_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registry_ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registry_companies" (
    "cnpj" VARCHAR(14) NOT NULL,
    "cnpj_root" VARCHAR(8) NOT NULL,
    "is_head_office" BOOLEAN NOT NULL,
    "company_name" TEXT,
    "trade_name" TEXT,
    "name_search" TEXT NOT NULL,
    "legal_nature" VARCHAR(4),
    "is_individual_entrepreneur" BOOLEAN NOT NULL DEFAULT false,
    "company_size" VARCHAR(2),
    "cnae_main" VARCHAR(7) NOT NULL,
    "cnaes_secondary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opened_at" DATE,
    "municipality_code" INTEGER,
    "receita_municipality_code" INTEGER NOT NULL,
    "city_name" TEXT,
    "uf" CHAR(2) NOT NULL,
    "address_line" TEXT,
    "address_number" TEXT,
    "address_complement" TEXT,
    "neighborhood" TEXT,
    "postal_code" CHAR(8),
    "phone_1" TEXT,
    "phone_2" TEXT,
    "email" TEXT,
    "dataset_reference" CHAR(7) NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registry_companies_pkey" PRIMARY KEY ("cnpj")
);

-- CreateTable
CREATE TABLE "prospecting_searches" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "dataset_reference" CHAR(7),
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "requested_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "prospecting_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospecting_results" (
    "id" UUID NOT NULL,
    "search_id" UUID NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "match_status" "import_match_status" NOT NULL,
    "matched_lead_id" UUID,
    "match_reasons" JSONB NOT NULL DEFAULT '[]',
    "decision" "prospecting_decision" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,
    "created_lead_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospecting_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registry_ingestions_started_at_idx" ON "registry_ingestions"("started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "registry_ingestions_running_key" ON "registry_ingestions"("status") WHERE (status = 'RUNNING');

-- CreateIndex
CREATE INDEX "registry_companies_uf_municipality_code_idx" ON "registry_companies"("uf", "municipality_code");

-- CreateIndex
CREATE INDEX "registry_companies_cnpj_root_idx" ON "registry_companies"("cnpj_root");

-- CreateIndex
CREATE INDEX "registry_companies_dataset_reference_idx" ON "registry_companies"("dataset_reference");

-- CreateIndex
CREATE INDEX "registry_companies_name_search_trgm_idx" ON "registry_companies" USING GIN ("name_search" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "prospecting_searches_created_at_idx" ON "prospecting_searches"("created_at" DESC);

-- CreateIndex
CREATE INDEX "prospecting_results_provider_ref_decision_idx" ON "prospecting_results"("provider_ref", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "prospecting_results_search_id_provider_ref_key" ON "prospecting_results"("search_id", "provider_ref");

-- AddForeignKey
ALTER TABLE "registry_ingestions" ADD CONSTRAINT "registry_ingestions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry_companies" ADD CONSTRAINT "registry_companies_municipality_code_fkey" FOREIGN KEY ("municipality_code") REFERENCES "municipalities"("ibge_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_searches" ADD CONSTRAINT "prospecting_searches_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_results" ADD CONSTRAINT "prospecting_results_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "prospecting_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_results" ADD CONSTRAINT "prospecting_results_matched_lead_id_fkey" FOREIGN KEY ("matched_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_results" ADD CONSTRAINT "prospecting_results_created_lead_id_fkey" FOREIGN KEY ("created_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospecting_results" ADD CONSTRAINT "prospecting_results_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

