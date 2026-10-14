import { Prisma, type DbTransaction } from '@docline/db';
import type { AnalyticsPeriod } from '../domain/period';

/**
 * Consultas dos indicadores (docs/SDR-FLOW.md §11) em SQL agregado, ao vivo
 * (docs/ARCHITECTURE.md §13), medidas com 100 mil leads (pnpm perf:100k).
 *
 * Filtro por pessoa (`userId`):
 * - indicadores do lead (novos, coorte, cidade, origem): leads de que ela é responsável;
 * - contatos feitos: mensagens enviadas e contatos registrados por ela;
 * - oportunidades e conversões: as transferidas por ela (`sdr_id`).
 * Leads mesclados ficam de fora (o histórico foi para o lead que ficou).
 */

export interface AnalyticsFilter {
  period: AnalyticsPeriod;
  userId: string | null;
}

/** Mensagens que contam como contato feito. */
const SENT = Prisma.sql`('SENT', 'DELIVERED', 'READ')`;

const ownerClause = (f: AnalyticsFilter, alias = 'l') =>
  f.userId ? Prisma.sql`AND ${Prisma.raw(alias)}.owner_id = ${f.userId}::uuid` : Prisma.empty;

/** Dimensões permitidas (lista fechada: nada vem do usuário para o SQL). */
const DIMENSION_COLUMNS = {
  city: 'municipality_code',
  source: 'origin_source_id',
  owner: 'owner_id',
} as const;

export type LeadDimension = 'none' | keyof typeof DIMENSION_COLUMNS;

export interface LeadMetricsRow {
  key: string | null;
  active: number;
  newLeads: number;
  firstContacts: number;
  responded: number;
  interestedCohort: number;
  opportunitiesCohort: number;
  wonCohort: number;
}

/**
 * Indicadores por lead, numa passada só para todas as dimensões pedidas
 * (GROUPING SETS): novos no período, ativos agora e a coorte do primeiro
 * contato, com resposta, interesse, oportunidade e ganho acompanhados até
 * hoje. Respostas, interesse e oportunidades são agregados por lead antes e
 * entram por hash join (sem subconsulta por lead).
 */
export async function leadMetrics(
  tx: DbTransaction,
  f: AnalyticsFilter,
  dimensions: readonly LeadDimension[],
): Promise<Map<LeadDimension, LeadMetricsRow[]>> {
  const { start, end } = f.period;
  const grouped = dimensions.filter((d) => d !== 'none');
  const columns = grouped.map((d) => `f.${DIMENSION_COLUMNS[d]}`);
  const sets = Prisma.join(
    dimensions.map((d) =>
      d === 'none' ? Prisma.sql`()` : Prisma.sql`(${Prisma.raw(`f.${DIMENSION_COLUMNS[d]}`)})`,
    ),
  );
  // grouping(c1, …, cn): bit 1 para cada coluna fora do conjunto (a primeira é o bit mais alto).
  const all = (1 << columns.length) - 1;
  const bitsOf = (d: LeadDimension) =>
    d === 'none' ? all : all - (1 << (columns.length - 1 - grouped.indexOf(d)));
  const groupingExpr = columns.length
    ? Prisma.raw(`grouping(${columns.join(', ')})::int`)
    : Prisma.raw('0');
  const keyExpr = columns.length
    ? Prisma.raw(`COALESCE(${columns.map((c) => `${c}::text`).join(', ')})`)
    : Prisma.raw('NULL::text');
  const rows = await tx.$queryRaw<(LeadMetricsRow & { grouping: number })[]>`
    WITH inbound AS (
      SELECT m.lead_id, max(COALESCE(m.received_at, m.created_at)) AS last_at
      FROM messages m
      WHERE m.direction = 'INBOUND' AND m.status <> 'CANCELED'
      GROUP BY m.lead_id
    ),
    inbound_calls AS (
      SELECT a.lead_id, max(a.occurred_at) AS last_at
      FROM activities a WHERE a.direction = 'INBOUND' GROUP BY a.lead_id
    ),
    interested AS (
      SELECT DISTINCT m.lead_id FROM messages m WHERE m.classification = 'INTERESTED'
    ),
    opps AS (
      SELECT o.lead_id, bool_or(o.status = 'WON') AS won FROM opportunities o GROUP BY o.lead_id
    ),
    flags AS (
      SELECT l.municipality_code, l.origin_source_id, l.owner_id, l.status,
        (l.created_at >= ${start} AND l.created_at < ${end}) AS is_new,
        (l.first_contact_at >= ${start} AND l.first_contact_at < ${end}) AS in_cohort,
        -- Resposta depois do primeiro contato: mensagem recebida ou ligação de entrada.
        (i.last_at >= l.first_contact_at OR c.last_at >= l.first_contact_at) AS replied,
        it.lead_id IS NOT NULL AS interested,
        o.lead_id IS NOT NULL AS has_opportunity,
        COALESCE(o.won, false) AS won
      FROM leads l
      LEFT JOIN inbound i ON i.lead_id = l.id
      LEFT JOIN inbound_calls c ON c.lead_id = l.id
      LEFT JOIN interested it ON it.lead_id = l.id
      LEFT JOIN opps o ON o.lead_id = l.id
      WHERE l.status <> 'MERGED' ${ownerClause(f)}
    )
    SELECT ${groupingExpr} AS grouping, ${keyExpr} AS key,
      count(*) FILTER (WHERE f.status = 'ACTIVE')::int AS "active",
      count(*) FILTER (WHERE f.is_new)::int AS "newLeads",
      count(*) FILTER (WHERE f.in_cohort)::int AS "firstContacts",
      count(*) FILTER (WHERE f.in_cohort AND f.replied)::int AS "responded",
      count(*) FILTER (WHERE f.in_cohort AND f.interested)::int AS "interestedCohort",
      count(*) FILTER (WHERE f.in_cohort AND f.has_opportunity)::int AS "opportunitiesCohort",
      count(*) FILTER (WHERE f.in_cohort AND f.won)::int AS "wonCohort"
    FROM flags f
    GROUP BY GROUPING SETS (${sets})
  `;
  const result = new Map<LeadDimension, LeadMetricsRow[]>(dimensions.map((d) => [d, []]));
  for (const { grouping, ...row } of rows) {
    const dimension = dimensions.find((d) => bitsOf(d) === grouping);
    if (dimension) result.get(dimension)!.push(row);
  }
  return result;
}

/** Mediana (horas) do cadastro ao primeiro contato, nos primeiros contatos do período. */
export async function medianHoursToFirstContact(
  tx: DbTransaction,
  f: AnalyticsFilter,
): Promise<number | null> {
  const { start, end } = f.period;
  const [row] = await tx.$queryRaw<{ hours: number | null }[]>`
    -- Contato registrado com data anterior ao cadastro conta como zero.
    SELECT (percentile_cont(0.5) WITHIN GROUP (
      ORDER BY GREATEST(0, extract(epoch FROM l.first_contact_at - l.created_at)) / 3600.0
    ))::float8 AS hours
    FROM leads l
    WHERE l.status <> 'MERGED' AND l.first_contact_at >= ${start} AND l.first_contact_at < ${end}
      ${ownerClause(f)}
  `;
  return row?.hours ?? null;
}

export interface ContactRow {
  key: string | null;
  leadsContacted: number;
  messagesSent: number;
  contactsLogged: number;
}

/** Contatos feitos no período (mensagens enviadas e contatos registrados), por pessoa ou no total. */
export async function contactMetrics(
  tx: DbTransaction,
  f: AnalyticsFilter,
  byUser: boolean,
): Promise<ContactRow[]> {
  const { start, end } = f.period;
  const person = (column: string) =>
    f.userId ? Prisma.sql`AND ${Prisma.raw(column)} = ${f.userId}::uuid` : Prisma.empty;
  return tx.$queryRaw<ContactRow[]>`
    WITH contacts AS (
      SELECT m.sent_by_id AS user_id, m.lead_id, 'M' AS kind
      FROM messages m
      WHERE m.direction = 'OUTBOUND' AND m.status IN ${SENT}
        AND m.sent_at >= ${start} AND m.sent_at < ${end} ${person('m.sent_by_id')}
      UNION ALL
      SELECT a.user_id, a.lead_id, 'A' AS kind
      FROM activities a
      WHERE a.direction = 'OUTBOUND' AND a.occurred_at >= ${start} AND a.occurred_at < ${end}
        ${person('a.user_id')}
    )
    SELECT ${byUser ? Prisma.sql`x.user_id::text` : Prisma.sql`NULL::text`} AS key,
      count(DISTINCT x.lead_id)::int AS "leadsContacted",
      count(*) FILTER (WHERE x.kind = 'M')::int AS "messagesSent",
      count(*) FILTER (WHERE x.kind = 'A')::int AS "contactsLogged"
    FROM contacts x
    JOIN leads l ON l.id = x.lead_id AND l.status <> 'MERGED'
    GROUP BY 1
  `;
}

export interface OutcomeRow {
  key: string | null;
  opportunities: number;
  conversions: number;
  partners: number;
  customers: number;
}

/** Oportunidades criadas e ganhas no período, por quem transferiu ou no total. */
export async function outcomeMetrics(
  tx: DbTransaction,
  f: AnalyticsFilter,
  byUser: boolean,
): Promise<OutcomeRow[]> {
  const { start, end } = f.period;
  const person = f.userId ? Prisma.sql`AND o.sdr_id = ${f.userId}::uuid` : Prisma.empty;
  return tx.$queryRaw<OutcomeRow[]>`
    SELECT ${byUser ? Prisma.sql`o.sdr_id::text` : Prisma.sql`NULL::text`} AS key,
      count(*) FILTER (WHERE o.handoff_at >= ${start} AND o.handoff_at < ${end})::int AS "opportunities",
      count(*) FILTER (WHERE o.status = 'WON' AND o.won_at >= ${start} AND o.won_at < ${end})::int AS "conversions",
      count(*) FILTER (WHERE o.status = 'WON' AND o.won_at >= ${start} AND o.won_at < ${end}
        AND o.conversion_type = 'PARTNER')::int AS "partners",
      count(*) FILTER (WHERE o.status = 'WON' AND o.won_at >= ${start} AND o.won_at < ${end}
        AND o.conversion_type = 'CUSTOMER')::int AS "customers"
    FROM opportunities o
    JOIN leads l ON l.id = o.lead_id AND l.status <> 'MERGED'
    WHERE ((o.handoff_at >= ${start} AND o.handoff_at < ${end})
       OR (o.won_at >= ${start} AND o.won_at < ${end})) ${person}
    GROUP BY 1
  `;
}

/** Leads com resposta de interesse recebida no período. */
export async function interestedInPeriod(tx: DbTransaction, f: AnalyticsFilter): Promise<number> {
  const { start, end } = f.period;
  const [row] = await tx.$queryRaw<{ count: number }[]>`
    SELECT count(DISTINCT m.lead_id)::int AS count
    FROM messages m
    JOIN leads l ON l.id = m.lead_id AND l.status <> 'MERGED'
    WHERE m.direction = 'INBOUND' AND m.classification = 'INTERESTED'
      AND COALESCE(m.received_at, m.created_at) >= ${start}
      AND COALESCE(m.received_at, m.created_at) < ${end} ${ownerClause(f)}
  `;
  return row?.count ?? 0;
}

/** Leads que entraram na Lista Não Contatar por opt-out no período. */
export async function optOutsInPeriod(tx: DbTransaction, f: AnalyticsFilter): Promise<number> {
  const { start, end } = f.period;
  const join = f.userId
    ? Prisma.sql`JOIN leads l ON l.id = s.lead_id ${ownerClause(f)}`
    : Prisma.empty;
  const [row] = await tx.$queryRaw<{ count: number }[]>`
    SELECT count(DISTINCT COALESCE(s.lead_id, s.id))::int AS count
    FROM suppression_entries s ${join}
    WHERE s.reason = 'OPT_OUT' AND s.created_at >= ${start} AND s.created_at < ${end}
  `;
  return row?.count ?? 0;
}

export interface StageRow {
  stageId: string | null;
  name: string;
  category: string | null;
  color: string | null;
  position: number;
  leads: number;
}

/** Leads ativos por etapa do pipeline padrão, agora (funil por etapa). */
export async function stageCounts(tx: DbTransaction, f: AnalyticsFilter): Promise<StageRow[]> {
  const stages = await tx.$queryRaw<StageRow[]>`
    SELECT s.id::text AS "stageId", s.name, s.category::text AS category, s.color, s.position,
      count(l.id)::int AS leads
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id AND p.is_default
    LEFT JOIN leads l ON l.stage_id = s.id AND l.status = 'ACTIVE' ${ownerClause(f)}
    WHERE s.active
    GROUP BY s.id
    ORDER BY s.position
  `;
  const [orphans] = await tx.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM leads l
    WHERE l.status = 'ACTIVE' AND l.stage_id IS NULL ${ownerClause(f)}
  `;
  return orphans?.count
    ? [
        ...stages,
        {
          stageId: null,
          name: 'Sem etapa',
          category: null,
          color: null,
          position: Number.MAX_SAFE_INTEGER,
          leads: orphans.count,
        },
      ]
    : stages;
}

export interface DailyRow {
  day: string;
  newLeads: number;
  firstContacts: number;
  leadsContacted: number;
  replies: number;
  opportunities: number;
  conversions: number;
}

/** Evolução diária (dias locais do fuso), com zero nos dias sem movimento. */
export async function dailySeries(tx: DbTransaction, f: AnalyticsFilter): Promise<DailyRow[]> {
  const { start, end, timeZone } = f.period;
  const localDay = (column: string) =>
    Prisma.sql`to_char(${Prisma.raw(column)} AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
  const person = (column: string) =>
    f.userId ? Prisma.sql`AND ${Prisma.raw(column)} = ${f.userId}::uuid` : Prisma.empty;
  type Count = { day: string; count: number };

  const [newLeads, firstContacts, contacted, replies, opportunities, conversions] =
    await Promise.all([
      tx.$queryRaw<Count[]>`
        SELECT ${localDay('l.created_at')} AS day, count(*)::int AS count FROM leads l
        WHERE l.status <> 'MERGED' AND l.created_at >= ${start} AND l.created_at < ${end} ${ownerClause(f)}
        GROUP BY 1`,
      tx.$queryRaw<Count[]>`
        SELECT ${localDay('l.first_contact_at')} AS day, count(*)::int AS count FROM leads l
        WHERE l.status <> 'MERGED' AND l.first_contact_at >= ${start} AND l.first_contact_at < ${end}
          ${ownerClause(f)}
        GROUP BY 1`,
      tx.$queryRaw<Count[]>`
        SELECT x.day, count(DISTINCT x.lead_id)::int AS count FROM (
          SELECT ${localDay('m.sent_at')} AS day, m.lead_id FROM messages m
          WHERE m.direction = 'OUTBOUND' AND m.status IN ${SENT}
            AND m.sent_at >= ${start} AND m.sent_at < ${end} ${person('m.sent_by_id')}
          UNION ALL
          SELECT ${localDay('a.occurred_at')} AS day, a.lead_id FROM activities a
          WHERE a.direction = 'OUTBOUND' AND a.occurred_at >= ${start} AND a.occurred_at < ${end}
            ${person('a.user_id')}
        ) x JOIN leads l ON l.id = x.lead_id AND l.status <> 'MERGED'
        GROUP BY 1`,
      tx.$queryRaw<Count[]>`
        SELECT ${localDay('COALESCE(m.received_at, m.created_at)')} AS day,
          count(DISTINCT m.lead_id)::int AS count
        FROM messages m JOIN leads l ON l.id = m.lead_id AND l.status <> 'MERGED'
        WHERE m.direction = 'INBOUND' AND m.status <> 'CANCELED'
          AND COALESCE(m.received_at, m.created_at) >= ${start}
          AND COALESCE(m.received_at, m.created_at) < ${end} ${ownerClause(f)}
        GROUP BY 1`,
      tx.$queryRaw<Count[]>`
        SELECT ${localDay('o.handoff_at')} AS day, count(*)::int AS count FROM opportunities o
        JOIN leads l ON l.id = o.lead_id AND l.status <> 'MERGED'
        WHERE o.handoff_at >= ${start} AND o.handoff_at < ${end} ${person('o.sdr_id')}
        GROUP BY 1`,
      tx.$queryRaw<Count[]>`
        SELECT ${localDay('o.won_at')} AS day, count(*)::int AS count FROM opportunities o
        JOIN leads l ON l.id = o.lead_id AND l.status <> 'MERGED'
        WHERE o.status = 'WON' AND o.won_at >= ${start} AND o.won_at < ${end} ${person('o.sdr_id')}
        GROUP BY 1`,
    ]);

  const index = (rows: Count[]) => new Map(rows.map((r) => [r.day, r.count]));
  const maps = {
    newLeads: index(newLeads),
    firstContacts: index(firstContacts),
    leadsContacted: index(contacted),
    replies: index(replies),
    opportunities: index(opportunities),
    conversions: index(conversions),
  };
  return f.period.days.map((day) => ({
    day,
    newLeads: maps.newLeads.get(day) ?? 0,
    firstContacts: maps.firstContacts.get(day) ?? 0,
    leadsContacted: maps.leadsContacted.get(day) ?? 0,
    replies: maps.replies.get(day) ?? 0,
    opportunities: maps.opportunities.get(day) ?? 0,
    conversions: maps.conversions.get(day) ?? 0,
  }));
}
