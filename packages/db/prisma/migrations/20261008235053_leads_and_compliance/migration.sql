-- CreateEnum
CREATE TYPE "legal_basis" AS ENUM ('CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT', 'NOT_ASSESSED');

-- CreateEnum
CREATE TYPE "lead_type" AS ENUM ('ACCOUNTING_FIRM', 'ACCOUNTANT', 'REFERRAL_PARTNER', 'COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('ACTIVE', 'ARCHIVED', 'MERGED', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('CONTACTABLE', 'RESTRICTED', 'NO_LEGAL_BASIS', 'OPTED_OUT', 'BLOCKED');

-- CreateEnum
CREATE TYPE "lead_created_via" AS ENUM ('MANUAL', 'IMPORT', 'PROSPECTING', 'API', 'MERGE');

-- CreateEnum
CREATE TYPE "lead_person_status" AS ENUM ('ACTIVE', 'LEFT', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "contact_point_type" AS ENUM ('PHONE', 'EMAIL', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "phone_kind" AS ENUM ('MOBILE', 'LANDLINE', 'SERVICE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "whatsapp_status" AS ENUM ('UNKNOWN', 'PROBABLE', 'CONFIRMED', 'NOT_ON_WHATSAPP');

-- CreateEnum
CREATE TYPE "contact_point_status" AS ENUM ('ACTIVE', 'INVALID', 'BOUNCED', 'WRONG_PERSON', 'REMOVED');

-- CreateEnum
CREATE TYPE "assignment_strategy" AS ENUM ('MANUAL', 'CLAIM', 'IMPORT', 'ROUND_ROBIN', 'TERRITORY', 'PRIORITY', 'AVAILABILITY');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE', 'SMS', 'OTHER');

-- CreateEnum
CREATE TYPE "contact_channel" AS ENUM ('ALL', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "opt_in_status" AS ENUM ('NONE', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "opt_in_method" AS ENUM ('INBOUND_MESSAGE', 'FORM', 'EVENT', 'EXISTING_RELATIONSHIP', 'VERBAL_RECORDED', 'CLICK_TO_WHATSAPP');

-- CreateEnum
CREATE TYPE "suppression_type" AS ENUM ('PHONE', 'EMAIL', 'INSTAGRAM', 'CNPJ', 'LEAD');

-- CreateEnum
CREATE TYPE "suppression_scope" AS ENUM ('ALL_CHANNELS', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "suppression_reason" AS ENUM ('OPT_OUT', 'DATA_SUBJECT_REQUEST', 'COMPLAINT', 'LEGAL', 'INVALID_CONTACT', 'INTERNAL_DECISION');

-- CreateEnum
CREATE TYPE "suppression_source" AS ENUM ('INBOUND_KEYWORD', 'SDR', 'ADMIN', 'IMPORT', 'WEBHOOK', 'DSR');

-- CreateEnum
CREATE TYPE "data_subject_request_type" AS ENUM ('CONFIRMATION', 'ACCESS', 'CORRECTION', 'ANONYMIZATION', 'DELETION', 'PORTABILITY', 'SHARING_INFO', 'CONSENT_REVOCATION', 'OPPOSITION');

-- CreateEnum
CREATE TYPE "data_subject_request_status" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_legal_basis" "legal_basis" NOT NULL DEFAULT 'NOT_ASSESSED',
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_search" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "code" SERIAL NOT NULL,
    "company_name" TEXT,
    "trade_name" TEXT,
    "display_name" TEXT NOT NULL,
    "name_search" TEXT NOT NULL,
    "name_core" TEXT NOT NULL,
    "lead_type" "lead_type" NOT NULL DEFAULT 'ACCOUNTING_FIRM',
    "segment_id" UUID,
    "category" TEXT,
    "cnae_main" VARCHAR(7),
    "cnpj" VARCHAR(14),
    "cnpj_root" VARCHAR(8),
    "address_line" TEXT,
    "address_number" TEXT,
    "address_complement" TEXT,
    "neighborhood" TEXT,
    "city_raw" TEXT,
    "municipality_code" INTEGER,
    "state_uf" CHAR(2),
    "postal_code" CHAR(8),
    "website_url" TEXT,
    "website_domain" TEXT,
    "origin_source_id" UUID NOT NULL,
    "origin_detail" TEXT,
    "origin_url" TEXT,
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "created_via" "lead_created_via" NOT NULL DEFAULT 'MANUAL',
    "owner_id" UUID,
    "previous_owner_id" UUID,
    "assigned_at" TIMESTAMPTZ(3),
    "has_phone" BOOLEAN NOT NULL DEFAULT false,
    "has_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "has_email" BOOLEAN NOT NULL DEFAULT false,
    "has_instagram" BOOLEAN NOT NULL DEFAULT false,
    "has_website" BOOLEAN NOT NULL DEFAULT false,
    "contact_status" "contact_status" NOT NULL DEFAULT 'NO_LEGAL_BASIS',
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "lead_status" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "description" TEXT,
    "is_test_data" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_people" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT,
    "role_title" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_decision_maker" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" "lead_person_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_points" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "person_id" UUID,
    "type" "contact_point_type" NOT NULL,
    "value_raw" TEXT NOT NULL,
    "value_normalized" TEXT NOT NULL,
    "value_hash" TEXT NOT NULL,
    "label" TEXT,
    "phone_kind" "phone_kind",
    "whatsapp_status" "whatsapp_status" NOT NULL DEFAULT 'UNKNOWN',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "contact_point_status" NOT NULL DEFAULT 'ACTIVE',
    "source_id" UUID,
    "source_detail" TEXT,
    "collected_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "verification_method" TEXT,
    "normalization_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_origins" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "detail" TEXT,
    "url" TEXT,
    "collected_at" TIMESTAMPTZ(3) NOT NULL,
    "referrer_name" TEXT,
    "is_first_touch" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "lead_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "added_by_id" UUID,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("lead_id","tag_id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignments" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "strategy" "assignment_strategy" NOT NULL DEFAULT 'MANUAL',
    "assigned_by_id" UUID,
    "reason" TEXT,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "payload" JSONB,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "channel" "channel",

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_basis_assessments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_basis" "legal_basis" NOT NULL,
    "purpose" TEXT NOT NULL,
    "document_url" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "legal_basis_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_permissions" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "person_id" UUID,
    "contact_point_id" UUID,
    "channel" "contact_channel" NOT NULL,
    "legal_basis" "legal_basis" NOT NULL,
    "legal_basis_assessment_id" UUID,
    "opt_in_status" "opt_in_status" NOT NULL DEFAULT 'NONE',
    "opt_in_at" TIMESTAMPTZ(3),
    "opt_in_method" "opt_in_method",
    "evidence" TEXT,
    "recorded_by_id" UUID,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" UUID NOT NULL,
    "type" "suppression_type" NOT NULL,
    "value_hash" TEXT NOT NULL,
    "value_masked" TEXT NOT NULL,
    "scope" "suppression_scope" NOT NULL DEFAULT 'ALL_CHANNELS',
    "reason" "suppression_reason" NOT NULL,
    "source" "suppression_source" NOT NULL,
    "lead_id" UUID,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "requester_name" TEXT NOT NULL,
    "requester_contact" TEXT NOT NULL,
    "type" "data_subject_request_type" NOT NULL,
    "lead_id" UUID,
    "status" "data_subject_request_status" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "handled_by_id" UUID,
    "response_summary" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'leads',
    "filter" JSONB NOT NULL,
    "columns" JSONB,
    "sort" JSONB,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_territories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state_uf" CHAR(2) NOT NULL,
    "municipality_code" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_territories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_key_key" ON "lead_sources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "segments_key_key" ON "segments"("key");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_search_key" ON "tags"("name_search");

-- CreateIndex
CREATE UNIQUE INDEX "leads_code_key" ON "leads"("code");

-- CreateIndex
CREATE INDEX "leads_cnpj_root_idx" ON "leads"("cnpj_root");

-- CreateIndex
CREATE INDEX "leads_owner_id_status_idx" ON "leads"("owner_id", "status");

-- CreateIndex
CREATE INDEX "leads_status_state_uf_idx" ON "leads"("status", "state_uf");

-- CreateIndex
CREATE INDEX "leads_municipality_code_idx" ON "leads"("municipality_code");

-- CreateIndex
CREATE INDEX "leads_contact_status_idx" ON "leads"("contact_status");

-- CreateIndex
CREATE INDEX "leads_last_activity_at_idx" ON "leads"("last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_name_search_trgm_idx" ON "leads" USING GIN ("name_search" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "leads_name_core_trgm_idx" ON "leads" USING GIN ("name_core" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "leads_cnpj_active_key" ON "leads"("cnpj") WHERE (cnpj IS NOT NULL AND status <> 'MERGED');

-- CreateIndex
CREATE INDEX "lead_people_lead_id_idx" ON "lead_people"("lead_id");

-- CreateIndex
CREATE INDEX "contact_points_type_value_normalized_idx" ON "contact_points"("type", "value_normalized");

-- CreateIndex
CREATE INDEX "contact_points_type_value_hash_idx" ON "contact_points"("type", "value_hash");

-- CreateIndex
CREATE INDEX "contact_points_person_id_idx" ON "contact_points"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_points_lead_id_type_value_normalized_key" ON "contact_points"("lead_id", "type", "value_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "contact_points_primary_key" ON "contact_points"("lead_id", "type") WHERE (is_primary AND status = 'ACTIVE');

-- CreateIndex
CREATE INDEX "lead_origins_lead_id_idx" ON "lead_origins"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_origins_first_touch_key" ON "lead_origins"("lead_id") WHERE (is_first_touch);

-- CreateIndex
CREATE INDEX "lead_tags_tag_id_idx" ON "lead_tags"("tag_id");

-- CreateIndex
CREATE INDEX "lead_notes_lead_id_created_at_idx" ON "lead_notes"("lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lead_assignments_lead_id_assigned_at_idx" ON "lead_assignments"("lead_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "lead_events_lead_id_occurred_at_idx" ON "lead_events"("lead_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "lead_events_type_occurred_at_idx" ON "lead_events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "contact_permissions_lead_id_idx" ON "contact_permissions"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_permissions_lead_channel_key" ON "contact_permissions"("lead_id", "channel") WHERE (person_id IS NULL AND contact_point_id IS NULL);

-- CreateIndex
CREATE INDEX "suppression_entries_type_value_hash_idx" ON "suppression_entries"("type", "value_hash");

-- CreateIndex
CREATE INDEX "suppression_entries_lead_id_idx" ON "suppression_entries"("lead_id");

-- CreateIndex
CREATE INDEX "suppression_entries_created_at_idx" ON "suppression_entries"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_active_key" ON "suppression_entries"("type", "value_hash", "scope") WHERE (revoked_at IS NULL);

-- CreateIndex
CREATE INDEX "data_subject_requests_status_due_at_idx" ON "data_subject_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_lead_id_idx" ON "data_subject_requests"("lead_id");

-- CreateIndex
CREATE INDEX "saved_views_entity_shared_idx" ON "saved_views"("entity", "shared");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_owner_id_entity_name_key" ON "saved_views"("owner_id", "entity", "name");

-- CreateIndex
CREATE INDEX "user_territories_state_uf_municipality_code_idx" ON "user_territories"("state_uf", "municipality_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_territories_state_key" ON "user_territories"("user_id", "state_uf") WHERE (municipality_code IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "user_territories_city_key" ON "user_territories"("user_id", "municipality_code") WHERE (municipality_code IS NOT NULL);

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_municipality_code_fkey" FOREIGN KEY ("municipality_code") REFERENCES "municipalities"("ibge_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_state_uf_fkey" FOREIGN KEY ("state_uf") REFERENCES "states"("uf") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_origin_source_id_fkey" FOREIGN KEY ("origin_source_id") REFERENCES "lead_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_people" ADD CONSTRAINT "lead_people_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "lead_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_origins" ADD CONSTRAINT "lead_origins_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_origins" ADD CONSTRAINT "lead_origins_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_permissions" ADD CONSTRAINT "contact_permissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_permissions" ADD CONSTRAINT "contact_permissions_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "lead_people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_permissions" ADD CONSTRAINT "contact_permissions_contact_point_id_fkey" FOREIGN KEY ("contact_point_id") REFERENCES "contact_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_permissions" ADD CONSTRAINT "contact_permissions_legal_basis_assessment_id_fkey" FOREIGN KEY ("legal_basis_assessment_id") REFERENCES "legal_basis_assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_territories" ADD CONSTRAINT "user_territories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_territories" ADD CONSTRAINT "user_territories_state_uf_fkey" FOREIGN KEY ("state_uf") REFERENCES "states"("uf") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_territories" ADD CONSTRAINT "user_territories_municipality_code_fkey" FOREIGN KEY ("municipality_code") REFERENCES "municipalities"("ibge_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Timeline append-only (docs/DATABASE.md §4.4)
--
-- Eventos não são alterados nem apagados. A única mudança permitida é mover o
-- evento para outro lead (mesclagem, Fase 3). DELETE e TRUNCATE só na purga
-- autorizada da rotina de retenção (mesma chave da auditoria):
--   SET LOCAL docline.audit_purge = 'on';
-- -----------------------------------------------------------------------------
CREATE FUNCTION lead_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.occurred_at, NEW.type, NEW.actor_type, NEW.actor_id, NEW.payload,
        NEW.subject_type, NEW.subject_id, NEW.channel)
       IS DISTINCT FROM
       (OLD.id, OLD.occurred_at, OLD.type, OLD.actor_type, OLD.actor_id, OLD.payload,
        OLD.subject_type, OLD.subject_id, OLD.channel) THEN
      RAISE EXCEPTION 'lead_events é append-only: só lead_id pode mudar (mesclagem)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('docline.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'lead_events é append-only: % só é permitido pela rotina de retenção', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER lead_events_append_only
  BEFORE UPDATE OR DELETE ON "lead_events"
  FOR EACH ROW EXECUTE FUNCTION lead_events_guard();

CREATE TRIGGER lead_events_no_truncate
  BEFORE TRUNCATE ON "lead_events"
  FOR EACH STATEMENT EXECUTE FUNCTION lead_events_guard();

-- -----------------------------------------------------------------------------
-- Lista Não Contatar (docs/LGPD.md §8)
--
-- Um registro nunca é alterado nem apagado: só revogado (revoked_*), por ADMIN,
-- com motivo. lead_id pode virar NULL (exclusão do lead pela retenção): o hash
-- continua valendo. DELETE e TRUNCATE só na purga autorizada.
-- -----------------------------------------------------------------------------
CREATE FUNCTION suppression_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.type, NEW.value_hash, NEW.value_masked, NEW.scope, NEW.reason, NEW.source,
        NEW.notes, NEW.created_by_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.type, OLD.value_hash, OLD.value_masked, OLD.scope, OLD.reason, OLD.source,
        OLD.notes, OLD.created_by_id, OLD.created_at) THEN
      RAISE EXCEPTION 'suppression_entries: só a revogação pode alterar um registro'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND
       (NEW.revoked_at, NEW.revoked_by_id, NEW.revoke_reason)
       IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by_id, OLD.revoke_reason) THEN
      RAISE EXCEPTION 'suppression_entries: revogação já registrada não pode ser alterada'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NEW.lead_id IS NOT NULL THEN
      RAISE EXCEPTION 'suppression_entries: lead_id só pode ser removido'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('docline.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'suppression_entries: % só é permitido pela rotina de retenção', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER suppression_entries_guarded
  BEFORE UPDATE OR DELETE ON "suppression_entries"
  FOR EACH ROW EXECUTE FUNCTION suppression_entries_guard();

CREATE TRIGGER suppression_entries_no_truncate
  BEFORE TRUNCATE ON "suppression_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION suppression_entries_guard();
