-- Fase 8: Instagram (docs/INTEGRATIONS.md §7.2, docs/DATABASE.md §4.12):
-- métricas públicas do perfil profissional do lead (Business Discovery),
-- comentários de leads nas publicações da Docline (com a resposta privada) e o
-- @ de quem escreveu nas conversas e nas mensagens sem lead.

-- CreateEnum
CREATE TYPE "instagram_profile_status" AS ENUM ('FOUND', 'NOT_FOUND', 'ERROR');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "handle" TEXT;

-- AlterTable
ALTER TABLE "inbound_unmatched" ADD COLUMN     "handle" TEXT;

-- CreateTable
CREATE TABLE "instagram_profiles" (
    "id" UUID NOT NULL,
    "contact_point_id" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "instagram_profile_status" NOT NULL,
    "followers_count" INTEGER,
    "media_count" INTEGER,
    "last_post_at" TIMESTAMPTZ(3),
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "instagram_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_comments" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "contact_point_id" UUID,
    "channel" "channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "external_comment_id" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "author_handle" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "media_product_type" TEXT,
    "parent_comment_id" TEXT,
    "body" TEXT,
    "commented_at" TIMESTAMPTZ(3) NOT NULL,
    "private_reply_message_id" UUID,
    "webhook_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instagram_profiles_contact_point_id_key" ON "instagram_profiles"("contact_point_id");

-- CreateIndex
CREATE INDEX "instagram_profiles_checked_at_idx" ON "instagram_profiles"("checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_comments_private_reply_message_id_key" ON "social_comments"("private_reply_message_id");

-- CreateIndex
CREATE INDEX "social_comments_lead_id_commented_at_idx" ON "social_comments"("lead_id", "commented_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "social_comments_provider_external_comment_id_key" ON "social_comments"("provider", "external_comment_id");

-- AddForeignKey
ALTER TABLE "instagram_profiles" ADD CONSTRAINT "instagram_profiles_contact_point_id_fkey" FOREIGN KEY ("contact_point_id") REFERENCES "contact_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_contact_point_id_fkey" FOREIGN KEY ("contact_point_id") REFERENCES "contact_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_private_reply_message_id_fkey" FOREIGN KEY ("private_reply_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

