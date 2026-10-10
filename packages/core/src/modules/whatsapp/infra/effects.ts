import type { IntegrationHealth } from '@docline/db';
import type { UseCaseContext } from '../../../shared/use-case';
import { applyLeadOptOut } from '../../leads';
import { notify } from '../../notifications';
import { describeWhatsappError } from '../domain/errors';

/**
 * Efeitos de uma falha de envio, venha da resposta da API ou do webhook de
 * status (docs/INTEGRATIONS.md §6.2 e §14):
 * - 131050 (o contato pediu ao WhatsApp para parar o marketing): o número vai
 *   para a Lista Não Contatar no WhatsApp e o opt-in cai;
 * - token ou conta com problema: a integração fica marcada e os ADMINs são avisados;
 * - quem pediu o envio recebe um aviso.
 */
export async function applySendFailure(
  ctx: UseCaseContext,
  message: {
    id: string;
    leadId: string;
    contactPointId: string | null;
    createdById: string | null;
  },
  code: string,
  providerName: string,
) {
  const { kind, message: explanation } = describeWhatsappError(code);
  if (kind === 'MARKETING_OPT_OUT' && message.contactPointId) {
    const lead = await ctx.tx.lead.findUniqueOrThrow({
      where: { id: message.leadId },
      select: { id: true, code: true, cnpj: true, cnpjHash: true },
    });
    await applyLeadOptOut(ctx, lead, {
      scope: 'WHATSAPP',
      reason: 'OPT_OUT',
      contactPointId: message.contactPointId,
      source: 'WEBHOOK',
      notes: 'O contato pediu ao WhatsApp para não receber mensagens de marketing da empresa.',
    });
  }
  if (kind === 'AUTH' || kind === 'ACCOUNT') {
    await markConnection(ctx, providerName, kind === 'AUTH' ? 'ERROR' : 'DEGRADED', explanation);
  }
  if (message.createdById) {
    const lead = await ctx.tx.lead.findUnique({
      where: { id: message.leadId },
      select: { displayName: true },
    });
    await notify(ctx.tx, {
      userId: message.createdById,
      type: 'whatsapp.failed',
      title: `WhatsApp não enviado para ${lead?.displayName ?? 'o lead'}`,
      body: explanation,
      leadId: message.leadId,
    });
  }
}

/** Situação da integração; avisa os ADMINs quando ela piora. */
export async function markConnection(
  ctx: UseCaseContext,
  provider: string,
  status: IntegrationHealth,
  error: string | null,
  config?: Record<string, unknown>,
) {
  const before = await ctx.tx.integrationConnection.findUnique({ where: { provider } });
  const data = {
    status,
    lastError: error,
    lastCheckAt: ctx.now,
    ...(config ? { config: JSON.parse(JSON.stringify(config)) } : {}),
  };
  await ctx.tx.integrationConnection.upsert({
    where: { provider },
    create: { provider, ...data },
    update: data,
  });
  const worse =
    (status === 'ERROR' || status === 'DEGRADED') &&
    before?.status !== status &&
    before?.status !== 'ERROR';
  if (!worse) return;
  const admins = await ctx.tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const admin of admins) {
    await notify(ctx.tx, {
      userId: admin.id,
      type: 'whatsapp.integration',
      title: status === 'ERROR' ? 'WhatsApp pela API parou' : 'WhatsApp pela API com problema',
      body: error,
      link: '/configuracoes/whatsapp',
    });
  }
}
