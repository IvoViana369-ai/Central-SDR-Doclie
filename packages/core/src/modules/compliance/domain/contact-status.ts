import type { ContactStatus, LegalBasis, SuppressionReason, SuppressionScope } from '@docline/db';

/**
 * Situação de contato do lead (cache em `leads.contact_status`, para filtros e
 * contagens). O gate por canal, com motivos legíveis, fica em `contactability.ts`.
 *
 * Supressões valem por identificador (docs/LGPD.md §8): um telefone na Lista Não
 * Contatar torna só aquele contato inutilizável. A organização inteira só é
 * bloqueada por supressão do lead ou do CNPJ, ou quando nenhum contato sobra.
 */

export interface MatchedSuppression {
  reason: SuppressionReason;
  scope: SuppressionScope;
}

export interface ContactStatusInput {
  /** Base legal do lead para todos os canais (nula se nunca registrada). */
  legalBasis: LegalBasis | null;
  /** Supressões vigentes do lead (tipo LEAD) ou do seu CNPJ. */
  organizationSuppressions: MatchedSuppression[];
  /** Pontos de contato ativos, com as supressões vigentes de cada um. */
  contactPoints: { suppressions: MatchedSuppression[] }[];
}

const OPT_OUT_REASONS: ReadonlySet<SuppressionReason> = new Set([
  'OPT_OUT',
  'DATA_SUBJECT_REQUEST',
]);

function blockingStatus(suppressions: MatchedSuppression[]): ContactStatus | null {
  const allChannels = suppressions.filter((s) => s.scope === 'ALL_CHANNELS');
  if (allChannels.length === 0) return null;
  return allChannels.some((s) => OPT_OUT_REASONS.has(s.reason)) ? 'OPTED_OUT' : 'BLOCKED';
}

export function computeContactStatus(input: ContactStatusInput): ContactStatus {
  const organization = blockingStatus(input.organizationSuppressions);
  if (organization) return organization;

  if (input.legalBasis === null || input.legalBasis === 'NOT_ASSESSED') return 'NO_LEGAL_BASIS';

  const usable = input.contactPoints.filter((cp) => blockingStatus(cp.suppressions) === null);
  if (usable.length === 0) {
    const blocked = input.contactPoints.map((cp) => blockingStatus(cp.suppressions));
    if (blocked.includes('OPTED_OUT')) return 'OPTED_OUT';
    if (blocked.includes('BLOCKED')) return 'BLOCKED';
    return 'RESTRICTED';
  }

  const partial =
    input.organizationSuppressions.length > 0 ||
    input.contactPoints.some((cp) => cp.suppressions.length > 0);
  return partial ? 'RESTRICTED' : 'CONTACTABLE';
}

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  CONTACTABLE: 'Contactável',
  RESTRICTED: 'Restrito',
  NO_LEGAL_BASIS: 'Sem base legal',
  OPTED_OUT: 'Pediu para não ser contatado',
  BLOCKED: 'Bloqueado',
};

export const LEGAL_BASIS_LABELS: Record<LegalBasis, string> = {
  CONSENT: 'Consentimento',
  LEGITIMATE_INTEREST: 'Legítimo interesse',
  CONTRACT: 'Execução de contrato',
  NOT_ASSESSED: 'Não avaliada',
};
