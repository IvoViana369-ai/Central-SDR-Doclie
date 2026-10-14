import { NotFoundError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import { CONTACT_STATUS_LABELS, loadLeadSuppressions } from '../../compliance';
import { auditLead, formatLeadCode, requireLeadInScope } from '../../leads';
import { formatCnpj, formatPhone } from '../../normalization';
import { integrationLeadInput } from '../contracts/schemas';
import { systemLabel } from '../domain/references';

const NOT_RELEASED = 'Lead não encontrado ou não liberado para integração.';

/**
 * Ficha do lead para o CRM e outros sistemas Docline (F12-03), depois do
 * webhook: empresa, pessoas, contatos com o aviso de Não Contatar,
 * oportunidades e referências. Minimização (docs/LGPD.md §14): só leads já
 * transferidos ao Comercial ou vinculados a outro sistema; sem anotações,
 * timeline ou evidências. Cada leitura fica na auditoria.
 */
export const getIntegrationLead = defineUseCase({
  name: 'integrations.getLead',
  access: 'lead.read',
  input: integrationLeadInput,
  async run(ctx, input) {
    // Pessoas seguem o próprio escopo; a chave lê qualquer lead liberado.
    const lead = await requireLeadInScope(ctx, input.leadId, {
      id: true,
      code: true,
      status: true,
      anonymizedAt: true,
      displayName: true,
      companyName: true,
      tradeName: true,
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
      contactStatus: true,
      convertedAt: true,
      stage: { select: { key: true, name: true } },
      owner: { select: { id: true, name: true } },
      people: {
        where: { status: 'ACTIVE' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          fullName: true,
          roleTitle: true,
          isPrimary: true,
          isDecisionMaker: true,
        },
      },
      contactPoints: {
        where: { status: 'ACTIVE' },
        orderBy: [{ type: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          personId: true,
          type: true,
          valueNormalized: true,
          valueHash: true,
          label: true,
          isPrimary: true,
          whatsappStatus: true,
        },
      },
      opportunities: {
        orderBy: { handoffAt: 'desc' },
        select: {
          id: true,
          status: true,
          handoffAt: true,
          acceptedAt: true,
          wonAt: true,
          lostAt: true,
          conversionType: true,
          productInterest: true,
          expectedValue: true,
          qualification: true,
          sdr: { select: { id: true, name: true } },
          salesOwner: { select: { id: true, name: true } },
          lossReason: { select: { key: true, name: true } },
        },
      },
    }).catch((error: unknown) => {
      if (error instanceof NotFoundError) throw new NotFoundError(NOT_RELEASED);
      throw error;
    });
    const references = await ctx.tx.externalReference.findMany({
      where: {
        OR: [
          { entityType: 'LEAD', entityId: lead.id },
          { entityType: 'OPPORTUNITY', entityId: { in: lead.opportunities.map((o) => o.id) } },
        ],
      },
      select: { entityType: true, entityId: true, system: true, externalId: true, url: true },
      orderBy: { system: 'asc' },
    });
    if (lead.opportunities.length === 0 && references.length === 0) {
      throw new NotFoundError(NOT_RELEASED);
    }
    await auditLead(ctx, lead.id, 'lead.integration_read');

    const describeRef = (r: (typeof references)[number]) => ({
      system: r.system,
      systemLabel: systemLabel(r.system),
      externalId: r.externalId,
      url: r.url,
    });
    const leadRefs = references.filter((r) => r.entityType === 'LEAD').map(describeRef);
    if (lead.anonymizedAt) {
      return {
        id: lead.id,
        code: formatLeadCode(lead.code),
        status: lead.status,
        anonymized: true,
        references: leadRefs,
      };
    }

    const suppressions = await loadLeadSuppressions(ctx.tx, lead, lead.contactPoints);
    return {
      id: lead.id,
      code: formatLeadCode(lead.code),
      status: lead.status,
      anonymized: false,
      displayName: lead.displayName,
      companyName: lead.companyName,
      tradeName: lead.tradeName,
      cnpj: lead.cnpj ? formatCnpj(lead.cnpj) : null,
      address: {
        line: lead.addressLine,
        number: lead.addressNumber,
        complement: lead.addressComplement,
        neighborhood: lead.neighborhood,
        city: lead.cityRaw,
        municipalityCode: lead.municipalityCode,
        stateUf: lead.stateUf,
        postalCode: lead.postalCode,
      },
      websiteUrl: lead.websiteUrl,
      stage: lead.stage,
      convertedAt: lead.convertedAt,
      owner: lead.owner,
      contactStatus: lead.contactStatus,
      contactStatusLabel: CONTACT_STATUS_LABELS[lead.contactStatus],
      /** Escritório inteiro na Lista Não Contatar (lead ou CNPJ). */
      doNotContact: suppressions.organization.map((s) => ({ scope: s.scope, since: s.createdAt })),
      people: lead.people,
      contactPoints: lead.contactPoints.map((cp) => ({
        id: cp.id,
        personId: cp.personId,
        type: cp.type,
        value: cp.valueNormalized,
        display: cp.type === 'PHONE' ? formatPhone(cp.valueNormalized) : cp.valueNormalized,
        label: cp.label,
        isPrimary: cp.isPrimary,
        whatsappStatus: cp.whatsappStatus,
        /** Canais em que este contato não pode ser procurado. */
        doNotContact: (suppressions.byContactPoint.get(cp.id) ?? []).map((s) => ({
          scope: s.scope,
          since: s.createdAt,
        })),
      })),
      opportunities: lead.opportunities.map((o) => ({
        ...o,
        expectedValue: o.expectedValue ? Number(o.expectedValue) : null,
        references: references
          .filter((r) => r.entityType === 'OPPORTUNITY' && r.entityId === o.id)
          .map(describeRef),
      })),
      references: leadRefs,
    };
  },
});
