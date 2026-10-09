-- CreateEnum
CREATE TYPE "import_file_type" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('UPLOADED', 'MAPPING', 'PREVIEWING', 'PREVIEW_READY', 'COMMITTING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "duplicate_policy" AS ENUM ('CREATE_AND_FLAG', 'SKIP', 'UPDATE_EMPTY_FIELDS');

-- CreateEnum
CREATE TYPE "import_match_status" AS ENUM ('NEW', 'EXISTING', 'POSSIBLE_DUPLICATE', 'DUPLICATE_IN_FILE', 'SUPPRESSED', 'INVALID');

-- CreateEnum
CREATE TYPE "import_row_decision" AS ENUM ('IMPORT', 'SKIP', 'LINK_EXISTING', 'UPDATE_EXISTING');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('PENDING', 'DONE', 'ERROR');

-- CreateEnum
CREATE TYPE "duplicate_confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "duplicate_status" AS ENUM ('PENDING', 'MERGED', 'KEPT_SEPARATE', 'IGNORED');

-- CreateEnum
CREATE TYPE "duplicate_source" AS ENUM ('IMPORT', 'SCAN', 'MANUAL', 'PROSPECTING');

-- AlterTable
ALTER TABLE "lead_origins" ADD COLUMN     "import_batch_id" UUID;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "custom_fields" JSONB,
ADD COLUMN     "merged_into_id" UUID;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "file_type" "import_file_type" NOT NULL,
    "encoding" TEXT,
    "delimiter" TEXT,
    "sheet_name" TEXT,
    "sheet_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "header_row" INTEGER NOT NULL DEFAULT 1,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "status" "import_status" NOT NULL DEFAULT 'UPLOADED',
    "mapping" JSONB,
    "duplicate_policy" "duplicate_policy" NOT NULL DEFAULT 'CREATE_AND_FLAG',
    "source_id" UUID,
    "source_detail" TEXT,
    "collected_at" TIMESTAMPTZ(3),
    "default_legal_basis" "legal_basis",
    "legal_basis_assessment_id" UUID,
    "default_owner_id" UUID,
    "default_tag_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "stats" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "purge_after" TIMESTAMPTZ(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_files" (
    "batch_id" UUID NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_files_pkey" PRIMARY KEY ("batch_id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "errors" JSONB,
    "warnings" JSONB,
    "match_status" "import_match_status",
    "matched_lead_id" UUID,
    "match_reasons" JSONB,
    "decision" "import_row_decision",
    "result_lead_id" UUID,
    "status" "import_row_status" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "header_signature" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidates" (
    "id" UUID NOT NULL,
    "lead_a_id" UUID NOT NULL,
    "lead_b_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" "duplicate_confidence" NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "duplicate_status" NOT NULL DEFAULT 'PENDING',
    "detected_by" "duplicate_source" NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,

    CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_merges" (
    "id" UUID NOT NULL,
    "survivor_lead_id" UUID NOT NULL,
    "merged_lead_id" UUID NOT NULL,
    "candidate_id" UUID,
    "field_choices" JSONB NOT NULL,
    "merged_snapshot" JSONB NOT NULL,
    "performed_by_id" UUID,
    "performed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_file_sha256_idx" ON "import_batches"("file_sha256");

-- CreateIndex
CREATE INDEX "import_batches_created_by_id_created_at_idx" ON "import_batches"("created_by_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_batches_status_purge_after_idx" ON "import_batches"("status", "purge_after");

-- CreateIndex
CREATE INDEX "import_rows_batch_id_match_status_idx" ON "import_rows"("batch_id", "match_status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_number_key" ON "import_rows"("batch_id", "row_number");

-- CreateIndex
CREATE INDEX "import_mapping_templates_header_signature_idx" ON "import_mapping_templates"("header_signature");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_templates_name_key" ON "import_mapping_templates"("name");

-- CreateIndex
CREATE INDEX "duplicate_candidates_status_confidence_score_idx" ON "duplicate_candidates"("status", "confidence", "score" DESC);

-- CreateIndex
CREATE INDEX "duplicate_candidates_lead_b_id_idx" ON "duplicate_candidates"("lead_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_candidates_lead_a_id_lead_b_id_key" ON "duplicate_candidates"("lead_a_id", "lead_b_id");

-- CreateIndex
CREATE INDEX "lead_merges_survivor_lead_id_idx" ON "lead_merges"("survivor_lead_id");

-- CreateIndex
CREATE INDEX "lead_merges_merged_lead_id_idx" ON "lead_merges"("merged_lead_id");

-- CreateIndex
CREATE INDEX "lead_origins_import_batch_id_idx" ON "lead_origins"("import_batch_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_origins" ADD CONSTRAINT "lead_origins_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_default_owner_id_fkey" FOREIGN KEY ("default_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mapping_templates" ADD CONSTRAINT "import_mapping_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_lead_a_id_fkey" FOREIGN KEY ("lead_a_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_lead_b_id_fkey" FOREIGN KEY ("lead_b_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_survivor_lead_id_fkey" FOREIGN KEY ("survivor_lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_merged_lead_id_fkey" FOREIGN KEY ("merged_lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "duplicate_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Par de duplicados sempre ordenado: (a, b) e (b, a) não coexistem.
ALTER TABLE "duplicate_candidates"
  ADD CONSTRAINT "duplicate_candidates_ordered_pair" CHECK ("lead_a_id" < "lead_b_id");
