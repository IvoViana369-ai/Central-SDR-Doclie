-- Fase 4: pipeline (etapas, motivos de perda, histórico com duração) e score
-- (modelos versionados, regras, histórico). A configuração inicial (17 etapas,
-- motivos e modelo v1) e a etapa dos leads existentes vêm do seed
-- (seed/sales-config.ts), que roda depois das migrações em todo deploy.

-- CreateEnum
CREATE TYPE "stage_category" AS ENUM ('OPEN', 'WON', 'LOST', 'PARKED');

-- CreateEnum
CREATE TYPE "stage_owner" AS ENUM ('SDR', 'SALES');

-- CreateEnum
CREATE TYPE "stage_change_source" AS ENUM ('CADENCE', 'INBOUND', 'IMPORT', 'HANDOFF', 'RULE', 'MERGE');

-- CreateEnum
CREATE TYPE "score_band" AS ENUM ('COLD', 'WARM', 'HOT', 'PRIORITY');

-- CreateEnum
CREATE TYPE "scoring_model_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "score_normalization" AS ENUM ('CLAMP', 'SCALE');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "converted_at" TIMESTAMPTZ(3),
ADD COLUMN     "loss_reason_id" UUID,
ADD COLUMN     "lost_at" TIMESTAMPTZ(3),
ADD COLUMN     "pipeline_id" UUID,
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "score_band" "score_band",
ADD COLUMN     "score_computed_at" TIMESTAMPTZ(3),
ADD COLUMN     "score_model_id" UUID,
ADD COLUMN     "stage_entered_at" TIMESTAMPTZ(3),
ADD COLUMN     "stage_id" UUID;

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "stage_category" NOT NULL,
    "owner_role" "stage_owner",
    "color" TEXT NOT NULL DEFAULT 'slate',
    "requires_loss_reason" BOOLEAN NOT NULL DEFAULT false,
    "sla_hours" INTEGER,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_reasons" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applies_to_stage_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_history" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "changed_by_id" UUID,
    "automation_source" "stage_change_source",
    "loss_reason_id" UUID,
    "note" TEXT,
    "entered_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_cities" (
    "municipality_code" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "priority_cities_pkey" PRIMARY KEY ("municipality_code")
);

-- CreateTable
CREATE TABLE "scoring_models" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "scoring_model_status" NOT NULL DEFAULT 'DRAFT',
    "normalization" "score_normalization" NOT NULL DEFAULT 'CLAMP',
    "bands" JSONB NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "activated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scoring_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_rules" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "criterion_key" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "scoring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_score_history" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "score_band" NOT NULL,
    "previous_score" INTEGER,
    "previous_band" "score_band",
    "breakdown" JSONB NOT NULL,
    "trigger" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_key_key" ON "pipelines"("key");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_default_key" ON "pipelines"("is_default") WHERE (is_default);

-- CreateIndex
CREATE INDEX "pipeline_stages_pipeline_id_position_idx" ON "pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_key_key" ON "pipeline_stages"("pipeline_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "loss_reasons_key_key" ON "loss_reasons"("key");

-- CreateIndex
CREATE INDEX "lead_stage_history_lead_id_entered_at_idx" ON "lead_stage_history"("lead_id", "entered_at" DESC);

-- CreateIndex
CREATE INDEX "lead_stage_history_to_stage_id_entered_at_idx" ON "lead_stage_history"("to_stage_id", "entered_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_stage_history_open_key" ON "lead_stage_history"("lead_id") WHERE (left_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "scoring_models_version_key" ON "scoring_models"("version");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_models_active_key" ON "scoring_models"("status") WHERE (status = 'ACTIVE');

-- CreateIndex
CREATE INDEX "scoring_rules_model_id_position_idx" ON "scoring_rules"("model_id", "position");

-- CreateIndex
CREATE INDEX "lead_score_history_lead_id_computed_at_idx" ON "lead_score_history"("lead_id", "computed_at" DESC);

-- CreateIndex
CREATE INDEX "leads_stage_id_status_score_idx" ON "leads"("stage_id", "status", "score" DESC);

-- CreateIndex
CREATE INDEX "leads_owner_id_stage_id_idx" ON "leads"("owner_id", "stage_id");

-- CreateIndex
CREATE INDEX "leads_score_band_idx" ON "leads"("score_band");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_score_model_id_fkey" FOREIGN KEY ("score_model_id") REFERENCES "scoring_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_cities" ADD CONSTRAINT "priority_cities_municipality_code_fkey" FOREIGN KEY ("municipality_code") REFERENCES "municipalities"("ibge_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_cities" ADD CONSTRAINT "priority_cities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_rules" ADD CONSTRAINT "scoring_rules_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "scoring_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_score_history" ADD CONSTRAINT "lead_score_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_score_history" ADD CONSTRAINT "lead_score_history_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "scoring_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
