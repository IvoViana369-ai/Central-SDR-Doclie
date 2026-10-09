import type { ContactPointType, ContactStatus, DbTransaction } from '@docline/db';
import type { IdentifierHasher } from '../../../shared/identifier-hash';
import {
  computeContactStatus,
  findActiveSuppressions,
  identifierKey,
  type ActiveSuppression,
  type SuppressionIdentifier,
} from '../../compliance';

/** Identificadores do lead e dos contatos, para cruzar com a Lista Não Contatar. */
export function leadIdentifiers(
  hasher: IdentifierHasher,
  lead: { id: string; cnpj: string | null },
  contactPoints: { type: ContactPointType; valueHash: string }[],
): { organization: SuppressionIdentifier[]; contactPoints: SuppressionIdentifier[] } {
  const organization: SuppressionIdentifier[] = [{ type: 'LEAD', valueHash: lead.id }];
  if (lead.cnpj) organization.push({ type: 'CNPJ', valueHash: hasher.hash('CNPJ', lead.cnpj) });
  return {
    organization,
    contactPoints: contactPoints.map((cp) => ({ type: cp.type, valueHash: cp.valueHash })),
  };
}

export interface LeadSuppressionState {
  organization: ActiveSuppression[];
  /** Supressões vigentes por id de ponto de contato. */
  byContactPoint: Map<string, ActiveSuppression[]>;
}

/** Supressões vigentes que atingem o lead (organização e cada ponto de contato). */
export async function loadLeadSuppressions(
  tx: DbTransaction,
  hasher: IdentifierHasher,
  lead: { id: string; cnpj: string | null },
  contactPoints: { id: string; type: ContactPointType; valueHash: string }[],
): Promise<LeadSuppressionState> {
  const ids = leadIdentifiers(hasher, lead, contactPoints);
  const found = await findActiveSuppressions(tx, [...ids.organization, ...ids.contactPoints]);
  return {
    organization: ids.organization.flatMap((i) => found.get(identifierKey(i)) ?? []),
    byContactPoint: new Map(
      contactPoints.map((cp) => [cp.id, found.get(identifierKey(cp)) ?? []] as const),
    ),
  };
}

/**
 * Recalcula os caches do lead na mesma transação da alteração (docs/DATABASE.md
 * §4.3): canais disponíveis (has_*) e situação de contato (contact_status).
 * Chamado depois de qualquer mudança em contatos, base legal, supressões ou CNPJ.
 */
export async function refreshLeadContactState(
  tx: DbTransaction,
  hasher: IdentifierHasher,
  leadId: string,
): Promise<ContactStatus> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      cnpj: true,
      websiteUrl: true,
      contactPoints: {
        where: { status: 'ACTIVE' },
        select: { id: true, type: true, valueHash: true, whatsappStatus: true },
      },
      permissions: {
        where: { channel: 'ALL', personId: null, contactPointId: null },
        select: { legalBasis: true },
      },
    },
  });
  const suppressions = await loadLeadSuppressions(tx, hasher, lead, lead.contactPoints);
  const contactStatus = computeContactStatus({
    legalBasis: lead.permissions[0]?.legalBasis ?? null,
    organizationSuppressions: suppressions.organization,
    contactPoints: lead.contactPoints.map((cp) => ({
      suppressions: suppressions.byContactPoint.get(cp.id) ?? [],
    })),
  });

  const points = lead.contactPoints;
  await tx.lead.update({
    where: { id: leadId },
    data: {
      contactStatus,
      hasPhone: points.some((cp) => cp.type === 'PHONE'),
      hasWhatsapp: points.some(
        (cp) =>
          cp.type === 'PHONE' &&
          (cp.whatsappStatus === 'PROBABLE' || cp.whatsappStatus === 'CONFIRMED'),
      ),
      hasEmail: points.some((cp) => cp.type === 'EMAIL'),
      hasInstagram: points.some((cp) => cp.type === 'INSTAGRAM'),
      hasWebsite: lead.websiteUrl !== null,
    },
  });
  return contactStatus;
}
