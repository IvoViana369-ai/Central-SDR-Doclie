-- Fase 7: WhatsApp Cloud API (docs/INTEGRATIONS.md §6.2, docs/DATABASE.md §4.11):
-- modelos aprovados, conversas com janela de atendimento, histórico de status,
-- inbox de webhooks, mensagens de números sem lead, situação da integração e
-- opt-in do WhatsApp por número (contact_permissions.contact_point_id).

-- CreateEnum
CREATE TYPE "whatsapp_template_category" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "inbound_unmatched_status" AS ENUM ('PENDING', 'LINKED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "integration_health" AS ENUM ('UNKNOWN', 'ACTIVE', 'DEGRADED', 'ERROR');

-- AlterTable
ALTER TABLE "contact_permissions" ADD COLUMN     "evidence_message_id" UUID;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "billable" BOOLEAN,
ADD COLUMN     "conversation_id" UUID,
ADD COLUMN     "cost_estimate_usd" DECIMAL(10,6),
ADD COLUMN     "delivered_at" TIMESTAMPTZ(3),
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "error_detail" TEXT,
ADD COLUMN     "failed_at" TIMESTAMPTZ(3),
ADD COLUMN     "pricing_category" TEXT,
ADD COLUMN     "read_at" TIMESTAMPTZ(3),
ADD COLUMN     "send_attempted_at" TIMESTAMPTZ(3),
ADD COLUMN     "template_params" JSONB,
ADD COLUMN     "whatsapp_template_id" UUID;

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "meta_template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "whatsapp_template_category" NOT NULL,
    "status" TEXT NOT NULL,
    "quality_score" TEXT,
    "rejected_reason" TEXT,
    "parameter_format" TEXT NOT NULL DEFAULT 'POSITIONAL',
    "components" JSONB NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_parameters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supported" BOOLEAN NOT NULL DEFAULT true,
    "unsupported_reason" TEXT,
    "approach_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removed_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "contact_point_id" UUID,
    "external_thread_id" TEXT NOT NULL,
    "profile_name" TEXT,
    "last_inbound_at" TIMESTAMPTZ(3),
    "last_outbound_at" TIMESTAMPTZ(3),
    "service_window_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_status_events" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "status" "message_status" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "webhook_event_id" UUID,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "contact_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "webhook_event_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_unmatched" (
    "id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "external_thread_id" TEXT NOT NULL,
    "phone_e164" TEXT,
    "profile_name" TEXT,
    "message_kind" TEXT NOT NULL,
    "body" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "candidate_lead_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "webhook_event_id" UUID,
    "status" "inbound_unmatched_status" NOT NULL DEFAULT 'PENDING',
    "resolved_lead_id" UUID,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_unmatched_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "integration_health" NOT NULL DEFAULT 'UNKNOWN',
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_check_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_meta_template_id_key" ON "whatsapp_templates"("meta_template_id");

-- CreateIndex
CREATE INDEX "whatsapp_templates_name_language_idx" ON "whatsapp_templates"("name", "language");

-- CreateIndex
CREATE INDEX "conversations_channel_external_thread_id_idx" ON "conversations"("channel", "external_thread_id");

-- CreateIndex
CREATE INDEX "conversations_last_inbound_at_idx" ON "conversations"("last_inbound_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_lead_id_channel_external_thread_id_key" ON "conversations"("lead_id", "channel", "external_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_status_events_message_id_status_key" ON "message_status_events"("message_id", "status");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");

-- CreateIndex
CREATE INDEX "webhook_events_contact_hashes_idx" ON "webhook_events" USING GIN ("contact_hashes");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_external_event_id_key" ON "webhook_events"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "inbound_unmatched_status_received_at_idx" ON "inbound_unmatched"("status", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_unmatched_provider_provider_message_id_key" ON "inbound_unmatched"("provider", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_provider_key" ON "integration_connections"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "contact_permissions_point_channel_key" ON "contact_permissions"("contact_point_id", "channel") WHERE (contact_point_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_channel_mode_sent_at_idx" ON "messages"("channel", "mode", "sent_at");

-- AddForeignKey
ALTER TABLE "contact_permissions" ADD CONSTRAINT "contact_permissions_evidence_message_id_fkey" FOREIGN KEY ("evidence_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_whatsapp_template_id_fkey" FOREIGN KEY ("whatsapp_template_id") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_approach_id_fkey" FOREIGN KEY ("approach_id") REFERENCES "approaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_point_id_fkey" FOREIGN KEY ("contact_point_id") REFERENCES "contact_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_unmatched" ADD CONSTRAINT "inbound_unmatched_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_unmatched" ADD CONSTRAINT "inbound_unmatched_resolved_lead_id_fkey" FOREIGN KEY ("resolved_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_unmatched" ADD CONSTRAINT "inbound_unmatched_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

