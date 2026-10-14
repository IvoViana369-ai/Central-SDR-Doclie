-- Fase 10: campanhas (docs/DATABASE.md §4.10). Uma campanha congela uma
-- seleção de leads (filtro da lista), avalia a elegibilidade de cada um com
-- motivos, distribui os aptos entre os SDRs escolhidos, sorteia a abordagem em
-- teste (A/B) e libera os leads para a cadência dentro do limite diário de cada
-- SDR. Nada é enviado pela campanha: os contatos seguem o gate de sempre.
-- `campaign_id` em cadence_enrollments e messages registra a atribuição.
-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'BUILDING', 'READY', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "campaign_lead_eligibility" AS ENUM ('ELIGIBLE', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "campaign_lead_status" AS ENUM ('PENDING', 'RELEASED', 'SKIPPED', 'REMOVED');

-- AlterEnum
ALTER TYPE "assignment_strategy" ADD VALUE 'CAMPAIGN';

-- AlterTable
ALTER TABLE "cadence_enrollments" ADD COLUMN     "campaign_id" UUID;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "campaign_id" UUID;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "filter_definition" JSONB NOT NULL,
    "filter_label" TEXT,
    "channel" "channel" NOT NULL,
    "cadence_id" UUID,
    "owner_id" UUID NOT NULL,
    "daily_contact_limit" INTEGER NOT NULL,
    "min_days_since_last_contact" INTEGER NOT NULL DEFAULT 30,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "snapshot_at" TIMESTAMPTZ(3),
    "build_stats" JSONB,
    "build_error" TEXT,
    "activated_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_sdrs" (
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "campaign_sdrs_pkey" PRIMARY KEY ("campaign_id","user_id")
);

-- CreateTable
CREATE TABLE "campaign_variants" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "label" VARCHAR(1) NOT NULL,
    "approach_id" UUID NOT NULL,

    CONSTRAINT "campaign_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_leads" (
    "campaign_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "eligibility" "campaign_lead_eligibility" NOT NULL,
    "ineligibility_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "campaign_lead_status" NOT NULL DEFAULT 'PENDING',
    "assigned_to_id" UUID,
    "variant_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "enrollment_id" UUID,
    "contacted_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "replied_at" TIMESTAMPTZ(3),
    "interested_at" TIMESTAMPTZ(3),
    "opportunity_at" TIMESTAMPTZ(3),
    "converted_at" TIMESTAMPTZ(3),
    "opted_out_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaign_leads_pkey" PRIMARY KEY ("campaign_id","lead_id")
);

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_created_at_idx" ON "campaigns"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_variants_campaign_id_label_key" ON "campaign_variants"("campaign_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_variants_campaign_id_approach_id_key" ON "campaign_variants"("campaign_id", "approach_id");

-- CreateIndex
CREATE INDEX "campaign_leads_campaign_id_status_assigned_to_id_idx" ON "campaign_leads"("campaign_id", "status", "assigned_to_id");

-- CreateIndex
CREATE INDEX "campaign_leads_lead_id_idx" ON "campaign_leads"("lead_id");

-- CreateIndex
CREATE INDEX "cadence_enrollments_campaign_id_idx" ON "cadence_enrollments"("campaign_id");

-- CreateIndex
CREATE INDEX "messages_campaign_id_idx" ON "messages"("campaign_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "cadences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sdrs" ADD CONSTRAINT "campaign_sdrs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sdrs" ADD CONSTRAINT "campaign_sdrs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_approach_id_fkey" FOREIGN KEY ("approach_id") REFERENCES "approaches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "campaign_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "cadence_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

