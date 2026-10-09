-- Fase 6: IA de prospecção (docs/AI-SDR.md). Gerações com contexto enviado,
-- saída, edição humana, custo e desfecho; base de conhecimento aprovada da
-- Docline (única fonte de fatos sobre a empresa); abordagens comparáveis; e,
-- nas mensagens, o rascunho de origem, a abordagem e quem aprovou o texto.

-- CreateEnum
CREATE TYPE "ai_generation_kind" AS ENUM ('FIRST_CONTACT', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3', 'INTERESTED_REPLY', 'OBJECTION_REPLY', 'SCHEDULING', 'REACTIVATION', 'REPLY_CLASSIFICATION');

-- CreateEnum
CREATE TYPE "ai_generation_status" AS ENUM ('GENERATED', 'EDITED', 'APPROVED', 'DISCARDED', 'SENT', 'FAILED', 'BLOCKED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "ai_generation_id" UUID,
ADD COLUMN     "approach_id" UUID,
ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by_id" UUID;

-- CreateTable
CREATE TABLE "approaches" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hypothesis" TEXT,
    "guidance" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_items" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "kind" "ai_generation_kind" NOT NULL,
    "channel" "channel",
    "approach_id" UUID,
    "source_message_id" UUID,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "output" JSONB,
    "text_generated" TEXT,
    "text_final" TEXT,
    "edit_distance_ratio" DECIMAL(4,3),
    "guardrail_flags" JSONB NOT NULL DEFAULT '[]',
    "status" "ai_generation_status" NOT NULL,
    "discard_reason" TEXT,
    "rating" INTEGER,
    "feedback" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "cost_estimate_usd" DECIMAL(10,6),
    "latency_ms" INTEGER,
    "stop_reason" TEXT,
    "error_code" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approaches_key_key" ON "approaches"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_items_key_key" ON "ai_knowledge_items"("key");

-- CreateIndex
CREATE INDEX "ai_generations_lead_id_created_at_idx" ON "ai_generations"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_generations_requested_by_id_created_at_idx" ON "ai_generations"("requested_by_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generations_created_at_idx" ON "ai_generations"("created_at");

-- CreateIndex
CREATE INDEX "ai_generations_source_message_id_idx" ON "ai_generations"("source_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_ai_generation_id_key" ON "messages"("ai_generation_id");

-- CreateIndex
CREATE INDEX "messages_approach_id_sent_at_idx" ON "messages"("approach_id", "sent_at");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_generation_id_fkey" FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_approach_id_fkey" FOREIGN KEY ("approach_id") REFERENCES "approaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approaches" ADD CONSTRAINT "approaches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_items" ADD CONSTRAINT "ai_knowledge_items_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_approach_id_fkey" FOREIGN KEY ("approach_id") REFERENCES "approaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

