import { Prisma, type DbTransaction } from '@docline/db';
import type { ConversionDimension } from '../domain/dimensions';
import type { AnalyticsPeriod } from '../domain/period';

/**
 * Consultas sobre os rollups (F11-01/F11-02): a coorte do 1º contato em
 * `analytics_lead_facts` e as somas de `daily_metrics`. Os dois são
 * atualizados pelo job `analytics.rollup`; os números ficam tão atuais quanto
 * a última execução (a tela mostra quando foi).
 *
 * Filtro por pessoa: a coorte é a dos 1ºs contatos que ela fez; as somas do
 * dia seguem a atribuição de `daily_metrics` (infra/rollups.ts).
 */

/** Colunas dos recortes (lista fechada: nada vem do usuário para o SQL). */
const FACT_COLUMNS: Record<ConversionDimension, string> = {
  city: 'f.municipality_code',
  state: 'f.state_uf',
  segment: 'f.segment_id',
  source: 'f.origin_source_id',
  owner: 'f.owner_id',
  firstContactUser: 'f.first_contact_user_id',
  campaign: 'f.first_contact_campaign_id',
  approach: 'f.first_contact_approach_id',
  channel: 'f.first_contact_channel',
};

export interface CohortRow {
  /** Nulo na linha do total e em quem não tem o recorte (veja `isTotal`). */
  key: string | null;
  isTotal: boolean;
  firstContacts: number;
  replied: number;
  interested: number;
  opportunities: number;
  won: number;
  partners: number;
  customers: number;
  optedOut: number;
}

export interface CohortFilter {
  start: Date;
  end: Date;
  /** Só os 1ºs contatos feitos por esta pessoa. */
  userId: string | null;
}

/**
 * Coorte do 1º contato no intervalo, no total e por recorte (ou por mês local),
 * numa passada só (GROUPING SETS). Marcos acompanhados até hoje.
 */
export async function cohortBy(
  tx: DbTransaction,
  f: CohortFilter,
  /** Por recorte, ou por mês local no fuso informado. */
  group: { dimension: ConversionDimension } | { monthTimeZone: string },
): Promise<CohortRow[]> {
  const keyExpr =
    'dimension' in group
      ? Prisma.raw(`${FACT_COLUMNS[group.dimension]}::text`)
      : Prisma.sql`to_char(f.first_contact_at AT TIME ZONE ${group.monthTimeZone}, 'YYYY-MM')`;
  const person = f.userId
    ? Prisma.sql`AND f.first_contact_user_id = ${f.userId}::uuid`
    : Prisma.empty;
  return tx.$queryRaw<CohortRow[]>`
    WITH cohort AS (
      SELECT ${keyExpr} AS key, f.first_reply_at, f.first_interested_at,
        f.first_opportunity_at, f.won_at, f.conversion_type, f.opted_out_at
      FROM analytics_lead_facts f
      WHERE f.first_contact_at >= ${f.start} AND f.first_contact_at < ${f.end} ${person}
    )
    SELECT c.key, grouping(c.key) = 1 AS "isTotal",
      count(*)::int AS "firstContacts",
      count(c.first_reply_at)::int AS "replied",
      count(c.first_interested_at)::int AS "interested",
      count(c.first_opportunity_at)::int AS "opportunities",
      count(c.won_at)::int AS "won",
      count(*) FILTER (WHERE c.conversion_type = 'PARTNER')::int AS "partners",
      count(*) FILTER (WHERE c.conversion_type = 'CUSTOMER')::int AS "customers",
      count(c.opted_out_at)::int AS "optedOut"
    FROM cohort c
    GROUP BY GROUPING SETS ((), (c.key))
  `;
}

export interface RollupSums {
  key: string;
  newLeads: number;
  firstContacts: number;
  messagesOut: number;
  contactsLogged: number;
  messagesIn: number;
  leadsReplied: number;
  interested: number;
  opportunities: number;
  conversions: number;
  optOuts: number;
}

export type RollupScope =
  { dimension: 'GLOBAL' } | { dimension: 'SDR'; userId: string | null } | { dimension: 'CHANNEL' };

/**
 * Somas de `daily_metrics` no período, por mês (`byMonth`) ou pelo
 * recorte (pessoa ou canal). `leads_contacted` fica de fora: leads distintos
 * por dia não somam.
 */
export async function rollupSums(
  tx: DbTransaction,
  period: Pick<AnalyticsPeriod, 'from' | 'to'>,
  scope: RollupScope,
  byMonth: boolean,
): Promise<RollupSums[]> {
  const key = byMonth ? Prisma.sql`to_char(d.date, 'YYYY-MM')` : Prisma.sql`d.dimension_id`;
  const person =
    scope.dimension === 'SDR' && scope.userId
      ? Prisma.sql`AND d.dimension_id = ${scope.userId}`
      : Prisma.empty;
  return tx.$queryRaw<RollupSums[]>`
    SELECT ${key} AS key,
      sum(d.new_leads)::int AS "newLeads",
      sum(d.first_contacts)::int AS "firstContacts",
      sum(d.messages_out)::int AS "messagesOut",
      sum(d.contacts_logged)::int AS "contactsLogged",
      sum(d.messages_in)::int AS "messagesIn",
      sum(d.leads_replied)::int AS "leadsReplied",
      sum(d.interested)::int AS "interested",
      sum(d.opportunities)::int AS "opportunities",
      sum(d.conversions)::int AS "conversions",
      sum(d.opt_outs)::int AS "optOuts"
    FROM daily_metrics d
    WHERE d.dimension = ${scope.dimension}::metric_dimension
      AND d.date >= ${period.from}::date AND d.date <= ${period.to}::date ${person}
    GROUP BY 1
  `;
}

/** Leads ativos de cada responsável, agora (carteira). */
export async function activePortfolio(tx: DbTransaction): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<{ ownerId: string; count: number }[]>`
    SELECT l.owner_id::text AS "ownerId", count(*)::int AS count
    FROM leads l
    WHERE l.status = 'ACTIVE' AND l.owner_id IS NOT NULL
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.ownerId, r.count]));
}
