-- Fase 5: operação do SDR. Tarefas (passos de cadência viram tarefas), atividades
-- (ligação, reunião, visita), mensagens (contato assistido, registro manual e
-- respostas coladas), cadências com passos e inscrições, oportunidades
-- (transferência ao Comercial) e notificações no app. Colunas de atividade no
-- lead. A cadência padrão e as regras de contato vêm do seed
-- (seed/sales-config.ts), que roda depois das migrações em todo deploy.

-- CreateEnum
CREATE TYPE "task_type" AS ENUM ('FIRST_CONTACT', 'FOLLOW_UP', 'REPLY_NEEDED', 'CALL', 'MEETING', 'HANDOFF_REVIEW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('OPEN', 'DONE', 'CANCELED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('CALL', 'MEETING', 'VISIT', 'EMAIL_EXTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "activity_outcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'VOICEMAIL', 'HELD', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "message_direction" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "message_mode" AS ENUM ('ASSISTED', 'API', 'LOGGED');

-- CreateEnum
CREATE TYPE "message_type" AS ENUM ('FIRST_CONTACT', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3', 'INTERESTED_REPLY', 'OBJECTION_REPLY', 'SCHEDULING', 'REACTIVATION', 'OTHER');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('PENDING_CONFIRMATION', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "reply_classification" AS ENUM ('INTERESTED', 'QUESTION', 'OBJECTION', 'NOT_INTERESTED', 'OPT_OUT', 'OUT_OF_OFFICE', 'WRONG_CONTACT', 'OTHER');

-- CreateEnum
CREATE TYPE "classification_source" AS ENUM ('RULE', 'AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "cadence_channel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE', 'ANY');

-- CreateEnum
CREATE TYPE "cadence_step_action" AS ENUM ('ASSISTED_MESSAGE', 'API_MESSAGE', 'CALL', 'TASK');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "enrollment_stop_reason" AS ENUM ('REPLIED', 'OPTED_OUT', 'MANUAL', 'STAGE_CHANGED', 'LEAD_ARCHIVED', 'CONTACT_INVALID');

-- CreateEnum
CREATE TYPE "opportunity_status" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "conversion_type" AS ENUM ('PARTNER', 'CUSTOMER');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "first_contact_at" TIMESTAMPTZ(3),
ADD COLUMN     "first_reply_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_contact_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_inbound_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_action_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "assignee_id" UUID,
    "type" "task_type" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "task_status" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "enrollment_id" UUID,
    "cadence_step_id" UUID,
    "message_type" "message_type",
    "channel" "cadence_channel",
    "overdue_notified_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "user_id" UUID,
    "type" "activity_type" NOT NULL,
    "direction" "message_direction" NOT NULL DEFAULT 'OUTBOUND',
    "outcome" "activity_outcome",
    "notes" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_seconds" INTEGER,
    "task_id" UUID,
    "contact_point_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "contact_point_id" UUID,
    "channel" "channel" NOT NULL,
    "direction" "message_direction" NOT NULL,
    "mode" "message_mode" NOT NULL,
    "message_type" "message_type",
    "body" TEXT,
    "status" "message_status" NOT NULL,
    "is_first_contact" BOOLEAN NOT NULL DEFAULT false,
    "task_id" UUID,
    "enrollment_id" UUID,
    "cadence_step_id" UUID,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "classification" "reply_classification",
    "classification_source" "classification_source",
    "classification_confidence" DECIMAL(4,3),
    "classified_by_id" UUID,
    "classified_at" TIMESTAMPTZ(3),
    "opt_out_match" TEXT,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadences" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "stop_on_reply" BOOLEAN NOT NULL DEFAULT true,
    "use_business_days" BOOLEAN NOT NULL DEFAULT true,
    "send_window_start" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "send_window_end" VARCHAR(5) NOT NULL DEFAULT '18:00',
    "no_response_after_days" INTEGER NOT NULL DEFAULT 3,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadence_steps" (
    "id" UUID NOT NULL,
    "cadence_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "channel" "cadence_channel" NOT NULL DEFAULT 'WHATSAPP',
    "action" "cadence_step_action" NOT NULL DEFAULT 'ASSISTED_MESSAGE',
    "message_type" "message_type" NOT NULL,
    "target_stage_key" TEXT,
    "instructions" TEXT,

    CONSTRAINT "cadence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadence_enrollments" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "cadence_id" UUID NOT NULL,
    "cadence_version" INTEGER NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'ACTIVE',
    "stop_reason" "enrollment_stop_reason",
    "current_step_position" INTEGER,
    "next_step_due_at" TIMESTAMPTZ(3),
    "last_step_executed_at" TIMESTAMPTZ(3),
    "paused_until" TIMESTAMPTZ(3),
    "enrolled_by_id" UUID,
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "cadence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "sdr_id" UUID,
    "sales_owner_id" UUID,
    "status" "opportunity_status" NOT NULL DEFAULT 'OPEN',
    "handoff_at" TIMESTAMPTZ(3) NOT NULL,
    "accept_due_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "sla_alerted_at" TIMESTAMPTZ(3),
    "qualification" JSONB NOT NULL,
    "product_interest" TEXT,
    "expected_value" DECIMAL(12,2),
    "won_at" TIMESTAMPTZ(3),
    "lost_at" TIMESTAMPTZ(3),
    "loss_reason_id" UUID,
    "conversion_type" "conversion_type",
    "notes" TEXT,
    "external_crm_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "lead_id" UUID,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_assignee_id_status_due_at_idx" ON "tasks"("assignee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_lead_id_status_idx" ON "tasks"("lead_id", "status");

-- CreateIndex
CREATE INDEX "tasks_status_due_at_idx" ON "tasks"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_open_enrollment_key" ON "tasks"("enrollment_id") WHERE (status = 'OPEN' AND enrollment_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "activities_lead_id_occurred_at_idx" ON "activities"("lead_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_idempotency_key_key" ON "messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "messages_lead_id_created_at_idx" ON "messages"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sent_by_id_status_idx" ON "messages"("sent_by_id", "status");

-- CreateIndex
CREATE INDEX "messages_first_contact_idx" ON "messages"("sent_by_id", "sent_at") WHERE (is_first_contact);

-- CreateIndex
CREATE UNIQUE INDEX "messages_provider_provider_message_id_key" ON "messages"("provider", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "cadences_key_key" ON "cadences"("key");

-- CreateIndex
CREATE UNIQUE INDEX "cadences_default_key" ON "cadences"("is_default") WHERE (is_default);

-- CreateIndex
CREATE UNIQUE INDEX "cadence_steps_cadence_id_position_key" ON "cadence_steps"("cadence_id", "position");

-- CreateIndex
CREATE INDEX "cadence_enrollments_status_next_step_due_at_idx" ON "cadence_enrollments"("status", "next_step_due_at");

-- CreateIndex
CREATE INDEX "cadence_enrollments_lead_id_enrolled_at_idx" ON "cadence_enrollments"("lead_id", "enrolled_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cadence_enrollments_active_key" ON "cadence_enrollments"("lead_id") WHERE (status = 'ACTIVE' OR status = 'PAUSED');

-- CreateIndex
CREATE INDEX "opportunities_sales_owner_id_status_idx" ON "opportunities"("sales_owner_id", "status");

-- CreateIndex
CREATE INDEX "opportunities_status_accept_due_at_idx" ON "opportunities"("status", "accept_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_open_key" ON "opportunities"("lead_id") WHERE (status = 'OPEN');

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_owner_id_last_inbound_at_idx" ON "leads"("owner_id", "last_inbound_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "cadence_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cadence_step_id_fkey" FOREIGN KEY ("cadence_step_id") REFERENCES "cadence_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_point_id_fkey" FOREIGN KEY ("contact_point_id") REFERENCES "contact_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_point_id_fkey" FOREIGN KEY ("contact_point_id") REFERENCES "contact_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "cadence_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_cadence_step_id_fkey" FOREIGN KEY ("cadence_step_id") REFERENCES "cadence_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_classified_by_id_fkey" FOREIGN KEY ("classified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadences" ADD CONSTRAINT "cadences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_steps" ADD CONSTRAINT "cadence_steps_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "cadences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_cadence_id_fkey" FOREIGN KEY ("cadence_id") REFERENCES "cadences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_enrolled_by_id_fkey" FOREIGN KEY ("enrolled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sdr_id_fkey" FOREIGN KEY ("sdr_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sales_owner_id_fkey" FOREIGN KEY ("sales_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_loss_reason_id_fkey" FOREIGN KEY ("loss_reason_id") REFERENCES "loss_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
