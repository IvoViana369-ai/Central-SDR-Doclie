import type { ContactPointType, ContactStatus, DbTransaction } from '@docline/db';
import { recomputeLeadScores } from '../../scoring';
import { computeContactStatus } from '../domain/contact-status';
import {
  findActiveSuppressions,
  identifierKey,
  type ActiveSuppression,
  type SuppressionIdentifier,
} from './suppressions';

/** Identificadores do lead e dos contatos, para cruzar com a Lista Não Contatar. */
export function leadIdentifiers(
  lead: { id: string; cnpjHash: string | null },
  contactPoints: { type: ContactPointType; valueHash: string }[],
): { organization: SuppressionIdentifier[]; contactPoints: SuppressionIdentifier[] } {
  const organization: SuppressionIdentifier[] = [{ type: 'LEAD', valueHash: lead.id }];
  if (lead.cnpjHash) organization.push({ type: 'CNPJ', valueHash: lead.cnpjHash });
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
  lead: { id: string; cnpjHash: string | null },
  contactPoints: { id: string; type: ContactPointType; valueHash: string }[],
): Promise<LeadSuppressionState> {
  const ids = leadIdentifiers(lead, contactPoints);
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
 * §4.3): canais disponíveis (has_*), situação de contato (contact_status) e o
 * score. Chamado depois de qualquer mudança em contatos, base legal,
 * supressões, CNPJ ou site.
 */
export async function refreshLeadContactState(
  tx: DbTransaction,
  leadId: string,
  now: Date,
): Promise<ContactStatus> {
  const lead = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      id: true,
      cnpjHash: true,
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
  const suppressions = await loadLeadSuppressions(tx, lead, lead.contactPoints);
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
  // Canais, site e CNPJ são critérios do score: recalcula na mesma transação.
  await recomputeLeadScores(tx, [leadId], 'contact_state', now);
  return contactStatus;
}

/**
 * Recalcula a situação de contato de todos os leads atingidos por identificadores
 * (inclusão ou revogação na Lista Não Contatar). Devolve os ids dos leads.
 */
export async function refreshLeadsForIdentifiers(
  tx: DbTransaction,
  identifiers: SuppressionIdentifier[],
  now: Date,
): Promise<string[]> {
  const leadIds = new Set<string>();
  const byContact = identifiers.filter(
    (i): i is SuppressionIdentifier & { type: ContactPointType } =>
      i.type === 'PHONE' || i.type === 'EMAIL' || i.type === 'INSTAGRAM',
  );
  if (byContact.length > 0) {
    const points = await tx.contactPoint.findMany({
      where: { OR: byContact.map((i) => ({ type: i.type, valueHash: i.valueHash })) },
      select: { leadId: true },
      distinct: ['leadId'],
    });
    points.forEach((p) => leadIds.add(p.leadId));
  }
  const cnpjHashes = identifiers.filter((i) => i.type === 'CNPJ').map((i) => i.valueHash);
  if (cnpjHashes.length > 0) {
    const leads = await tx.lead.findMany({
      where: { cnpjHash: { in: cnpjHashes } },
      select: { id: true },
    });
    leads.forEach((l) => leadIds.add(l.id));
  }
  identifiers.filter((i) => i.type === 'LEAD').forEach((i) => leadIds.add(i.valueHash));

  for (const leadId of leadIds) {
    const exists = await tx.lead.count({ where: { id: leadId } });
    if (exists > 0) await refreshLeadContactState(tx, leadId, now);
  }
  return [...leadIds];
}
