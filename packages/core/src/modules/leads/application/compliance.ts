import type { SuppressionReason, SuppressionScope } from '@docline/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import {
  CONTACT_STATUS_LABELS,
  evaluateAllChannels,
  loadGateInput,
  refreshLeadContactState,
  suppressIdentifiers,
  type SuppressionToCreate,
} from '../../compliance';
import { maskIdentifier, toSearchKey } from '../../normalization';
import {
  anonymizeLeadInput,
  contactabilityInput,
  registerOptOutInput,
  setChannelPermissionInput,
} from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { formatLeadCode } from '../domain/lead';
import { auditLead, recordLeadEvent } from '../infra/events';
import { requireLeadInScope } from '../infra/scope';

/** Tipos de contato atingidos por um opt-out em cada escopo. */
const SCOPE_CONTACT_TYPES: Record<SuppressionScope, ('PHONE' | 'EMAIL' | 'INSTAGRAM')[]> = {
  ALL_CHANNELS: ['PHONE', 'EMAIL', 'INSTAGRAM'],
  WHATSAPP: ['PHONE'],
  PHONE: ['PHONE'],
  EMAIL: ['EMAIL'],
  INSTAGRAM: ['INSTAGRAM'],
};

/** Monta as supressões de um lead: contatos, CNPJ e o próprio lead. */
async function leadSuppressions(
  ctx: UseCaseContext,
  lead: { id: string; code: number; cnpj: string | null; cnpjHash: string | null },
  options: {
    scope: SuppressionScope;
    reason: SuppressionReason;
    contactPointId?: string | null;
    notes?: string | null;
    source?: SuppressionToCreate['source'];
  },
): Promise<SuppressionToCreate[]> {
  const common = {
    scope: options.scope,
    reason: options.reason,
    leadId: lead.id,
    notes: options.notes ?? null,
    ...(options.source ? { source: options.source } : {}),
  };
  const points = await ctx.tx.contactPoint.findMany({
    where: {
      leadId: lead.id,
      status: { not: 'REMOVED' },
      ...(options.contactPointId
        ? { id: options.contactPointId }
        : { type: { in: SCOPE_CONTACT_TYPES[options.scope] } }),
    },
    select: { type: true, valueNormalized: true, valueHash: true },
  });
  if (options.contactPointId && points.length === 0) {
    throw new NotFoundError('Contato não encontrado.');
  }
  const entries: SuppressionToCreate[] = points.map((cp) => ({
    ...common,
    type: cp.type,
    valueHash: cp.valueHash,
    valueMasked: maskIdentifier(cp.type, cp.valueNormalized),
  }));
  if (!options.contactPointId) {
    // O lead em si (vale mesmo para contatos cadastrados depois)…
    entries.push({
      ...common,
      type: 'LEAD',
      valueHash: lead.id,
      valueMasked: formatLeadCode(lead.code),
    });
    // …e o CNPJ, que impede recontato por reimportação da mesma empresa.
    if (lead.cnpj && lead.cnpjHash && options.scope === 'ALL_CHANNELS') {
      entries.push({
        ...common,
        type: 'CNPJ',
        valueHash: lead.cnpjHash,
        valueMasked: maskIdentifier('CNPJ', lead.cnpj),
      });
    }
  }
  return entries;
}

const optOutLeadSelect = {
  id: true,
  code: true,
  cnpj: true,
  cnpjHash: true,
  status: true,
} as const;

/**
 * Opt-out em 1 clique (MVP M14): todos os canais (padrão), um canal ou um
 * contato. Efeito imediato; vale por identificador, inclusive para outros
 * leads com o mesmo telefone/e-mail e para reimportações (docs/LGPD.md §8).
 * Parar cadências e cancelar tarefas entra na Fase 5.
 */
export const registerOptOut = defineUseCase({
  name: 'leads.registerOptOut',
  access: 'optout.register',
  input: registerOptOutInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, optOutLeadSelect);
    const entries = await leadSuppressions(ctx, lead, input);
    const result = await suppressIdentifiers(ctx, entries);
    for (const leadId of result.leadIds) {
      await recordLeadEvent(ctx, leadId, LEAD_EVENTS.optOutRegistered, {
        payload: {
          scope: input.scope,
          reason: input.reason,
          ...(leadId !== lead.id ? { viaLeadCode: formatLeadCode(lead.code) } : {}),
          ...(input.contactPointId ? { contactPointId: input.contactPointId } : {}),
        },
      });
    }
    await auditLead(ctx, lead.id, 'lead.optout', {
      metadata: {
        scope: input.scope,
        reason: input.reason,
        identifiers: entries.length,
        newEntries: result.created.length,
        affectedLeads: result.leadIds,
      },
    });
    const updated = await ctx.tx.lead.findUniqueOrThrow({
      where: { id: lead.id },
      select: { contactStatus: true },
    });
    return {
      contactStatus: updated.contactStatus,
      contactStatusLabel: CONTACT_STATUS_LABELS[updated.contactStatus],
      affectedLeads: result.leadIds.length,
    };
  },
});

/** Base legal e opt-in por canal (ADMIN/GESTOR). Consentimento e opt-in exigem evidência. */
export const setChannelPermission = defineUseCase({
  name: 'leads.setChannelPermission',
  access: 'permission.update',
  input: setChannelPermissionInput,
  async run(ctx, input) {
    await requireLeadInScope(ctx, input.leadId, { id: true });
    const issues: { path: string; message: string }[] = [];
    if (input.legalBasis === 'CONSENT' && !input.evidence) {
      issues.push({
        path: 'evidence',
        message: 'Consentimento exige evidência (formulário, mensagem…).',
      });
    }
    if (input.optInStatus === 'GRANTED') {
      if (input.channel === 'ALL') {
        issues.push({ path: 'optInStatus', message: 'Opt-in é registrado por canal.' });
      }
      if (!input.optInMethod)
        issues.push({ path: 'optInMethod', message: 'Informe como o opt-in foi obtido.' });
      if (!input.evidence) issues.push({ path: 'evidence', message: 'Opt-in exige evidência.' });
    }
    if (input.legalBasisAssessmentId) {
      const assessment = await ctx.tx.legalBasisAssessment.findFirst({
        where: { id: input.legalBasisAssessmentId, active: true },
      });
      if (!assessment)
        issues.push({ path: 'legalBasisAssessmentId', message: 'Avaliação não encontrada.' });
    }
    if (issues.length > 0) throw new ValidationError(issues);

    const current = await ctx.tx.contactPermission.findFirst({
      where: { leadId: input.leadId, channel: input.channel, personId: null, contactPointId: null },
    });
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const optInStatus = input.optInStatus ?? current?.optInStatus ?? 'NONE';
    const data = {
      legalBasis: input.legalBasis,
      legalBasisAssessmentId: input.legalBasisAssessmentId ?? null,
      optInStatus,
      optInMethod: optInStatus === 'GRANTED' ? (input.optInMethod ?? null) : null,
      optInAt:
        optInStatus === 'GRANTED'
          ? current?.optInStatus === 'GRANTED'
            ? current.optInAt
            : ctx.now
          : null,
      evidence: input.evidence ?? null,
      recordedById: actorId,
      recordedAt: ctx.now,
    };
    if (current) {
      await ctx.tx.contactPermission.update({ where: { id: current.id }, data });
    } else {
      await ctx.tx.contactPermission.create({
        data: { ...data, leadId: input.leadId, channel: input.channel },
      });
    }
    const contactStatus = await refreshLeadContactState(ctx.tx, input.leadId);
    await recordLeadEvent(ctx, input.leadId, LEAD_EVENTS.permissionChanged, {
      payload: { channel: input.channel, legalBasis: input.legalBasis, optInStatus },
    });
    await auditLead(ctx, input.leadId, 'lead.permission', {
      changes: {
        [`${input.channel}.legalBasis`]: [current?.legalBasis ?? null, input.legalBasis],
        [`${input.channel}.optInStatus`]: [current?.optInStatus ?? null, optInStatus],
      },
    });
    return { contactStatus, contactStatusLabel: CONTACT_STATUS_LABELS[contactStatus] };
  },
});

/** Resultado do gate por canal, para a UI habilitar ou explicar cada ação de contato. */
export const getLeadContactability = defineUseCase({
  name: 'leads.contactability',
  access: 'lead.read',
  input: contactabilityInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, { id: true, contactStatus: true });
    const gate = await loadGateInput(ctx.tx, lead.id);
    return {
      contactStatus: lead.contactStatus,
      contactStatusLabel: CONTACT_STATUS_LABELS[lead.contactStatus],
      mode: input.mode,
      channels: evaluateAllChannels(gate, input.mode),
    };
  },
});

const ANONYMIZED_PERSON = 'Pessoa anonimizada';
const ANONYMIZED_NOTE = '[conteúdo removido na anonimização]';

/**
 * Anonimização (ADMIN; docs/LGPD.md §13): remove nome, CNPJ, endereço, site,
 * pessoas, contatos e observações; mantém cidade, UF, origem, etapas e
 * eventos (sem dados pessoais) para as métricas. Por padrão, os
 * identificadores entram na Lista Não Contatar antes de serem apagados, para
 * o pedido continuar valendo em reimportações.
 */
export const anonymizeLead = defineUseCase({
  name: 'leads.anonymize',
  access: 'lead.anonymize',
  input: anonymizeLeadInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, optOutLeadSelect);
    if (lead.status === 'ANONYMIZED') throw new ConflictError('Este lead já foi anonimizado.');
    if (lead.status === 'MERGED') {
      throw new ConflictError('Lead mesclado: anonimize o lead em que ele foi mesclado.');
    }
    if (input.dataSubjectRequestId) {
      const request = await ctx.tx.dataSubjectRequest.findUnique({
        where: { id: input.dataSubjectRequestId },
      });
      if (!request) throw new NotFoundError('Solicitação do titular não encontrada.');
      if (!request.leadId) {
        await ctx.tx.dataSubjectRequest.update({
          where: { id: request.id },
          data: { leadId: lead.id },
        });
      }
    }

    let suppressed = 0;
    if (input.suppress) {
      const entries = await leadSuppressions(ctx, lead, {
        scope: 'ALL_CHANNELS',
        reason: input.dataSubjectRequestId ? 'DATA_SUBJECT_REQUEST' : 'INTERNAL_DECISION',
        source: input.dataSubjectRequestId ? 'DSR' : 'ADMIN',
      });
      suppressed = (await suppressIdentifiers(ctx, entries)).created.length;
    }

    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const placeholder = `Lead anonimizado ${formatLeadCode(lead.code)}`;
    await ctx.tx.lead.update({
      where: { id: lead.id },
      data: {
        companyName: null,
        tradeName: null,
        displayName: placeholder,
        nameSearch: toSearchKey(placeholder),
        nameCore: toSearchKey(placeholder),
        cnpj: null,
        cnpjRoot: null,
        cnpjHash: null,
        addressLine: null,
        addressNumber: null,
        addressComplement: null,
        neighborhood: null,
        postalCode: null,
        websiteUrl: null,
        websiteDomain: null,
        description: null,
        originDetail: null,
        originUrl: null,
        status: 'ANONYMIZED',
        anonymizedAt: ctx.now,
        version: { increment: 1 },
      },
    });
    await ctx.tx.leadPerson.updateMany({
      where: { leadId: lead.id },
      data: {
        fullName: ANONYMIZED_PERSON,
        firstName: null,
        roleTitle: null,
        notes: null,
        isPrimary: false,
        status: 'ANONYMIZED',
      },
    });
    const points = await ctx.tx.contactPoint.findMany({
      where: { leadId: lead.id },
      select: { id: true },
    });
    for (const cp of points) {
      await ctx.tx.contactPoint.update({
        where: { id: cp.id },
        data: {
          valueRaw: '',
          valueNormalized: `anon:${cp.id}`,
          valueHash: `anon:${cp.id}`,
          label: null,
          sourceDetail: null,
          verificationMethod: null,
          normalizationFlags: [],
          isPrimary: false,
          status: 'REMOVED',
        },
      });
    }
    await ctx.tx.leadNote.updateMany({
      where: { leadId: lead.id },
      data: { body: ANONYMIZED_NOTE },
    });
    await ctx.tx.leadNote.updateMany({
      where: { leadId: lead.id, removedAt: null },
      data: { removedAt: ctx.now, removedById: actorId },
    });
    await ctx.tx.leadOrigin.updateMany({
      where: { leadId: lead.id },
      data: { detail: null, url: null, referrerName: null },
    });
    await ctx.tx.contactPermission.updateMany({
      where: { leadId: lead.id },
      data: { evidence: null },
    });
    await ctx.tx.leadAssignment.updateMany({ where: { leadId: lead.id }, data: { reason: null } });

    const contactStatus = await refreshLeadContactState(ctx.tx, lead.id);
    await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.anonymized, {
      payload: { suppressed, viaDataSubjectRequest: Boolean(input.dataSubjectRequestId) },
    });
    await auditLead(ctx, lead.id, 'lead.anonymize', {
      changes: { status: [lead.status, 'ANONYMIZED'] },
      metadata: {
        reason: input.reason,
        suppressed,
        ...(input.dataSubjectRequestId ? { dataSubjectRequestId: input.dataSubjectRequestId } : {}),
      },
    });
    return { status: 'ANONYMIZED' as const, contactStatus, suppressed };
  },
});
