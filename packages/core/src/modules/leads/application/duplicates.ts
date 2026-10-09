import type { LeadStatus, Prisma } from '@docline/db';
import { ConflictError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { normalizeCnpj, normalizeUrl } from '../../normalization';
import { checkDuplicatesInput } from '../contracts/schemas';
import { buildLeadNames, formatLeadCode } from '../domain/lead';
import { leadScopeWhere } from '../infra/scope';
import { maskContactValue, normalizeContactValue, type NormalizedContact } from './normalize-input';

/**
 * Verificação de duplicidade EXATA antes de salvar (MVP M02, F2-04). A detecção
 * por similaridade, a fila de revisão e a mesclagem vêm na Fase 3.
 */

export type DuplicateReasonKind =
  'CNPJ' | 'PHONE' | 'EMAIL' | 'INSTAGRAM' | 'WEBSITE' | 'NAME_CITY';

export interface DuplicateReason {
  kind: DuplicateReasonKind;
  /** Valor mascarado ou descrição curta, para a mensagem. */
  detail: string;
  /** CNPJ ativo repetido impede o cadastro; os demais exigem confirmação. */
  blocking: boolean;
}

export interface DuplicateMatch {
  code: string;
  status: LeadStatus;
  /** Fora do escopo do usuário, só o código é revelado. */
  inScope: boolean;
  leadId: string | null;
  displayName: string | null;
  city: string | null;
  stateUf: string | null;
  ownerName: string | null;
  reasons: DuplicateReason[];
}

export interface DuplicateCandidate {
  cnpj?: string | null;
  contacts: NormalizedContact[];
  websiteDomain?: string | null;
  nameSearch?: string | null;
  municipalityCode?: number | null;
  excludeLeadId?: string | null;
}

/** Domínios que não identificam a empresa (perfis em redes e encurtadores). */
export const GENERIC_DOMAINS: ReadonlySet<string> = new Set([
  'instagram.com',
  'facebook.com',
  'fb.com',
  'linktr.ee',
  'wa.me',
  'whatsapp.com',
  'api.whatsapp.com',
  'google.com',
  'g.page',
  'goo.gl',
  'maps.app.goo.gl',
  'sites.google.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'bit.ly',
]);

const REASON_LABELS: Record<DuplicateReasonKind, string> = {
  CNPJ: 'mesmo CNPJ',
  PHONE: 'mesmo telefone',
  EMAIL: 'mesmo e-mail',
  INSTAGRAM: 'mesmo Instagram',
  WEBSITE: 'mesmo site',
  NAME_CITY: 'mesmo nome na mesma cidade',
};

export async function findDuplicateLeads(
  ctx: UseCaseContext,
  candidate: DuplicateCandidate,
): Promise<DuplicateMatch[]> {
  const websiteDomain =
    candidate.websiteDomain && !GENERIC_DOMAINS.has(candidate.websiteDomain)
      ? candidate.websiteDomain
      : null;
  const conditions: Prisma.LeadWhereInput[] = [];
  if (candidate.cnpj) conditions.push({ cnpj: candidate.cnpj });
  if (websiteDomain) conditions.push({ websiteDomain });
  if (candidate.nameSearch && candidate.municipalityCode) {
    conditions.push({
      nameSearch: candidate.nameSearch,
      municipalityCode: candidate.municipalityCode,
    });
  }
  const contactMatch = candidate.contacts.map((c) => ({
    type: c.type,
    valueNormalized: c.valueNormalized,
  }));
  if (contactMatch.length > 0) {
    conditions.push({
      contactPoints: { some: { status: { not: 'REMOVED' }, OR: contactMatch } },
    });
  }
  if (conditions.length === 0) return [];

  const leads = await ctx.tx.lead.findMany({
    where: {
      status: { in: ['ACTIVE', 'ARCHIVED'] },
      ...(candidate.excludeLeadId ? { id: { not: candidate.excludeLeadId } } : {}),
      OR: conditions,
    },
    select: {
      id: true,
      code: true,
      status: true,
      displayName: true,
      cityRaw: true,
      stateUf: true,
      cnpj: true,
      websiteDomain: true,
      nameSearch: true,
      municipalityCode: true,
      owner: { select: { name: true } },
      contactPoints: {
        where: { status: { not: 'REMOVED' }, OR: contactMatch.length > 0 ? contactMatch : [] },
        select: { type: true, valueNormalized: true },
      },
    },
    orderBy: { code: 'asc' },
    take: 20,
  });
  if (leads.length === 0) return [];

  const scope = await leadScopeWhere(ctx.tx, ctx.actor);
  const visible = new Set(
    (
      await ctx.tx.lead.findMany({
        where: { AND: [{ id: { in: leads.map((l) => l.id) } }, scope] },
        select: { id: true },
      })
    ).map((l) => l.id),
  );

  return leads.map((lead) => {
    const reasons: DuplicateReason[] = [];
    if (candidate.cnpj && lead.cnpj === candidate.cnpj) {
      reasons.push({ kind: 'CNPJ', detail: REASON_LABELS.CNPJ, blocking: true });
    }
    for (const cp of lead.contactPoints) {
      reasons.push({
        kind: cp.type,
        detail: `${REASON_LABELS[cp.type]} (${maskContactValue(cp.type, cp.valueNormalized)})`,
        blocking: false,
      });
    }
    if (websiteDomain && lead.websiteDomain === websiteDomain) {
      reasons.push({
        kind: 'WEBSITE',
        detail: `${REASON_LABELS.WEBSITE} (${websiteDomain})`,
        blocking: false,
      });
    }
    if (
      candidate.nameSearch &&
      candidate.municipalityCode &&
      lead.nameSearch === candidate.nameSearch &&
      lead.municipalityCode === candidate.municipalityCode
    ) {
      reasons.push({ kind: 'NAME_CITY', detail: REASON_LABELS.NAME_CITY, blocking: false });
    }
    const inScope = visible.has(lead.id);
    return {
      code: formatLeadCode(lead.code),
      status: lead.status,
      inScope,
      leadId: inScope ? lead.id : null,
      displayName: inScope ? lead.displayName : null,
      city: inScope ? lead.cityRaw : null,
      stateUf: inScope ? lead.stateUf : null,
      ownerName: inScope ? (lead.owner?.name ?? null) : null,
      reasons,
    };
  });
}

/** Erro de cadastro com possíveis duplicados: a UI mostra a lista e pede confirmação. */
export class PossibleDuplicateError extends ConflictError {
  override readonly code = 'POSSIBLE_DUPLICATE';

  constructor(
    readonly duplicates: DuplicateMatch[],
    message = 'Encontramos leads parecidos. Confira antes de salvar.',
  ) {
    super(message);
  }
}

/**
 * Duplicados que impedem o cadastro: CNPJ repetido de lead ativo ou arquivado
 * (o índice único só libera CNPJ de leads mesclados). Um arquivado deve ser
 * reativado em vez de recadastrado.
 */
export function blockingDuplicates(matches: DuplicateMatch[]): DuplicateMatch[] {
  return matches.filter((m) => m.reasons.some((r) => r.blocking));
}

export const checkDuplicates = defineUseCase({
  name: 'leads.checkDuplicates',
  access: 'lead.read',
  input: checkDuplicatesInput,
  async run(ctx, input) {
    // Valores inválidos são ignorados aqui: a validação acontece ao salvar.
    const contacts = input.contactPoints.flatMap((cp) => {
      const normalized = cp.value ? normalizeContactValue(cp.type, cp.value) : null;
      return normalized?.ok ? [normalized.value] : [];
    });
    const cnpj = input.cnpj ? normalizeCnpj(input.cnpj) : null;
    const url = input.website ? normalizeUrl(input.website) : null;
    const names = buildLeadNames(input);
    return findDuplicateLeads(ctx, {
      cnpj: cnpj?.ok ? cnpj.value.cnpj : null,
      contacts,
      websiteDomain: url?.ok ? url.value.domain : null,
      nameSearch: names?.nameSearch ?? null,
      municipalityCode: input.municipalityCode ?? null,
      excludeLeadId: input.excludeLeadId ?? null,
    });
  },
});
