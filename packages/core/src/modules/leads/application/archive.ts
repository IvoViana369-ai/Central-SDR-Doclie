import { ConflictError } from '../../../shared/errors';
import {
  cancelOpenTasks,
  engagementActorOf,
  refreshNextAction,
  stopLeadEnrollment,
} from '../../engagement';
import { defineUseCase } from '../../../shared/use-case';
import { archiveLeadInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { auditLead, recordLeadEvent } from '../infra/events';
import { requireEditableLead } from '../infra/scope';

/** Arquivar: o lead sai das listas e da operação, mas nunca é excluído (MVP M02). */
export const archiveLead = defineUseCase({
  name: 'leads.archive',
  access: 'lead.update',
  input: archiveLeadInput,
  async run(ctx, { leadId, reason }) {
    const lead = await requireEditableLead(ctx, leadId, { id: true });
    if (lead.status === 'ARCHIVED') return { status: lead.status };
    await ctx.tx.lead.update({
      where: { id: leadId },
      data: { status: 'ARCHIVED', archivedAt: ctx.now, version: { increment: 1 } },
    });
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.archived, {
      payload: reason ? { reason } : {},
    });
    // Lead arquivado sai da cadência e não deixa tarefa aberta.
    await stopLeadEnrollment(
      ctx.tx,
      leadId,
      'LEAD_ARCHIVED',
      ctx.now,
      engagementActorOf(ctx.actor),
    );
    if ((await cancelOpenTasks(ctx.tx, leadId, 'Lead arquivado.')) > 0) {
      await refreshNextAction(ctx.tx, leadId);
    }
    await auditLead(ctx, leadId, 'lead.archive', {
      changes: { status: ['ACTIVE', 'ARCHIVED'] },
      ...(reason ? { metadata: { reason } } : {}),
    });
    return { status: 'ARCHIVED' as const };
  },
});

export const unarchiveLead = defineUseCase({
  name: 'leads.unarchive',
  access: 'lead.update',
  input: archiveLeadInput,
  async run(ctx, { leadId, reason }) {
    const lead = await requireEditableLead(ctx, leadId, { id: true });
    if (lead.status !== 'ARCHIVED') {
      throw new ConflictError('Só leads arquivados podem ser reativados.');
    }
    await ctx.tx.lead.update({
      where: { id: leadId },
      data: {
        status: 'ACTIVE',
        archivedAt: null,
        lastActivityAt: ctx.now,
        version: { increment: 1 },
      },
    });
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.unarchived, {
      payload: reason ? { reason } : {},
    });
    await auditLead(ctx, leadId, 'lead.unarchive', {
      changes: { status: ['ARCHIVED', 'ACTIVE'] },
      ...(reason ? { metadata: { reason } } : {}),
    });
    return { status: 'ACTIVE' as const };
  },
});
