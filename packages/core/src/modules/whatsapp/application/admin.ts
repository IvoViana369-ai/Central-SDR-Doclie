import { z } from 'zod';
import { WhatsappProviderError, type WhatsappTemplateInfo } from '../../../ports/whatsapp';
import { systemActor, type Actor } from '../../../shared/actor';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import {
  checkAccess,
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
} from '../../../shared/use-case';
import { suggestReplyClassification } from '../../ai-sdr';
import { auditLead } from '../../leads';
import { describeWhatsappError } from '../domain/errors';
import { analyzeTemplate } from '../domain/templates';
import {
  resolveWhatsappSettings,
  WHATSAPP_SETTINGS_KEY,
  whatsappSettingsSchema,
} from '../domain/settings';
import { attachInbound, matchInbound } from '../infra/inbound';
import { markConnection } from '../infra/effects';

/**
 * Administração do WhatsApp pela API: modelos da conta (F7-04), saúde do
 * número (F7-08), mensagens de números sem lead, configuração e a sugestão
 * automática de classificação (F7-07).
 */

function providerOf(deps: CoreDeps) {
  if (!deps.whatsapp) {
    throw new BusinessRuleError('O WhatsApp pela API não está ativo (modo assistido).');
  }
  return deps.whatsapp;
}

function asBusinessError(error: unknown): never {
  if (error instanceof WhatsappProviderError) {
    throw new BusinessRuleError(describeWhatsappError(error.details.code).message);
  }
  throw error;
}

// --- Modelos (F7-04) ---------------------------------------------------------

const templateInfo = z.object({
  metaTemplateId: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  status: z.string(),
  qualityScore: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  parameterFormat: z.enum(['POSITIONAL', 'NAMED']),
  components: z.array(z.unknown()),
});

const persistTemplates = defineUseCase({
  name: 'whatsapp.templates.sync',
  access: 'integration.manage',
  input: z.object({ templates: z.array(templateInfo) }),
  async run(ctx, input) {
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const t of input.templates) {
      seen.add(t.metaTemplateId);
      const analysis = analyzeTemplate(t.category, t.components);
      const data = {
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        qualityScore: t.qualityScore,
        rejectedReason: t.rejectedReason,
        parameterFormat: t.parameterFormat,
        components: toJson(t.components),
        bodyText: analysis.bodyText,
        bodyParameters: analysis.bodyParameters,
        supported: analysis.supported,
        unsupportedReason: analysis.unsupportedReason,
        removedAt: null,
        lastSyncedAt: ctx.now,
      };
      const existing = await ctx.tx.whatsappTemplate.findUnique({
        where: { metaTemplateId: t.metaTemplateId },
        select: { id: true },
      });
      // A abordagem e o "liberado para uso" são decisões do ADMIN: a sincronização não mexe.
      await ctx.tx.whatsappTemplate.upsert({
        where: { metaTemplateId: t.metaTemplateId },
        create: { metaTemplateId: t.metaTemplateId, ...data },
        update: data,
      });
      if (existing) updated += 1;
      else created += 1;
    }
    // Modelos que sumiram da conta ficam para o histórico das mensagens.
    const removed = await ctx.tx.whatsappTemplate.updateMany({
      where: { metaTemplateId: { notIn: [...seen] }, removedAt: null },
      data: { removedAt: ctx.now },
    });
    await ctx.audit({
      action: 'whatsapp.templates.sync',
      entityType: 'whatsapp_template',
      metadata: { created, updated, removed: removed.count },
    });
    return { created, updated, removed: removed.count };
  },
});

/** "Sincronizar modelos" (ADMIN) e job diário: lê a conta na Meta e grava o espelho. */
export async function syncWhatsappTemplates(deps: CoreDeps, actor: Actor, meta: RequestMeta = {}) {
  checkAccess(actor, 'integration.manage');
  const provider = providerOf(deps);
  let templates: WhatsappTemplateInfo[];
  try {
    templates = await provider.listTemplates();
  } catch (error) {
    asBusinessError(error);
  }
  return persistTemplates(deps, actor, { templates }, meta);
}

/** Abordagem do modelo (atribuição em analytics) e se os SDRs podem usá-lo. */
export const updateWhatsappTemplate = defineUseCase({
  name: 'whatsapp.templates.update',
  access: 'settings.manage',
  input: z.object({
    templateId: z.uuid(),
    approachId: z.uuid().nullish(),
    active: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const current = await ctx.tx.whatsappTemplate.findUnique({ where: { id: input.templateId } });
    if (!current) throw new NotFoundError('Modelo não encontrado.');
    if (input.approachId) {
      const approach = await ctx.tx.approach.findUnique({ where: { id: input.approachId } });
      if (!approach) throw new NotFoundError('Abordagem não encontrada.');
    }
    const data = {
      ...(input.approachId !== undefined ? { approachId: input.approachId } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    };
    const updated = await ctx.tx.whatsappTemplate.update({ where: { id: current.id }, data });
    await ctx.audit({
      action: 'whatsapp.templates.update',
      entityType: 'whatsapp_template',
      entityId: current.id,
      changes: Object.fromEntries(
        Object.keys(data).map((k) => [
          k,
          [current[k as keyof typeof data], updated[k as keyof typeof data]],
        ]),
      ),
    });
    return updated;
  },
});

// --- Saúde do número (F7-08) -------------------------------------------------

const persistHealth = defineUseCase({
  name: 'whatsapp.health.record',
  access: 'integration.manage',
  input: z.object({
    provider: z.string(),
    ok: z.boolean(),
    code: z.string().nullable(),
    health: z
      .object({
        displayPhoneNumber: z.string().nullable(),
        verifiedName: z.string().nullable(),
        qualityRating: z.string().nullable(),
        messagingLimit: z.string().nullable(),
        status: z.string().nullable(),
        nameStatus: z.string().nullable(),
      })
      .nullable(),
  }),
  async run(ctx, input) {
    if (!input.ok) {
      const info = describeWhatsappError(input.code ?? 'UNKNOWN');
      if (info.kind === 'AUTH' || info.kind === 'ACCOUNT') {
        await markConnection(
          ctx,
          input.provider,
          info.kind === 'AUTH' ? 'ERROR' : 'DEGRADED',
          info.message,
        );
      } else {
        // Falha passageira da consulta: registra sem mudar a situação (não alarma à toa).
        await ctx.tx.integrationConnection.upsert({
          where: { provider: input.provider },
          create: { provider: input.provider, lastError: info.message, lastCheckAt: ctx.now },
          update: { lastError: info.message, lastCheckAt: ctx.now },
        });
      }
      return { status: 'unchanged' as const };
    }
    const health = input.health!;
    const degraded =
      health.qualityRating === 'RED' ||
      ['FLAGGED', 'RESTRICTED', 'BANNED', 'DISCONNECTED'].includes(health.status ?? '');
    await markConnection(
      ctx,
      input.provider,
      degraded ? 'DEGRADED' : 'ACTIVE',
      degraded
        ? 'Qualidade baixa ou número restrito na Meta: reduza os envios e revise os modelos.'
        : null,
      health,
    );
    return { status: degraded ? ('DEGRADED' as const) : ('ACTIVE' as const) };
  },
});

/** Consulta a situação do número (ADMIN ou job de hora em hora). */
export async function checkWhatsappHealth(deps: CoreDeps, actor: Actor, meta: RequestMeta = {}) {
  checkAccess(actor, 'integration.manage');
  const provider = providerOf(deps);
  try {
    const health = await provider.getPhoneHealth();
    return persistHealth(
      deps,
      actor,
      { provider: provider.name, ok: true, code: null, health },
      meta,
    );
  } catch (error) {
    if (!(error instanceof WhatsappProviderError)) throw error;
    return persistHealth(
      deps,
      actor,
      { provider: provider.name, ok: false, code: error.details.code, health: null },
      meta,
    );
  }
}

export async function runWhatsappHealthCheck(deps: CoreDeps) {
  if (!deps.whatsapp) return { status: 'disabled' as const };
  return checkWhatsappHealth(deps, systemActor('whatsapp.health-check'));
}

export async function runWhatsappTemplateSync(deps: CoreDeps) {
  if (!deps.whatsapp) return { status: 'disabled' as const };
  return syncWhatsappTemplates(deps, systemActor('whatsapp.sync-templates'));
}

// --- Configuração ------------------------------------------------------------

export const getWhatsappSettings = defineUseCase({
  name: 'whatsapp.settings',
  access: 'authenticated',
  input: z.object({}),
  async run(ctx) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
    return resolveWhatsappSettings(row?.value);
  },
});

export const updateWhatsappSettings = defineUseCase({
  name: 'whatsapp.settings.update',
  access: 'settings.manage',
  input: whatsappSettingsSchema,
  async run(ctx, input) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
    const before = resolveWhatsappSettings(row?.value);
    const data = {
      value: toJson(input),
      updatedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
    };
    await ctx.tx.appSetting.upsert({
      where: { key: WHATSAPP_SETTINGS_KEY },
      create: { key: WHATSAPP_SETTINGS_KEY, ...data },
      update: data,
    });
    await ctx.audit({
      action: 'whatsapp.settings',
      entityType: 'app_setting',
      entityId: WHATSAPP_SETTINGS_KEY,
      changes: Object.fromEntries(
        (Object.keys(input) as (keyof typeof input)[])
          .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(input[k]))
          .map((k) => [k, [before[k], input[k]]]),
      ),
    });
    return input;
  },
});

// --- Números sem lead --------------------------------------------------------

export const listUnmatchedInbound = defineUseCase({
  name: 'whatsapp.unmatched.list',
  access: 'lead.assign',
  input: z.object({ status: z.enum(['PENDING', 'LINKED', 'DISMISSED']).default('PENDING') }),
  async run(ctx, input) {
    const rows = await ctx.tx.inboundUnmatched.findMany({
      where: { status: input.status },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
    const candidateIds = [...new Set(rows.flatMap((r) => r.candidateLeadIds))];
    const candidates = await ctx.tx.lead.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, displayName: true, code: true },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    return rows.map((r) => ({
      ...r,
      candidates: r.candidateLeadIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
    }));
  },
});

/**
 * Vincula a mensagem de um número sem lead a um lead que tem esse telefone
 * (cadastre o telefone antes, se faltar): a partir daí, vale como resposta.
 */
export const linkUnmatchedInbound = defineUseCase({
  name: 'whatsapp.unmatched.link',
  access: 'lead.assign',
  input: z.object({ unmatchedId: z.uuid(), leadId: z.uuid() }),
  async run(ctx, input) {
    const row = await ctx.tx.inboundUnmatched.findUnique({ where: { id: input.unmatchedId } });
    if (!row || row.status !== 'PENDING')
      throw new NotFoundError('Mensagem pendente não encontrada.');
    const lead = await ctx.tx.lead.findUnique({
      where: { id: input.leadId },
      select: { id: true, status: true },
    });
    if (!lead || (lead.status !== 'ACTIVE' && lead.status !== 'ARCHIVED')) {
      throw new NotFoundError('Lead não encontrado.');
    }
    const point = row.phoneE164
      ? await ctx.tx.contactPoint.findFirst({
          where: {
            leadId: lead.id,
            type: 'PHONE',
            valueNormalized: row.phoneE164,
            status: { not: 'REMOVED' },
          },
          select: { id: true },
        })
      : null;
    if (!point) {
      throw new BusinessRuleError(
        'Este lead não tem o telefone da mensagem. Cadastre o telefone no lead e vincule de novo.',
      );
    }
    await attachInbound(
      ctx,
      { leadId: lead.id, contactPointId: point.id },
      {
        waId: row.externalThreadId,
        profileName: row.profileName,
        providerMessageId: row.providerMessageId,
        provider: row.provider,
        receivedAt: row.receivedAt,
        body: row.body ?? '[Mensagem sem texto]',
      },
    );
    await ctx.tx.inboundUnmatched.update({
      where: { id: row.id },
      data: {
        status: 'LINKED',
        resolvedLeadId: lead.id,
        resolvedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        resolvedAt: ctx.now,
      },
    });
    await auditLead(ctx, lead.id, 'whatsapp.unmatched.link', { subjectId: row.id });
    return { leadId: lead.id };
  },
});

/**
 * "Procurar de novo": depois de cadastrar o lead (ou o telefone num lead), a
 * mensagem é casada como as que chegam pelo webhook.
 */
export const retryUnmatchedInbound = defineUseCase({
  name: 'whatsapp.unmatched.retry',
  access: 'lead.assign',
  input: z.object({ unmatchedId: z.uuid() }),
  async run(ctx, input) {
    const row = await ctx.tx.inboundUnmatched.findUnique({ where: { id: input.unmatchedId } });
    if (!row || row.status !== 'PENDING')
      throw new NotFoundError('Mensagem pendente não encontrada.');
    const match = await matchInbound(ctx, row.externalThreadId);
    if (match.kind !== 'matched') {
      throw new BusinessRuleError(
        match.candidateLeadIds.length > 1
          ? 'O número está em mais de um lead: escolha o lead certo.'
          : 'Ainda não há lead ativo com este número. Cadastre o lead (ou o telefone) e tente de novo.',
      );
    }
    await attachInbound(ctx, match, {
      waId: row.externalThreadId,
      profileName: row.profileName,
      providerMessageId: row.providerMessageId,
      provider: row.provider,
      receivedAt: row.receivedAt,
      body: row.body ?? '[Mensagem sem texto]',
    });
    await ctx.tx.inboundUnmatched.update({
      where: { id: row.id },
      data: {
        status: 'LINKED',
        resolvedLeadId: match.leadId,
        resolvedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        resolvedAt: ctx.now,
      },
    });
    await auditLead(ctx, match.leadId, 'whatsapp.unmatched.link', { subjectId: row.id });
    return { leadId: match.leadId };
  },
});

export const dismissUnmatchedInbound = defineUseCase({
  name: 'whatsapp.unmatched.dismiss',
  access: 'lead.assign',
  input: z.object({ unmatchedId: z.uuid() }),
  async run(ctx, input) {
    const row = await ctx.tx.inboundUnmatched.findUnique({ where: { id: input.unmatchedId } });
    if (!row || row.status !== 'PENDING')
      throw new NotFoundError('Mensagem pendente não encontrada.');
    await ctx.tx.inboundUnmatched.update({
      where: { id: row.id },
      data: {
        status: 'DISMISSED',
        resolvedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        resolvedAt: ctx.now,
      },
    });
    await ctx.audit({
      action: 'whatsapp.unmatched.dismiss',
      entityType: 'inbound_unmatched',
      entityId: row.id,
    });
    return { status: 'DISMISSED' as const };
  },
});

// --- Sugestão automática de classificação (F7-07) ---------------------------

/**
 * Job `whatsapp.suggest-classification`: pede à IA a sugestão para a resposta
 * que acabou de chegar. A sugestão nunca classifica sozinha; sem orçamento ou
 * com a IA indisponível, a pessoa classifica como sempre.
 */
export async function runWhatsappSuggestClassification(deps: CoreDeps, data: unknown) {
  const { messageId } = z.object({ messageId: z.uuid() }).parse(data);
  try {
    await suggestReplyClassification(deps, systemActor('whatsapp.auto-suggest'), { messageId });
    return { status: 'suggested' as const };
  } catch (error) {
    deps.logger.warn(
      { messageId, error: error instanceof Error ? error.name : 'erro' },
      'Sugestão automática de classificação não foi feita',
    );
    return { status: 'skipped' as const };
  }
}
