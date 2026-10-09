import { Prisma, type SuppressionReason, type SuppressionScope } from '@docline/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import {
  CONTACT_STATUS_LABELS,
  evaluateLeadGate,
  refreshLeadContactState,
  suppressIdentifiers,
  type SuppressionToCreate,
} from '../../compliance';
import { cancelOpenTasks, engagementActorOf, stopLeadEnrollment } from '../../engagement';
import { formatPhone, maskIdentifier, toSearchKey } from '../../normalization';
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
/**
 * Aplica o opt-out de um lead já carregado no escopo (Lista Não Contatar,
 * eventos e auditoria). Usado pelo opt-out em 1 clique e pela perda com
 * motivo "Pediu para não ser contatado" no pipeline.
 */
export async function applyLeadOptOut(
  ctx: UseCaseContext,
  lead: { id: string; code: number; cnpj: string | null; cnpjHash: string | null },
  input: {
    scope: SuppressionScope;
    reason: SuppressionReason;
    contactPointId?: string | null;
    notes?: string | null;
    /** Origem do pedido (padrão pelo ator); ex.: WEBHOOK quando a Meta avisa. */
    source?: SuppressionToCreate['source'];
  },
) {
  const entries = await leadSuppressions(ctx, lead, input);
  const result = await suppressIdentifiers(ctx, entries);
  // Opt-out é retirada da permissão: o opt-in do WhatsApp dos números atingidos
  // cai junto (e não volta sozinho se a supressão for revogada depois).
  if (input.scope === 'ALL_CHANNELS' || input.scope === 'WHATSAPP') {
    const phoneHashes = entries.filter((e) => e.type === 'PHONE').map((e) => e.valueHash);
    const wholeLead = entries.some((e) => e.type === 'LEAD');
    const targets = [
      ...(phoneHashes.length > 0
        ? [{ contactPoint: { type: 'PHONE' as const, valueHash: { in: phoneHashes } } }]
        : []),
      ...(wholeLead ? [{ leadId: lead.id }] : []),
    ];
    if (targets.length > 0) {
      await ctx.tx.contactPermission.updateMany({
        where: {
          channel: 'WHATSAPP',
          optInStatus: 'GRANTED',
          contactPointId: { not: null },
          OR: targets,
        },
        data: {
          optInStatus: 'REVOKED',
          recordedAt: ctx.now,
          recordedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        },
      });
    }
  }
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
  return result;
}

/** Carrega o lead no escopo com o que o opt-out precisa. */
export function requireLeadForOptOut(ctx: UseCaseContext, leadId: string) {
  return requireLeadInScope(ctx, leadId, optOutLeadSelect);
}

export const registerOptOut = defineUseCase({
  name: 'leads.registerOptOut',
  access: 'optout.register',
  input: registerOptOutInput,
  async run(ctx, input) {
    const lead = await requireLeadInScope(ctx, input.leadId, optOutLeadSelect);
    const result = await applyLeadOptOut(ctx, lead, input);
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
      if (input.channel === 'WHATSAPP') {
        // Fase 7: a Meta exige a permissão do próprio número.
        issues.push({
          path: 'optInStatus',
          message: 'O opt-in do WhatsApp é registrado por número, na seção WhatsApp do lead.',
        });
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
    const contactStatus = await refreshLeadContactState(ctx.tx, input.leadId, ctx.now);
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
    const gate = await evaluateLeadGate(ctx.tx, lead.id, {
      mode: input.mode,
      actor: ctx.actor,
      now: ctx.now,
    });
    const points = await ctx.tx.contactPoint.findMany({
      where: { leadId: lead.id, status: 'ACTIVE' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, type: true, valueNormalized: true },
    });
    return {
      contactStatus: lead.contactStatus,
      contactStatusLabel: CONTACT_STATUS_LABELS[lead.contactStatus],
      mode: input.mode,
      channels: gate.channels,
      /** Contatos ativos, para a tela escolher por qual falar. */
      contactPoints: points.map((cp) => ({
        id: cp.id,
        type: cp.type,
        display:
          cp.type === 'PHONE'
            ? formatPhone(cp.valueNormalized)
            : cp.type === 'INSTAGRAM'
              ? `@${cp.valueNormalized}`
              : cp.valueNormalized,
      })),
    };
  },
});

const ANONYMIZED_PERSON = 'Pessoa anonimizada';
const ANONYMIZED_NOTE = '[conteúdo removido na anonimização]';
/** Título livre de tarefa pode citar pessoas (ex.: "Ligar para a sócia Ana"). */
const ANONYMIZED_TASK_TITLE = 'Tarefa (conteúdo removido na anonimização)';

/**
 * Anonimização (ADMIN; docs/LGPD.md §13): remove nome, CNPJ, endereço, site,
 * pessoas, contatos e observações; mantém cidade, UF, origem, etapas e
 * eventos (sem dados pessoais) para as métricas. Por padrão, os
 * identificadores entram na Lista Não Contatar antes de serem apagados, para
 * o pedido continuar valendo em reimportações.
 */
/** Leads mesclados (direta ou indiretamente) neste lead. */
async function absorbedLeads(ctx: UseCaseContext, leadId: string) {
  const found: { id: string; code: number; cnpj: string | null; cnpjHash: string | null }[] = [];
  let frontier = [leadId];
  for (let depth = 0; frontier.length > 0 && depth < 10; depth++) {
    const next = await ctx.tx.lead.findMany({
      where: { mergedIntoId: { in: frontier }, status: 'MERGED' },
      select: { id: true, code: true, cnpj: true, cnpjHash: true },
    });
    found.push(...next);
    frontier = next.map((l) => l.id);
  }
  return found;
}

/**
 * Apaga os dados do lead e dos filhos (pessoas, contatos, observações,
 * origens, bases legais). O lead anonimizado muda de status; um lead mesclado
 * nele continua MERGED, só sem os dados.
 */
async function scrubLead(
  ctx: UseCaseContext,
  leadId: string,
  code: string,
  options: { anonymize: boolean },
) {
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  const placeholder = `Lead anonimizado ${code}`;
  await ctx.tx.lead.update({
    where: { id: leadId },
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
      customFields: Prisma.DbNull,
      originDetail: null,
      originUrl: null,
      ...(options.anonymize ? { status: 'ANONYMIZED' as const } : {}),
      anonymizedAt: ctx.now,
      version: { increment: 1 },
    },
  });
  await ctx.tx.leadPerson.updateMany({
    where: { leadId },
    data: {
      fullName: ANONYMIZED_PERSON,
      firstName: null,
      roleTitle: null,
      notes: null,
      isPrimary: false,
      status: 'ANONYMIZED',
    },
  });
  // WhatsApp (Fase 7): conversas (wa_id, nome do perfil), payloads de webhook e
  // mensagens de "número sem lead" que citam os telefones do lead.
  const phones = await ctx.tx.contactPoint.findMany({
    where: { leadId, type: 'PHONE' },
    select: { valueHash: true, valueNormalized: true },
  });
  if (phones.length > 0) {
    await ctx.tx.webhookEvent.deleteMany({
      where: { contactHashes: { hasSome: phones.map((p) => p.valueHash) } },
    });
    await ctx.tx.inboundUnmatched.deleteMany({
      where: { phoneE164: { in: phones.map((p) => p.valueNormalized) } },
    });
  }
  await ctx.tx.inboundUnmatched.deleteMany({ where: { resolvedLeadId: leadId } });
  await ctx.tx.conversation.deleteMany({ where: { leadId } });
  const points = await ctx.tx.contactPoint.findMany({ where: { leadId }, select: { id: true } });
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
  await ctx.tx.leadNote.updateMany({ where: { leadId }, data: { body: ANONYMIZED_NOTE } });
  await ctx.tx.leadNote.updateMany({
    where: { leadId, removedAt: null },
    data: { removedAt: ctx.now, removedById: actorId },
  });
  await ctx.tx.leadOrigin.updateMany({
    where: { leadId },
    data: { detail: null, url: null, referrerName: null },
  });
  await ctx.tx.contactPermission.updateMany({ where: { leadId }, data: { evidence: null } });
  await ctx.tx.leadAssignment.updateMany({ where: { leadId }, data: { reason: null } });
  // Operação comercial (Fase 5): textos das mensagens, anotações e checklist.
  await ctx.tx.message.updateMany({
    where: { leadId },
    data: { body: null, optOutMatch: null, templateParams: Prisma.DbNull },
  });
  await ctx.tx.activity.updateMany({ where: { leadId }, data: { notes: null } });
  await ctx.tx.task.updateMany({
    where: { leadId },
    data: { title: ANONYMIZED_TASK_TITLE, description: null, outcome: null },
  });
  // IA (Fase 6): contexto enviado, saída e textos citam o lead e, às vezes, pessoas.
  await ctx.tx.aiGeneration.updateMany({
    where: { leadId },
    data: {
      inputSnapshot: { anonymized: true },
      output: Prisma.DbNull,
      textGenerated: null,
      textFinal: null,
      feedback: null,
      discardReason: null,
    },
  });
  // Avisos citam o nome do lead no título.
  await ctx.tx.notification.updateMany({
    where: { leadId },
    data: { title: 'Aviso sobre um lead anonimizado', body: null },
  });
  await ctx.tx.opportunity.updateMany({
    where: { leadId },
    data: { qualification: { anonymized: true }, notes: null },
  });
  // Nada mais a fazer com o lead: tarefas abertas e cadência saem.
  await stopLeadEnrollment(ctx.tx, leadId, 'MANUAL', ctx.now, engagementActorOf(ctx.actor));
  await cancelOpenTasks(ctx.tx, leadId, 'Lead anonimizado.');
}

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

    // Leads mesclados neste guardam dados do mesmo titular: são anonimizados junto.
    const absorbed = await absorbedLeads(ctx, lead.id);
    let suppressed = 0;
    if (input.suppress) {
      const options = {
        scope: 'ALL_CHANNELS' as const,
        reason: input.dataSubjectRequestId
          ? ('DATA_SUBJECT_REQUEST' as const)
          : ('INTERNAL_DECISION' as const),
        source: input.dataSubjectRequestId ? ('DSR' as const) : ('ADMIN' as const),
      };
      const entries = await leadSuppressions(ctx, lead, options);
      for (const other of absorbed) entries.push(...(await leadSuppressions(ctx, other, options)));
      suppressed = (await suppressIdentifiers(ctx, entries)).created.length;
    }

    await scrubLead(ctx, lead.id, formatLeadCode(lead.code), { anonymize: true });
    for (const other of absorbed) {
      await scrubLead(ctx, other.id, formatLeadCode(other.code), { anonymize: false });
    }
    const ids = [lead.id, ...absorbed.map((a) => a.id)];
    // Cópias da mesclagem e linhas de importação ainda não purgadas.
    await ctx.tx.leadMerge.updateMany({
      where: { OR: [{ survivorLeadId: { in: ids } }, { mergedLeadId: { in: ids } }] },
      data: { mergedSnapshot: { anonymized: true } },
    });
    await ctx.tx.importRow.updateMany({
      where: { OR: [{ resultLeadId: { in: ids } }, { matchedLeadId: { in: ids } }] },
      data: { raw: [], normalized: Prisma.DbNull, errors: Prisma.DbNull, warnings: Prisma.DbNull },
    });

    const contactStatus = await refreshLeadContactState(ctx.tx, lead.id, ctx.now);
    await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.anonymized, {
      payload: { suppressed, viaDataSubjectRequest: Boolean(input.dataSubjectRequestId) },
    });
    await auditLead(ctx, lead.id, 'lead.anonymize', {
      changes: { status: [lead.status, 'ANONYMIZED'] },
      metadata: {
        reason: input.reason,
        suppressed,
        ...(input.dataSubjectRequestId ? { dataSubjectRequestId: input.dataSubjectRequestId } : {}),
        ...(absorbed.length ? { mergedLeads: absorbed.map((a) => formatLeadCode(a.code)) } : {}),
      },
    });
    return { status: 'ANONYMIZED' as const, contactStatus, suppressed };
  },
});
