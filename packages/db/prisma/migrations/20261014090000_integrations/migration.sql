-- CreateEnum
CREATE TYPE "webhook_endpoint_status" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "external_entity_type" AS ENUM ('LEAD', 'OPPORTUNITY');

-- AlterEnum
ALTER TYPE "suppression_source" ADD VALUE 'INTEGRATION';

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "system" TEXT,
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 120,
    "rate_window_start" TIMESTAMPTZ(3),
    "rate_window_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "last_used_ip" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "system" TEXT,
    "events" TEXT[],
    "status" "webhook_endpoint_status" NOT NULL DEFAULT 'ACTIVE',
    "secret_version" INTEGER NOT NULL DEFAULT 1,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "failing_since" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_failure_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "disabled_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "lead_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "last_duration_ms" INTEGER,
    "delivered_at" TIMESTAMPTZ(3),
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_references" (
    "id" UUID NOT NULL,
    "entity_type" "external_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "created_by_key_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_created_at_idx" ON "api_keys"("created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_endpoints_status_idx" ON "webhook_endpoints"("status");

-- CreateIndex
CREATE INDEX "outbound_events_type_occurred_at_idx" ON "outbound_events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "outbound_events_lead_id_idx" ON "outbound_events"("lead_id");

-- CreateIndex
CREATE INDEX "outbound_events_created_at_idx" ON "outbound_events"("created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_event_id_idx" ON "webhook_deliveries"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_references_entity_type_entity_id_system_key" ON "external_references"("entity_type", "entity_id", "system");

-- CreateIndex
CREATE UNIQUE INDEX "external_references_system_entity_type_external_id_key" ON "external_references"("system", "entity_type", "external_id");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "outbound_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Regras que o domínio já garante, repetidas no banco (docs/DATABASE.md §4.15).
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_scopes_present" CHECK (cardinality("scopes") > 0),
  ADD CONSTRAINT "api_keys_rate_limit_range" CHECK ("rate_limit_per_minute" BETWEEN 1 AND 6000);

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_events_present" CHECK (cardinality("events") > 0),
  ADD CONSTRAINT "webhook_endpoints_url_http" CHECK ("url" ~ '^https?://');

ALTER TABLE "external_references"
  ADD CONSTRAINT "external_references_system_code" CHECK ("system" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  ADD CONSTRAINT "external_references_external_id_length" CHECK (char_length("external_id") BETWEEN 1 AND 200);
