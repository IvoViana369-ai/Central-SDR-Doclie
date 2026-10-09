import { roleHasPermission } from '../../identity';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { loadGateInput } from '../../compliance';
import { auditLead, LEAD_EVENTS, recordLeadEvent, requireEditableLead } from '../../leads';
import { recordWhatsappOptInInput, revokeWhatsappOptInInput } from '../contracts/schemas';

/** Número (telefone ativo) do lead. */
async function requirePhone(ctx: UseCaseContext, leadId: string, contactPointId: string) {
  const point = await ctx.tx.contactPoint.findFirst({
    where: { id: contactPointId, leadId, type: 'PHONE' },
    select: { id: true, status: true },
  });
  if (!point) throw new NotFoundError('Telefone não encontrado neste lead.');
  return point;
}

/**
 * Registra o opt-in do WhatsApp de um número (F7-05; docs/LGPD.md §6). Opt-in
 * é a permissão do próprio número para receber mensagens da empresa no
 * WhatsApp, exigida pela Meta para envio pela API; não substitui a base legal.
 *
 * - "O contato escreveu concordando" (INBOUND_MESSAGE): aponta a mensagem
 *   recebida desse número, que o sistema confere; qualquer pessoa que edita o lead.
 * - Demais métodos (formulário, evento, relacionamento, verbal): descrição da
 *   evidência, e só ADMIN/GESTOR (`permission.update`).
 * - Número na Lista Não Contatar não recebe opt-in: a revogação é do ADMIN.
 */
export const recordWhatsappOptIn = defineUseCase({
  name: 'whatsapp.optIn.record',
  access: 'lead.update',
  input: recordWhatsappOptInInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const point = await requirePhone(ctx, lead.id, input.contactPointId);
    if (point.status !== 'ACTIVE') throw new BusinessRuleError('Este telefone não está ativo.');

    let evidence = input.evidence ?? null;
    if (input.method === 'INBOUND_MESSAGE') {
      if (!input.evidenceMessageId) {
        throw new ValidationError([
          {
            path: 'evidenceMessageId',
            message: 'Escolha a mensagem do contato que comprova o opt-in.',
          },
        ]);
      }
      const message = await ctx.tx.message.findFirst({
        where: {
          id: input.evidenceMessageId,
          leadId: lead.id,
          contactPointId: point.id,
          channel: 'WHATSAPP',
          direction: 'INBOUND',
        },
        select: { id: true, receivedAt: true },
      });
      if (!message) {
        throw new ValidationError([
          {
            path: 'evidenceMessageId',
            message: 'A mensagem precisa ser deste número, recebida pelo WhatsApp.',
          },
        ]);
      }
      evidence ??= 'Mensagem recebida do contato no WhatsApp.';
    } else {
      if (ctx.actor.kind === 'user' && !roleHasPermission(ctx.actor.role, 'permission.update')) {
        throw new ForbiddenError(
          'Só ADMIN ou GESTOR registram opt-in por formulário, evento, relacionamento ou registro verbal.',
        );
      }
      if (!evidence) {
        throw new ValidationError([
          { path: 'evidence', message: 'Descreva a evidência (documento, data, link).' },
        ]);
      }
    }

    const gate = await loadGateInput(ctx.tx, lead.id, ctx.now);
    const gatePoint = gate.contactPoints.find((cp) => cp.id === point.id);
    const suppressed =
      gate.organizationSuppressions.some(
        (s) => s.scope === 'ALL_CHANNELS' || s.scope === 'WHATSAPP',
      ) ||
      gatePoint?.suppressions.some((s) => s.scope === 'ALL_CHANNELS' || s.scope === 'WHATSAPP');
    if (suppressed) {
      throw new BusinessRuleError(
        'Este número está na Lista Não Contatar. Só o ADMIN pode revogar a supressão, se o próprio titular pedir.',
      );
    }

    // A linha do número guarda a base legal vigente do canal (a do lead não muda).
    const basis =
      gate.channelPermissions.find((p) => p.channel === 'WHATSAPP')?.legalBasis ??
      gate.legalBasis ??
      'NOT_ASSESSED';
    const current = await ctx.tx.contactPermission.findFirst({
      where: { contactPointId: point.id, channel: 'WHATSAPP' },
    });
    const data = {
      legalBasis: basis,
      optInStatus: 'GRANTED' as const,
      optInAt: ctx.now,
      optInMethod: input.method,
      evidence,
      evidenceMessageId: input.method === 'INBOUND_MESSAGE' ? input.evidenceMessageId! : null,
      recordedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      recordedAt: ctx.now,
    };
    const permission = current
      ? await ctx.tx.contactPermission.update({ where: { id: current.id }, data })
      : await ctx.tx.contactPermission.create({
          data: { ...data, leadId: lead.id, contactPointId: point.id, channel: 'WHATSAPP' },
        });
    await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.permissionChanged, {
      payload: {
        channel: 'WHATSAPP',
        optInStatus: 'GRANTED',
        method: input.method,
        contactPointId: point.id,
      },
    });
    await auditLead(ctx, lead.id, 'whatsapp.optin', {
      subjectId: permission.id,
      changes: { [`WHATSAPP.${point.id}.optInStatus`]: [current?.optInStatus ?? null, 'GRANTED'] },
      metadata: { method: input.method },
    });
    return { contactPointId: point.id, optInStatus: 'GRANTED' as const, optInAt: ctx.now };
  },
});

/** Revoga o opt-in do WhatsApp de um número (o contato pediu ou a evidência não vale). */
export const revokeWhatsappOptIn = defineUseCase({
  name: 'whatsapp.optIn.revoke',
  access: 'lead.update',
  input: revokeWhatsappOptInInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const point = await requirePhone(ctx, lead.id, input.contactPointId);
    const current = await ctx.tx.contactPermission.findFirst({
      where: { contactPointId: point.id, channel: 'WHATSAPP' },
    });
    if (current?.optInStatus !== 'GRANTED') {
      throw new BusinessRuleError('Este número não tem opt-in do WhatsApp registrado.');
    }
    await ctx.tx.contactPermission.update({
      where: { id: current.id },
      data: {
        optInStatus: 'REVOKED',
        recordedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        recordedAt: ctx.now,
      },
    });
    await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.permissionChanged, {
      payload: { channel: 'WHATSAPP', optInStatus: 'REVOKED', contactPointId: point.id },
    });
    await auditLead(ctx, lead.id, 'whatsapp.optin.revoke', {
      subjectId: current.id,
      changes: { [`WHATSAPP.${point.id}.optInStatus`]: ['GRANTED', 'REVOKED'] },
      ...(input.reason ? { metadata: { reason: input.reason } } : {}),
    });
    return { contactPointId: point.id, optInStatus: 'REVOKED' as const };
  },
});
