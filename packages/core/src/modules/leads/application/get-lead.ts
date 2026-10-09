import type { ContactPointType, Prisma } from '@docline/db';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { CONTACT_STATUS_LABELS } from '../../compliance';
import { formatCnpj, formatPhone, whatsappLink } from '../../normalization';
import { leadIdInput } from '../contracts/schemas';
import { formatLeadCode } from '../domain/lead';
import { loadLeadSuppressions } from '../../compliance';
import { requireLeadInScope } from '../infra/scope';

export const leadDetailSelect = {
  id: true,
  code: true,
  version: true,
  status: true,
  companyName: true,
  tradeName: true,
  displayName: true,
  leadType: true,
  category: true,
  cnaeMain: true,
  cnpj: true,
  cnpjHash: true,
  addressLine: true,
  addressNumber: true,
  addressComplement: true,
  neighborhood: true,
  cityRaw: true,
  municipalityCode: true,
  stateUf: true,
  postalCode: true,
  websiteUrl: true,
  websiteDomain: true,
  description: true,
  originDetail: true,
  originUrl: true,
  collectedAt: true,
  createdVia: true,
  ownerId: true,
  assignedAt: true,
  hasPhone: true,
  hasWhatsapp: true,
  hasEmail: true,
  hasInstagram: true,
  hasWebsite: true,
  contactStatus: true,
  lastActivityAt: true,
  archivedAt: true,
  anonymizedAt: true,
  createdAt: true,
  updatedAt: true,
  segment: { select: { id: true, key: true, name: true } },
  originSource: { select: { id: true, key: true, name: true } },
  owner: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  /** Lead que absorveu este na mesclagem (status MERGED). */
  mergedInto: { select: { id: true, code: true } },
  people: {
    where: { status: 'ACTIVE' },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      fullName: true,
      roleTitle: true,
      isPrimary: true,
      isDecisionMaker: true,
      notes: true,
    },
  },
  contactPoints: {
    where: { status: { not: 'REMOVED' } },
    orderBy: [{ type: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      personId: true,
      type: true,
      valueNormalized: true,
      valueHash: true,
      label: true,
      phoneKind: true,
      whatsappStatus: true,
      isPrimary: true,
      status: true,
      normalizationFlags: true,
      collectedAt: true,
      source: { select: { name: true } },
    },
  },
  tags: {
    orderBy: { addedAt: 'asc' },
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
  notes: {
    where: { removedAt: null },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    select: {
      id: true,
      body: true,
      pinned: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  },
  permissions: {
    where: { personId: null, contactPointId: null },
    orderBy: { channel: 'asc' },
    select: {
      channel: true,
      legalBasis: true,
      optInStatus: true,
      optInAt: true,
      optInMethod: true,
      evidence: true,
      recordedAt: true,
      assessment: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.LeadSelect;

function contactLinks(type: ContactPointType, value: string) {
  if (type === 'PHONE') {
    return { tel: `tel:${value}`, whatsapp: whatsappLink(value) };
  }
  if (type === 'EMAIL') return { mailto: `mailto:${value}` };
  return { instagram: `https://www.instagram.com/${value}/` };
}

function displayValue(type: ContactPointType, value: string): string {
  if (type === 'PHONE') return formatPhone(value);
  if (type === 'INSTAGRAM') return `@${value}`;
  return value;
}

/** Monta o detalhe do lead (já dentro do escopo do ator). */
export async function loadLeadDetail(ctx: UseCaseContext, leadId: string) {
  const lead = await requireLeadInScope(ctx, leadId, leadDetailSelect);
  const suppressions = await loadLeadSuppressions(ctx.tx, lead, lead.contactPoints);
  const describe = (s: { id: string; reason: string; scope: string; createdAt: Date }) => ({
    id: s.id,
    reason: s.reason,
    scope: s.scope,
    since: s.createdAt,
  });

  const { cnpjHash: _cnpjHash, mergedInto, ...rest } = lead;
  return {
    ...rest,
    codeLabel: formatLeadCode(lead.code),
    mergedInto: mergedInto
      ? { id: mergedInto.id, codeLabel: formatLeadCode(mergedInto.code) }
      : null,
    cnpjFormatted: lead.cnpj ? formatCnpj(lead.cnpj) : null,
    contactStatusLabel: CONTACT_STATUS_LABELS[lead.contactStatus],
    legalBasis: lead.permissions.find((p) => p.channel === 'ALL') ?? null,
    tags: lead.tags.map((t) => t.tag),
    organizationSuppressions: suppressions.organization.map(describe),
    contactPoints: lead.contactPoints.map(({ valueHash: _hash, ...cp }) => ({
      ...cp,
      display: displayValue(cp.type, cp.valueNormalized),
      links: contactLinks(cp.type, cp.valueNormalized),
      suppressions: (suppressions.byContactPoint.get(cp.id) ?? []).map(describe),
    })),
  };
}

export type LeadDetail = Awaited<ReturnType<typeof loadLeadDetail>>;

export const getLead = defineUseCase({
  name: 'leads.get',
  access: 'lead.read',
  input: leadIdInput,
  async run(ctx, input) {
    return loadLeadDetail(ctx, input.leadId);
  },
});
