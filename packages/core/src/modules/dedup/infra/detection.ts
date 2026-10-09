import { Prisma, type DbTransaction, type DuplicateSource } from '@docline/db';
import { GENERIC_DOMAINS } from '../../leads';
import { maskIdentifier } from '../../normalization';
import { emailRule, signal, type DuplicateSignal } from '../domain/scoring';
import { upsertCandidate, type CandidateUpsert } from './candidates';

/**
 * Detecção de duplicados em SQL (docs/ARCHITECTURE.md §10; F3-08): índices
 * exatos para CNPJ, contatos e site; nome igual na mesma cidade; e nome
 * parecido (`pg_trgm` em `name_core`, que já não tem termos genéricos como
 * "contabilidade") só dentro da mesma cidade (*blocking*).
 *
 * Alvo: alguns leads (`dedup.check-lead`, importação) ou um bloco da varredura
 * diária (leads de uma UF contra toda a base; cada par aparece uma vez, no
 * bloco do lead de menor id).
 */
export type DetectionTarget =
  { kind: 'leads'; ids: string[] } | { kind: 'block'; stateUf: string | null };

/** Similaridade mínima entre os núcleos dos nomes (0–1). */
export const NAME_SIMILARITY_MIN = 0.6;
/** Valor repetido em mais leads que isto não identifica a empresa (ex.: telefone de associação). */
export const SHARED_VALUE_LIMIT = 20;
/** Núcleo de nome mais curto que isto é comum demais para comparar. */
const MIN_NAME_CORE = 3;

interface Hit {
  a_id: string;
  b_id: string;
  rule: string;
  value: string | null;
  sim: number | null;
}

export interface PairSignals {
  leadAId: string;
  leadBId: string;
  signals: DuplicateSignal[];
}

const ACTIVE = Prisma.sql`('ACTIVE', 'ARCHIVED')`;

function filters(target: DetectionTarget) {
  const a =
    target.kind === 'leads'
      ? Prisma.sql`a.id = ANY(${target.ids}::uuid[])`
      : target.stateUf
        ? Prisma.sql`a.state_uf = ${target.stateUf}`
        : Prisma.sql`a.state_uf IS NULL`;
  // Na varredura, cada par sai uma vez só (no bloco do lead de menor id).
  const pair = target.kind === 'leads' ? Prisma.sql`b.id <> a.id` : Prisma.sql`b.id > a.id`;
  return { a, pair };
}

async function findHits(tx: DbTransaction, target: DetectionTarget): Promise<Hit[]> {
  const { a, pair } = filters(target);
  const generic = [...GENERIC_DOMAINS];
  const [cnpj, contacts, website, names, similar] = await Promise.all([
    // Filial (mesma raiz de CNPJ). CNPJ igual entre leads não mesclados o índice
    // único já impede; a regra fica coberta mesmo assim.
    tx.$queryRaw<Hit[]>`
      SELECT a.id::text AS a_id, b.id::text AS b_id,
             CASE WHEN a.cnpj = b.cnpj THEN 'CNPJ' ELSE 'CNPJ_ROOT' END AS rule,
             CASE WHEN a.cnpj = b.cnpj THEN a.cnpj ELSE a.cnpj_root END AS value,
             NULL::float8 AS sim
      FROM leads a
      JOIN leads b ON b.cnpj_root = a.cnpj_root AND ${pair} AND b.status IN ${ACTIVE}
      WHERE ${a} AND a.status IN ${ACTIVE} AND a.cnpj_root IS NOT NULL
        AND (SELECT count(*) FROM leads l
             WHERE l.cnpj_root = a.cnpj_root AND l.status IN ${ACTIVE}) <= ${SHARED_VALUE_LIMIT}`,
    // Mesmo telefone, e-mail ou Instagram (contatos não removidos).
    tx.$queryRaw<Hit[]>`
      SELECT DISTINCT a.id::text AS a_id, b.id::text AS b_id, ca.type::text AS rule,
             ca.value_normalized AS value, NULL::float8 AS sim
      FROM leads a
      JOIN contact_points ca ON ca.lead_id = a.id AND ca.status <> 'REMOVED'
      JOIN contact_points cb ON cb.type = ca.type AND cb.value_normalized = ca.value_normalized
                            AND cb.lead_id <> a.id AND cb.status <> 'REMOVED'
      JOIN leads b ON b.id = cb.lead_id AND ${pair} AND b.status IN ${ACTIVE}
      WHERE ${a} AND a.status IN ${ACTIVE}
        AND (SELECT count(DISTINCT c.lead_id) FROM contact_points c
             WHERE c.type = ca.type AND c.value_normalized = ca.value_normalized
               AND c.status <> 'REMOVED') <= ${SHARED_VALUE_LIMIT}`,
    // Mesmo site (domínios de redes sociais e encurtadores não contam).
    tx.$queryRaw<Hit[]>`
      SELECT a.id::text AS a_id, b.id::text AS b_id, 'WEBSITE' AS rule,
             a.website_domain AS value, NULL::float8 AS sim
      FROM leads a
      JOIN leads b ON b.website_domain = a.website_domain AND ${pair} AND b.status IN ${ACTIVE}
      WHERE ${a} AND a.status IN ${ACTIVE} AND a.website_domain IS NOT NULL
        AND a.website_domain <> ALL(${generic}::text[])
        AND (SELECT count(*) FROM leads l
             WHERE l.website_domain = a.website_domain AND l.status IN ${ACTIVE}) <= ${SHARED_VALUE_LIMIT}`,
    // Mesmo nome na mesma cidade (código do IBGE ou, sem ele, o texto da
    // cidade e a UF); ou mesmo nome e nenhum dos dois com cidade.
    tx.$queryRaw<Hit[]>`
      SELECT a.id::text AS a_id, b.id::text AS b_id,
             CASE WHEN a.city_raw IS NULL AND a.municipality_code IS NULL
                  THEN 'NAME_NO_CITY' ELSE 'NAME_CITY' END AS rule,
             NULL AS value, NULL::float8 AS sim
      FROM leads a
      JOIN leads b ON b.name_core = a.name_core AND ${pair} AND b.status IN ${ACTIVE}
      WHERE ${a} AND a.status IN ${ACTIVE} AND length(a.name_core) >= ${MIN_NAME_CORE}
        AND (
          (a.municipality_code IS NOT NULL AND b.municipality_code = a.municipality_code)
          OR (a.city_raw IS NOT NULL AND b.city_raw IS NOT NULL
              AND (a.municipality_code IS NULL OR b.municipality_code IS NULL)
              AND lower(unaccent(b.city_raw)) = lower(unaccent(a.city_raw))
              AND b.state_uf IS NOT DISTINCT FROM a.state_uf)
          OR (a.municipality_code IS NULL AND a.city_raw IS NULL
              AND b.municipality_code IS NULL AND b.city_raw IS NULL)
        )`,
    // Nome parecido na mesma cidade: o operador % usa o índice trigram de
    // name_core; a similaridade mínima é conferida em seguida.
    tx.$queryRaw<Hit[]>`
      SELECT a.id::text AS a_id, s.id::text AS b_id, 'NAME_SIMILAR' AS rule,
             NULL AS value, s.sim
      FROM leads a
      CROSS JOIN LATERAL (
        SELECT b.id, similarity(b.name_core, a.name_core)::float8 AS sim
        FROM leads b
        WHERE b.municipality_code = a.municipality_code AND ${pair}
          AND b.status IN ${ACTIVE}
          AND b.name_core % a.name_core AND b.name_core <> a.name_core
          AND similarity(b.name_core, a.name_core) >= ${NAME_SIMILARITY_MIN}
        ORDER BY sim DESC
        LIMIT ${SHARED_VALUE_LIMIT}::int
      ) s
      WHERE ${a} AND a.status IN ${ACTIVE} AND a.municipality_code IS NOT NULL
        AND length(a.name_core) >= ${MIN_NAME_CORE + 1}`,
  ]);
  return [...cnpj, ...contacts, ...website, ...names, ...similar];
}

const formatRoot = (root: string) => `${root.slice(0, 2)}.${root.slice(2, 5)}.${root.slice(5)}`;

/** Sinal de um achado, com o valor sempre mascarado (sem dado pessoal em claro). */
function toSignal(hit: Hit): DuplicateSignal | null {
  const value = hit.value ?? '';
  switch (hit.rule) {
    case 'CNPJ':
      return signal('CNPJ', maskIdentifier('CNPJ', value));
    case 'CNPJ_ROOT':
      return signal('CNPJ_ROOT', `raiz ${formatRoot(value)}`);
    case 'PHONE':
      return signal('PHONE', maskIdentifier('PHONE', value));
    case 'EMAIL':
      return signal(emailRule(value), maskIdentifier('EMAIL', value));
    case 'INSTAGRAM':
      return signal('INSTAGRAM', maskIdentifier('INSTAGRAM', value));
    case 'WEBSITE':
      return signal('WEBSITE', value);
    case 'NAME_CITY':
      return signal('NAME_CITY', 'mesmo nome na mesma cidade');
    case 'NAME_NO_CITY':
      return signal('NAME_SIMILAR', 'mesmo nome, sem cidade nos dois');
    case 'NAME_SIMILAR': {
      const sim = hit.sim ?? 0;
      return signal('NAME_SIMILAR', `${Math.round(sim * 100)}% parecido`, sim);
    }
    default:
      return null;
  }
}

/** Pares e sinais encontrados para o alvo (o par sai ordenado: a < b). */
export async function findDuplicatePairs(
  tx: DbTransaction,
  target: DetectionTarget,
): Promise<PairSignals[]> {
  if (target.kind === 'leads' && target.ids.length === 0) return [];
  const pairs = new Map<string, PairSignals>();
  for (const hit of await findHits(tx, target)) {
    const s = toSignal(hit);
    if (!s) continue;
    const [leadAId, leadBId] = hit.a_id < hit.b_id ? [hit.a_id, hit.b_id] : [hit.b_id, hit.a_id];
    const key = `${leadAId}|${leadBId}`;
    const pair = pairs.get(key) ?? { leadAId, leadBId, signals: [] };
    pair.signals.push(s);
    pairs.set(key, pair);
  }
  return [...pairs.values()];
}

export type DetectionSummary = Record<CandidateUpsert, number> & { pairs: number };

/** Detecta e registra os candidatos do alvo; devolve quantos de cada resultado. */
export async function detectDuplicates(
  tx: DbTransaction,
  target: DetectionTarget,
  detectedBy: DuplicateSource,
  now: Date,
): Promise<{ summary: DetectionSummary; byLead: Map<string, CandidateUpsert[]> }> {
  const summary: DetectionSummary = {
    pairs: 0,
    created: 0,
    updated: 0,
    reopened: 0,
    unchanged: 0,
    skipped: 0,
  };
  const byLead = new Map<string, CandidateUpsert[]>();
  for (const pair of await findDuplicatePairs(tx, target)) {
    const result = await upsertCandidate(
      tx,
      pair.leadAId,
      pair.leadBId,
      pair.signals,
      detectedBy,
      now,
    );
    summary.pairs += 1;
    summary[result] += 1;
    for (const id of [pair.leadAId, pair.leadBId])
      byLead.set(id, [...(byLead.get(id) ?? []), result]);
  }
  return { summary, byLead };
}
