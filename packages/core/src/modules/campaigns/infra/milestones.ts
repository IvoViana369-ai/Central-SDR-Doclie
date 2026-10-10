import { Prisma, type DbTransaction } from '@docline/db';
import { ATTRIBUTION_DAYS, type FunnelCounts } from '../domain/funnel';

/**
 * Marcos do funil de cada lead liberado (F10-04), recalculados por inteiro a
 * cada chamada (idempotente). A janela de atribuição vai da liberação até
 * ATTRIBUTION_DAYS depois ou até o mesmo lead ser liberado por outra
 * campanha, o que vier antes:
 *
 * - contatado: mensagem de saída enviada/entregue/lida ou ligação atendida
 *   (as mesmas regras do "primeiro contato" do lead);
 * - entregue: entrega confirmada pelo canal (só envios pela API);
 * - respondeu: mensagem recebida depois do primeiro contato;
 * - interessado: resposta classificada como interesse;
 * - oportunidade: transferência ao Comercial; convertido: oportunidade ganha;
 * - pediu para sair: opt-out na Lista Não Contatar.
 *
 * Também marca as mensagens da janela com a campanha (messages.campaign_id).
 */
function windows(campaignIds: readonly string[]) {
  return Prisma.sql`
    w AS (
      SELECT cl.campaign_id, cl.lead_id, cl.released_at AS start,
        LEAST(
          cl.released_at + make_interval(days => ${ATTRIBUTION_DAYS}::int),
          COALESCE(
            (SELECT min(o.released_at) FROM campaign_leads o
              WHERE o.lead_id = cl.lead_id AND o.released_at > cl.released_at),
            'infinity'::timestamptz
          )
        ) AS stop
      FROM campaign_leads cl
      WHERE cl.campaign_id = ANY(${[...campaignIds]}::uuid[])
        AND cl.status = 'RELEASED' AND cl.released_at IS NOT NULL
    )`;
}

export async function refreshMilestones(
  tx: DbTransaction,
  campaignIds: readonly string[],
): Promise<void> {
  if (campaignIds.length === 0) return;
  await tx.$executeRaw`
    WITH ${windows(campaignIds)},
    c AS (
      SELECT w.*,
        (SELECT min(x.at) FROM (
          SELECT m.sent_at AS at FROM messages m
            WHERE m.lead_id = w.lead_id AND m.direction = 'OUTBOUND'
              AND m.status IN ('SENT', 'DELIVERED', 'READ')
              AND m.sent_at >= w.start AND m.sent_at < w.stop
          UNION ALL
          SELECT a.occurred_at FROM activities a
            WHERE a.lead_id = w.lead_id AND a.direction = 'OUTBOUND'
              AND a.outcome IN ('CONNECTED', 'HELD')
              AND a.occurred_at >= w.start AND a.occurred_at < w.stop
        ) x) AS contacted_at
      FROM w
    ),
    r AS (
      SELECT c.*,
        (SELECT min(COALESCE(m.delivered_at, m.read_at, m.sent_at)) FROM messages m
          WHERE m.lead_id = c.lead_id AND m.direction = 'OUTBOUND'
            AND m.status IN ('DELIVERED', 'READ')
            AND m.sent_at >= c.start AND m.sent_at < c.stop) AS delivered_at,
        (SELECT min(COALESCE(m.received_at, m.created_at)) FROM messages m
          WHERE m.lead_id = c.lead_id AND m.direction = 'INBOUND'
            AND c.contacted_at IS NOT NULL
            AND COALESCE(m.received_at, m.created_at) >= c.contacted_at
            AND COALESCE(m.received_at, m.created_at) < c.stop) AS replied_at,
        (SELECT min(COALESCE(m.received_at, m.created_at)) FROM messages m
          WHERE m.lead_id = c.lead_id AND m.direction = 'INBOUND'
            AND m.classification = 'INTERESTED'
            AND COALESCE(m.received_at, m.created_at) >= c.start
            AND COALESCE(m.received_at, m.created_at) < c.stop) AS interested_at,
        (SELECT min(o.handoff_at) FROM opportunities o
          WHERE o.lead_id = c.lead_id
            AND o.handoff_at >= c.start AND o.handoff_at < c.stop) AS opportunity_at,
        (SELECT min(o.won_at) FROM opportunities o
          WHERE o.lead_id = c.lead_id AND o.status = 'WON'
            AND o.handoff_at >= c.start AND o.handoff_at < c.stop) AS converted_at,
        (SELECT min(s.created_at) FROM suppression_entries s
          WHERE s.lead_id = c.lead_id AND s.reason = 'OPT_OUT'
            AND s.created_at >= c.start AND s.created_at < c.stop) AS opted_out_at
      FROM c
    )
    UPDATE campaign_leads cl SET
      contacted_at = r.contacted_at,
      delivered_at = r.delivered_at,
      replied_at = r.replied_at,
      interested_at = r.interested_at,
      opportunity_at = r.opportunity_at,
      converted_at = r.converted_at,
      opted_out_at = r.opted_out_at
    FROM r
    WHERE cl.campaign_id = r.campaign_id AND cl.lead_id = r.lead_id
  `;
  await tx.$executeRaw`
    WITH ${windows(campaignIds)}
    UPDATE messages m SET campaign_id = w.campaign_id
    FROM w
    WHERE m.lead_id = w.lead_id AND m.campaign_id IS NULL
      AND COALESCE(m.sent_at, m.received_at, m.created_at) >= w.start
      AND COALESCE(m.sent_at, m.received_at, m.created_at) < w.stop
  `;
}

export type FunnelDimension = 'none' | 'sdr' | 'variant';

const DIMENSION_COLUMN: Record<FunnelDimension, Prisma.Sql> = {
  none: Prisma.sql`NULL::text`,
  sdr: Prisma.sql`cl.assigned_to_id::text`,
  variant: Prisma.sql`cl.variant_id::text`,
};

export type FunnelRowCounts = FunnelCounts & {
  key: string | null;
  /** Aptos ainda aguardando liberação. */
  pending: number;
  /** Não liberados (inaptos na montagem ou na liberação). */
  skipped: number;
};

/** Contagens do funil da campanha, no total ou por SDR ou variante. */
export async function funnelCounts(
  tx: DbTransaction,
  campaignId: string,
  dimension: FunnelDimension,
): Promise<FunnelRowCounts[]> {
  const key = DIMENSION_COLUMN[dimension];
  return tx.$queryRaw<FunnelRowCounts[]>`
    SELECT ${key} AS key,
      count(*)::int AS selected,
      count(*) FILTER (WHERE cl.eligibility = 'ELIGIBLE')::int AS eligible,
      count(*) FILTER (WHERE cl.status = 'RELEASED')::int AS released,
      count(cl.contacted_at)::int AS contacted,
      count(cl.delivered_at)::int AS delivered,
      count(cl.replied_at)::int AS replied,
      count(cl.interested_at)::int AS interested,
      count(cl.opportunity_at)::int AS opportunity,
      count(cl.converted_at)::int AS converted,
      count(cl.opted_out_at)::int AS "optedOut",
      count(*) FILTER (WHERE cl.status = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE cl.status = 'SKIPPED')::int AS skipped
    FROM campaign_leads cl
    WHERE cl.campaign_id = ${campaignId}::uuid
    GROUP BY 1
    ORDER BY 1
  `;
}

export const EMPTY_FUNNEL: Omit<FunnelRowCounts, 'key'> = {
  selected: 0,
  eligible: 0,
  released: 0,
  contacted: 0,
  delivered: 0,
  replied: 0,
  interested: 0,
  opportunity: 0,
  converted: 0,
  optedOut: 0,
  pending: 0,
  skipped: 0,
};
