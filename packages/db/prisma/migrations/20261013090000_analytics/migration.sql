-- Fase 11 — Analytics: rollup diário (daily_metrics), fatos por lead para as
-- conversões por dimensão (materialized view analytics_lead_facts), insights
-- da carteira e disponibilidade dos usuários para a distribuição automática.
-- ai_generations passa a aceitar geração sem lead (insights, tipo INSIGHT),
-- para o custo entrar no mesmo orçamento da IA. Nada aqui guarda dado pessoal
-- em claro: só ids, códigos, contagens e datas.


-- CreateEnum
CREATE TYPE "metric_dimension" AS ENUM ('GLOBAL', 'SDR', 'CHANNEL');

-- CreateEnum
CREATE TYPE "insight_scope" AS ENUM ('TEAM', 'USER');

-- CreateEnum
CREATE TYPE "insight_source" AS ENUM ('AI', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "insight_feedback" AS ENUM ('USEFUL', 'NOT_USEFUL');

-- AlterEnum
ALTER TYPE "ai_generation_kind" ADD VALUE 'INSIGHT';

-- AlterTable
ALTER TABLE "ai_generations" ALTER COLUMN "lead_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auto_assign" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "away_until" DATE,
ADD COLUMN     "max_active_leads" INTEGER;

-- CreateTable
CREATE TABLE "daily_metrics" (
    "date" DATE NOT NULL,
    "dimension" "metric_dimension" NOT NULL,
    "dimension_id" TEXT NOT NULL DEFAULT '',
    "new_leads" INTEGER NOT NULL DEFAULT 0,
    "first_contacts" INTEGER NOT NULL DEFAULT 0,
    "leads_contacted" INTEGER NOT NULL DEFAULT 0,
    "messages_out" INTEGER NOT NULL DEFAULT 0,
    "contacts_logged" INTEGER NOT NULL DEFAULT 0,
    "messages_in" INTEGER NOT NULL DEFAULT 0,
    "leads_replied" INTEGER NOT NULL DEFAULT 0,
    "interested" INTEGER NOT NULL DEFAULT 0,
    "opportunities" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "opt_outs" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("date","dimension","dimension_id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "scope" "insight_scope" NOT NULL,
    "audience_user_id" UUID,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source" "insight_source" NOT NULL,
    "ai_generation_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "feedback" "insight_feedback",
    "feedback_by_id" UUID,
    "feedback_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_metrics_dimension_dimension_id_date_idx" ON "daily_metrics"("dimension", "dimension_id", "date");

-- CreateIndex
CREATE INDEX "insights_scope_audience_user_id_generated_at_idx" ON "insights"("scope", "audience_user_id", "generated_at" DESC);

-- CreateIndex
CREATE INDEX "insights_valid_until_idx" ON "insights"("valid_until");

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_audience_user_id_fkey" FOREIGN KEY ("audience_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_ai_generation_id_fkey" FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_feedback_by_id_fkey" FOREIGN KEY ("feedback_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Fatos por lead (uma linha por lead não mesclado), atualizados pelo job
-- `analytics.rollup` com REFRESH MATERIALIZED VIEW CONCURRENTLY. Base das
-- conversões por cidade, campanha, abordagem, canal, segmento, origem e SDR
-- (coorte do 1º contato). O canal, a abordagem e quem fez o 1º contato vêm do
-- primeiro contato de saída (mensagem enviada/entregue/lida ou ligação
-- atendida); a campanha é a que liberou o lead até 90 dias antes do 1º contato
-- (a janela de atribuição das campanhas). Resposta = mensagem recebida ou
-- contato de entrada a partir do 1º contato.
CREATE MATERIALIZED VIEW "analytics_lead_facts" AS
WITH outbound AS (
  SELECT m.lead_id, m.sent_at AS at, m.channel::text AS channel, m.approach_id,
    m.sent_by_id AS user_id
  FROM messages m
  WHERE m.direction = 'OUTBOUND' AND m.status IN ('SENT', 'DELIVERED', 'READ')
    AND m.sent_at IS NOT NULL
  UNION ALL
  SELECT a.lead_id, a.occurred_at, CASE WHEN a.type = 'CALL' THEN 'PHONE' ELSE 'OTHER' END,
    NULL::uuid, a.user_id
  FROM activities a
  WHERE a.direction = 'OUTBOUND' AND a.outcome IN ('CONNECTED', 'HELD')
),
first_out AS (
  SELECT DISTINCT ON (o.lead_id) o.lead_id, o.channel, o.approach_id, o.user_id
  FROM outbound o
  ORDER BY o.lead_id, o.at, o.channel
),
inbound AS (
  SELECT m.lead_id, COALESCE(m.received_at, m.created_at) AS at
  FROM messages m
  WHERE m.direction = 'INBOUND' AND m.status <> 'CANCELED'
  UNION ALL
  SELECT a.lead_id, a.occurred_at FROM activities a WHERE a.direction = 'INBOUND'
),
replies AS (
  SELECT i.lead_id, min(i.at) AS first_reply_at
  FROM inbound i
  JOIN leads l2 ON l2.id = i.lead_id
  WHERE l2.first_contact_at IS NOT NULL AND i.at >= l2.first_contact_at
  GROUP BY i.lead_id
),
interested AS (
  SELECT m.lead_id, min(COALESCE(m.received_at, m.created_at)) AS first_interested_at
  FROM messages m
  WHERE m.classification = 'INTERESTED'
  GROUP BY m.lead_id
),
opps AS (
  SELECT o.lead_id, min(o.handoff_at) AS first_opportunity_at,
    min(o.won_at) FILTER (WHERE o.status = 'WON') AS won_at,
    (array_agg(o.conversion_type::text ORDER BY o.won_at) FILTER (WHERE o.status = 'WON'))[1]
      AS conversion_type
  FROM opportunities o
  GROUP BY o.lead_id
),
optouts AS (
  SELECT s.lead_id, min(s.created_at) AS opted_out_at
  FROM suppression_entries s
  WHERE s.reason = 'OPT_OUT' AND s.lead_id IS NOT NULL
  GROUP BY s.lead_id
),
campaign_first AS (
  SELECT DISTINCT ON (cl.lead_id) cl.lead_id, cl.campaign_id
  FROM campaign_leads cl
  JOIN leads l3 ON l3.id = cl.lead_id
  WHERE cl.released_at IS NOT NULL AND l3.first_contact_at IS NOT NULL
    AND cl.released_at <= l3.first_contact_at
    AND l3.first_contact_at < cl.released_at + interval '90 days'
  ORDER BY cl.lead_id, cl.released_at DESC
)
SELECT
  l.id AS lead_id,
  l.status::text AS status,
  l.owner_id,
  l.municipality_code,
  l.state_uf,
  l.segment_id,
  l.origin_source_id,
  l.score_band::text AS score_band,
  l.created_at,
  l.first_contact_at,
  fo.channel AS first_contact_channel,
  fo.approach_id AS first_contact_approach_id,
  fo.user_id AS first_contact_user_id,
  cf.campaign_id AS first_contact_campaign_id,
  r.first_reply_at,
  it.first_interested_at,
  op.first_opportunity_at,
  op.won_at,
  op.conversion_type,
  oo.opted_out_at
FROM leads l
LEFT JOIN first_out fo ON fo.lead_id = l.id AND l.first_contact_at IS NOT NULL
LEFT JOIN campaign_first cf ON cf.lead_id = l.id
LEFT JOIN replies r ON r.lead_id = l.id
LEFT JOIN interested it ON it.lead_id = l.id
LEFT JOIN opps op ON op.lead_id = l.id
LEFT JOIN optouts oo ON oo.lead_id = l.id
WHERE l.status <> 'MERGED';

-- Único: exigido pelo REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX "analytics_lead_facts_lead_id_key" ON "analytics_lead_facts" ("lead_id");
CREATE INDEX "analytics_lead_facts_first_contact_at_idx" ON "analytics_lead_facts" ("first_contact_at");
CREATE INDEX "analytics_lead_facts_created_at_idx" ON "analytics_lead_facts" ("created_at");
