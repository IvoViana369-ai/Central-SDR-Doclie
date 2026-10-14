import { Prisma, type DbTransaction } from '@docline/db';
import { rateStat } from '../domain/confidence';
import type { InsightFact } from '../domain/insights';
import { ratio } from '../domain/metrics';

/**
 * Fatos dos insights da carteira (F11-04), calculados em SQL com as mesmas
 * definições da Minha Fila, dos jobs de esquecidos e do potencial por cidade.
 * Nenhum dado pessoal: só contagens, cidades e nomes de abordagens.
 */

export type InsightAudience =
  | { scope: 'TEAM' }
  | {
      scope: 'USER';
      userId: string;
      territories: readonly { stateUf: string; municipalityCode: number | null }[];
    };

/** Janela da comparação de abordagens (coorte do 1º contato). */
export const BEST_APPROACH_DAYS = 90;

const DAY_MS = 86_400_000;

const ownerIs = (a: InsightAudience, column = 'l.owner_id') =>
  a.scope === 'USER' ? Prisma.sql`AND ${Prisma.raw(column)} = ${a.userId}::uuid` : Prisma.empty;

/** Lead que ainda pode ser trabalhado: ativo e sem bloqueio de contato. */
const WORKABLE = Prisma.sql`l.status = 'ACTIVE' AND l.contact_status NOT IN ('OPTED_OUT', 'BLOCKED')`;

async function count(tx: DbTransaction, query: Prisma.Sql): Promise<number> {
  const [row] = await tx.$queryRaw<{ count: number }[]>(query);
  return row?.count ?? 0;
}

/** Respostas esperando ação: o lead escreveu depois do último contato (como na Minha Fila). */
function awaitingAction(tx: DbTransaction, a: InsightAudience) {
  return count(
    tx,
    Prisma.sql`
      SELECT count(*)::int AS count
      FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id
      WHERE ${WORKABLE} AND s.category IN ('OPEN', 'PARKED')
        AND l.last_inbound_at IS NOT NULL
        AND (l.last_contact_at IS NULL OR l.last_inbound_at > l.last_contact_at)
        ${ownerIs(a)}`,
  );
}

/** Transferências ao Comercial sem aceite depois do prazo. */
function pendingAcceptance(tx: DbTransaction, a: InsightAudience, now: Date) {
  return count(
    tx,
    Prisma.sql`
      SELECT count(*)::int AS count
      FROM opportunities o JOIN leads l ON l.id = o.lead_id AND l.status <> 'MERGED'
      WHERE o.status = 'OPEN' AND o.accepted_at IS NULL AND o.accept_due_at < ${now}
        ${ownerIs(a, 'o.sdr_id')}`,
  );
}

/** Prioritários (faixa mais alta do score) ainda sem 1º contato e sem oportunidade aberta. */
function priorityToContact(tx: DbTransaction, a: InsightAudience) {
  return count(
    tx,
    Prisma.sql`
      SELECT count(*)::int AS count
      FROM leads l
      WHERE ${WORKABLE} AND l.score_band = 'PRIORITY' AND l.first_contact_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM opportunities o WHERE o.lead_id = l.id AND o.status = 'OPEN'
        )
        ${ownerIs(a)}`,
  );
}

/** Cidade com mais leads esquecidos (sem atividade há N dias e sem próxima ação). */
async function forgottenInCity(
  tx: DbTransaction,
  a: InsightAudience,
  now: Date,
  days: number,
): Promise<InsightFact | null> {
  const [row] = await tx.$queryRaw<{ code: number; city: string; count: number }[]>`
    SELECT l.municipality_code AS code, m.name || '/' || m.uf AS city, count(*)::int AS count
    FROM leads l
    JOIN pipeline_stages s ON s.id = l.stage_id
    JOIN municipalities m ON m.ibge_code = l.municipality_code
    WHERE ${WORKABLE} AND s.category = 'OPEN' AND l.owner_id IS NOT NULL
      AND l.next_action_at IS NULL AND l.last_activity_at < ${new Date(now.getTime() - days * DAY_MS)}
      AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id AND o.status = 'OPEN')
      ${ownerIs(a)}
    GROUP BY l.municipality_code, m.name, m.uf
    ORDER BY count(*) DESC, m.name
    LIMIT 1
  `;
  return row
    ? { type: 'FORGOTTEN_IN_CITY', count: row.count, city: row.city, cityCode: row.code, days }
    : null;
}

/**
 * Abordagem com resposta acima da média, com significância: o intervalo de
 * confiança inteiro acima da taxa geral (e base de pelo menos 20 contatos).
 * Da equipe (fatos por lead), também mostrada a cada SDR.
 */
export async function bestApproach(tx: DbTransaction, now: Date): Promise<InsightFact | null> {
  const since = new Date(now.getTime() - BEST_APPROACH_DAYS * DAY_MS);
  const rows = await tx.$queryRaw<
    {
      isTotal: boolean;
      approachId: string | null;
      name: string | null;
      trials: number;
      replied: number;
    }[]
  >`
    SELECT grouping(f.first_contact_approach_id) = 1 AS "isTotal",
      f.first_contact_approach_id::text AS "approachId", a.name,
      count(*)::int AS trials, count(f.first_reply_at)::int AS replied
    FROM analytics_lead_facts f
    LEFT JOIN approaches a ON a.id = f.first_contact_approach_id
    WHERE f.first_contact_at >= ${since} AND f.first_contact_at < ${now}
    GROUP BY GROUPING SETS ((), (f.first_contact_approach_id, a.name))
  `;
  const total = rows.find((r) => r.isTotal);
  const reference = total ? ratio(total.replied, total.trials) : null;
  if (reference === null) return null;
  const best = rows
    .filter((r) => !r.isTotal && r.approachId && r.name)
    .map((r) => ({ ...r, stat: rateStat(r.replied, r.trials, reference) }))
    .filter((r) => r.stat.comparison === 'ABOVE')
    .sort((x, y) => y.stat.rate! - x.stat.rate! || y.trials - x.trials)[0];
  return best
    ? {
        type: 'BEST_APPROACH',
        approachId: best.approachId!,
        approach: best.name!,
        rate: best.stat.rate!,
        reference,
        trials: best.trials,
        days: BEST_APPROACH_DAYS,
      }
    : null;
}

/**
 * Cidade com mais escritórios ativos da base aberta do CNPJ que ainda não são
 * lead (como no potencial da Prospecção). Para o SDR, só no seu território.
 */
async function topPotentialCity(
  tx: DbTransaction,
  a: InsightAudience,
): Promise<InsightFact | null> {
  let where = Prisma.sql`rc.municipality_code IS NOT NULL`;
  if (a.scope === 'USER') {
    if (a.territories.length === 0) return null;
    const cities = a.territories.flatMap((t) => (t.municipalityCode ? [t.municipalityCode] : []));
    const states = a.territories.flatMap((t) => (t.municipalityCode ? [] : [t.stateUf]));
    const parts = [
      cities.length ? Prisma.sql`rc.municipality_code IN (${Prisma.join(cities)})` : null,
      states.length ? Prisma.sql`rc.uf IN (${Prisma.join(states)})` : null,
    ].filter((p): p is Prisma.Sql => p !== null);
    where = Prisma.sql`${where} AND (${Prisma.join(parts, ' OR ')})`;
  }
  const [row] = await tx.$queryRaw<
    { code: number; city: string; offices: number; remaining: number }[]
  >`
    WITH universe AS (
      SELECT rc.municipality_code AS code, count(*)::int AS offices, count(l.id)::int AS in_base
      FROM registry_companies rc
      LEFT JOIN leads l ON l.cnpj = rc.cnpj AND l.status IN ('ACTIVE', 'ARCHIVED')
      WHERE ${where}
      GROUP BY rc.municipality_code
    )
    SELECT u.code, m.name || '/' || m.uf AS city, u.offices, (u.offices - u.in_base)::int AS remaining
    FROM universe u JOIN municipalities m ON m.ibge_code = u.code
    WHERE u.offices > u.in_base
    ORDER BY u.offices - u.in_base DESC, m.name
    LIMIT 1
  `;
  return row
    ? {
        type: 'TOP_POTENTIAL_CITY',
        city: row.city,
        cityCode: row.code,
        remaining: row.remaining,
        offices: row.offices,
      }
    : null;
}

/** Todos os fatos do público, só os que têm algo a dizer (contagem acima de zero). */
export async function computeInsightFacts(
  tx: DbTransaction,
  audience: InsightAudience,
  now: Date,
  options: { forgottenAfterDays: number; bestApproach: InsightFact | null },
): Promise<InsightFact[]> {
  const facts: InsightFact[] = [];
  const awaiting = await awaitingAction(tx, audience);
  if (awaiting > 0) facts.push({ type: 'AWAITING_ACTION', count: awaiting });
  const pending = await pendingAcceptance(tx, audience, now);
  if (pending > 0) facts.push({ type: 'PENDING_ACCEPTANCE', count: pending });
  const priority = await priorityToContact(tx, audience);
  if (priority > 0) facts.push({ type: 'PRIORITY_TO_CONTACT', count: priority });
  const forgotten = await forgottenInCity(tx, audience, now, options.forgottenAfterDays);
  if (forgotten) facts.push(forgotten);
  if (options.bestApproach) facts.push(options.bestApproach);
  const potential = await topPotentialCity(tx, audience);
  if (potential) facts.push(potential);
  return facts;
}
