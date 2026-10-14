import type { SuppressionType } from '@docline/db';
import { BusinessRuleError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { findActiveSuppressions, identifierKey, refreshLeadContactState } from '../../compliance';
import { detectDuplicates } from '../../dedup';
import { fillEmptyLeadFields, type NormalizedImportRow } from '../../import';
import {
  auditLead,
  LEAD_EVENTS,
  recordLeadEvent,
  requireEditableLead,
  requireLeadInScope,
  touchLead,
} from '../../leads';
import { leadRegistryInput } from '../contracts/schemas';
import {
  accountingSegmentId,
  REGISTRY_SELECT,
  REGISTRY_SOURCE_KEY,
  registryOriginDetail,
  registryToRow,
  registryView,
  requireRegistrySource,
} from '../infra/registry-row';

/**
 * Enriquecimento pontual pelo CNPJ (F9-04): completa um lead que já existe
 * com os dados da cópia local da base aberta, só nos campos vazios (nada é
 * sobrescrito). Sem consulta a serviços de terceiros: o CNPJ precisa estar na
 * base carregada (escritórios de contabilidade ativos).
 */

const LEAD_FILL_SELECT = {
  cnpj: true,
  companyName: true,
  tradeName: true,
  municipalityCode: true,
  postalCode: true,
  addressLine: true,
  addressNumber: true,
  addressComplement: true,
  neighborhood: true,
  segmentId: true,
  contactPoints: {
    where: { status: { not: 'REMOVED' as const } },
    select: { type: true, valueNormalized: true },
  },
};

/** O que a base aberta tem e o lead não (prévia do botão "Completar"). */
function fillablePreview(
  lead: {
    companyName: string | null;
    tradeName: string | null;
    municipalityCode: number | null;
    postalCode: string | null;
    addressLine: string | null;
    addressNumber: string | null;
    addressComplement: string | null;
    neighborhood: string | null;
    segmentId: string | null;
    contactPoints: { type: string; valueNormalized: string }[];
  },
  row: NormalizedImportRow,
) {
  const fields = (
    [
      'companyName',
      'tradeName',
      'municipalityCode',
      'postalCode',
      'addressLine',
      'addressNumber',
      'addressComplement',
      'neighborhood',
      'segmentId',
    ] as const
  ).filter((key) => lead[key] === null && row[key] !== null);
  const existing = new Set(lead.contactPoints.map((c) => `${c.type}:${c.valueNormalized}`));
  const newContacts = row.contacts.filter((c) => !existing.has(`${c.type}:${c.value}`)).length;
  return { fields, newContacts };
}

/**
 * Contatos da base aberta que podem entrar no lead: o que está na Lista Não
 * Contatar em todos os canais fica de fora (o opt-out de um canal só fica a
 * cargo do gate, como na importação).
 */
async function allowedContacts(ctx: UseCaseContext, row: NormalizedImportRow) {
  const hashed = row.contacts.map((contact) => ({
    contact,
    identifier: {
      type: contact.type as SuppressionType,
      valueHash: ctx.deps.identifiers.hash(contact.type, contact.value),
    },
  }));
  const suppressions = await findActiveSuppressions(
    ctx.tx,
    hashed.map((h) => h.identifier),
  );
  const allowed = hashed
    .filter(
      (h) =>
        !(suppressions.get(identifierKey(h.identifier)) ?? []).some(
          (s) => s.scope === 'ALL_CHANNELS',
        ),
    )
    .map((h) => h.contact);
  return { allowed, skippedSuppressed: row.contacts.length - allowed.length };
}

async function hasLoadedRegistry(ctx: UseCaseContext) {
  return (await ctx.tx.registryIngestion.count({ where: { status: 'SUCCEEDED' } })) > 0;
}

/** Dados do CNPJ do lead na base aberta e o que daria para completar. */
export const getLeadRegistryData = defineUseCase({
  name: 'prospecting.leadRegistry',
  access: 'lead.read',
  input: leadRegistryInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, LEAD_FILL_SELECT);
    if (!(await hasLoadedRegistry(ctx))) {
      return {
        status: 'not_loaded' as const,
        company: null,
        fields: [],
        newContacts: 0,
        skippedSuppressed: 0,
      };
    }
    if (!lead.cnpj)
      return {
        status: 'no_cnpj' as const,
        company: null,
        fields: [],
        newContacts: 0,
        skippedSuppressed: 0,
      };
    const company = await ctx.tx.registryCompany.findUnique({
      where: { cnpj: lead.cnpj },
      select: REGISTRY_SELECT,
    });
    const row = company ? registryToRow(company, await accountingSegmentId(ctx.tx)) : null;
    if (!company || !row) {
      return {
        status: 'not_found' as const,
        company: null,
        fields: [],
        newContacts: 0,
        skippedSuppressed: 0,
      };
    }
    const { allowed, skippedSuppressed } = await allowedContacts(ctx, row);
    return {
      status: 'found' as const,
      company: registryView(company),
      ...fillablePreview(lead, { ...row, contacts: allowed }),
      skippedSuppressed,
    };
  },
});

/** Completa o lead com a base aberta (campos vazios, contatos novos e a origem). */
export const enrichLeadFromRegistry = defineUseCase({
  name: 'prospecting.enrichLead',
  access: 'lead.update',
  input: leadRegistryInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true, cnpj: true });
    if (!lead.cnpj) {
      throw new BusinessRuleError(
        'O lead não tem CNPJ: informe o CNPJ para completar com os dados abertos.',
      );
    }
    const company = await ctx.tx.registryCompany.findUnique({
      where: { cnpj: lead.cnpj },
      select: REGISTRY_SELECT,
    });
    const row = company ? registryToRow(company, await accountingSegmentId(ctx.tx)) : null;
    if (!company || !row) {
      throw new BusinessRuleError(
        'CNPJ não encontrado na base aberta carregada (só escritórios de contabilidade ativos).',
      );
    }
    const source = await requireRegistrySource(ctx.tx);

    const { allowed, skippedSuppressed } = await allowedContacts(ctx, row);

    const origin = {
      sourceId: source.id,
      sourceDetail: registryOriginDetail(company.datasetReference),
      collectedAt: company.ingestedAt,
    };
    const changes = await fillEmptyLeadFields(ctx, origin, lead.id, { ...row, contacts: allowed });
    const fields = Object.keys(changes);
    if (fields.length > 0) {
      // A origem registra de onde vieram os dados novos (LGPD: rastreabilidade).
      await ctx.tx.leadOrigin.create({
        data: {
          leadId: lead.id,
          sourceId: origin.sourceId,
          detail: origin.sourceDetail,
          collectedAt: origin.collectedAt,
          createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        },
      });
      await detectDuplicates(ctx.tx, { kind: 'leads', ids: [lead.id] }, 'PROSPECTING', ctx.now);
      await refreshLeadContactState(ctx.tx, lead.id, ctx.now);
      await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.updated, {
        payload: {
          sourceKey: REGISTRY_SOURCE_KEY,
          datasetReference: company.datasetReference,
          fields,
        },
      });
      await touchLead(ctx, lead.id);
    }
    await auditLead(ctx, lead.id, 'lead.registry_enrich', {
      changes,
      metadata: { datasetReference: company.datasetReference, skippedSuppressed },
    });
    return { fields, skippedSuppressed, datasetReference: company.datasetReference };
  },
});
