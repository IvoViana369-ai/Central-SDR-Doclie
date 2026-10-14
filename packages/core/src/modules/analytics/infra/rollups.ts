import { Prisma, type DbClient, type DbTransaction } from '@docline/db';
import type { AnalyticsPeriod } from '../domain/period';

/**
 * Rollups dos indicadores (F11-01; docs/ARCHITECTURE.md §13).
 *
 * - `analytics_lead_facts` (materialized view): um registro por lead com o 1º
 *   contato (quando, canal, abordagem, quem, campanha) e os marcos depois dele.
 *   Base das conversões por recorte (coorte do 1º contato).
 * - `daily_metrics`: contagens por dia local (fuso da operação) da equipe
 *   (GLOBAL), de cada pessoa (SDR) e de cada canal (CHANNEL). Todas somam de
 *   um dia para o outro, exceto `leads_contacted` (leads distintos no dia).
 *
 * Quem recebe cada número no recorte por pessoa: o que alguém fez (1º contato,
 * mensagens, contatos registrados, oportunidades e conversões) vai para quem
 * fez; o que o lead fez (novo, resposta, interesse, opt-out) vai para o
 * responsável atual. No recorte por canal, volumes (mensagens, contatos) vão
 * para o canal do evento; resposta, interesse, oportunidade, conversão e
 * opt-out vão para o canal do 1º contato do lead.
 */

/** Atualiza os fatos por lead sem bloquear quem está lendo (usa o índice único). */
export async function refreshLeadFacts(db: DbClient): Promise<void> {
  await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_lead_facts');
}

const SENT = Prisma.sql`('SENT', 'DELIVERED', 'READ')`;

/**
 * Recalcula os dias do período: apaga e grava de novo (na mesma transação),
 * com uma linha GLOBAL zerada nos dias sem movimento (o dia foi calculado).
 * Depende dos fatos por lead atualizados (`refreshLeadFacts` antes).
 */
export async function computeDailyMetrics(
  tx: DbTransaction,
  period: AnalyticsPeriod,
  computedAt: Date,
): Promise<number> {
  const { start, end, timeZone, from, to } = period;
  const day = (column: string) =>
    Prisma.sql`(${Prisma.raw(column)} AT TIME ZONE ${timeZone})::date`;
  const inRange = (column: string) =>
    Prisma.sql`${Prisma.raw(column)} >= ${start} AND ${Prisma.raw(column)} < ${end}`;
  const received = 'COALESCE(m.received_at, m.created_at)';

  await tx.$executeRaw`
    DELETE FROM daily_metrics WHERE date >= ${from}::date AND date <= ${to}::date
  `;
  const inserted = await tx.$executeRaw`
    WITH events AS (
      SELECT ${day('l.created_at')} AS day, l.owner_id AS user_id, NULL::text AS channel,
        l.id AS lead_id, 'new' AS kind
      FROM leads l
      WHERE l.status <> 'MERGED' AND ${inRange('l.created_at')}
      UNION ALL
      SELECT ${day('f.first_contact_at')}, f.first_contact_user_id, f.first_contact_channel,
        f.lead_id, 'first'
      FROM analytics_lead_facts f
      WHERE ${inRange('f.first_contact_at')}
      UNION ALL
      SELECT ${day('m.sent_at')}, m.sent_by_id, m.channel::text, m.lead_id, 'msg_out'
      FROM messages m
      JOIN leads l ON l.id = m.lead_id AND l.status <> 'MERGED'
      WHERE m.direction = 'OUTBOUND' AND m.status IN ${SENT} AND ${inRange('m.sent_at')}
      UNION ALL
      SELECT ${day('a.occurred_at')}, a.user_id,
        CASE WHEN a.type = 'CALL' THEN 'PHONE' ELSE 'OTHER' END, a.lead_id, 'act_out'
      FROM activities a
      JOIN leads l ON l.id = a.lead_id AND l.status <> 'MERGED'
      WHERE a.direction = 'OUTBOUND' AND ${inRange('a.occurred_at')}
      UNION ALL
      SELECT ${day(received)}, l.owner_id, m.channel::text, m.lead_id, 'msg_in'
      FROM messages m
      JOIN leads l ON l.id = m.lead_id AND l.status <> 'MERGED'
      WHERE m.direction = 'INBOUND' AND m.status <> 'CANCELED' AND ${inRange(received)}
      UNION ALL
      SELECT ${day('f.first_reply_at')}, f.owner_id, f.first_contact_channel, f.lead_id, 'replied'
      FROM analytics_lead_facts f
      WHERE ${inRange('f.first_reply_at')}
      UNION ALL
      SELECT ${day('f.first_interested_at')}, f.owner_id, f.first_contact_channel, f.lead_id,
        'interested'
      FROM analytics_lead_facts f
      WHERE ${inRange('f.first_interested_at')}
      UNION ALL
      SELECT ${day('o.handoff_at')}, o.sdr_id, f.first_contact_channel, o.lead_id, 'opp'
      FROM opportunities o
      JOIN analytics_lead_facts f ON f.lead_id = o.lead_id
      WHERE ${inRange('o.handoff_at')}
      UNION ALL
      SELECT ${day('o.won_at')}, o.sdr_id, f.first_contact_channel, o.lead_id, 'won'
      FROM opportunities o
      JOIN analytics_lead_facts f ON f.lead_id = o.lead_id
      WHERE o.status = 'WON' AND ${inRange('o.won_at')}
      UNION ALL
      -- Opt-out sem lead (só o contato) conta pela própria entrada da lista.
      SELECT ${day('s.created_at')}, f.owner_id, f.first_contact_channel,
        COALESCE(s.lead_id, s.id), 'optout'
      FROM suppression_entries s
      LEFT JOIN analytics_lead_facts f ON f.lead_id = s.lead_id
      WHERE s.reason = 'OPT_OUT' AND ${inRange('s.created_at')}
    ),
    grouped AS (
      SELECT e.day, grouping(e.user_id, e.channel) AS g,
        COALESCE(e.user_id::text, e.channel, '') AS dimension_id,
        count(*) FILTER (WHERE e.kind = 'new')::int AS new_leads,
        count(*) FILTER (WHERE e.kind = 'first')::int AS first_contacts,
        count(DISTINCT e.lead_id) FILTER (WHERE e.kind IN ('msg_out', 'act_out'))::int
          AS leads_contacted,
        count(*) FILTER (WHERE e.kind = 'msg_out')::int AS messages_out,
        count(*) FILTER (WHERE e.kind = 'act_out')::int AS contacts_logged,
        count(*) FILTER (WHERE e.kind = 'msg_in')::int AS messages_in,
        count(*) FILTER (WHERE e.kind = 'replied')::int AS leads_replied,
        count(*) FILTER (WHERE e.kind = 'interested')::int AS interested,
        count(*) FILTER (WHERE e.kind = 'opp')::int AS opportunities,
        count(*) FILTER (WHERE e.kind = 'won')::int AS conversions,
        count(DISTINCT e.lead_id) FILTER (WHERE e.kind = 'optout')::int AS opt_outs
      FROM events e
      GROUP BY GROUPING SETS ((e.day), (e.day, e.user_id), (e.day, e.channel))
      -- grouping(): 3 = total do dia; 1 = por pessoa; 2 = por canal.
      HAVING grouping(e.user_id, e.channel) = 3
        OR (grouping(e.user_id, e.channel) = 1 AND e.user_id IS NOT NULL)
        OR (grouping(e.user_id, e.channel) = 2 AND e.channel IS NOT NULL)
    )
    INSERT INTO daily_metrics (date, dimension, dimension_id, new_leads, first_contacts,
      leads_contacted, messages_out, contacts_logged, messages_in, leads_replied, interested,
      opportunities, conversions, opt_outs, computed_at)
    SELECT g.day,
      (CASE g.g WHEN 3 THEN 'GLOBAL' WHEN 1 THEN 'SDR' ELSE 'CHANNEL' END)::metric_dimension,
      g.dimension_id, g.new_leads, g.first_contacts, g.leads_contacted, g.messages_out,
      g.contacts_logged, g.messages_in, g.leads_replied, g.interested, g.opportunities,
      g.conversions, g.opt_outs, ${computedAt}
    FROM grouped g
  `;
  await tx.$executeRaw`
    INSERT INTO daily_metrics (date, dimension, dimension_id, computed_at)
    SELECT d::date, 'GLOBAL', '', ${computedAt}
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
    ON CONFLICT DO NOTHING
  `;
  return inserted;
}

/** Último dia com o total calculado (AAAA-MM-DD), ou nulo se nunca rodou. */
export async function lastComputedDay(db: DbClient): Promise<string | null> {
  const [row] = await db.$queryRaw<{ day: string | null }[]>`
    SELECT to_char(max(date), 'YYYY-MM-DD') AS day FROM daily_metrics WHERE dimension = 'GLOBAL'
  `;
  return row?.day ?? null;
}

/** Dia local do lead mais antigo (início do preenchimento retroativo). */
export async function firstLeadDay(db: DbClient, timeZone: string): Promise<string | null> {
  const [row] = await db.$queryRaw<{ day: string | null }[]>`
    SELECT to_char(min(created_at) AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day FROM leads
  `;
  return row?.day ?? null;
}
