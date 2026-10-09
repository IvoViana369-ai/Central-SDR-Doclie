import { z } from 'zod';
import { InstagramProviderError, type InstagramUserProfile } from '../../../ports/instagram';
import { systemActor, type Actor } from '../../../shared/actor';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import {
  checkAccess,
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
  type UseCaseContext,
} from '../../../shared/use-case';
import { suggestReplyClassification } from '../../ai-sdr';
import { auditLead } from '../../leads';
import { instagramUnmatchedInput, linkInstagramUnmatchedInput } from '../contracts/schemas';
import { describeInstagramError } from '../domain/errors';
import {
  INSTAGRAM_SETTINGS_KEY,
  instagramSettingsSchema,
  resolveInstagramSettings,
} from '../domain/settings';
import { instagramConnectionKey, markInstagramConnection } from '../infra/connection';
import { attachInstagramInbound, instagramHandle, matchInstagramInbound } from '../infra/inbound';

/**
 * Administração do Instagram pela API: conta conectada (F8-01), mensagens de
 * quem não é lead, configuração e a sugestão automática de classificação.
 */

function providerOf(deps: CoreDeps) {
  if (!deps.instagram) {
    throw new BusinessRuleError('O Instagram pela API não está ativo (modo assistido).');
  }
  return deps.instagram;
}

// --- Conta conectada (F8-01) ---------------------------------------------------

const persistAccount = defineUseCase({
  name: 'instagram.account.record',
  access: 'integration.manage',
  input: z.object({
    provider: z.string(),
    code: z.string().nullable(),
    account: z
      .object({
        id: z.string(),
        username: z.string().nullable(),
        name: z.string().nullable(),
        followersCount: z.number().nullable(),
      })
      .nullable(),
  }),
  async run(ctx, input) {
    if (!input.account) {
      const info = describeInstagramError(input.code ?? 'UNKNOWN');
      if (info.kind === 'AUTH') {
        await markInstagramConnection(ctx, input.provider, 'ERROR', info.message);
        return { status: 'ERROR' as const, message: info.message };
      }
      // Falha passageira da consulta: registra sem mudar a situação (não alarma à toa).
      const provider = instagramConnectionKey(input.provider);
      await ctx.tx.integrationConnection.upsert({
        where: { provider },
        create: { provider, lastError: info.message, lastCheckAt: ctx.now },
        update: { lastError: info.message, lastCheckAt: ctx.now },
      });
      return { status: 'unchanged' as const, message: info.message };
    }
    await markInstagramConnection(ctx, input.provider, 'ACTIVE', null, input.account);
    return { status: 'ACTIVE' as const, message: null };
  },
});

/** Confere o token e a conta profissional (ADMIN ou job diário). */
export async function checkInstagramAccount(deps: CoreDeps, actor: Actor, meta: RequestMeta = {}) {
  checkAccess(actor, 'integration.manage');
  const provider = providerOf(deps);
  try {
    const account = await provider.getAccount();
    return persistAccount(deps, actor, { provider: provider.name, code: null, account }, meta);
  } catch (error) {
    if (!(error instanceof InstagramProviderError)) throw error;
    return persistAccount(
      deps,
      actor,
      { provider: provider.name, code: error.details.code, account: null },
      meta,
    );
  }
}

export async function runInstagramAccountCheck(deps: CoreDeps) {
  if (!deps.instagram) return { status: 'disabled' as const };
  return checkInstagramAccount(deps, systemActor('instagram.account-check'));
}

// --- Configuração ------------------------------------------------------------

export const getInstagramSettings = defineUseCase({
  name: 'instagram.settings',
  access: 'authenticated',
  input: z.object({}),
  async run(ctx) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: INSTAGRAM_SETTINGS_KEY } });
    return resolveInstagramSettings(row?.value);
  },
});

export const updateInstagramSettings = defineUseCase({
  name: 'instagram.settings.update',
  access: 'settings.manage',
  input: instagramSettingsSchema,
  async run(ctx, input) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: INSTAGRAM_SETTINGS_KEY } });
    const before = resolveInstagramSettings(row?.value);
    const data = {
      value: toJson(input),
      updatedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
    };
    await ctx.tx.appSetting.upsert({
      where: { key: INSTAGRAM_SETTINGS_KEY },
      create: { key: INSTAGRAM_SETTINGS_KEY, ...data },
      update: data,
    });
    await ctx.audit({
      action: 'instagram.settings',
      entityType: 'app_setting',
      entityId: INSTAGRAM_SETTINGS_KEY,
      changes: Object.fromEntries(
        (Object.keys(input) as (keyof typeof input)[])
          .filter((k) => before[k] !== input[k])
          .map((k) => [k, [before[k], input[k]]]),
      ),
    });
    return input;
  },
});

// --- Mensagens de quem não é lead ----------------------------------------------

async function pendingRow(ctx: UseCaseContext, unmatchedId: string) {
  const row = await ctx.tx.inboundUnmatched.findUnique({ where: { id: unmatchedId } });
  if (!row || row.status !== 'PENDING' || row.channel !== 'INSTAGRAM') {
    throw new NotFoundError('Mensagem pendente não encontrada.');
  }
  return row;
}

async function resolveRow(
  ctx: UseCaseContext,
  row: Awaited<ReturnType<typeof pendingRow>>,
  match: { leadId: string; contactPointId: string | null },
  learned: { handle: string | null; name: string | null },
) {
  await attachInstagramInbound(ctx, match, {
    igsid: row.externalThreadId,
    handle: learned.handle,
    name: learned.name,
    providerMessageId: row.providerMessageId,
    provider: row.provider,
    receivedAt: row.receivedAt,
    body: row.body ?? '[Mensagem sem texto]',
  });
  await ctx.tx.inboundUnmatched.update({
    where: { id: row.id },
    data: {
      status: 'LINKED',
      handle: learned.handle,
      profileName: learned.name,
      resolvedLeadId: match.leadId,
      resolvedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      resolvedAt: ctx.now,
    },
  });
  await auditLead(ctx, match.leadId, 'instagram.unmatched.link', { subjectId: row.id });
  return { leadId: match.leadId };
}

/**
 * Vincula a mensagem a um lead que tem o @ de quem escreveu (cadastre o @ no
 * lead antes, se faltar): a partir daí, vale como resposta.
 */
export const linkInstagramUnmatched = defineUseCase({
  name: 'instagram.unmatched.link',
  access: 'lead.assign',
  input: linkInstagramUnmatchedInput,
  async run(ctx, input) {
    const row = await pendingRow(ctx, input.unmatchedId);
    const lead = await ctx.tx.lead.findUnique({
      where: { id: input.leadId },
      select: { id: true, status: true },
    });
    if (!lead || (lead.status !== 'ACTIVE' && lead.status !== 'ARCHIVED')) {
      throw new NotFoundError('Lead não encontrado.');
    }
    if (!row.handle) {
      throw new BusinessRuleError(
        'O @ de quem escreveu ainda não é conhecido. Use "Procurar de novo" para consultar o perfil.',
      );
    }
    const point = await ctx.tx.contactPoint.findFirst({
      where: {
        leadId: lead.id,
        type: 'INSTAGRAM',
        valueNormalized: row.handle,
        status: { not: 'REMOVED' },
      },
      select: { id: true },
    });
    if (!point) {
      throw new BusinessRuleError(
        `Este lead não tem o @${row.handle}. Cadastre o Instagram no lead e vincule de novo.`,
      );
    }
    return resolveRow(
      ctx,
      row,
      { leadId: lead.id, contactPointId: point.id },
      { handle: row.handle, name: row.profileName },
    );
  },
});

const retryInner = defineUseCase({
  name: 'instagram.unmatched.retry',
  access: 'lead.assign',
  input: instagramUnmatchedInput.extend({
    profile: z.object({ username: z.string().nullable(), name: z.string().nullable() }).nullable(),
  }),
  async run(ctx, input) {
    const row = await pendingRow(ctx, input.unmatchedId);
    const handle = instagramHandle(input.profile?.username) ?? row.handle;
    const name = input.profile?.name ?? row.profileName;
    const match = await matchInstagramInbound(ctx, row.externalThreadId, handle);
    if (match.kind !== 'matched') {
      throw new BusinessRuleError(
        match.candidateLeadIds.length > 1
          ? 'O @ está em mais de um lead: escolha o lead certo.'
          : handle
            ? `Ainda não há lead ativo com o @${handle}. Cadastre o lead (ou o Instagram num lead) e tente de novo.`
            : 'A Meta não informou o @ de quem escreveu. Tente de novo mais tarde.',
      );
    }
    return resolveRow(ctx, row, match, { handle, name });
  },
});

/**
 * "Procurar de novo": consulta o @ na Meta, se ainda faltar (fora da
 * transação), e casa a mensagem como as que chegam pelo webhook.
 */
export async function retryInstagramUnmatched(
  deps: CoreDeps,
  actor: Actor,
  input: unknown,
  meta: RequestMeta = {},
) {
  checkAccess(actor, 'lead.assign');
  const { unmatchedId } = instagramUnmatchedInput.parse(input);
  const row = await deps.db.inboundUnmatched.findUnique({
    where: { id: unmatchedId },
    select: { handle: true, externalThreadId: true },
  });
  let profile: InstagramUserProfile | null = null;
  if (row && !row.handle && deps.instagram) {
    try {
      profile = await deps.instagram.getUserProfile(row.externalThreadId);
    } catch (error) {
      if (!(error instanceof InstagramProviderError)) throw error;
      throw new BusinessRuleError(describeInstagramError(error.details.code).message);
    }
  }
  return retryInner(deps, actor, { unmatchedId, profile }, meta);
}

// --- Sugestão automática de classificação -----------------------------------

/**
 * Job `instagram.suggest-classification`: pede à IA a sugestão para a resposta
 * que acabou de chegar. Só sugere; sem orçamento ou com a IA fora, a pessoa
 * classifica como sempre.
 */
export async function runInstagramSuggestClassification(deps: CoreDeps, data: unknown) {
  const { messageId } = z.object({ messageId: z.uuid() }).parse(data);
  try {
    await suggestReplyClassification(deps, systemActor('instagram.auto-suggest'), { messageId });
    return { status: 'suggested' as const };
  } catch (error) {
    deps.logger.warn(
      { messageId, error: error instanceof Error ? error.name : 'erro' },
      'Sugestão automática de classificação não foi feita',
    );
    return { status: 'skipped' as const };
  }
}
