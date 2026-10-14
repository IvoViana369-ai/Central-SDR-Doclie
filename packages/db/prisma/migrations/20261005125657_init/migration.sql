-- Extensões (docs/DATABASE.md §1): similaridade de nomes e apoio à normalização.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'MANAGER', 'SDR', 'SALES');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'SYSTEM', 'AUTOMATION', 'INTEGRATION', 'AI');

-- CreateEnum
CREATE TYPE "holiday_scope" AS ENUM ('NATIONAL', 'STATE', 'MUNICIPAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'SDR',
    "status" "user_status" NOT NULL DEFAULT 'INVITED',
    "team_id" UUID,
    "timezone" TEXT NOT NULL DEFAULT 'America/Fortaleza',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manager_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "states" (
    "uf" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "ibge_code" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("uf")
);

-- CreateTable
CREATE TABLE "municipalities" (
    "ibge_code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "name_search" TEXT NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "ddd" INTEGER,
    "timezone" TEXT NOT NULL,
    "is_capital" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "population" INTEGER,

    CONSTRAINT "municipalities_pkey" PRIMARY KEY ("ibge_code")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scope" "holiday_scope" NOT NULL,
    "uf" CHAR(2),
    "municipality_code" INTEGER,
    "name" TEXT NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_team_id_idx" ON "users"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_user_id_idx" ON "invitations"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_occurred_at_idx" ON "audit_logs"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "audit_logs"("action", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "states_ibge_code_key" ON "states"("ibge_code");

-- CreateIndex
CREATE INDEX "municipalities_uf_name_search_idx" ON "municipalities"("uf", "name_search");

-- CreateIndex
CREATE INDEX "municipalities_name_search_trgm_idx" ON "municipalities" USING GIN ("name_search" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_key_key" ON "holidays"("key");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_uf_fkey" FOREIGN KEY ("uf") REFERENCES "states"("uf") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Auditoria append-only (docs/SECURITY.md §14)
--
-- UPDATE é sempre bloqueado. DELETE e TRUNCATE só são permitidos quando a
-- sessão declara explicitamente uma purga autorizada (rotina de retenção LGPD):
--   SET LOCAL docline.audit_purge = 'on';
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_logs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs é append-only: UPDATE não é permitido'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(current_setting('docline.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_logs é append-only: % só é permitido pela rotina de retenção', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();
