import type { DbTransaction, ImportMatchStatus, SuppressionType } from '@docline/db';
import type { IdentifierHasher } from '../../../shared/identifier-hash';
import { findActiveSuppressions, identifierKey } from '../../compliance';
import { formatLeadCode } from '../../leads';
import { maskIdentifier, toSearchKey, type IdentifierKind } from '../../normalization';
import type { MatchReason } from '../domain/decisions';
import type { NormalizedImportRow } from '../domain/row';

export interface RowToMatch {
  id: string;
  rowNumber: number;
  normalized: NormalizedImportRow;
}

export interface RowMatch {
  status: ImportMatchStatus;
  matchedLeadId: string | null;
  reasons: MatchReason[];
  /** Avisos extras (ex.: contato com opt-out só de um canal). */
  warnings: string[];
}

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  PHONE: 'ligação',
  EMAIL: 'e-mail',
  INSTAGRAM: 'Instagram',
};

/** Chaves de identidade de uma linha, para achar repetições no próprio arquivo. */
/** Cidade para comparar nomes: o código do IBGE ou, sem ele, o texto da cidade e a UF. */
function placeKey(place: {
  municipalityCode: number | null;
  city: string | null;
  stateUf: string | null;
}): string | null {
  if (place.municipalityCode) return `ibge:${place.municipalityCode}`;
  if (place.city) return `texto:${toSearchKey(place.city)}|${place.stateUf ?? ''}`;
  return null;
}

function fileKeys(row: NormalizedImportRow): string[] {
  const keys = row.contacts.map((c) => `${c.type}:${c.value}`);
  if (row.cnpj) keys.push(`CNPJ:${row.cnpj}`);
  const place = placeKey({
    municipalityCode: row.municipalityCode,
    city: row.cityName,
    stateUf: row.stateUf,
  });
  keys.push(`NAME:${row.nameCore}|${place ?? 'sem cidade'}`);
  return keys;
}

/** Repetições dentro do arquivo: a primeira ocorrência vale, as seguintes são marcadas. */
export class InFileIndex {
  private readonly seen = new Map<string, number>();

  firstOccurrence(row: NormalizedImportRow): number | null {
    for (const key of fileKeys(row)) {
      const found = this.seen.get(key);
      if (found !== undefined) return found;
    }
    return null;
  }

  add(row: NormalizedImportRow, rowNumber: number): void {
    for (const key of fileKeys(row)) if (!this.seen.has(key)) this.seen.set(key, rowNumber);
  }
}

interface LeadHit {
  id: string;
  code: number;
  nameCore: string;
  cnpj: string | null;
  municipalityCode: number | null;
  cityRaw: string | null;
  stateUf: string | null;
}

const ACTIVE = { in: ['ACTIVE', 'ARCHIVED'] as ('ACTIVE' | 'ARCHIVED')[] };

/**
 * Casa um lote de linhas com a base (leads ativos e arquivados), com o próprio
 * arquivo e com a Lista Não Contatar, em poucas consultas por lote.
 *
 * - **Já existe:** mesmo CNPJ; mesmo nome na mesma cidade, sem CNPJ
 *   divergente; ou mesmo contato e mesmo nome.
 * - **Possível duplicado:** mesmo contato com outro nome, ou filial (mesma
 *   raiz de CNPJ).
 * - **Na Lista Não Contatar:** contato ou CNPJ suprimido em todos os canais.
 */
export async function matchRows(
  tx: DbTransaction,
  hasher: IdentifierHasher,
  rows: RowToMatch[],
  inFile: InFileIndex,
): Promise<Map<string, RowMatch>> {
  const cnpjs = [...new Set(rows.flatMap((r) => (r.normalized.cnpj ? [r.normalized.cnpj] : [])))];
  const roots = [
    ...new Set(rows.flatMap((r) => (r.normalized.cnpjRoot ? [r.normalized.cnpjRoot] : []))),
  ];
  const names = [...new Set(rows.map((r) => r.normalized.nameCore))];
  const byType = {
    PHONE: new Set<string>(),
    EMAIL: new Set<string>(),
    INSTAGRAM: new Set<string>(),
  };
  for (const r of rows) for (const c of r.normalized.contacts) byType[c.type].add(c.value);

  const leadSelect = {
    id: true,
    code: true,
    nameCore: true,
    cnpj: true,
    municipalityCode: true,
    cityRaw: true,
    stateUf: true,
  };
  const [byCnpj, byRoot, byName, points] = await Promise.all([
    cnpjs.length
      ? tx.lead.findMany({ where: { cnpj: { in: cnpjs }, status: ACTIVE }, select: leadSelect })
      : [],
    roots.length
      ? tx.lead.findMany({
          where: { cnpjRoot: { in: roots }, status: ACTIVE },
          select: { ...leadSelect, cnpjRoot: true },
        })
      : [],
    tx.lead.findMany({
      where: { nameCore: { in: names }, status: ACTIVE },
      select: leadSelect,
    }),
    tx.contactPoint.findMany({
      where: {
        status: { not: 'REMOVED' },
        lead: { status: ACTIVE },
        OR: (Object.entries(byType) as [keyof typeof byType, Set<string>][])
          .filter(([, values]) => values.size > 0)
          .map(([type, values]) => ({ type, valueNormalized: { in: [...values] } })),
      },
      select: { type: true, valueNormalized: true, lead: { select: leadSelect } },
    }),
  ]);

  const leadsByContact = new Map<string, LeadHit[]>();
  for (const p of points) {
    const key = `${p.type}:${p.valueNormalized}`;
    leadsByContact.set(key, [...(leadsByContact.get(key) ?? []), p.lead]);
  }

  // Lista Não Contatar: contatos e CNPJ de todas as linhas do lote.
  const identifiers = rows.flatMap((r) => [
    ...r.normalized.contacts.map((c) => ({
      type: c.type as SuppressionType,
      valueHash: hasher.hash(c.type, c.value),
    })),
    ...(r.normalized.cnpj
      ? [{ type: 'CNPJ' as const, valueHash: hasher.hash('CNPJ', r.normalized.cnpj) }]
      : []),
  ]);
  const suppressions = await findActiveSuppressions(tx, identifiers);

  const result = new Map<string, RowMatch>();
  for (const row of rows) {
    const n = row.normalized;
    const reasons: MatchReason[] = [];
    const warnings: string[] = [];
    let status: ImportMatchStatus = 'NEW';
    let matched: LeadHit | null = null;

    // Lista Não Contatar.
    let suppressed = false;
    const checks: { type: IdentifierKind; value: string }[] = [
      ...n.contacts.map((c) => ({ type: c.type, value: c.value })),
      ...(n.cnpj ? [{ type: 'CNPJ' as const, value: n.cnpj }] : []),
    ];
    for (const check of checks) {
      const found = suppressions.get(
        identifierKey({
          type: check.type as SuppressionType,
          valueHash: hasher.hash(check.type, check.value),
        }),
      );
      if (!found?.length) continue;
      const masked = maskIdentifier(check.type, check.value);
      if (found.some((s) => s.scope === 'ALL_CHANNELS')) {
        suppressed = true;
        reasons.push({ rule: 'SUPPRESSED', detail: masked });
      } else {
        const channels = found.map((s) => CHANNEL_LABELS[s.scope] ?? s.scope).join(', ');
        warnings.push(`${masked} pediu para não ser contatado por ${channels}.`);
      }
    }

    // Base: CNPJ, contatos, nome na cidade, filial.
    const cnpjHit = n.cnpj ? byCnpj.find((l) => l.cnpj === n.cnpj) : undefined;
    const contactHits = n.contacts.flatMap((c) =>
      (leadsByContact.get(`${c.type}:${c.value}`) ?? []).map((lead) => ({ lead, contact: c })),
    );
    const sameName = (lead: LeadHit) => lead.nameCore === n.nameCore;
    const rowPlace = placeKey({
      municipalityCode: n.municipalityCode,
      city: n.cityName,
      stateUf: n.stateUf,
    });
    const leadPlace = (l: LeadHit) =>
      placeKey({ municipalityCode: l.municipalityCode, city: l.cityRaw, stateUf: l.stateUf });
    const sameNameHits = byName.filter(
      (l) => sameName(l) && !(l.cnpj && n.cnpj && l.cnpj !== n.cnpj),
    );
    // Mesmo nome na mesma cidade (pelo IBGE ou, sem ele, pelo texto da cidade e UF).
    const nameCityHit = rowPlace ? sameNameHits.find((l) => leadPlace(l) === rowPlace) : undefined;
    // Mesmo nome e nenhum dos dois com cidade: só sinaliza.
    const nameOnlyHit = rowPlace ? undefined : sameNameHits.find((l) => leadPlace(l) === null);
    const rootHit =
      n.cnpjRoot && !cnpjHit
        ? byRoot.find((l) => l.cnpjRoot === n.cnpjRoot && l.cnpj !== n.cnpj)
        : undefined;

    if (cnpjHit) {
      status = 'EXISTING';
      matched = cnpjHit;
      reasons.push({ rule: 'CNPJ', detail: maskIdentifier('CNPJ', n.cnpj!) });
    } else if (contactHits.some((h) => sameName(h.lead))) {
      const hit = contactHits.find((h) => sameName(h.lead))!;
      status = 'EXISTING';
      matched = hit.lead;
      reasons.push({
        rule: hit.contact.type,
        detail: maskIdentifier(hit.contact.type, hit.contact.value),
      });
    } else if (nameCityHit) {
      status = 'EXISTING';
      matched = nameCityHit;
      reasons.push({ rule: 'NAME_CITY', detail: 'Mesmo nome na mesma cidade' });
    } else if (contactHits.length > 0) {
      const hit = contactHits[0]!;
      status = 'POSSIBLE_DUPLICATE';
      matched = hit.lead;
      reasons.push({
        rule: hit.contact.type,
        detail: maskIdentifier(hit.contact.type, hit.contact.value),
      });
    } else if (rootHit) {
      status = 'POSSIBLE_DUPLICATE';
      matched = rootHit;
      reasons.push({ rule: 'CNPJ_ROOT', detail: `Filial de ${formatLeadCode(rootHit.code)}` });
    } else if (nameOnlyHit) {
      status = 'POSSIBLE_DUPLICATE';
      matched = nameOnlyHit;
      reasons.push({ rule: 'NAME_CITY', detail: 'Mesmo nome, ambos sem cidade' });
    }

    // Arquivo: a primeira ocorrência vale.
    const first = inFile.firstOccurrence(n);
    if (first !== null) {
      reasons.push({ rule: 'IN_FILE', detail: `Igual à linha ${first}` });
      if (!suppressed) status = 'DUPLICATE_IN_FILE';
    } else {
      inFile.add(n, row.rowNumber);
    }
    if (suppressed) status = 'SUPPRESSED';

    result.set(row.id, { status, matchedLeadId: matched?.id ?? null, reasons, warnings });
  }
  return result;
}
